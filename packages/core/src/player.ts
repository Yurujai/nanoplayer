/**
 * El reproductor: orquesta manifiesto, ciclo de vida, motores y sincronización.
 *
 * Es la primera pieza que se puede llamar "reproductor", aunque todavía no
 * tenga interfaz. Deliberadamente **sin UI**: los controles son la Fase 2 y se
 * construyen encima de esta API, no dentro.
 *
 * El principio 2 —cero red hasta que el usuario lo pida— se hace cumplir aquí:
 * construir un `Player` no descarga absolutamente nada. Ni el manifiesto.
 */
import {
  ANTICIPACION_MS, VIGILANCIA_MS, firstFrame, type BumperPhase, type ChainPhase,
} from './chain.js';
import type { CoreEvents } from './core-events.js';
import {
  selectEngine, type EngineFactory, type MediaEngine,
} from './engine.js';
import { playerError, type PlayerError } from './errors.js';
import { strings, type Catalogues, type Translate } from './i18n.js';
import { EventBus, type Unsubscribe } from './events.js';
import { Lifecycle } from './lifecycle.js';
import type { LiveStatus, RetryPolicy } from './live.js';
import { LiveBroadcast } from './live-broadcast.js';
import { LiveEdge } from './live-edge.js';
import type { Bumper, Manifest, Stream } from './manifest.js';
import { StallCoordinator } from './stall-coordinator.js';
import { TrimTimeline, type TrimRange } from './trim-timeline.js';
import { nativeEngineFactory } from './native-engine.js';
import type { UiSlots } from './slots.js';
import type { PlayerState } from './state.js';
import { Synchronizer, type SyncProfile } from './sync.js';
import {
  isAudioOnlyManifest, masterStream, slaveStreams, trimOf,
} from './manifest-queries.js';
import { validateManifest } from './validate.js';

/** Resuelve el origen del manifiesto. Reemplazable para agrupar peticiones. */
export type ManifestResolver = (src: string) => Promise<unknown>;

export interface PlayerOptions {
  /** Dónde se montan los elementos multimedia. */
  container: HTMLElement;
  /** Manifiesto ya cargado, o una URL de la que traerlo. */
  manifest: Manifest | Record<string, unknown> | string;
  /**
   * Motores disponibles, por orden de preferencia. A igualdad de confianza
   * gana el primero, así que registrar uno con hls.js delante bastaría para
   * anteponerlo sin tocar nada más.
   */
  engines?: readonly EngineFactory[];
  /**
   * Cómo traer un manifiesto por URL. El punto de extensión que permite
   * resolver varios de golpe en una sola petición: en una página con 32
   * reproductores, convierte 32 llamadas en una.
   */
  manifestResolver?: ManifestResolver;
  /**
   * Imagen previa, disponible **sin resolver el manifiesto**.
   *
   * Hay un círculo vicioso si el póster solo vive dentro del manifiesto: para
   * enseñarlo habría que pedirlo, que es justo la petición que el estado `idle`
   * existe para evitar. En la práctica quien integra ya tiene la miniatura a
   * mano —viene en el listado que pinta la página—, así que se pasa aquí.
   */
  poster?: string;
  muted?: boolean;
  volume?: number;
  /** Perfil de sincronización. Por defecto se detecta el del motor. */
  syncProfile?: SyncProfile;
  /** Espera entre reintentos cuando un directo aún no emite. */
  liveRetry?: RetryPolicy;
  /**
   * Idioma de la interfaz. Por defecto, el del documento que contiene al
   * reproductor; `es` si tampoco lo declara.
   *
   * Vive aquí y no en la barra de controles porque los plugins también lo
   * necesitan, y antes cada uno lo deducía por su cuenta: dos formas distintas
   * de mirar `document.documentElement.lang` acaban discrepando.
   */
  lang?: string;
  /** Cadenas propias, que mandan sobre las registradas por cada paquete. */
  strings?: Catalogues;
}

const resolverPorDefecto: ManifestResolver = async (src) => {
  const res = await fetch(src);
  if (!res.ok) {
    throw playerError('manifest/fetch', `${res.status} ${res.statusText} requesting ${src}`);
  }
  return res.json();
};

export class Player {
  readonly bus = new EventBus<CoreEvents>();
  readonly #lc = new Lifecycle(this.bus);
  readonly #opts: PlayerOptions;
  readonly #engines: readonly EngineFactory[];

  #manifest: Manifest | null = null;
  #instancias = new Map<string, MediaEngine>();
  #sync: Synchronizer | null = null;
  #cajas: HTMLElement[] = [];
  #ui: UiSlots | null = null;
  readonly #emision: LiveBroadcast;
  readonly #borde = new LiveEdge(() => this.master);
  readonly #t: Translate;
  readonly #atascos = new StallCoordinator(() => this.#instancias.entries());
  /** El timeline del recorte, y de qué manifiesto salió: se rehace solo si cambia. */
  #linea = new TrimTimeline(null);
  #lineaDe: Manifest | null = null;
  /** El manifiesto que vino ya cargado, validado una sola vez. */
  #provisional: Manifest | null = null;
  #provisionalMirado = false;
  /** Ya se avisó del final del recorte. Evita repetir `ended` en cada `time`. */
  #finRecorteAvisado = false;

