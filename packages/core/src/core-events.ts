/**
 * The core event catalogue. Complete from day one: an analytics sink plugs in
 * with `bus.onAny()` and can only report what the core emits. Naming is
 * `subject:verb`, and fallible operations split into `:start` / `:ok` / `:fail`.
 */
import type { BumperPhase, ChainPhase } from './chain.js';
import type { AudioTrackInfo, QualityInfo } from './engine.js';
import type { Empty } from './events.js';
import type { PlayerError } from './errors.js';
import type { Manifest } from './manifest.js';
import type { PlayerState } from './state.js';
import type { SyncAction } from './sync.js';

export interface CoreEvents {
  // --- lifecycle ------------------------------------------------------------
  'state:change': { from: PlayerState; to: PlayerState };
  'destroy': Empty;
  /** A UI is mounted and its slots are available. */
  'ui:ready': Empty;

  // --- manifest -------------------------------------------------------------
  'manifest:resolve:start': Empty;
  'manifest:resolve:ok': { manifest: Manifest };
  'manifest:resolve:fail': { error: PlayerError };

  // --- engines --------------------------------------------------------------
  'engine:attach:start': Empty;
  /** `resumeAt` is the position recovered from a previous eviction. */
  'engine:attach:ok': { engine: string; resumeAt: number };
  'engine:attach:fail': { error: PlayerError };
  /** Eviction. `at` is the position kept for the next attach. */
  'engine:detach': { at: number };

  // --- playback -------------------------------------------------------------
  'play': { at: number };
  'pause': { at: number };
  'ended': { at: number };
  'time': { current: number; duration: number };
  'seek:start': { from: number; to: number };
  'seek:end': { at: number };
  'ratechange': { rate: number };
  /** The content's audio tracks or the one playing changed. */
  'audio:tracks': { tracks: AudioTrackInfo[]; active: string | null };
  /** The content's qualities, the one chosen or the one playing changed. */
  'quality:change': { qualities: QualityInfo[]; selected: string | null; playing: string | null };
  'volumechange': { volume: number; muted: boolean };

  // --- intro and outro ------------------------------------------------------
  /** The visible piece changed. Emitted at the visible switch, not when requested. */
  'chain:phase': { from: ChainPhase; to: ChainPhase; skipped: boolean };
  /** Intro/outro progress, apart from `time`, which belongs to the content only. */
  'chain:time': { phase: BumperPhase; current: number; duration: number };
  /** An intro or outro could not play and was skipped. Not an `error`: the content goes on. */
  'chain:unavailable': { phase: BumperPhase; error: PlayerError };

  // --- multi-stream ---------------------------------------------------------
  /**
   * Drift between a slave and the master. `waiting`: cannot be measured now
   * (the slave is seeking or has no clock); `recover`: it stayed that way too
   * long and was forced to reposition.
   */
  'sync:drift': { stream: string; drift: number; action: SyncAction };
  'layout:change': { layout: string };
  /** Drift cannot be measured, so it is not corrected: a live stream without EXT-X-PROGRAM-DATE-TIME. */
  'sync:unavailable': { reason: string };

  // --- live -----------------------------------------------------------------
  /** A stream's broadcast status changed. `retryInMs` when a retry is scheduled. */
  'live:status': {
    stream: string;
    status: 'waiting' | 'live' | 'interrupted';
    retryInMs?: number;
  };

  // --- network and buffering ------------------------------------------------
  'stall:start': { stream: string };
  'stall:end': { stream: string; durationMs: number };

  // --- errors ---------------------------------------------------------------
  'error': { error: PlayerError };
}
