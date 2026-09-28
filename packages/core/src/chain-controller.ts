/**
 * El encadenado de cabecera, contenido y cola.
 *
 * Decide qué pieza se ve, cuándo arranca la siguiente y cómo se cambia sin
 * que se note. Lo que es del contenido —reproducirlo, pausarlo, saltar en
 * él— lo pide al reproductor por `ChainHost`.
 */
import { ANTICIPACION_MS, VIGILANCIA_MS, firstFrame, type BumperPhase, type ChainPhase } from './chain.js';
import type { CoreEvents } from './core-events.js';
import { selectEngine, type EngineFactory, type MediaEngine } from './engine.js';
import { playerError, type PlayerError } from './errors.js';
import type { EventBus } from './events.js';
import type { Bumper, Manifest, Stream } from './manifest.js';

/** Lo que el encadenado necesita del reproductor. */
export interface ChainHost {
  readonly bus: EventBus<CoreEvents>;
  readonly container: HTMLElement;
  readonly engines: readonly EngineFactory[];
  readonly manifest: Manifest | null;
  readonly muted: boolean;
  readonly volume: number;
  readonly duration: number;
  readonly hasEngine: boolean;
  readonly isActive: boolean;
  master(): MediaEngine | null;
  contentEngines(): Iterable<MediaEngine>;
  playContent(): Promise<void>;
  pauseContent(): void;
  seekContent(seconds: number): void;
  /** Segundos que le quedan al contenido, a la velocidad actual. */
  contentRemaining(): number;
  /** El contenido termina sin cola que lo siga: parar y recordar el final. */
  contentEnded(): void;
  announceEnded(): void;
  reflectPlay(): void;
  reflectPause(): void;
  toPlayerError(error: unknown): PlayerError;
}

export class ChainController {
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

  constructor(private readonly host: ChainHost) {}

  get phase(): ChainPhase {
    return this.#fase;
  }

  /** Si ahora mismo se puede saltar algo. Solo la cabecera; la cola, nunca. */
  get canSkip(): boolean {
    return this.#fase === 'intro' && this.#conmutando === null;
  }

  get hasOutro(): boolean {
    return this.#piezas.has('outro');
  }

  /**
   * Si lo que dice el contenido cuenta. Solo manda cuando es lo que se ve:
   * mientras suena la cabecera está parado o arrancando detrás, y durante un
   * cambio sus avisos describen una transición, no algo que pidió el usuario.
   */
  get contentCounts(): boolean {
    return this.#fase === 'main' && this.#conmutando === null;
  }

  /** Si el progreso del contenido está oculto: detrás de una pieza o apareciendo. */
  get contentHidden(): boolean {
    return this.#fase !== 'main' || this.#conmutando === 'main';
  }

