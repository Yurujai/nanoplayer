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
import type { CoreEvents } from './core-events.js';
import {
  selectEngine, type EngineFactory, type MediaEngine,
} from './engine.js';
import { playerError, type PlayerError } from './errors.js';
import { EventBus, type Unsubscribe } from './events.js';
import { Lifecycle } from './lifecycle.js';
import type { Manifest, Stream } from './manifest.js';
import { nativeEngineFactory } from './native-engine.js';
import type { UiSlots } from './slots.js';
import type { PlayerState } from './state.js';
import { Synchronizer, type SyncProfile } from './sync.js';
import {
  isAudioOnlyManifest, masterStream, slaveStreams, validateManifest,
} from './validate.js';

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
}

const resolverPorDefecto: ManifestResolver = async (src) => {
  const res = await fetch(src);
  if (!res.ok) {
    throw playerError('manifest/fetch', `${res.status} ${res.statusText} al pedir ${src}`);
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
  #pausadoPorStall = false;

  constructor(options: PlayerOptions) {
    this.#opts = options;
    this.#engines = options.engines ?? [nativeEngineFactory];
  }

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
    if (this.#opts.poster) return this.#opts.poster;
    const src = this.#opts.manifest;
    if (typeof src === 'object' && typeof src['poster'] === 'string') {
      return src['poster'] as string;
    }
    return this.#manifest?.poster;
  }
  get resumeAt(): number { return this.#lc.resumeAt; }

  /** Motor del stream que lleva el audio: el que gobierna el reloj. */
  get master(): MediaEngine | null {
    if (!this.#manifest) return null;
    return this.#instancias.get(masterStream(this.#manifest).id) ?? null;
  }

  /**
   * Si no hay ninguna imagen que enseñar.
   *
   * Lo consulta la interfaz para mantener el póster puesto durante la
   * reproducción, en vez de dejar un rectángulo negro. Se puede saber sin
   * resolver si el manifiesto vino ya cargado.
   */
  get audioOnly(): boolean {
    const m = this.#manifest;
    if (m) return isAudioOnlyManifest(m);
    const src = this.#opts.manifest;
    if (typeof src === 'object') {
      const r = validateManifest(src);
      return r.ok ? isAudioOnlyManifest(r.manifest) : false;
    }
    return false;
  }

  get currentTime(): number { return this.master?.currentTime ?? this.#lc.resumeAt; }
  get duration(): number { return this.master?.duration ?? this.#manifest?.duration ?? 0; }
  get paused(): boolean { return this.master?.paused ?? true; }

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
        const detalle = r.errors.map((e) => `${e.path || '(raíz)'}: ${e.message}`).join('; ');
        throw playerError('manifest/invalid', `Manifiesto inválido — ${detalle}`);
      }
      this.#manifest = r.manifest;
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
      for (const stream of m.streams) {
        const factory = selectEngine(this.#engines, stream);
        if (!factory) {
          throw playerError('engine/unsupported',
            `Ningún motor puede reproducir el stream "${stream.id}"`);
        }
        nombreMotor = factory.name;

        const caja = document.createElement('div');
        caja.dataset['stream'] = stream.id;
        caja.dataset['role'] = stream.role;
        this.#opts.container.appendChild(caja);
        this.#cajas.push(caja);

        const engine = factory.create();
        this.#instancias.set(stream.id, engine);
        await engine.attach(caja, stream, {
          startAt: this.#lc.resumeAt,
          // Solo el maestro suena: S2 midió que iOS no reproduce dos pistas a
          // la vez, y S1 que el audio fija quién es el maestro del reloj.
          muted: this.#opts.muted === true || !stream.audio,
          playsInline: true,
          callbacks: this.#callbacks(stream),
        });
        if (stream.audio && this.#opts.volume !== undefined) {
          engine.setVolume(this.#opts.volume);
        }
      }

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
    this.#sync?.stop();
    this.#sync = null;
    for (const e of this.#instancias.values()) e.destroy();
    this.#instancias.clear();
    for (const caja of this.#cajas) caja.remove();
    this.#cajas = [];
  }

  /* ------------------------------------------------------------ reproducción */

  async play(): Promise<void> {
    if (!this.#lc.hasEngine) await this.attach();
    const m = this.#manifest;
    if (!m) return;

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
    this.#sync?.stop();
    this.#pausadoPorStall = false;
    for (const e of this.#instancias.values()) e.pause();
  }

  seek(seconds: number): void {
    const maestro = this.master;
    if (!maestro) {
      this.#lc.rememberPosition(seconds);
      return;
    }
    const from = maestro.currentTime;
    this.bus.emit('seek:start', { from, to: seconds });
    maestro.seek(seconds);
    // Los esclavos van de golpe: perseguir un salto con corrección suave
    // tardaría segundos y se vería.
    this.#sync?.align();
    this.bus.emit('seek:end', { at: seconds });
  }

  setVolume(volume: number): void {
    this.master?.setVolume(volume);
    this.bus.emit('volumechange', { volume, muted: false });
  }

  setMuted(muted: boolean): void {
    this.master?.setMuted(muted);
    this.bus.emit('volumechange', { volume: 1, muted });
  }

  setPlaybackRate(rate: number): void {
    // Solo al maestro: los esclavos lo heredan por el lazo de sincronización,
    // que ajusta su velocidad relativa a la de él.
    this.master?.setPlaybackRate(rate);
    this.bus.emit('ratechange', { rate });
  }

  destroy(): void {
    if (this.#lc.isDestroyed) return;
    this.#soltarMotores();
    this.#lc.destroy();
    this.bus.clear();
  }

  /* --------------------------------------------------------------- interno */

  #callbacks(stream: Stream) {
    const esMaestro = stream.audio;
    return {
      onTime: (current: number, duration: number) => {
        if (esMaestro) this.bus.emit('time', { current, duration });
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
        if (!esMaestro) return;
        if (this.#lc.can('active')) this.#lc.transition('active');
        this.bus.emit('play', { at: this.currentTime });
      },
      onPause: () => {
        if (!esMaestro) return;
        if (this.#lc.state === 'active') this.#lc.transition('attached');
        this.bus.emit('pause', { at: this.currentTime });
      },
      onEnded: () => {
        if (esMaestro) this.bus.emit('ended', { at: this.currentTime });
      },
      onSeeked: (at: number) => {
        if (esMaestro) this.bus.emit('seek:end', { at });
      },
      onStallStart: () => {
        this.bus.emit('stall:start', { stream: stream.id });
        /*
         * Que uno se quede sin buffer y los demás sigan destroza la
         * sincronización: S1 midió que pausar a todos deja el pico de deriva
         * en 7 ms, frente a dejar correr al maestro.
         *
         * Pero **solo si ya se estaba reproduciendo**. Al arrancar, el
         * `waiting` inicial es lo normal —el navegador está llenando el
         * buffer— y pausar ahí aborta el `play()` que acaba de empezar con un
         * `AbortError`. Ocurría de verdad: el vídeo no llegaba a arrancar y el
         * botón se quedaba en "Reproducir" porque esa era la verdad.
         */
        if (this.#lc.state !== 'active') return;
        this.#pausadoPorStall = true;
        for (const e of this.#instancias.values()) e.pause();
      },
      onStallEnd: (durationMs: number) => {
        this.bus.emit('stall:end', { stream: stream.id, durationMs });
        // Solo se reanuda lo que se pausó aquí. Reanudar por sistema
        // resucitaría un vídeo que el usuario había pausado a propósito.
        if (!this.#pausadoPorStall) return;
        this.#pausadoPorStall = false;
        for (const e of this.#instancias.values()) void e.play().catch(() => {});
      },
      onError: (error: PlayerError) => this.bus.emit('error', { error }),
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
