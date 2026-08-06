/**
 * Sincronización multi-stream: maestro/esclavo con corrección de deriva.
 *
 * Modelo, tal como lo validó el spike S1:
 *
 *   - El **maestro** es el stream que lleva el audio, y **nunca se le toca el
 *     `playbackRate`**: alterar la velocidad del audio se oye, y un reproductor
 *     que hace "wow" en la voz del ponente es inaceptable.
 *   - Los **esclavos** persiguen al maestro. Toda la corrección recae en ellos,
 *     que además van silenciados — S2 midió que iOS no reproduce dos pistas de
 *     audio a la vez.
 *
 * Dos regímenes:
 *   - Deriva pequeña → control proporcional sobre `playbackRate`. Invisible.
 *   - Deriva grande  → salto duro. Se nota, pero recupera en decenas de ms.
 *
 * La **histéresis no es opcional**: sin separar el umbral de enganche del de
 * suelta, el controlador se para al entrar en la zona muerta y deja un offset
 * permanente. Medido en S1: 28,8 ms fijos sin histéresis, 9,8 ms con ella.
 */
import type { CoreEvents } from './core-events.js';
import type { MediaEngine } from './engine.js';
import type { EventBus } from './events.js';

export interface SyncProfile {
  /** Umbral de ENGANCHE: por debajo no se empieza a corregir. */
  deadZone: number;
  /** Umbral de SUELTA: una vez enganchado, se corrige hasta bajar de aquí. */
  releaseZone: number;
  /** Ganancia del control proporcional. Gobierna el tiempo de recuperación. */
  gain: number;
  /** Techo de desviación de velocidad del esclavo. */
  maxRateDelta: number;
  /** Por encima de esto, salto duro en vez de corrección suave. */
  hardSeek: number;
}

/**
 * Perfiles por motor.
 *
 * No son un capricho: S2 midió la misma configuración dando resultados muy
 * distintos según el motor, y fallando de formas distintas.
 *
 * | Motor            | mediana | p95    | máx    |
 * |------------------|---------|--------|--------|
 * | Blink            |  7,8 ms |  15 ms |  39 ms |
 * | WebKit (Mac)     | 30,6 ms |  54 ms | 118 ms |
 * | WebKit (iPhone)  | 28,1 ms | 209 ms | 405 ms |
 *
 * La firma de WebKit en móvil es la interesante: mediana buena con
 * **excursiones puntuales severas**. Eso no es un desajuste de ganancia —si lo
 * fuera, la mediana también estaría mal— sino saltos ocasionales. Por eso el
 * perfil de WebKit no sube la ganancia sino que **baja el umbral de salto
 * duro**, para que una excursión de 200 ms se corrija en vez de quedarse.
 */
export const SYNC_PROFILES = {
  blink: {
    deadZone: 0.033, releaseZone: 0.008, gain: 1.2, maxRateDelta: 0.25, hardSeek: 0.5,
  },
  webkit: {
    deadZone: 0.033, releaseZone: 0.008, gain: 1.2, maxRateDelta: 0.25, hardSeek: 0.2,
  },
} as const satisfies Record<string, SyncProfile>;

export type SyncProfileName = keyof typeof SYNC_PROFILES;

/**
 * Detecta el perfil por motor.
 *
 * En iOS todos los navegadores están obligados a usar WebKit, así que Chrome de
 * iPhone también entra aquí. Se mira `ManagedMediaSource` —que solo existe en
 * WebKit reciente— antes de recurrir a la cadena de agente de usuario.
 */
export function detectProfile(): SyncProfileName {
  const g = globalThis as { ManagedMediaSource?: unknown; navigator?: Navigator };
  if (g.ManagedMediaSource !== undefined) return 'webkit';
  const ua = g.navigator?.userAgent ?? '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'webkit';
  // La UA de Chrome contiene "Safari", así que hay que descartarlo antes.
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua)) return 'webkit';
  return 'blink';
}

export type SyncAction = 'ok' | 'correcting' | 'hard-seek' | 'seeking';

export interface SyncSample {
  stream: string;
  drift: number;
  action: SyncAction;
  rate: number;
}

interface Slave {
  id: string;
  engine: MediaEngine;
  correcting: boolean;
}

export interface SynchronizerOptions {
  master: { id: string; engine: MediaEngine };
  slaves: ReadonlyArray<{ id: string; engine: MediaEngine }>;
  profile?: SyncProfile;
  bus?: EventBus<CoreEvents>;
  /** Inyectable para las pruebas; por defecto rVFC con recurso a rAF. */
  scheduler?: Scheduler;
}

/** Cómo se agenda el lazo de control. Abstraído para poder probarlo sin navegador. */
export interface Scheduler {
  start(tick: () => void): void;
  stop(): void;
}

/**
 * Agendador por defecto: `requestVideoFrameCallback` cuando existe.
 *
 * Se dispara con la presentación real del fotograma en lugar de con el
 * repintado, que es una medida más fiel de dónde va el vídeo. Recurre a
 * `requestAnimationFrame` donde no esté disponible.
 */
