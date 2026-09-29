/**
 * Engine on the native `<video>` element: progressive MP4, and HLS where the
 * browser plays it natively (Safari, iOS).
 */
import {
  hasMse, isHlsType,
  type AttachOptions, type Confidence, type EngineFactory, type MediaEngine,
} from './engine.js';
import type { Source, Stream } from './manifest.js';
import { MediaElementEngine, mediaElementError } from './media-element-engine.js';

export class NativeEngine extends MediaElementEngine {
  readonly name = 'native';

  protected prepare(el: HTMLVideoElement, stream: Stream, _options: AttachOptions): Promise<void> {
    el.preload = 'auto';
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
