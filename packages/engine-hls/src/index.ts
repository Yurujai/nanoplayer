/**
 * HLS engine on top of hls.js, loaded lazily so MP4-only pages never download it.
 * It wins wherever MSE exists; without MSE (iOS) the native engine plays HLS.
 */
import {
  hasMse, isHlsType, MediaElementEngine, playerError,
  type AttachOptions, type AudioTrackInfo, type Confidence, type EngineFactory, type MediaEngine,
  type PlayerError, type Source, type Stream,
} from '@nanoplayer/core';
import type HlsType from 'hls.js';

type Hls = HlsType;

const PLAYLIST_TIMEOUT_MS = 20000;

let loading: Promise<typeof HlsType> | null = null;
function loadHls(): Promise<typeof HlsType> {
  loading ??= import('hls.js').then((m) => m.default);
  return loading;
}

export class HlsEngine extends MediaElementEngine {
  readonly name = 'hls.js';

  #hls: Hls | null = null;

  protected async prepare(el: HTMLVideoElement, stream: Stream, _options: AttachOptions): Promise<void> {
    const source = stream.sources.find((s) => isHlsType(s.type));
    if (!source) {
      throw playerError('engine/unsupported', `Stream "${stream.id}" has no HLS source`);
    }

    const Hls = await loadHls();
    if (!Hls.isSupported()) {
      throw playerError('engine/unsupported',
        'hls.js cannot run in this browser: no Media Source Extensions');
    }

    this.#hls = new Hls({ enableWorker: true, startLevel: -1, backBufferLength: 90 });
    this.#recoverFromErrors(this.#hls, Hls);
    this.#watchAudioTracks(this.#hls, Hls);
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

export const hlsEngineFactory: EngineFactory = {
  name: 'hls.js',

  /** Never trusts canPlayType for HLS. See docs/browser-quirks.md#canplaytype-hls */
  canPlay(source: Source): Confidence {
    if (!source.type || !isHlsType(source.type)) return 'no';
    return hasMse() ? 'probably' : 'no';
  },

  create(): MediaEngine {
    return new HlsEngine();
  },
};

/** Engines in order of preference, hls.js first: `canPlay` decides the rest. */
export function enginesWithHls(
  native: EngineFactory,
): readonly EngineFactory[] {
  return [hlsEngineFactory, native];
}
