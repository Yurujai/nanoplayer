/**
 * HLS engine on top of hls.js, loaded lazily so MP4-only pages never download it.
 * It wins wherever MSE exists; without MSE (iOS) the native engine plays HLS.
 *
 * Where hls.js comes from is the factory's choice: the npm package by default,
 * or a `window.Hls` loaded from a CDN, which is how the `<script>` bundle gets it.
 */
import {
  AUTO_QUALITY, hasMse, isHlsType, MediaElementEngine, playerError,
  type AttachOptions, type AudioTrackInfo, type Confidence, type EngineFactory, type MediaEngine,
  type PlayerError, type QualityInfo, type Source, type Stream,
} from '@nanoplayer/core';
import type HlsType from 'hls.js';

type Hls = HlsType;

/** The hls.js class: the package's default export, or the CDN build's `window.Hls`. */
export type HlsConstructor = typeof HlsType;
export type HlsLoader = () => Promise<HlsConstructor>;

const PLAYLIST_TIMEOUT_MS = 20000;

let loading: Promise<HlsConstructor> | null = null;
function loadFromPackage(): Promise<HlsConstructor> {
  loading ??= import('hls.js').then((m) => m.default);
  return loading;
}

export class HlsEngine extends MediaElementEngine {
  readonly name = 'hls.js';
  readonly autoQuality = true;

  #hls: Hls | null = null;

  /**
   * The loader is required, not defaulted to the package: a default would keep
   * the `import('hls.js')` alive in the `<script>` bundle, which cannot resolve it.
   */
  constructor(private readonly loadHls: HlsLoader) {
    super();
  }

  protected async prepare(el: HTMLVideoElement, stream: Stream, _options: AttachOptions): Promise<void> {
    const source = stream.sources.find((s) => isHlsType(s.type));
    if (!source) {
      throw playerError('engine/unsupported', `Stream "${stream.id}" has no HLS source`);
    }

    const Hls = await this.loadHls();
    if (!Hls.isSupported()) {
      throw playerError('engine/unsupported',
        'hls.js cannot run in this browser: no Media Source Extensions');
    }

    this.#hls = new Hls({ enableWorker: true, startLevel: -1, backBufferLength: 90 });
    this.#recoverFromErrors(this.#hls, Hls);
    this.#watchAudioTracks(this.#hls, Hls);
    this.#watchQualities(this.#hls, Hls);
    this.#hls.attachMedia(el);
    this.#hls.loadSource(source.src);

    // With MSE the element has no data until hls.js appends segments: wait for the playlist.
    await this.#waitForPlaylist(this.#hls, Hls);
  }

  /** Without destroy() hls.js keeps downloading segments. See docs/browser-quirks.md#decoder-release */
  protected override release(): void {
    this.#hls?.destroy();
    this.#hls = null;
  }

  /** hls.js detects and recovers element errors itself; reporting them would show an error mid-recovery. */
  protected override onElementError(): void {}

