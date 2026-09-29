/**
 * Base for engines that play on a `<video>` element. Everything that does not
 * depend on how the media reaches the element lives here; each engine only
 * says how it prepares the element and what it releases besides it.
 */
import type { AttachOptions, EngineCallbacks, MediaEngine } from './engine.js';
import { playerError, type PlayerError } from './errors.js';
import type { Stream } from './manifest.js';

export interface MediaElementEngineOptions {
  /** Injectable for tests; `performance.now` by default. */
  now?: () => number;
  /** Injectable for tests; `document.createElement('video')` by default. */
  createElement?: () => HTMLVideoElement;
}

/** Translates the element's `MediaError` number into a code, once, here. */
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
  #undo: Array<() => void> = [];
  #stallSince: number | null = null;
  #destroyed = false;
  readonly #now: () => number;
  readonly #createElement: () => HTMLVideoElement;

  constructor(options: MediaElementEngineOptions = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#createElement = options.createElement ?? (() => document.createElement('video'));
  }

  /** Puts the media into the element and resolves once it accepts `play()`. */
  protected abstract prepare(
    el: HTMLVideoElement, stream: Stream, options: AttachOptions,
  ): Promise<void>;

  /** What the engine must release before the element. */
  protected release(_el: HTMLVideoElement): void {}

  /** Reports element errors; an engine that recovers them itself may opt out. */
  protected onElementError(el: HTMLVideoElement): void {
    this.#cb.onError?.(mediaElementError(el));
  }

  protected get callbacks(): EngineCallbacks {
    return this.#cb;
  }

  /** Registers something to undo when the element is released. */
  protected onDetach(undo: () => void): void {
    this.#undo.push(undo);
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
    if (this.#destroyed) throw new Error('The engine has been destroyed');
    if (this.#el) throw new Error('The engine is already attached: call detach() first');

    const el = this.#createElement();
    this.#el = el;
    this.#cb = options.callbacks ?? {};

    if (options.playsInline !== false) {
      // Property and attribute: older Safari reads only the attribute.
      // see docs/browser-quirks.md#ios-playsinline
      el.playsInline = true;
      el.setAttribute('playsinline', '');
    }
    if (options.muted) el.muted = true;

    this.#listen(el);
    container.appendChild(el);

    await this.prepare(el, stream, options);

    if (options.startAt !== undefined && options.startAt > 0) {
      const startAt = options.startAt;
      const seek = () => {
        try { el.currentTime = startAt; } catch { /* out of range: ignored */ }
      };
      // Without metadata there is nowhere to seek; on iOS it only arrives with
      // the first play. see docs/browser-quirks.md#ios-no-preload
      if (el.readyState >= 1) seek();
      else el.addEventListener('loadedmetadata', seek, { once: true });
    }
  }

  #listen(el: HTMLVideoElement): void {
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

    on('waiting', () => {
      if (this.#stallSince !== null) return;
      this.#stallSince = this.#now();
      this.#cb.onStallStart?.();
    });
    on('playing', () => this.#cb.onPlaying?.());
    const endStall = () => {
      if (this.#stallSince === null) return;
      const duration = this.#now() - this.#stallSince;
      this.#stallSince = null;
      this.#cb.onStallEnd?.(duration);
    };
    on('playing', endStall);
    on('canplay', endStall);
  }

  /** Removing it from the DOM does not free the decoder. see docs/browser-quirks.md#decoder-release */
  detach(): void {
    const el = this.#el;
    if (!el) return;

    for (const undo of this.#undo) undo();
    this.#undo = [];
    this.#stallSince = null;

    try { this.release(el); } catch { /* may already be released */ }
    try {
      el.pause();
      el.removeAttribute('src');
      while (el.firstChild) el.removeChild(el.firstChild);
      el.load();
    } catch { /* the element may already be unusable */ }
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
      // see docs/browser-quirks.md#play-abort
      if (err.name === 'AbortError') return;
      // The autoplay policy is not a media failure: the UI fixes it with a play button.
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
    this.#destroyed = true;
  }
}
