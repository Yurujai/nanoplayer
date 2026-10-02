/**
 * Engine on the native `<video>` element: progressive MP4, and HLS where the
 * browser plays it natively (Safari, iOS).
 */
import {
  hasMse, isHlsType,
  type AttachOptions, type AudioTrackInfo, type Confidence, type EngineFactory, type MediaEngine,
  type QualityInfo,
} from './engine.js';
import type { Source, Stream } from './manifest.js';
import { MediaElementEngine, mediaElementError } from './media-element-engine.js';

/** WebKit only (S2): TypeScript's DOM types leave it out. */
interface NativeAudioTrack {
  id: string;
  kind: string;
  label: string;
  language: string;
  enabled: boolean;
}
type NativeAudioTrackList = EventTarget & { readonly length: number; [index: number]: NativeAudioTrack };

/** An empty id is allowed by the spec; the position stands in for it. */
const trackId = (t: NativeAudioTrack, i: number) => t.id || String(i);

export class NativeEngine extends MediaElementEngine {
  readonly name = 'native';
  readonly autoQuality = false;

  #sources: readonly Source[] = [];

  protected prepare(el: HTMLVideoElement, stream: Stream, _options: AttachOptions): Promise<void> {
    el.preload = 'auto';
    this.#sources = stream.sources;
    this.#watchAudioTracks(el);
    for (const source of stream.sources) {
      const s = document.createElement('source');
      s.src = source.src;
      s.type = source.type;
      el.appendChild(s);
    }
    return this.#whenUsable(el).catch((pe) => {
      this.callbacks.onError?.(pe);
      throw pe;
    });
  }

  /**
   * Resolves on `loadeddata` or on `suspend`: iOS downloads nothing until the
   * first play(), so waiting for data never ended. Not on `canplay` either (S2).
   * see docs/browser-quirks.md#ios-no-preload
   */
  #whenUsable(el: HTMLVideoElement): Promise<void> {
    if (el.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(mediaElementError(el)); };
      const cleanup = () => {
        el.removeEventListener('loadeddata', ok);
        el.removeEventListener('suspend', ok);
        el.removeEventListener('error', fail);
      };
      el.addEventListener('loadeddata', ok);
      el.addEventListener('suspend', ok);
      el.addEventListener('error', fail);
      if (el.networkState === 0 /* NETWORK_EMPTY */) el.load();
    });
  }

  /**
   * The element's own `audioTracks`, only here: under hls.js the element
   * holds MSE buffers, not the renditions, and hls.js does the switching.
   */
  #nativeAudioTracks(): NativeAudioTrack[] {
    const list = (this.element as { audioTracks?: NativeAudioTrackList } | null)?.audioTracks;
    return list ? Array.from({ length: list.length }, (_, i) => list[i]!) : [];
  }

  #watchAudioTracks(el: HTMLVideoElement): void {
    const list = (el as { audioTracks?: NativeAudioTrackList }).audioTracks;
    if (!list) return;
    const notify = () => this.callbacks.onAudioTracks?.();
    for (const type of ['addtrack', 'removetrack', 'change']) {
      list.addEventListener(type, notify);
      this.onDetach(() => list.removeEventListener(type, notify));
    }
  }

  getAudioTracks(): AudioTrackInfo[] {
    return this.#nativeAudioTracks().map((t, i) => ({
      id: trackId(t, i),
      label: t.label,
      lang: t.language,
      describes: t.kind === 'description' || t.kind === 'main-desc',
    }));
  }

  getAudioTrack(): string | null {
    const tracks = this.#nativeAudioTracks();
    const i = tracks.findIndex((t) => t.enabled);
    return i < 0 ? null : trackId(tracks[i]!, i);
  }

  /** Disables the rest first: several enabled tracks are mixed, and two languages would play at once. */
  setAudioTrack(id: string): void {
    const tracks = this.#nativeAudioTracks();
    const target = tracks.findIndex((t, i) => trackId(t, i) === id);
    if (target < 0) return;
    tracks.forEach((t, i) => { if (i !== target) t.enabled = false; });
    tracks[target]!.enabled = true;
  }

  /**
   * Sources the browser can play that declare a `height`, by their index in
   * the manifest. Fewer than two is nothing to choose. With `<source>`
   * children the browser plays the first it can, so manifest order is the default.
   */
  #qualitySources(): Array<{ source: Source; index: number }> {
    const el = this.element;
    if (!el) return [];
    const candidates = this.#sources
      .map((source, index) => ({ source, index }))
      .filter(({ source }) => source.height && el.canPlayType(source.type) !== '');
    return candidates.length >= 2 ? candidates : [];
  }

  getQualities(): QualityInfo[] {
    return this.#qualitySources().map(({ source, index }) => ({
      id: String(index),
      height: source.height ?? null,
      bitrate: null,
      label: source.label ?? '',
    }));
  }

  getQuality(): string | null {
    const el = this.element;
    if (!el?.currentSrc) return null;
    const playing = this.#qualitySources()
      .find(({ source }) => new URL(source.src, el.baseURI).href === el.currentSrc);
    return playing ? String(playing.index) : null;
  }

  getPlayingQuality(): string | null {
    return this.getQuality();
  }

  /**
   * Another file means loading again, which resets position and rate: both are
   * restored once metadata arrives, and playback resumes if it was running.
   * Setting `src` leaves the `<track>` children, the captions, in place.
   */
  setQuality(id: string): void {
    const el = this.element;
    const target = this.#qualitySources().find(({ index }) => String(index) === id);
    if (!el || !target || this.getQuality() === id) return;

    const at = el.currentTime;
    const rate = el.playbackRate;
    const wasPlaying = !el.paused;
    el.addEventListener('loadedmetadata', () => {
      try { el.currentTime = at; } catch { /* out of range: starts over */ }
      el.playbackRate = rate;
      if (wasPlaying) void el.play().catch(() => {});
      this.callbacks.onQualities?.();
    }, { once: true });
    el.src = target.source.src;
  }

  /**
   * Absolute time of the current position, from WebKit's `getStartDate()`
   * (the EXT-X-PROGRAM-DATE-TIME of native HLS in Safari and iOS).
   */
  getProgramTime(): number | null {
    const el = this.element as (HTMLVideoElement & { getStartDate?: () => Date }) | null;
    if (!el?.getStartDate) return null;
    const start = el.getStartDate();
    const t = start instanceof Date ? start.getTime() : Number.NaN;
    if (!Number.isFinite(t)) return null;
    return t + el.currentTime * 1000;
  }
}

export const nativeEngineFactory: EngineFactory = {
  name: 'native',

  /**
   * For HLS, `canPlayType` says "maybe" everywhere, even where it cannot play it
   * (see docs/browser-quirks.md#canplaytype-hls). What decides is MSE: without it
   * (iOS) native is the only way; with it, "maybe", so hls.js wins when registered.
   */
  canPlay(source: Source): Confidence {
    if (!source.type) return 'no';
    if (isHlsType(source.type)) return hasMse() ? 'maybe' : 'probably';
    if (typeof document === 'undefined') return 'no';
    const probe = document.createElement('video');
    const r = probe.canPlayType(source.type);
    return r === '' ? 'no' : (r as Confidence);
  },

  create(): MediaEngine {
    return new NativeEngine();
  },
};
