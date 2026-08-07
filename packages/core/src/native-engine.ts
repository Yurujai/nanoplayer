/**
 * Motor sobre el elemento `<video>` nativo.
 *
 * Es el único motor del MVP y cubre MP4 progresivo y HLS donde el navegador lo
 * soporte de fábrica. Lo que no cubre —HLS sobre MSE con hls.js— entra como
 * otro motor sin tocar este, que es para lo que existe la interfaz.
 */
import type {
  AttachOptions, Confidence, EngineCallbacks, EngineFactory, MediaEngine,
} from './engine.js';
import { playerError, type PlayerError } from './errors.js';
import type { Source, Stream } from './manifest.js';

const HLS_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
  'video/x-mpegurl',
]);

const esHls = (type: string) => HLS_TYPES.has(type.split(';')[0]!.trim().toLowerCase());

/** ¿Hay Media Source Extensions? Es lo que hls.js necesita para existir. */
function hayMse(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const g = globalThis as { MediaSource?: unknown; ManagedMediaSource?: unknown };
  return g.MediaSource !== undefined || g.ManagedMediaSource !== undefined;
}

/**
 * Traduce el error del elemento a un código propio.
 *
 * `MediaError` solo trae un número, y cada consumidor haciendo su propio
 * `switch` sobre él termina en incoherencias. Se traduce una vez, aquí.
 */
function traducirError(el: HTMLVideoElement): PlayerError {
  const e = el.error;
  if (!e) return playerError('media/decode', 'Fallo de reproducción sin detalle');
  switch (e.code) {
    case 1: return playerError('media/network', 'Reproducción abortada', e);
    case 2: return playerError('media/network', e.message || 'Error de red al cargar el medio', e);
    case 3: return playerError('media/decode', e.message || 'No se pudo decodificar el medio', e);
    case 4: return playerError('engine/unsupported',
      e.message || 'Ninguna fuente reproducible para este navegador', e);
    default: return playerError('media/decode', e.message || 'Fallo de reproducción', e);
  }
}

export class NativeEngine implements MediaEngine {
  readonly name = 'native';

  #el: HTMLVideoElement | null = null;
  #cb: EngineCallbacks = {};
  #desatar: Array<() => void> = [];
  #stallDesde: number | null = null;
  #destruido = false;
  readonly #ahora: () => number;
  readonly #crearElemento: () => HTMLVideoElement;

  constructor(options: {
    /** Inyectable para las pruebas; por defecto `performance.now`. */
    now?: () => number;
    /** Inyectable para las pruebas; por defecto `document.createElement('video')`. */
    createElement?: () => HTMLVideoElement;
  } = {}) {
    this.#ahora = options.now ?? (() => performance.now());
    this.#crearElemento =
      options.createElement ?? (() => document.createElement('video'));
  }

  get element(): HTMLVideoElement | null {
    return this.#el;
  }

  get attached(): boolean {
    return this.#el !== null;
  }

