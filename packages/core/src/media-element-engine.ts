/**
 * Base de los motores que reproducen sobre un elemento `<video>`.
 *
 * Todo lo que no depende de cómo llega el medio al elemento vive aquí: crear
 * y soltar el elemento, traducir sus eventos a callbacks, contar los stalls,
 * `play()` con la política de autoplay y los getters y setters. Cada motor
 * solo dice cómo prepara el elemento y qué suelta además de él.
 */
import type { AttachOptions, EngineCallbacks, MediaEngine } from './engine.js';
import { playerError, type PlayerError } from './errors.js';
import type { Stream } from './manifest.js';

export interface MediaElementEngineOptions {
  /** Inyectable para las pruebas; por defecto `performance.now`. */
  now?: () => number;
  /** Inyectable para las pruebas; por defecto `document.createElement('video')`. */
  createElement?: () => HTMLVideoElement;
}

/**
 * Traduce el error del elemento a un código propio.
 *
 * `MediaError` solo trae un número, y cada consumidor haciendo su propio
 * `switch` sobre él termina en incoherencias. Se traduce una vez, aquí.
 */
export function mediaElementError(el: HTMLVideoElement): PlayerError {
  const e = el.error;
  if (!e) return playerError('media/decode', 'Playback failure with no detail');
  switch (e.code) {
    case 1: return playerError('media/network', 'Playback aborted', e);
    case 2: return playerError('media/network', e.message || 'Network error while loading the media', e);
    case 3: return playerError('media/decode', e.message || 'The media could not be decoded', e);
    case 4: return playerError('engine/unsupported',
      e.message || 'No playable source for this browser', e);
    default: return playerError('media/decode', e.message || 'Playback failure', e);
  }
}

export abstract class MediaElementEngine implements MediaEngine {
  abstract readonly name: string;

  #el: HTMLVideoElement | null = null;
  #cb: EngineCallbacks = {};
  #desatar: Array<() => void> = [];
  #stallDesde: number | null = null;
  #destruido = false;
  readonly #ahora: () => number;
  readonly #crearElemento: () => HTMLVideoElement;

  constructor(options: MediaElementEngineOptions = {}) {
    this.#ahora = options.now ?? (() => performance.now());
    this.#crearElemento = options.createElement ?? (() => document.createElement('video'));
  }

  /** Mete el medio en el elemento y resuelve cuando ya acepta `play()`. */
  protected abstract prepare(
    el: HTMLVideoElement, stream: Stream, options: AttachOptions,
  ): Promise<void>;

  /** Lo que el motor tiene que soltar antes que el elemento. */
  protected release(_el: HTMLVideoElement): void {}

  /**
   * Qué hacer con un error del propio elemento. Por defecto, avisar: un motor
   * que ya los recupera por su cuenta puede no querer hacerlo.
   */
  protected onElementError(el: HTMLVideoElement): void {
    this.#cb.onError?.(mediaElementError(el));
  }

  protected get callbacks(): EngineCallbacks {
    return this.#cb;
  }

  /** Registra algo que hay que deshacer al soltar el elemento. */
  protected onDetach(deshacer: () => void): void {
    this.#desatar.push(deshacer);
  }

  protected requireElement(): HTMLVideoElement {
    if (!this.#el) throw new Error('The engine is not attached');
    return this.#el;
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
    if (this.#destruido) throw new Error('The engine has been destroyed');
    if (this.#el) throw new Error('The engine is already attached: call detach() first');

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

    this.#escuchar(el);
    container.appendChild(el);

    await this.prepare(el, stream, options);

    if (options.startAt !== undefined && options.startAt > 0) {
      const startAt = options.startAt;
      const saltar = () => {
        try { el.currentTime = startAt; } catch { /* fuera de rango: se ignora */ }
      };
      // Sin metadatos no hay a dónde saltar: en iOS llegan con el primer play.
      if (el.readyState >= 1) saltar();
      else el.addEventListener('loadedmetadata', saltar, { once: true });
    }
  }

  #escuchar(el: HTMLVideoElement): void {
    const on = <K extends keyof HTMLMediaElementEventMap>(
      type: K,
      fn: (ev: HTMLMediaElementEventMap[K]) => void,
    ) => {
      el.addEventListener(type, fn as EventListener);
      this.onDetach(() => el.removeEventListener(type, fn as EventListener));
    };

    on('timeupdate', () => {
      this.#cb.onTime?.(el.currentTime, Number.isFinite(el.duration) ? el.duration : 0);
    });
    on('play', () => this.#cb.onPlay?.());
    on('pause', () => this.#cb.onPause?.());
    on('ended', () => this.#cb.onEnded?.());
    on('seeked', () => this.#cb.onSeeked?.(el.currentTime));
    on('error', () => this.onElementError(el));

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

    try { this.release(el); } catch { /* ya podía estar suelto */ }
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
    const el = this.requireElement();
    try {
      await el.play();
    } catch (error) {
      const err = error as { name?: string; message?: string };
      // Un play() interrumpido por un pause() no es un fallo: pasa al pausar
      // mientras carga, y en el desbloqueo del encadenado. Tratarlo como error
      // hacía que la cola se diera por rota y desapareciera.
      if (err.name === 'AbortError') return;
      // NotAllowedError es la política de autoplay, no un fallo del medio. La
      // UI debe distinguirlas: una se arregla mostrando un botón de play.
      const pe = err.name === 'NotAllowedError'
        ? playerError('media/blocked',
            'The browser blocked playback: a user interaction is required', error)
        : playerError('media/decode', err.message ?? 'Playback could not be started', error);
      this.#cb.onError?.(pe);
      throw pe;
    }
  }

  pause(): void {
    this.#el?.pause();
  }

  seek(seconds: number): void {
    const el = this.requireElement();
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
}
