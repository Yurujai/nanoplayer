/**
 * Engine contract. **An engine drives one stream, not a player**: dual-stream
 * is two engines coordinated by the synchronizer. Engines talk through
 * callbacks, not the core bus, so they are testable in isolation.
 */
import type { PlayerError } from './errors.js';
import type { Source, Stream } from './manifest.js';

/** Confidence in playing something, on the same scale as `canPlayType`. */
export type Confidence = 'probably' | 'maybe' | 'no';

/**
 * One audio rendition of the content: another language, or the same one with
 * audio description. They come from the media, not the manifest.
 */
export interface AudioTrackInfo {
  /** Stable while the engine stays attached. */
  id: string;
  /** May be empty: the media does not always name its tracks. */
  label: string;
  /** BCP 47, or empty. */
  lang: string;
  /** Narrates what is on screen (WCAG 1.2.5). */
  describes: boolean;
}

export interface EngineCallbacks {
  onTime?(current: number, duration: number): void;
  /** Playback was **requested**; it may not have started yet. */
  onPlay?(): void;
  /**
   * Playback **is actually running**. Not the same as `onPlay`: the browser
   * may be filling the buffer in between, which with HLS always happens.
   */
  onPlaying?(): void;
  onPause?(): void;
  onEnded?(): void;
  /** Ran out of buffer. */
  onStallStart?(): void;
  /** Recovered from a stall, with how long it lasted. */
  onStallEnd?(durationMs: number): void;
  onSeeked?(at: number): void;
  onError?(error: PlayerError): void;
  /** The audio tracks or the one playing changed. */
  onAudioTracks?(): void;
}

export interface AttachOptions {
  /** Position to continue from, recovered from an eviction. */
  startAt?: number;
  muted?: boolean;
  /** see docs/browser-quirks.md#ios-playsinline */
  playsInline?: boolean;
  callbacks?: EngineCallbacks;
}

export interface MediaEngine {
  readonly name: string;
  /** The media element, or `null` while not attached. */
  readonly element: HTMLVideoElement | null;
  readonly attached: boolean;

  /**
   * Creates the element, puts it in `container` and resolves once it can
   * accept `play()` — not once it has data, which iOS only fetches on the
   * first play(). see docs/browser-quirks.md#ios-no-preload
   */
  attach(container: HTMLElement, stream: Stream, options?: AttachOptions): Promise<void>;

  /**
   * Releases the element and **every** browser resource behind it.
   * see docs/browser-quirks.md#decoder-release
   */
  detach(): void;

  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;

  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly buffered: TimeRanges | null;
  /** The seekable range: the whole content on demand, the DVR window live. */
  readonly seekable: TimeRanges | null;

  /**
   * Absolute time of the current position, in ms since epoch, or `null`. Only
   * with `EXT-X-PROGRAM-DATE-TIME`; it is what makes two live streams
   * comparable. see docs/browser-quirks.md#live-currenttime-origin
   */
  getProgramTime?(): number | null;

  /**
   * Recommended position to watch a live stream without stalls, or `null`.
   * see docs/browser-quirks.md#live-segment-latency
   */
  liveSyncPosition?(): number | null;

  /**
   * Alternative audio, where the engine can switch it: natively on WebKit,
   * through hls.js elsewhere (S2: Blink has no `audioTracks`).
   */
  getAudioTracks?(): AudioTrackInfo[];
  /** The id of the track playing, or `null`. */
  getAudioTrack?(): string | null;
  setAudioTrack?(id: string): void;

  getPlaybackRate(): number;
  /** Changing the audio stream's rate is audible: slaves only. */
  setPlaybackRate(rate: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;

  /** Releases everything and leaves the engine unusable. */
  destroy(): void;
}

export interface EngineFactory {
  readonly name: string;
  canPlay(source: Source): Confidence;
  create(): MediaEngine;
}

const HLS_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
  'video/x-mpegurl',
]);

/** Whether a MIME type is HLS, any common alias, parameters ignored. */
export function isHlsType(type: string): boolean {
  return HLS_TYPES.has(type.split(';')[0]!.trim().toLowerCase());
}

/** Media Source Extensions, which hls.js needs. `ManagedMediaSource` (Safari 17+) counts. */
export function hasMse(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const g = globalThis as { MediaSource?: unknown; ManagedMediaSource?: unknown };
  return g.MediaSource !== undefined || g.ManagedMediaSource !== undefined;
}

const RANK: Record<Confidence, number> = { probably: 2, maybe: 1, no: 0 };

/** The engine's best confidence over any of the stream's sources. */
export function confidenceFor(factory: EngineFactory, stream: Stream): Confidence {
  let best: Confidence = 'no';
  for (const source of stream.sources) {
    const c = factory.canPlay(source);
    if (RANK[c] > RANK[best]) best = c;
  }
  return best;
}

/**
 * The most confident engine for a stream, or `null`. On a tie the one
 * registered first wins, so registration order expresses preference.
 */
export function selectEngine(
  factories: readonly EngineFactory[],
  stream: Stream,
): EngineFactory | null {
  let chosen: EngineFactory | null = null;
  let best = 0;
  for (const f of factories) {
    const c = RANK[confidenceFor(f, stream)];
    if (c > best) {
      best = c;
      chosen = f;
    }
  }
  return chosen;
}

export type { Source, Stream };