export function defaultScheduler(video: HTMLVideoElement | null): Scheduler {
  let vivo = false;
  let handle = 0;
  const conRVFC = video !== null && 'requestVideoFrameCallback' in video;

  return {
    start(tick) {
      vivo = true;
      const paso = () => {
        if (!vivo) return;
        tick();
        if (!vivo) return;
        handle = conRVFC
          ? (video as HTMLVideoElement).requestVideoFrameCallback(paso)
          : requestAnimationFrame(paso);
      };
      paso();
    },
    stop() {
      vivo = false;
      if (!handle) return;
      if (conRVFC) (video as HTMLVideoElement).cancelVideoFrameCallback?.(handle);
      else cancelAnimationFrame(handle);
      handle = 0;
    },
  };
}

export class Synchronizer {
  readonly #master: { id: string; engine: MediaEngine };
  readonly #slaves: Slave[];
  readonly #profile: SyncProfile;
  readonly #bus: EventBus<CoreEvents> | undefined;
  readonly #scheduler: Scheduler;
  #corriendo = false;
  #saltosDuros = 0;

  constructor(options: SynchronizerOptions) {
    this.#master = options.master;
    this.#slaves = options.slaves.map((s) => ({ ...s, correcting: false }));
    this.#profile = options.profile ?? SYNC_PROFILES[detectProfile()];
    this.#bus = options.bus;
    this.#scheduler = options.scheduler
      ?? defaultScheduler(options.master.engine.element);
  }

  get running(): boolean {
    return this.#corriendo;
  }

  get hardSeeks(): number {
    return this.#saltosDuros;
  }

  get profile(): SyncProfile {
    return this.#profile;
  }

  start(): void {
    if (this.#corriendo || this.#slaves.length === 0) return;
    this.#corriendo = true;
    this.#scheduler.start(() => this.tick());
  }

  stop(): void {
    if (!this.#corriendo) return;
    this.#corriendo = false;
    this.#scheduler.stop();
    // Devolver a los esclavos su velocidad natural: dejarlos corriendo al
    // 1,25× tras parar el lazo sería un fallo silencioso y desconcertante.
    for (const s of this.#slaves) {
      s.correcting = false;
      s.engine.setPlaybackRate(this.#master.engine.getPlaybackRate());
    }
  }

  /** Un paso del lazo de control. Público para poder probarlo paso a paso. */
  tick(): SyncSample[] {
    const maestro = this.#master.engine;
    const base = maestro.getPlaybackRate();
    const muestras: SyncSample[] = [];

    for (const s of this.#slaves) {
      const muestra = this.#corregir(s, maestro.currentTime, base);
      muestras.push(muestra);
      this.#bus?.emit('sync:drift', {
        stream: muestra.stream,
        drift: muestra.drift,
        // El bus no distingue 'seeking': para quien observa es un momento
        // en el que no se está corrigiendo nada.
        action: muestra.action === 'seeking' ? 'ok' : muestra.action,
      });
    }
    return muestras;
  }

  #corregir(s: Slave, tiempoMaestro: number, base: number): SyncSample {
    const p = this.#profile;
    const drift = s.engine.currentTime - tiempoMaestro;
    const a = Math.abs(drift);

    // Durante un salto la medida no significa nada: el navegador está entre
    // dos posiciones y corregir sobre eso amplifica el error.
    if (this.#master.engine.element?.seeking || s.engine.element?.seeking) {
      return { stream: s.id, drift, action: 'seeking', rate: s.engine.getPlaybackRate() };
    }

    if (a > p.hardSeek) {
      s.engine.seek(tiempoMaestro);
      s.engine.setPlaybackRate(base);
      s.correcting = false;
      this.#saltosDuros++;
      return { stream: s.id, drift, action: 'hard-seek', rate: base };
    }

    // Histéresis: engancha en deadZone, suelta en releaseZone.
    if (!s.correcting && a > p.deadZone) s.correcting = true;
    else if (s.correcting && a < p.releaseZone) s.correcting = false;

    if (!s.correcting) {
      s.engine.setPlaybackRate(base);
      return { stream: s.id, drift, action: 'ok', rate: base };
    }

    // Control proporcional: si el esclavo va por detrás (drift < 0), acelera.
    const delta = Math.max(-p.maxRateDelta, Math.min(p.maxRateDelta, -p.gain * drift));
    const rate = base + delta;
    s.engine.setPlaybackRate(rate);
    return { stream: s.id, drift, action: 'correcting', rate };
  }

  /**
   * Alinea los esclavos con el maestro de golpe, sin corrección suave.
   *
   * Se usa cuando la corrección gradual no tiene sentido: tras un salto del
   * usuario, o al arrancar. La demo mostró por qué hace falta al arrancar —
   * enganchar y reproducir en secuencia deja un desfase de unos 70 ms que no
   * es deriva acumulada sino retraso de partida, y nada lo corregiría solo.
   */
  align(): void {
    const t = this.#master.engine.currentTime;
    const base = this.#master.engine.getPlaybackRate();
    for (const s of this.#slaves) {
      s.engine.seek(t);
      s.engine.setPlaybackRate(base);
      s.correcting = false;
    }
  }
}