  async attach(
    container: HTMLElement,
    stream: Stream,
    options: AttachOptions = {},
  ): Promise<void> {
    if (this.#destruido) throw new Error('El motor fue destruido');
    if (this.#el) throw new Error('El motor ya está enganchado: llama a detach() antes');

    const el = this.#crearElemento();
    this.#el = el;
    this.#cb = options.callbacks ?? {};

    // playsInline es obligatorio en iPhone: sin él, reproducir arrebata la
    // pantalla completa al sistema y el segundo stream desaparece. Se ponen
    // propiedad y atributo porque Safari antiguo solo mira el atributo.
    if (options.playsInline !== false) {
      el.playsInline = true;
      el.setAttribute('playsinline', '');
    }
    if (options.muted) el.muted = true;
    el.preload = 'auto';

    for (const source of stream.sources) {
      const s = document.createElement('source');
      s.src = source.src;
      s.type = source.type;
      el.appendChild(s);
    }

    this.#escuchar(el);
    container.appendChild(el);

    try {
      await this.#esperarUtilizable(el);
    } catch (error) {
      const pe = error as PlayerError;
      this.#cb.onError?.(pe);
      throw pe;
    }

    if (options.startAt !== undefined && options.startAt > 0) {
      try { el.currentTime = options.startAt; } catch { /* fuera de rango: se ignora */ }
    }
  }

  /**
   * Espera a `readyState >= 2` (`HAVE_CURRENT_DATA`).
   *
   * No a `canplay`: S2 midió que en iOS ese evento puede no llegar nunca porque
   * el sistema no bufferea hasta que se intenta reproducir. `loadeddata` sí
   * llega y basta para operar.
   *
   * Sin efectos sobre la reproducción a propósito. Una versión de la sonda
   * lanzaba un `play()` para forzar la carga, y su promesa pausaba el vídeo por
   * detrás al resolverse tarde. Provocar la carga y controlar la reproducción
   * no pueden vivir en la misma función.
   */
  #esperarUtilizable(el: HTMLVideoElement): Promise<void> {
    if (el.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ok = () => { limpiar(); resolve(); };
      const fallo = () => { limpiar(); reject(traducirError(el)); };
      const limpiar = () => {
        el.removeEventListener('loadeddata', ok);
        el.removeEventListener('error', fallo);
      };
      el.addEventListener('loadeddata', ok);
      el.addEventListener('error', fallo);
      if (el.networkState === 0 /* NETWORK_EMPTY */) el.load();
    });
  }

  #escuchar(el: HTMLVideoElement): void {
    const on = <K extends keyof HTMLMediaElementEventMap>(
      type: K,
      fn: (ev: HTMLMediaElementEventMap[K]) => void,
    ) => {
      el.addEventListener(type, fn as EventListener);
      this.#desatar.push(() => el.removeEventListener(type, fn as EventListener));
    };