  #waitForPlaylist(hls: Hls, Hls: typeof HlsType): Promise<void> {
    return new Promise((resolve, reject) => {
      const ok = () => { cleanUp(); resolve(); };
      const fail = (_e: unknown, data: { fatal?: boolean; details?: string }) => {
        if (!data?.fatal) return;
        cleanUp();
        reject(playerError('media/network',
          `hls.js could not load the playlist: ${data.details ?? 'unknown error'}`));
      };
      const cleanUp = () => {
        hls.off(Hls.Events.MANIFEST_PARSED, ok);
        hls.off(Hls.Events.ERROR, fail as never);
        clearTimeout(timer);
      };
      const timer = setTimeout(() => {
        cleanUp();
        reject(playerError('media/network', 'Timed out loading the HLS playlist'));
      }, PLAYLIST_TIMEOUT_MS);
      hls.on(Hls.Events.MANIFEST_PARSED, ok);
      hls.on(Hls.Events.ERROR, fail as never);
    });
  }

  #recoverFromErrors(hls: Hls, Hls: typeof HlsType): void {
    const onError = (_e: unknown, data: {
      fatal?: boolean; type?: string; details?: string;
    }) => {
      if (!data?.fatal) return;
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          return;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          return;
        default:
          this.callbacks.onError?.(this.#toPlayerError(data));
      }
    };
    hls.on(Hls.Events.ERROR, onError as never);
    this.onDetach(() => hls.off(Hls.Events.ERROR, onError as never));
  }

  #watchAudioTracks(hls: Hls, Hls: typeof HlsType): void {
    const notify = () => this.callbacks.onAudioTracks?.();
    for (const event of [Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED]) {
      hls.on(event, notify);
      this.onDetach(() => hls.off(event, notify));
    }
  }

  /** Renditions from the playlist's `EXT-X-MEDIA:TYPE=AUDIO`; the id is the index hls.js switches by. */
  getAudioTracks(): AudioTrackInfo[] {
    return (this.#hls?.audioTracks ?? []).map((t, i) => ({
      id: String(i),
      label: t.name ?? '',
      lang: t.lang ?? '',
      describes: (t.characteristics ?? '').includes('public.accessibility.describes-video'),
    }));
  }

  getAudioTrack(): string | null {
    const i = this.#hls?.audioTrack ?? -1;
    return i < 0 ? null : String(i);
  }

  setAudioTrack(id: string): void {
    const i = Number(id);
    if (this.#hls && Number.isInteger(i) && i >= 0 && i < this.#hls.audioTracks.length) {
      this.#hls.audioTrack = i;
    }
  }

  #watchQualities(hls: Hls, Hls: HlsConstructor): void {
    const notify = () => this.callbacks.onQualities?.();
    for (const event of [Hls.Events.MANIFEST_PARSED, Hls.Events.LEVELS_UPDATED, Hls.Events.LEVEL_SWITCHED]) {
      hls.on(event, notify);
      this.onDetach(() => hls.off(event, notify));
    }
  }

  /** The playlist's ladder; the id is the level index hls.js switches by. */
  getQualities(): QualityInfo[] {
    return (this.#hls?.levels ?? []).map((level, i) => ({
      id: String(i),
      height: level.height || null,
      bitrate: level.bitrate || null,
      label: level.name ?? '',
    }));
  }

  getQuality(): string | null {
    const hls = this.#hls;
    if (!hls || !hls.levels?.length) return null;
    return hls.autoLevelEnabled ? AUTO_QUALITY : String(hls.currentLevel);
  }

  getPlayingQuality(): string | null {
    const i = this.#hls?.currentLevel ?? -1;
    return i < 0 ? null : String(i);
  }

  /** `currentLevel`, not `nextLevel`: whoever picks a quality expects to see it now. */
  setQuality(id: string): void {
    const hls = this.#hls;
    if (!hls) return;
    if (id === AUTO_QUALITY) {
      hls.currentLevel = -1;
    } else {
      const i = Number(id);
      if (Number.isInteger(i) && i >= 0 && i < (hls.levels?.length ?? 0)) hls.currentLevel = i;
    }
    this.callbacks.onQualities?.();
  }

  #toPlayerError(data: { type?: string; details?: string }): PlayerError {
    const detail = data.details ?? 'unknown error';
    if (data.type === 'networkError') {
      return playerError('media/network', `HLS network error: ${detail}`);
    }
    if (data.type === 'mediaError') {
      return playerError('media/decode', `HLS decoding error: ${detail}`);
    }
    return playerError('engine/failed', `hls.js failure: ${detail}`);
  }

  override seek(seconds: number): void {
    super.seek(seconds);
    const el = this.element;
    if (!el || !Number.isFinite(seconds) || seconds < 0) return;
    // WebKit never tells hls.js about a seek outside the buffer, freezing playback.
    // See docs/browser-quirks.md#webkit-hls-seek and test/seek.test.ts.
    if (!this.#isBuffered(el, seconds)) this.#hls?.startLoad(seconds);
  }

  #isBuffered(el: HTMLVideoElement, t: number): boolean {
    const b = el.buffered;
    for (let i = 0; i < b.length; i++) {
      if (t >= b.start(i) && t < b.end(i)) return true;
    }
    return false;
  }

  /** `null` when the playlist has no EXT-X-PROGRAM-DATE-TIME: live sync cannot be measured. */
  getProgramTime(): number | null {
    const d = this.#hls?.playingDate;
    return d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : null;
  }

  liveSyncPosition(): number | null {
    const p = this.#hls?.liveSyncPosition;
    return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null;
  }
}

export interface HlsEngineFactoryOptions {
  /**
   * Whether hls.js can be had right now. Asked at each engine choice, not once:
   * a CDN tag with `defer` or `async` may finish after the player is created.
   */
  isAvailable?: () => boolean;
}

/** An hls.js engine factory taking hls.js from `load`. */
export function createHlsEngineFactory(
  load: HlsLoader, options: HlsEngineFactoryOptions = {},
): EngineFactory {
  return {
    name: 'hls.js',

    /** Never trusts canPlayType for HLS. See docs/browser-quirks.md#canplaytype-hls */
    canPlay(source: Source): Confidence {
      if (!source.type || !isHlsType(source.type)) return 'no';
      if (options.isAvailable && !options.isAvailable()) return 'no';
      return hasMse() ? 'probably' : 'no';
    },

    create(): MediaEngine {
      return new HlsEngine(load);
    },
  };
}

/** hls.js from the npm package, imported on first use. */
export const hlsEngineFactory: EngineFactory = /* @__PURE__ */ createHlsEngineFactory(loadFromPackage);

/** Engines in order of preference, hls.js first: `canPlay` decides the rest. */
export function enginesWithHls(
  native: EngineFactory,
): readonly EngineFactory[] {
  return [hlsEngineFactory, native];
}