  /** El motor de la pieza que se ve: la cabecera, la cola o el maestro. */
  currentEngine(): MediaEngine | null {
    if (this.#fase === 'main') return this.host.master();
    return this.#piezas.get(this.#fase)?.engine ?? null;
  }

  /** Con el manifiesto resuelto: si hay cabecera, se empieza por ella. */
  start(manifest: Manifest): void {
    if (manifest.intro) this.#ponerFase('intro');
  }

  /** La cabecera primero, porque es lo que se va a ver antes. Si ya se vio o se saltó, no. */
  async attachIntro(manifest: Manifest): Promise<void> {
    if (manifest.intro && this.#fase === 'intro') await this.#engancharPieza('intro', manifest.intro);
  }

  /**
   * La cola se engancha al arrancar, aunque falte una hora para usarla. Es el
   * precio de poder desbloquearla en el gesto del usuario (variante A de S6).
   */
  async attachOutro(manifest: Manifest): Promise<void> {
    if (manifest.outro) await this.#engancharPieza('outro', manifest.outro);
  }

  /**
   * Lo que toca al pedir play. Devuelve `true` si ya lo ha resuelto el
   * encadenado —una pieza, o un cambio en curso— y `false` si hay que
   * reproducir el contenido.
   */
  async play(): Promise<boolean> {
    if (this.#conmutando) return true;
    this.#desbloquear();

    // Dar al play con la cadena terminada vuelve al contenido, sin repetir la
    // cabecera: ya se vio, y se podía saltar.
    if (this.#finCadena) {
      this.#finCadena = false;
      this.#piezas.get('outro')?.engine.seek(0);
      this.#ponerFaseYAvisar('main', false);
      this.host.seekContent(0);
    }

    if (this.#fase !== 'main') {
      const pieza = this.#piezas.get(this.#fase);
      if (pieza) {
        pieza.engine.setMuted(this.host.muted);
        await pieza.engine.play();
        this.watch();
        return true;
      }
      // La pieza se perdió por el camino: se sigue con el contenido.
      this.#ponerFaseYAvisar('main', false);
    }
    return false;
  }

  /**
   * Pausar en pleno cambio lo cancela: se queda en la pieza de antes, y al
   * reanudar la vigilancia vuelve a disparar el cambio.
   */
  pause(): void {
    this.#cancelarCambio();
    clearInterval(this.#vigilante);
    for (const { engine } of this.#piezas.values()) engine.pause();
  }

  /**
   * Salta la cabecera, por el mismo camino que el cambio anticipado: la
   * cabecera sigue a la vista hasta que el contenido tiene imagen (S6).
   */
  skipIntro(): void {
    if (!this.canSkip) return;
    if (!this.host.hasEngine) {
      // Aún no hay nada enganchado: basta con no empezar por ella.
      this.#ponerFaseYAvisar('main', true);
      return;
    }
    void this.#pasarA('main', true);
  }

  /**
   * Lo que el encadenado tiene que decir de un salto. Devuelve `true` si ya lo
   * ha resuelto y el contenido no debe saltar.
   */
  seek(seconds: number): boolean {
    if (this.#fase === 'outro') {
      // Hacia delante no hay nada: la cola no se salta. Hacia atrás se vuelve
      // al contenido, y al llegar otra vez al final la cola suena de nuevo.
      if (seconds < this.host.duration) this.#volverDeLaCola(seconds);
      return true;
    }
    // Retroceder mientras se preparaba la cola la deja para más adelante.
    if (this.#conmutando === 'outro') {
      const sonaba = this.host.isActive;
      this.#cancelarCambio();
      if (sonaba) void this.host.playContent().then(() => this.watch());
    }
    return false;
  }

  /**
   * El contenido llega a su final. Con cola no es el final: entra la cola.
   * Devuelve `true` si el encadenado se ocupa.
   */
  onContentEnd(): boolean {
    if (!this.hasOutro) return false;
    if (!this.#conmutando) void this.#pasarA('outro', false);
    return true;
  }

  /**
   * El contenido llega al final del recorte. Con cola, se para ahí con el
   * último fotograma a la vista y la cola entra encima.
   */
  onTrimEnd(): boolean {
    if (!this.onContentEnd()) return false;
    this.host.pauseContent();
    return true;
  }

  /** Las piezas que esperan detrás van mudas hasta descubrirse. */
  setMuted(muted: boolean): void {
    if (!this.#conmutando) this.currentEngine()?.setMuted(muted);
  }

  setVolume(volume: number): void {
    for (const { engine } of this.#piezas.values()) engine.setVolume(volume);
  }

  /**
   * Las piezas no conservan posición: duran segundos, y retomar una cabecera
   * a la mitad no tiene sentido. La fase sí se conserva, así que al volver se
   * empieza la misma pieza desde el principio.
   */
  release(): void {
    clearInterval(this.#vigilante);
    this.#turno++;
    this.#conmutando = null;
    this.#desbloqueado = false;
    for (const { engine, caja } of this.#piezas.values()) {
      engine.destroy();
      caja.remove();
    }
    this.#piezas.clear();
  }

  /**
   * Vigila el final de la pieza actual para arrancar la siguiente a tiempo.
   *
   * Con temporizador y no con `timeupdate`: ese evento llega a unos 4 Hz, y
   * con 250 ms entre avisos la anticipación de 600 ms fallaría a menudo.
   */
  watch(): void {
    clearInterval(this.#vigilante);
    if (!this.#siguiente()) return;
    this.#vigilante = setInterval(() => {
      const sig = this.#siguiente();
      if (!sig || this.#conmutando || this.currentEngine()?.paused !== false) return;
      const r = this.#restante();
      if (Number.isFinite(r) && r * 1000 <= ANTICIPACION_MS) void this.#pasarA(sig, false);
    }, VIGILANCIA_MS);
  }

  /**
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
      const factory = selectEngine(this.host.engines, stream);
      if (!factory) {
        throw playerError('engine/unsupported', `No engine can play the ${fase}`);
      }
      this.host.container.appendChild(caja);
      engine = factory.create();
      await engine.attach(caja, stream, {
        // La cola suena después de mucho rato: hasta descubrirla va muda.
        muted: fase === 'outro' || this.host.muted,
        playsInline: true,
        callbacks: this.#callbacksPieza(fase),
      });
      engine.setVolume(this.host.volume);
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
    this.host.bus.emit('chain:unavailable', { phase: fase, error: this.host.toPlayerError(error) });
  }

  /**
   * Cambia la pieza visible. **Un solo atributo**: la interfaz decide con él
   * qué se ve, y cambiarlo de golpe es lo que hace el cambio instantáneo.
   */
  #ponerFase(fase: ChainPhase): void {
    this.#fase = fase;
    this.host.container.dataset['phase'] = fase;
  }

  #ponerFaseYAvisar(fase: ChainPhase, skipped: boolean): void {
    const from = this.#fase;
    if (from === fase) return;
    this.#ponerFase(fase);
    this.host.bus.emit('chain:phase', { from, to: fase, skipped });
  }

  /** Da por cancelado el cambio en curso y deja la pieza entrante parada. */
  #cancelarCambio(): void {
    const destino = this.#conmutando;
    if (!destino) return;
    this.#turno++;
    this.#conmutando = null;
    if (destino === 'main') {
      this.host.pauseContent();
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
    this.host.master()?.setMuted(this.host.muted);
    this.host.seekContent(seconds);
    if (sonaba) void this.host.playContent().then(() => this.watch());
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
    if (this.#fase === 'intro') despues.push(...this.host.contentEngines());
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
    if (this.#fase === 'main') return this.host.contentRemaining();
    const e = this.#piezas.get(this.#fase)?.engine;
    return e ? e.duration - e.currentTime : NaN;
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
    if (this.#conmutando || destino === this.#fase || !this.host.manifest) return;
    const origen = this.#fase;
    const turno = ++this.#turno;
    this.#conmutando = destino;
    clearInterval(this.#vigilante);

    let entrante: MediaEngine | null;
    try {
      if (destino === 'main') {
        this.host.master()?.setMuted(true);
        await this.host.playContent();
        entrante = this.host.master();
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
        this.host.bus.emit('error', { error: this.host.toPlayerError(error) });
        return;
      }
      // La cola no arranca: se omite y la cadena termina aquí.
      this.#omitirPieza('outro', error);
      this.#terminarContenido();
      return;
    }
    if (turno !== this.#turno) return;

    // --- el cambio visible ------------------------------------------------
    this.#conmutando = null;
    this.#ponerFaseYAvisar(destino, saltada);
    entrante?.setMuted(this.host.muted);
    if (origen === 'main') {
      this.host.pauseContent();
    } else {
      this.#piezas.get(origen)?.engine.pause();
    }
    // Si se saltó con la cabecera en pausa, el contenido acaba de arrancar y
    // el estado tiene que decirlo: su `onPlay` llegó mientras no contaba.
    if (entrante && !entrante.paused && !this.host.isActive) this.host.reflectPlay();
    if (!entrante) {
      if (destino === 'outro') this.#terminarContenido();
      return;
    }
    this.watch();
  }

  /**
   * El contenido ha llegado a su final y no hay cola que lo siga (o la que
   * había se ha perdido). Es el `ended` del contenido tal cual.
   */
  #terminarContenido(): void {
    if (this.#fase === 'outro') this.#finCadena = true;
    else this.host.contentEnded();
    this.host.announceEnded();
  }

  #callbacksPieza(fase: BumperPhase) {
    // Solo cuenta lo que dice la pieza que se ve, y no durante un cambio.
    const cuenta = () => this.#fase === fase && this.#conmutando === null;
    return {
      onTime: (current: number, duration: number) => {
        if (cuenta()) this.host.bus.emit('chain:time', { phase: fase, current, duration });
      },
      onPlay: () => { if (cuenta()) this.host.reflectPlay(); },
      onPause: () => { if (cuenta()) this.host.reflectPause(); },
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
}