  /** Pieza que se ve. Sin cabecera, se empieza directamente en el contenido. */
  #fase: ChainPhase = 'main';
  /** Motores de la cabecera y la cola, que van aparte de los del contenido. */
  #piezas = new Map<BumperPhase, { engine: MediaEngine; caja: HTMLElement }>();
  /** Hacia dónde se está cambiando, o `null`. Mientras dura, nadie manda. */
  #conmutando: ChainPhase | null = null;
  /** Se incrementa para dar por cancelado un cambio en curso. */
  #turno = 0;
  #vigilante: ReturnType<typeof setInterval> | undefined;
  /** Si ya se desbloquearon las piezas posteriores en este enganche. */
  #desbloqueado = false;
  /** La cola terminó: la cadena entera está vista. */
  #finCadena = false;
  /** Lo que el usuario pidió, para aplicarlo a cada pieza al descubrirla. */
  #mudo: boolean;
  /** El volumen elegido. Sobrevive a un desalojo: se reaplica al enganchar. */
  #volumen: number;

  constructor(options: PlayerOptions) {
    this.#opts = options;
    this.#mudo = options.muted === true;
    this.#volumen = options.volume ?? 1;
    this.#emision = new LiveBroadcast({
      bus: this.bus,
      ...(options.liveRetry ? { retry: options.liveRetry } : {}),
      reconnect: (id) => { void this.#reintentar(id); },
    });
    this.#engines = options.engines ?? [nativeEngineFactory];
    // Del documento del contenedor y no del global `document`: dentro de un
    // iframe el idioma que manda es el del iframe.
    const idioma = options.lang
      ?? options.container.ownerDocument.documentElement.lang;
    this.#t = strings.translator(idioma || '', options.strings);
  }

  /**
   * Traduce una clave del catálogo compartido.
   *
   * Lo usan la interfaz y los plugins, para que todos digan lo mismo en el
   * mismo idioma sin tener que ponerse de acuerdo entre ellos.
   */
  get t(): Translate { return this.#t; }

  /** Idioma resuelto. Es el que hay que pasarle a `Intl`. */
  get lang(): string { return this.#t.lang; }

  /** El elemento donde se montan los medios. Lo necesita el registro para
   *  observar visibilidad sin que el integrador tenga que repetírselo. */
  get container(): HTMLElement { return this.#opts.container; }

  /**
   * Los anclajes de interfaz, si hay una montada.
   *
   * El núcleo no depende de la capa de interfaz: solo guarda quien se anuncie
   * y avisa por el bus. Un plugin usa `whenUi()` para no tener que preocuparse
   * de si llegó antes o después.
   */
  get ui(): UiSlots | null { return this.#ui; }

  /** Lo llama la capa de interfaz al montarse. */
  setUi(slots: UiSlots | null): void {
    this.#ui = slots;
    if (slots) this.bus.emit('ui:ready', {});
  }

  get state(): PlayerState { return this.#lc.state; }
  get manifest(): Manifest | null { return this.#manifest; }

  /**
   * URL del póster, si se conoce, sin obligar a resolver nada.
   *
   * Por orden: lo que dijo el integrador, lo que trae el manifiesto si vino ya
   * cargado, y por último el manifiesto resuelto.
   */
  get poster(): string | undefined {
    return this.#opts.poster || this.#conocido()?.poster;
  }

  /**
   * El manifiesto resuelto o, si vino ya cargado, ese mismo validado.
   *
   * Es lo que permite saber póster, recorte o si es solo audio sin tocar la
   * red. Se valida una vez: antes cada lectura de `audioOnly` volvía a validar.
   */
  #conocido(): Manifest | null {
    if (this.#manifest) return this.#manifest;
    if (!this.#provisionalMirado) {
      this.#provisionalMirado = true;
      const src = this.#opts.manifest;
      if (typeof src === 'object') {
        const r = validateManifest(src);
        if (r.ok) this.#provisional = r.manifest;
      }
    }
    return this.#provisional;
  }
  get resumeAt(): number { return this.#lc.resumeAt; }

  /** Motor del stream que lleva el audio: el que gobierna el reloj. */
  get master(): MediaEngine | null {
    if (!this.#manifest) return null;
    return this.#instancias.get(masterStream(this.#manifest).id) ?? null;
  }

  /** Estado de emisión del conjunto. `unknown` si no es un directo. */
  get liveStatus(): LiveStatus {
    return this.#emision.overall;
  }

  /** Estado de emisión de un flujo concreto. */
  liveStatusOf(streamId: string): LiveStatus {
    return this.#emision.status(streamId);
  }

  /** Imagen para la espera de un directo. Cae al póster si no hay una propia. */
  get liveWaitingImage(): string | undefined {
    return this.#conocido()?.liveWaitingImage || this.poster;
  }

  /**
   * Si no hay ninguna imagen que enseñar.
   *
   * Lo consulta la interfaz para mantener el póster puesto durante la
   * reproducción, en vez de dejar un rectángulo negro. Se puede saber sin
   * resolver si el manifiesto vino ya cargado.
   */
  get audioOnly(): boolean {
    const m = this.#conocido();
    return m ? isAudioOnlyManifest(m) : false;
  }

  /* ------------------------------------------------------------- directo -- */

  /** Cuánto se puede retroceder en un directo, en segundos. */
  get dvrWindow(): number {
    return this.#borde.window;
  }

  /** Posición más reciente disponible. */
  get liveEdge(): number {
    return this.#borde.edge;
  }

  /** Cuántos segundos por detrás del borde se está reproduciendo. */
  get behindLive(): number {
    return this.#manifest?.live ? this.#borde.behind(this.currentTime) : 0;
  }

  /** Si se está viendo el directo, con la tolerancia del búfer normal. */
  get atLiveEdge(): boolean {
    return !!this.#manifest?.live && this.#borde.isAtEdge(this.currentTime);
  }

  /** Salta al directo, a la posición que recomienda el motor o con margen. */
  seekToLive(): void {
    if (!this.#manifest?.live) return;
    const destino = this.#borde.seekTarget;
    if (destino !== null) this.seek(destino);
  }

  /* ------------------------------------------------------------- recorte -- */

  /**
   * El recorte, buscándolo en el manifiesto sin resolver si hace falta.
   *
   * Igual que con el póster: cuando el manifiesto viene ya cargado no hay por
   * qué esperar a `resolve()` para saber cuánto dura el recorte. Así la barra
   * puede pintar `0:15` antes de que se descargue un solo byte.
   */
  #timeline(): TrimTimeline {
    const m = this.#conocido();
    if (m !== this.#lineaDe) {
      this.#lineaDe = m;
      this.#linea = new TrimTimeline(m ? trimOf(m) : null);
    }
    return this.#linea;
  }

  /**
   * De tiempo del medio al que se enseña. Público para que la interfaz y los
   * plugins, que reciben tiempos del manifiesto, no repitan la cuenta.
   */
  toVisibleTime(medio: number): number {
    return this.#timeline().toVisible(medio);
  }

  /** Del tiempo que se enseña al del medio, acotado al recorte. */
  toMediaTime(visible: number): number {
    return this.#timeline().toMedia(visible);
  }

  /** El recorte en vigor, o `null`. La interfaz lo usa para colocar marcas. */
  get trim(): TrimRange | null {
    const r = this.#timeline().range;
    return r ? { ...r } : null;
  }

  get currentTime(): number {
    // Durante la cola el contenido ya ha terminado, aunque el maestro se haya
    // parado unos milisegundos antes: el cambio se anticipa.
    if (this.#fase === 'outro') return this.duration;
    const m = this.master;
    return m ? this.toVisibleTime(m.currentTime) : this.#lc.resumeAt;
  }

  get duration(): number {
    const recortada = this.#timeline().duration;
    if (recortada !== null) return recortada;
    // El motor dice 0 mientras no tiene metadatos, que en iOS es hasta el
    // primer play: mientras tanto vale más la duración que trae el manifiesto.
    const delMotor = this.master?.duration ?? 0;
    return delMotor > 0 ? delMotor : this.#manifest?.duration ?? 0;
  }

  get paused(): boolean { return this.#motorActual()?.paused ?? true; }

  /** Pieza de la cadena que se está viendo. */
  get phase(): ChainPhase { return this.#fase; }

  /** Si ahora mismo se puede saltar algo. Solo la cabecera; la cola, nunca. */
  get canSkip(): boolean { return this.#fase === 'intro' && this.#conmutando === null; }

  on<K extends keyof CoreEvents & string>(
    type: K, fn: (payload: CoreEvents[K]) => void,
  ): Unsubscribe {
    return this.bus.on(type, fn);
  }

  /* ------------------------------------------------------- idle → resolved */

  /** Trae y valida el manifiesto. Es la primera —y única— petición hasta el play. */
  async resolve(): Promise<Manifest> {
    if (this.#manifest) return this.#manifest;
    this.#lc.transition('resolving');
    this.bus.emit('manifest:resolve:start', {});

    try {
      const src = this.#opts.manifest;
      const crudo = typeof src === 'string'
        ? await (this.#opts.manifestResolver ?? resolverPorDefecto)(src)
        : src;

      const r = validateManifest(crudo);
      if (!r.ok) {
        const detalle = r.errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ');
        throw playerError('manifest/invalid', `Invalid manifest — ${detalle}`);
      }
      this.#manifest = r.manifest;
      if (r.manifest.intro) this.#ponerFase('intro');
      this.#lc.transition('resolved');
      this.bus.emit('manifest:resolve:ok', { manifest: r.manifest });
      return r.manifest;
    } catch (error) {
      this.#lc.transition('idle');
      const pe = this.#comoPlayerError(error, 'manifest/fetch');
      this.bus.emit('manifest:resolve:fail', { error: pe });
      this.bus.emit('error', { error: pe });
      throw pe;
    }
  }

  /* --------------------------------------------------- resolved → attached */

  /**
   * Crea los motores y sus elementos. Aquí empieza a bajar vídeo.
   *
   * Si viene de un desalojo, retoma en `resumeAt` y **cuadra los esclavos con
   * el maestro antes de empezar**: enganchar en secuencia deja un retraso de
   * partida de decenas de milisegundos que no es deriva y que la corrección
   * suave no arreglaría por sí sola.
   */
  async attach(): Promise<void> {
    const m = this.#manifest ?? await this.resolve();
    if (this.#lc.hasEngine) return;

    this.#lc.transition('attaching');
    this.bus.emit('engine:attach:start', {});

    try {
      let nombreMotor = 'native';
      const fallidos: string[] = [];

      // La cabecera primero: es lo que se va a ver antes. Si ya se vio o se
      // saltó, no se engancha.
      if (m.intro && this.#fase === 'intro') await this.#engancharPieza('intro', m.intro);

      for (const stream of m.streams) {
        try {
          nombreMotor = await this.#engancharStream(stream);
          if (m.live) this.#emision.markLive(stream.id);
        } catch (error) {
          /*
           * En directo, que un flujo no esté emitiendo **no impide reproducir
           * los demás**. Es el caso de la cámara que arranca antes que las
           * diapositivas, o de una de las dos que se cae: bloquear ambas
           * porque falta una sería peor experiencia que enseñar la que hay.
           *
           * Bajo demanda no aplica: si una fuente falta, el contenido está
           * incompleto y hay que decirlo.
           */
          if (!m.live) throw error;
          fallidos.push(stream.id);
          this.#emision.markUnavailable(stream.id);
          this.#emision.retryLater(stream.id);
        }
      }

      if (m.live && fallidos.length === m.streams.length) {
        // Ninguno emite todavía: se vuelve a `resolved` y se sigue esperando.
        this.#lc.transition('resolved');
        this.bus.emit('engine:attach:fail', {
          error: playerError('media/network',
            'The live stream is not broadcasting yet', undefined),
        });
        return;
      }

      /*
       * La cola se engancha ya, aunque falte una hora para usarla. Es el
       * precio de poder desbloquearla en el gesto del usuario (variante A de
       * S6): en iOS el permiso de reproducir es de cada elemento, y un
       * elemento creado al final no tendría gesto detrás.
       */
      if (m.outro) await this.#engancharPieza('outro', m.outro);

      this.#montarSync(m);
      this.#lc.transition('attached');
      this.bus.emit('engine:attach:ok', {
        engine: nombreMotor, resumeAt: this.#lc.resumeAt,
      });
    } catch (error) {
      this.#soltarMotores();
      this.#lc.transition('resolved');
      const pe = this.#comoPlayerError(error, 'engine/failed');
      this.bus.emit('engine:attach:fail', { error: pe });
      this.bus.emit('error', { error: pe });
      throw pe;
    }
  }

  /**
   * Engancha un solo flujo. Devuelve el nombre del motor elegido.
   *
   * En directo, **la caja del flujo se conserva aunque falle**: es el hueco
   * donde la interfaz pone el aviso de que ese flujo no emite. Sin ella el
   * mensaje acabaría encima del flujo que sí funciona, que es justo al revés
   * de lo que hay que enseñar.
   */
  async #engancharStream(stream: Stream): Promise<string> {
    const factory = selectEngine(this.#engines, stream);
    if (!factory) {
      throw playerError('engine/unsupported',
        `No engine can play stream "${stream.id}"`);
    }
    // Reutilizar la caja si ya existe: un reintento no debe duplicarla.
    let caja = this.#cajas.find((c) => c.dataset['stream'] === stream.id);
    if (!caja) {
      caja = document.createElement('div');
      caja.dataset['stream'] = stream.id;
      caja.dataset['role'] = stream.role;
      this.#opts.container.appendChild(caja);
      this.#cajas.push(caja);
    }

    const engine = factory.create();
    this.#instancias.set(stream.id, engine);
    try {
      await engine.attach(caja, stream, {
        // `resumeAt` está en tiempo visible; el motor quiere el del medio. Sin
        // recorte son lo mismo, y con él esto es lo que hace que un enganche
        // en frío empiece en `start` y no en el segundo cero del fichero.
        startAt: this.toMediaTime(this.#lc.resumeAt),
        // Con cabecera, el contenido espera detrás en silencio hasta descubrirse.
        muted: this.#mudo || !stream.audio || this.#fase === 'intro',
        playsInline: true,
        callbacks: this.#callbacks(stream),
      });
    } catch (error) {
      engine.destroy();
      this.#instancias.delete(stream.id);
      // Bajo demanda no hay nada que esperar, así que la caja sobra. En directo
      // se queda: es el hueco donde va el aviso mientras el flujo no emite.
      if (!this.#manifest?.live) {
        caja.remove();
        this.#cajas = this.#cajas.filter((c) => c !== caja);
      }
      throw error;
    }
    if (stream.audio) {
      engine.setVolume(this.#volumen);
    }
    return factory.name;
  }

  /**
   * Engancha la cabecera o la cola.
   *
   * Si falla, **se omite y el contenido sigue**: una cabecera rota no puede
   * impedir ver la clase. Se avisa por `chain:unavailable`, no por `error`,
   * porque la interfaz trata `error` como algo que para la reproducción.
   */
  async #engancharPieza(fase: BumperPhase, pieza: Bumper): Promise<void> {
    const stream: Stream = { id: fase, role: fase, audio: true, sources: pieza.sources };
    const caja = document.createElement('div');
    caja.dataset['bumper'] = fase;
    let engine: MediaEngine | null = null;
    try {
      const factory = selectEngine(this.#engines, stream);
      if (!factory) {
        throw playerError('engine/unsupported', `No engine can play the ${fase}`);
      }
      this.#opts.container.appendChild(caja);
      engine = factory.create();
      await engine.attach(caja, stream, {
        // La cola suena después de mucho rato: hasta descubrirla va muda.
        muted: fase === 'outro' || this.#mudo,
        playsInline: true,
        callbacks: this.#callbacksPieza(fase),
      });
      engine.setVolume(this.#volumen);
      this.#piezas.set(fase, { engine, caja });
    } catch (error) {
      engine?.destroy();
      caja.remove();
      this.#omitirPieza(fase, error);
      if (fase === 'intro') this.#ponerFaseYAvisar('main', false);
    }
  }

  /** Quita una pieza que no se puede reproducir y sigue sin ella. */
  #omitirPieza(fase: BumperPhase, error: unknown): void {
    const p = this.#piezas.get(fase);
    if (p) {
      p.engine.destroy();
      p.caja.remove();
      this.#piezas.delete(fase);
    }
    this.bus.emit('chain:unavailable', {
      phase: fase, error: this.#comoPlayerError(error, 'engine/failed'),
    });
  }

  /** Vuelve a intentar un flujo de directo que no emitía. */
  async #reintentar(streamId: string): Promise<void> {
    const stream = this.#manifest?.streams.find((s) => s.id === streamId);
    if (this.#lc.isDestroyed || !this.#manifest?.live || !stream) return;
    // Si ya no hay motores montados, el reproductor está desalojado: no tiene
    // sentido seguir insistiendo hasta que alguien vuelva a engancharlo.
    if (!this.#lc.hasEngine && this.#lc.state !== 'resolved') return;

    try {
      await this.#engancharStream(stream);
      this.#emision.markLive(stream.id);
      // Si el reproductor estaba esperando a que empezara algo, ya hay señal.
      if (this.#lc.state === 'resolved') {
        this.#lc.transition('attaching');
        this.#lc.transition('attached');
      }
      this.#montarSync(this.#manifest);
      if (this.#lc.state === 'active' || this.#atascos.playing) {
        await this.#instancias.get(stream.id)?.play().catch(() => {});
      }
    } catch {
      this.#emision.markUnavailable(stream.id);
      this.#emision.retryLater(stream.id);
    }
  }

  #montarSync(m: Manifest): void {
    const esclavos = slaveStreams(m)
      .map((s) => ({ id: s.id, engine: this.#instancias.get(s.id) }))
      .filter((x): x is { id: string; engine: MediaEngine } => !!x.engine);
    if (esclavos.length === 0) return;

    const maestro = this.#instancias.get(masterStream(m).id);
    if (!maestro) return;

    this.#sync = new Synchronizer({
      master: { id: masterStream(m).id, engine: maestro },
      slaves: esclavos,
      live: m.live === true,
      bus: this.bus,
      ...(this.#opts.syncProfile ? { profile: this.#opts.syncProfile } : {}),
    });
    this.#sync.align();
  }

  /* ------------------------------------------------------ attached → resolved */

  /**
   * Suelta los motores conservando la posición.
   *
   * Es lo que permite que una página tenga muchos más reproductores que
   * decodificadores: S2 midió el techo del navegador en 17 elementos
   * simultáneos en WebKit y 18 en Blink.
   */
  detach(): void {
    if (!this.#lc.hasEngine) return;
    if (this.#lc.state === 'active') {
      this.pause();
      /*
       * El evento `pause` del elemento es asíncrono, así que puede no haber
       * llegado todavía y el estado seguir en `active`. Como la máquina de
       * estados prohíbe `active` → `resolved` a propósito —para que nadie
       * arranque el motor de debajo de una reproducción en curso—, aquí se
       * cierra el paso intermedio a mano.
       *
       * Con MP4 no se notaba porque el evento llega en el mismo turno; con
       * hls.js sí, y así apareció.
       */
      if (this.#lc.state === 'active') this.#lc.transition('attached');
    }
    const at = this.currentTime;
    this.#lc.rememberPosition(at);
    this.#soltarMotores();
    this.#lc.transition('resolved');
    this.bus.emit('engine:detach', { at });
  }

  #soltarMotores(): void {
    this.#emision.cancelRetries();
    this.#sync?.stop();
    this.#sync = null;
    for (const e of this.#instancias.values()) e.destroy();
    this.#instancias.clear();
    /*
     * Las piezas no conservan posición: duran segundos, y retomar una cabecera
     * a la mitad no tiene sentido. La fase sí se conserva, así que al volver
     * se empieza la misma pieza desde el principio.
     */
    clearInterval(this.#vigilante);
    this.#turno++;
    this.#conmutando = null;
    this.#desbloqueado = false;
    for (const { engine, caja } of this.#piezas.values()) {
      engine.destroy();
      caja.remove();
    }
    this.#piezas.clear();
    // Sin esto, un flujo que estaba atascado al soltar el motor dejaría el
    // conjunto marcado como atascado para siempre y nadie volvería a reanudar.
    this.#atascos.reset();
    this.#finRecorteAvisado = false;
    for (const caja of this.#cajas) caja.remove();
    this.#cajas = [];
  }

  /* ------------------------------------------------------------ reproducción */

  async play(): Promise<void> {
    if (!this.#lc.hasEngine) await this.attach();
    const m = this.#manifest;
    if (!m) return;
    // En pleno cambio de pieza ya hay algo arrancando.
    if (this.#conmutando) return;

    this.#desbloquear();

    // Dar al play con la cadena terminada vuelve al contenido, sin repetir la
    // cabecera: ya se vio, y se podía saltar.
    if (this.#finCadena) {
      this.#finCadena = false;
      this.#piezas.get('outro')?.engine.seek(0);
      this.#ponerFaseYAvisar('main', false);
      this.seek(0);
    }

    if (this.#fase !== 'main') {
      const pieza = this.#piezas.get(this.#fase);
      if (pieza) {
        pieza.engine.setMuted(this.#mudo);
        await pieza.engine.play();
        this.#vigilar();
        return;
      }
      // La pieza se perdió por el camino: se sigue con el contenido.
      this.#ponerFaseYAvisar('main', false);
    }
    await this.#reproducirContenido(m);
    this.#vigilar();
  }

  /** Arranca los flujos del contenido. */
  async #reproducirContenido(m: Manifest): Promise<void> {
    // Dar al play con el recorte terminado vuelve al principio, que es lo que
    // hace un <video> al final del medio. Sin esto se quedaría clavado.
    if (this.#finRecorteAvisado) {
      this.#finRecorteAvisado = false;
      this.seek(0);
    }

    // El maestro primero: es quien fija el reloj que los demás persiguen.
    const maestro = this.master;
    if (maestro) await maestro.play();
    for (const [id, e] of this.#instancias) {
      if (id !== masterStream(m).id) await e.play().catch(() => {});
    }

    // Cuadrar antes de arrancar el lazo: si no, el retraso de partida se
    // quedaría como offset y la corrección suave tardaría en absorberlo.
    this.#sync?.align();
    this.#sync?.start();

    // El cambio de estado y el evento los dispara el callback `onPlay` del
    // motor, que es quien sabe si de verdad ha empezado a sonar.
  }

  pause(): void {
    // Pausar en pleno cambio lo cancela: se queda en la pieza de antes, y al
    // reanudar la vigilancia vuelve a disparar el cambio.
    this.#cancelarCambio();
    clearInterval(this.#vigilante);
    this.#sync?.stop();
    this.#atascos.userPaused();
    for (const e of this.#instancias.values()) e.pause();
    for (const { engine } of this.#piezas.values()) engine.pause();
  }

  /**
   * Salta la cabecera. Solo la cabecera: **la cola no se puede saltar**, y por
   * eso no hay un `skipOutro()`.
   *
   * Reutiliza el mismo camino que el cambio anticipado —arrancar el contenido,
   * esperar su primer fotograma, conmutar—, así que tampoco deja hueco: la
   * cabecera sigue a la vista hasta que el contenido tiene imagen (S6).
   */
  skipIntro(): void {
    if (!this.canSkip) return;
    if (!this.#lc.hasEngine) {
      // Aún no hay nada enganchado: basta con no empezar por ella.
      this.#ponerFaseYAvisar('main', true);
      return;
    }
    void this.#pasarA('main', true);
  }

  /** Salta. `seconds` va en tiempo visible, y se acota al recorte si lo hay. */
  seek(seconds: number): void {
    if (this.#fase === 'outro') {
      // Hacia delante no hay nada: la cola no se salta. Hacia atrás se vuelve
      // al contenido, y al llegar otra vez al final la cola suena de nuevo.
      if (seconds >= this.duration) return;
      this.#volverDeLaCola(seconds);
      return;
    }
    // Retroceder mientras se preparaba la cola la deja para más adelante.
    if (this.#conmutando === 'outro') {
      const sonaba = this.#lc.state === 'active';
      this.#cancelarCambio();
      if (sonaba && this.#manifest) {
        void this.#reproducirContenido(this.#manifest).then(() => this.#vigilar());
      }
    }
    const maestro = this.master;
    if (!maestro) {
      this.#lc.rememberPosition(Math.max(0, Math.min(this.duration || seconds, seconds)));
      return;
    }
    const destino = Math.max(0, seconds);
    // Saltar hacia atrás vuelve a meter la reproducción dentro del recorte, así
    // que el final tiene que poder volver a anunciarse.
    if (this.#timeline().range && destino < this.duration) this.#finRecorteAvisado = false;
    const from = this.toVisibleTime(maestro.currentTime);
    this.bus.emit('seek:start', { from, to: destino });
    maestro.seek(this.toMediaTime(destino));
    // Los esclavos van de golpe: perseguir un salto con corrección suave
    // tardaría segundos y se vería.
    this.#sync?.align();
    this.bus.emit('seek:end', { at: destino });
  }

  get volume(): number { return this.#volumen; }
  get muted(): boolean { return this.#mudo; }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.#volumen = Math.min(1, Math.max(0, volume));
    this.master?.setVolume(this.#volumen);
    for (const { engine } of this.#piezas.values()) engine.setVolume(this.#volumen);
    this.bus.emit('volumechange', { volume: this.#volumen, muted: this.#mudo });
  }

  setMuted(muted: boolean): void {
    // Se guarda para aplicarlo a cada pieza al descubrirla: las que esperan
    // detrás van mudas hasta entonces, se haya pedido o no.
    this.#mudo = muted;
    if (!this.#conmutando) this.#motorActual()?.setMuted(muted);
    this.bus.emit('volumechange', { volume: this.#volumen, muted });
  }

  setPlaybackRate(rate: number): void {
    // Solo al maestro: los esclavos lo heredan por el lazo de sincronización,
    // que ajusta su velocidad relativa a la de él.
    this.master?.setPlaybackRate(rate);
    this.bus.emit('ratechange', { rate });
  }

  destroy(): void {
    if (this.#lc.isDestroyed) return;
    this.#emision.reset();
    this.#soltarMotores();
    this.#lc.destroy();
    this.bus.clear();
  }

  /* ------------------------------------------------------ cabecera y cola */

  /** El motor de la pieza que se ve: la cabecera, la cola o el maestro. */
  #motorActual(): MediaEngine | null {
    if (this.#fase === 'main') return this.master;
    return this.#piezas.get(this.#fase)?.engine ?? null;
  }

  /**
   * Cambia la pieza visible. **Un solo atributo**: la interfaz decide con él
   * qué se ve, y cambiarlo de golpe es lo que hace el cambio instantáneo.
   */
  #ponerFase(fase: ChainPhase): void {
    this.#fase = fase;
    this.#opts.container.dataset['phase'] = fase;
  }

  #ponerFaseYAvisar(fase: ChainPhase, skipped: boolean): void {
    const from = this.#fase;
    if (from === fase) return;
    this.#ponerFase(fase);
    this.bus.emit('chain:phase', { from, to: fase, skipped });
  }

  /** Da por cancelado el cambio en curso y deja la pieza entrante parada. */
  #cancelarCambio(): void {
    const destino = this.#conmutando;
    if (!destino) return;
    this.#turno++;
    this.#conmutando = null;
    if (destino === 'main') {
      this.#sync?.stop();
      for (const e of this.#instancias.values()) e.pause();
    } else {
      const e = this.#piezas.get(destino)?.engine;
      e?.pause();
      e?.seek(0);
    }
  }

  /** Retroceder desde la cola: vuelve al contenido sin anticipación. */
  #volverDeLaCola(seconds: number): void {
    const cola = this.#piezas.get('outro')?.engine;
    const sonaba = !!cola && !cola.paused;
    this.#finCadena = false;
    // La fase cambia antes de pausar la cola para que su pausa no cuente como
    // una pausa del usuario.
    this.#ponerFaseYAvisar('main', false);
    cola?.pause();
    cola?.seek(0);
    this.master?.setMuted(this.#mudo);
    this.seek(seconds);
    if (sonaba && this.#manifest) {
      void this.#reproducirContenido(this.#manifest).then(() => this.#vigilar());
    }
  }

  /**
   * Desbloquea las piezas que vendrán después, en el mismo arranque que pidió
   * el usuario (variante A de S6).
   *
   * En iOS el permiso de reproducir con sonido es **de cada elemento**. La
   * pieza siguiente arranca desde un temporizador, sin gesto detrás, y al
   * quitarle el silencio el navegador podría pausarla. Un `play()` seguido de
   * `pause()` dentro del gesto la deja autorizada.
   *
   * En un iPhone con Safari 26.5 **no hizo falta** (S6 §5): sin desbloquear, el
   * cambio tampoco se rechazó ni se pausó. Se mantiene hasta medirlo en un iOS
   * anterior, donde la política por elemento podría seguir aplicándose.
   */
  #desbloquear(): void {
    if (this.#desbloqueado) return;
    this.#desbloqueado = true;
    const despues: MediaEngine[] = [];
    if (this.#fase === 'intro') despues.push(...this.#instancias.values());
    const cola = this.#piezas.get('outro')?.engine;
    if (cola && this.#fase !== 'outro') despues.push(cola);
    for (const e of despues) {
      if (!e.paused) continue;
      const t = e.currentTime;
      e.setMuted(true);
      const p = e.play();
      e.pause();
      e.seek(t);
      void p.catch(() => {});
    }
  }

  /** Qué pieza va después de la actual, si hay alguna. */
  #siguiente(): ChainPhase | null {
    if (this.#fase === 'intro') return 'main';
    if (this.#fase === 'main' && this.#piezas.has('outro')) return 'outro';
    return null;
  }

  /** Segundos que le quedan a la pieza actual, a la velocidad actual. */
  #restante(): number {
    if (this.#fase !== 'main') {
      const e = this.#piezas.get(this.#fase)?.engine;
      return e ? e.duration - e.currentTime : NaN;
    }
    const m = this.master;
    if (!m) return NaN;
    const fin = this.#timeline().range?.end ?? m.duration;
    return (fin - m.currentTime) / (m.getPlaybackRate() || 1);
  }

  /**
   * Vigila el final de la pieza actual para arrancar la siguiente a tiempo.
   *
   * Con temporizador y no con `timeupdate`: ese evento llega a unos 4 Hz, y
   * con 250 ms entre avisos la anticipación de 600 ms fallaría a menudo.
   */
  #vigilar(): void {
    clearInterval(this.#vigilante);
    if (!this.#siguiente()) return;
    this.#vigilante = setInterval(() => {
      const sig = this.#siguiente();
      if (!sig || this.#conmutando || this.#motorActual()?.paused !== false) return;
      const r = this.#restante();
      if (Number.isFinite(r) && r * 1000 <= ANTICIPACION_MS) void this.#pasarA(sig, false);
    }, VIGILANCIA_MS);
  }

  /**
   * Cambia a la pieza siguiente sin que se vea el salto.
   *
   * 1. Arranca la entrante **en silencio**, con la saliente todavía a la vista.
   * 2. Espera a su primer fotograma, no a que acepte el `play()`.
   * 3. Conmuta de golpe: la hace visible, le da el sonido y para la saliente.
   *
   * Mientras dura, los avisos de los dos motores no cuentan: la entrante aún
   * no es la que se ve, y la saliente va a pararse por diseño.
   */
  async #pasarA(destino: ChainPhase, saltada: boolean): Promise<void> {
    if (this.#conmutando || destino === this.#fase) return;
    const m = this.#manifest;
    if (!m) return;
    const origen = this.#fase;
    const turno = ++this.#turno;
    this.#conmutando = destino;
    clearInterval(this.#vigilante);

    let entrante: MediaEngine | null;
    try {
      if (destino === 'main') {
        this.master?.setMuted(true);
        await this.#reproducirContenido(m);
        entrante = this.master;
      } else {
        entrante = this.#piezas.get(destino)?.engine ?? null;
        if (entrante) {
          entrante.setMuted(true);
          entrante.seek(0);
          await entrante.play();
        }
      }
      if (entrante) await firstFrame(entrante);
    } catch (error) {
      if (turno !== this.#turno) return;
      this.#conmutando = null;
      if (destino === 'main') {
        this.bus.emit('error', { error: this.#comoPlayerError(error, 'engine/failed') });
        return;
      }
      // La cola no arranca: se omite y la cadena termina aquí.
      this.#omitirPieza(destino as 'outro', error);
      this.#terminarContenido();
      return;
    }
    if (turno !== this.#turno) return;

    // --- el cambio visible ------------------------------------------------
    this.#conmutando = null;
    this.#ponerFaseYAvisar(destino, saltada);
    entrante?.setMuted(this.#mudo);
    if (origen === 'main') {
      this.#sync?.stop();
      for (const e of this.#instancias.values()) e.pause();
    } else {
      this.#piezas.get(origen)?.engine.pause();
    }
    // Si se saltó con la cabecera en pausa, el contenido acaba de arrancar y
    // el estado tiene que decirlo: su `onPlay` llegó mientras no contaba.
    if (entrante && !entrante.paused && this.#lc.state !== 'active') this.#reflejarPlay();
    if (!entrante) {
      if (destino === 'outro') this.#terminarContenido();
      return;
    }
    this.#vigilar();
  }

  /**
   * El contenido ha llegado a su final y no hay cola que lo siga (o la que
   * había se ha perdido). Es el `ended` del contenido tal cual.
   */
  #terminarContenido(): void {
    if (this.#fase === 'outro') {
      this.#finCadena = true;
    } else {
      this.#finRecorteAvisado = !!this.#timeline().range;
      this.pause();
    }
    this.bus.emit('time', { current: this.duration, duration: this.duration });
    this.bus.emit('ended', { at: this.duration });
  }

  /** El medio ha empezado a sonar: el estado y el bus lo cuentan. */
  #reflejarPlay(): void {
    if (this.#lc.can('active')) this.#lc.transition('active');
    this.bus.emit('play', { at: this.currentTime });
  }

  /** El medio se ha parado. */
  #reflejarPausa(): void {
    if (this.#lc.state === 'active') this.#lc.transition('attached');
    this.bus.emit('pause', { at: this.currentTime });
  }

  #callbacksPieza(fase: BumperPhase) {
    // Solo cuenta lo que dice la pieza que se ve, y no durante un cambio.
    const cuenta = () => this.#fase === fase && this.#conmutando === null;
    return {
      onTime: (current: number, duration: number) => {
        if (cuenta()) this.bus.emit('chain:time', { phase: fase, current, duration });
      },
      onPlay: () => {
        if (!cuenta()) return;
        this.#reflejarPlay();
      },
      onPause: () => {
        if (!cuenta()) return;
        this.#reflejarPausa();
      },
      onEnded: () => {
        if (this.#fase !== fase) return;
        // Red de seguridad: si la vigilancia no llegó a tiempo —una cabecera
        // más corta que la anticipación—, se cambia al terminar.
        if (fase === 'intro') void this.#pasarA('main', false);
        else if (!this.#conmutando) this.#terminarContenido();
      },
      onError: (error: PlayerError) => {
        this.#omitirPieza(fase, error);
        if (this.#fase !== fase) return;
        if (fase === 'intro') void this.#pasarA('main', false);
        else this.#terminarContenido();
      },
    };
  }

  /* --------------------------------------------------------------- interno */

  #callbacks(stream: Stream) {
    const esMaestro = stream.audio;
    /*
     * El contenido solo manda cuando es lo que se ve. Mientras suena la
     * cabecera está parado o arrancando detrás, y durante un cambio de pieza
     * sus avisos describen una transición, no algo que haya pedido el usuario.
     */
    const cuenta = () => this.#fase === 'main' && this.#conmutando === null;
    return {
      onTime: (current: number, duration: number) => {
        if (!esMaestro || this.#fase !== 'main' || this.#conmutando === 'main') return;
        /*
         * El final del recorte lo hace cumplir el reproductor, no el medio: el
         * fichero sigue teniendo material por detrás y el motor no sabe que
         * sobra. Se comprueba aquí y no con un temporizador porque el usuario
         * puede saltar, cambiar de velocidad o quedarse sin búfer, y la única
         * señal fiable de dónde está la reproducción es esta.
         */
        const recorte = this.#timeline().range;
        if (recorte && current >= recorte.end) {
          // Con cola, el final del recorte no es el final: se para aquí, con
          // el último fotograma a la vista, y la cola entra encima.
          if (this.#piezas.has('outro')) {
            if (!this.#conmutando) void this.#pasarA('outro', false);
            this.#sync?.stop();
            for (const e of this.#instancias.values()) e.pause();
            return;
          }
          if (!this.#finRecorteAvisado) {
            this.#finRecorteAvisado = true;
            this.pause();
            this.bus.emit('time', { current: this.duration, duration: this.duration });
            this.bus.emit('ended', { at: this.duration });
          }
          return;
        }
        this.bus.emit('time', {
          current: this.toVisibleTime(current),
          duration: this.duration || duration,
        });
      },
      /*
       * El estado de reproducción lo dicta el elemento multimedia, no lo que
       * este objeto creía que iba a pasar.
       *
       * Sin esto la interfaz refleja la intención y no la realidad: si el
       * navegador pausa por su cuenta —política de autoplay, un corte, un
       * fallo— el botón sigue diciendo "Reproducir" con el vídeo en marcha, o
       * al revés.
       */
      onPlay: () => {
        if (!esMaestro || !cuenta()) return;
        this.#reflejarPlay();
      },
      /*
       * Marca que la reproducción **ha empezado de verdad**, no solo que se ha
       * pedido. Es lo que separa el buffering inicial —normal— de un corte a
       * mitad de reproducción, que son dos cosas con respuestas opuestas.
       */
      onPlaying: () => { if (esMaestro) this.#atascos.markPlaying(); },
      onPause: () => {
        if (!esMaestro || !cuenta()) return;
        this.#atascos.markNotPlaying();
        this.#reflejarPausa();
      },
      onEnded: () => {
        if (!esMaestro || this.#fase !== 'main') return;
        // Red de seguridad por si la vigilancia no llegó a anticipar la cola.
        if (this.#piezas.has('outro')) {
          if (!this.#conmutando) void this.#pasarA('outro', false);
          return;
        }
        if (cuenta()) this.bus.emit('ended', { at: this.currentTime });
      },
      onSeeked: (at: number) => {
        if (esMaestro && cuenta()) this.bus.emit('seek:end', { at: this.toVisibleTime(at) });
      },
      onStallStart: () => {
        if (!cuenta()) return;
        this.bus.emit('stall:start', { stream: stream.id });
        this.#atascos.stallStarted(stream.id);
      },
      onStallEnd: (durationMs: number) => {
        if (!cuenta() && !this.#atascos.isStalled(stream.id)) return;
        this.bus.emit('stall:end', { stream: stream.id, durationMs });
        this.#atascos.stallEnded(stream.id);
      },
      onError: (error: PlayerError) => {
        this.bus.emit('error', { error });
        // En un directo, un fallo de red en un flujo ya enganchado es una
        // interrupción, no un "aún no ha empezado": ese flujo llegó a emitir.
        if (this.#manifest?.live && error.retryable) {
          this.#emision.markUnavailable(stream.id);
        }
      },
    };
  }

  #comoPlayerError(error: unknown, porDefecto: PlayerError['code']): PlayerError {
    if (error && typeof error === 'object' && 'code' in error && 'retryable' in error) {
      return error as PlayerError;
    }
    return playerError(porDefecto, error instanceof Error ? error.message : String(error), error);
  }
}

/** Punto de entrada de la API pública. */
export function createPlayer(options: PlayerOptions): Player {
  return new Player(options);
}