    on('timeupdate', () => {
      this.#cb.onTime?.(el.currentTime, Number.isFinite(el.duration) ? el.duration : 0);
    });
    on('play', () => this.#cb.onPlay?.());
    on('pause', () => this.#cb.onPause?.());
    on('ended', () => this.#cb.onEnded?.());
    on('seeked', () => this.#cb.onSeeked?.(el.currentTime));
    on('error', () => this.#cb.onError?.(traducirError(el)));

    // Contabilidad de stalls. Su duración es la señal que permitirá diagnosticar
    // en producción lo que S2 vio en iPhone: buena mediana de sincronización con
    // excursiones puntuales severas. Si coinciden con stalls, ya sabemos la causa.
    on('waiting', () => {
      if (this.#stallDesde !== null) return;
      this.#stallDesde = this.#ahora();
      this.#cb.onStallStart?.();
    });
    on('playing', () => this.#cb.onPlaying?.());
    const finStall = () => {
      if (this.#stallDesde === null) return;
      const dur = this.#ahora() - this.#stallDesde;
      this.#stallDesde = null;
      this.#cb.onStallEnd?.(dur);
    };
    on('playing', finStall);
    on('canplay', finStall);
  }

  /**
   * Suelta el elemento y sus recursos.
   *
   * La secuencia importa y no es folclore: quitar del DOM no libera el
   * decodificador. Hay que vaciar la fuente —atributo y nodos `<source>`— y
   * llamar a `load()` para que el navegador abandone el recurso. S2 lo demostró
   * al medir 2 vídeos simultáneos en un iPhone que en realidad soporta 17.
   */
  detach(): void {
    const el = this.#el;
    if (!el) return;

    for (const off of this.#desatar) off();
    this.#desatar = [];
    this.#stallDesde = null;

    try {
      el.pause();
      el.removeAttribute('src');
      while (el.firstChild) el.removeChild(el.firstChild);
      el.load();
    } catch { /* el elemento ya podía estar inservible */ }
    el.remove();

    this.#el = null;
    this.#cb = {};
  }

  async play(): Promise<void> {
    const el = this.#requerir();
    try {
      await el.play();
    } catch (error) {
      const err = error as { name?: string; message?: string };
      // NotAllowedError es la política de autoplay, no un fallo del medio. La
      // UI debe distinguirlas: una se arregla mostrando un botón de play.
      const pe = err.name === 'NotAllowedError'
        ? playerError('media/blocked',
            'El navegador bloqueó la reproducción: hace falta una interacción del usuario', error)
        : playerError('media/decode', err.message ?? 'No se pudo iniciar la reproducción', error);
      this.#cb.onError?.(pe);
      throw pe;
    }
  }

  pause(): void {
    this.#el?.pause();
  }

  seek(seconds: number): void {
    const el = this.#requerir();
    if (!Number.isFinite(seconds) || seconds < 0) return;
    el.currentTime = seconds;
  }

  get currentTime(): number {
    return this.#el?.currentTime ?? 0;
  }

  get duration(): number {
    const d = this.#el?.duration;
    return d !== undefined && Number.isFinite(d) ? d : 0;
  }

  get paused(): boolean {
    return this.#el?.paused ?? true;
  }

  get ended(): boolean {
    return this.#el?.ended ?? false;
  }

  get buffered(): TimeRanges | null {
    return this.#el?.buffered ?? null;
  }

  get seekable(): TimeRanges | null {
    return this.#el?.seekable ?? null;
  }

  /**
   * Hora absoluta de la posición actual.
   *
   * En HLS nativo lo aporta `getStartDate()`, una API de WebKit que devuelve la
   * hora del `EXT-X-PROGRAM-DATE-TIME` del inicio del flujo. Existe justamente
   * en los navegadores donde HLS se reproduce de forma nativa —Safari e iOS—,
   * que son los que no pueden usar hls.js.
   */
  getProgramTime(): number | null {
    const el = this.#el as (HTMLVideoElement & { getStartDate?: () => Date }) | null;
    if (!el?.getStartDate) return null;
    const inicio = el.getStartDate();
    const t = inicio instanceof Date ? inicio.getTime() : Number.NaN;
    if (!Number.isFinite(t)) return null;
    return t + el.currentTime * 1000;
  }

  getPlaybackRate(): number {
    return this.#el?.playbackRate ?? 1;
  }

  setPlaybackRate(rate: number): void {
    const el = this.#el;
    if (!el || !Number.isFinite(rate) || rate <= 0) return;
    el.playbackRate = rate;
  }

  setVolume(volume: number): void {
    const el = this.#el;
    if (!el || !Number.isFinite(volume)) return;
    el.volume = Math.min(1, Math.max(0, volume));
  }

  setMuted(muted: boolean): void {
    if (this.#el) this.#el.muted = muted;
  }

  destroy(): void {
    this.detach();
    this.#destruido = true;
  }

  #requerir(): HTMLVideoElement {
    if (!this.#el) throw new Error('El motor no está enganchado');
    return this.#el;
  }
}

export const nativeEngineFactory: EngineFactory = {
  name: 'native',

  /**
   * Confianza en reproducir una fuente.
   *
   * El caso HLS merece explicación, porque es la trampa clásica: **medido en
   * S2, `canPlayType('application/vnd.apple.mpegurl')` devolvió `"maybe"` en
   * los cinco navegadores probados** — Chrome sobre Ubuntu y sobre Mac, Safari
   * de escritorio, y Safari y Chrome de iPhone. Chrome de escritorio no
   * reproduce HLS nativo y aun así responde `"maybe"`. O sea que la API no
   * sirve para decidir, por mucho que medio internet la use para eso.
   *
   * La señal que sí discrimina es la ausencia de MSE: donde no hay Media Source
   * Extensions (iOS), hls.js no puede funcionar y el soporte nativo es la única
   * vía, así que se afirma con confianza. Donde sí hay MSE se rebaja a `maybe`,
   * para que un motor basado en hls.js —que da control de calidad y estadísticas
   * de buffer— gane cuando se registre.
   */
  canPlay(source: Source): Confidence {
    if (!source.type) return 'no';
    if (esHls(source.type)) return hayMse() ? 'maybe' : 'probably';
    if (typeof document === 'undefined') return 'no';
    const sonda = document.createElement('video');
    const r = sonda.canPlayType(source.type);
    return r === '' ? 'no' : (r as Confidence);
  },

  create(): MediaEngine {
    return new NativeEngine();
  },
};
