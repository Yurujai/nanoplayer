/**
 * Multi-stream sync: master/slave with drift correction, as validated in S1.
 * The **master** carries the audio and its playbackRate is never touched (it
 * would be heard); the muted **slaves** chase it. Small drift → proportional
 * control on playbackRate; large drift → hard seek. Hysteresis is required:
 * without separate engage/release thresholds the controller stops inside the
 * dead zone and leaves a fixed offset (S1: 28.8 ms without, 9.8 ms with).
 */
import type { CoreEvents } from './core-events.js';
import type { MediaEngine } from './engine.js';
import type { EventBus } from './events.js';

export interface SyncProfile {
  /** ENGAGE threshold: below it correction does not start. */
  deadZone: number;
  /** RELEASE threshold: once engaged, correct until below it. */
  releaseZone: number;
  /** Proportional gain. It governs recovery time. */
  gain: number;
  /** Cap on the slave's rate deviation. */
  maxRateDelta: number;
  /** Above this, a hard seek instead of smooth correction. */
  hardSeek: number;
}

/**
 * Per-engine profiles. WebKit keeps a good median with severe one-off
 * excursions, so its profile lowers the hard-seek threshold instead of raising
 * the gain. see docs/browser-quirks.md#sync-profiles
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

/** Every iOS browser is WebKit; `ManagedMediaSource` is checked before the UA string. */
export function detectProfile(): SyncProfileName {
  const g = globalThis as { ManagedMediaSource?: unknown; navigator?: Navigator };
  if (g.ManagedMediaSource !== undefined) return 'webkit';
  const ua = g.navigator?.userAgent ?? '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'webkit';
  // Chrome's UA contains "Safari", so it is ruled out first.
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua)) return 'webkit';
  return 'blink';
}

/** No measuring after a hard seek, in ms, while the position settles. */
const SEEK_COOLDOWN_MS = 700;

/** The same after aligning everything, which moves more pieces. */
const ALIGN_COOLDOWN_MS = 1200;

/**
 * How long a slave may stay unmeasurable while the master plays before it is
 * taken as stuck, in ms. Generous: a normal seek on a slow network takes seconds.
 */
const STUCK_MS = 4000;

/**
 * `waiting` — the slave cannot be measured now (it is seeking or has no clock).
 * `recover` — it stayed that way too long and was forced to reposition.
 */
export type SyncAction = 'ok' | 'correcting' | 'hard-seek' | 'waiting' | 'recover';

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
  /** Since when it cannot be measured while the master plays. */
  unmeasuredSince: number | null;
}

export interface SynchronizerOptions {
  master: { id: string; engine: MediaEngine };
  slaves: ReadonlyArray<{ id: string; engine: MediaEngine }>;
  profile?: SyncProfile;
  /**
   * Live content measures by absolute time, not `currentTime`, and does not
   * correct when that is impossible. see docs/browser-quirks.md#live-currenttime-origin
   */
  live?: boolean;
  bus?: EventBus<CoreEvents>;
  /** Injectable for tests; rVFC falling back to rAF by default. */
  scheduler?: Scheduler;
  /** Injectable for tests; `performance.now` by default. */
  now?: () => number;
}

/** How the control loop is scheduled, abstracted to test it without a browser. */
export interface Scheduler {
  start(tick: () => void): void;
  stop(): void;
}

/**
 * `requestVideoFrameCallback` when available: it fires on actual frame
 * presentation. `requestAnimationFrame` otherwise.
 */
export function defaultScheduler(video: HTMLVideoElement | null): Scheduler {
  let running = false;
  let handle = 0;
  const withRvfc = video !== null && 'requestVideoFrameCallback' in video;

  return {
    start(tick) {
      running = true;
      const step = () => {
        if (!running) return;
        tick();
        if (!running) return;
        handle = withRvfc
          ? (video as HTMLVideoElement).requestVideoFrameCallback(step)
          : requestAnimationFrame(step);
      };
      step();
    },
    stop() {
      running = false;
      if (!handle) return;
      if (withRvfc) (video as HTMLVideoElement).cancelVideoFrameCallback?.(handle);
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
  readonly #live: boolean;
  readonly #now: () => number;
  #running = false;
  #hardSeeks = 0;
  #warned = false;
  #coolUntil = 0;

  constructor(options: SynchronizerOptions) {
    this.#master = options.master;
    this.#slaves = options.slaves.map((s) => ({ ...s, correcting: false, unmeasuredSince: null }));
    this.#profile = options.profile ?? SYNC_PROFILES[detectProfile()];
    this.#bus = options.bus;
    this.#live = options.live === true;
    this.#now = options.now ?? (() => performance.now());
    this.#scheduler = options.scheduler
      ?? defaultScheduler(options.master.engine.element);
  }

  get running(): boolean {
    return this.#running;
  }

  get hardSeeks(): number {
    return this.#hardSeeks;
  }

  get profile(): SyncProfile {
    return this.#profile;
  }

  /**
   * Where the measurement comes from: `timeline` (currentTime difference, on
   * demand), `program` (absolute time, live), or `impossible` (live without
   * absolute time: nothing is corrected, since S5 saw synced streams whose
   * currentTime differed by 20 s).
   */
  get mode(): 'timeline' | 'program' | 'impossible' {
    if (!this.#live) return 'timeline';
    return this.#clockOf(this.#master.engine) !== null ? 'program' : 'impossible';
  }

  #clockOf(engine: MediaEngine): number | null {
    const t = engine.getProgramTime?.();
    return typeof t === 'number' && Number.isFinite(t) ? t : null;
  }

  start(): void {
    if (this.#running || this.#slaves.length === 0) return;
    this.#running = true;
    this.#scheduler.start(() => this.tick());
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    this.#scheduler.stop();
    // Slaves must not keep running at 1.25× once the loop stops.
    for (const s of this.#slaves) {
      s.correcting = false;
      s.engine.setPlaybackRate(this.#master.engine.getPlaybackRate());
    }
  }

  /** One step of the control loop. Public to test it step by step. */
  tick(): SyncSample[] {
    const master = this.#master.engine;
    const base = master.getPlaybackRate();
    const samples: SyncSample[] = [];

    if (this.mode === 'impossible') {
      if (!this.#warned) {
        this.#warned = true;
        this.#bus?.emit('sync:unavailable', {
          reason: 'The live stream has no EXT-X-PROGRAM-DATE-TIME: drift between '
            + 'streams cannot be measured, so it is not corrected',
        });
      }
      return [];
    }

    // Readings while a seek settles mean nothing; correcting on them kept the
    // loop at 270 ms, hard-seeking every few seconds (test: cooldown after a seek).
    if (this.#now() < this.#coolUntil) {
      return this.#slaves.map((s) => ({
        stream: s.id, drift: 0, action: 'waiting' as const,
        rate: s.engine.getPlaybackRate(),
      }));
    }

    for (const s of this.#slaves) {
      const sample = this.#correct(s, master.currentTime, base);
      samples.push(sample);
      this.#bus?.emit('sync:drift', {
        stream: sample.stream,
        drift: sample.drift,
        action: sample.action,
      });
    }
    return samples;
  }

  /** Slave drift from the master, in seconds; by absolute time when live. */
  #drift(s: Slave, masterTime: number): number | null {
    if (this.mode === 'program') {
      const hm = this.#clockOf(this.#master.engine);
      const hs = this.#clockOf(s.engine);
      if (hm === null || hs === null) return null;
      return (hs - hm) / 1000;
    }
    return s.engine.currentTime - masterTime;
  }

  #correct(s: Slave, masterTime: number, base: number): SyncSample {
    const p = this.#profile;
    const measured = this.#drift(s, masterTime);
    if (measured === null) return this.#wait(s, 0);
    const drift = measured;
    const a = Math.abs(drift);

    if (this.#master.engine.element?.seeking || s.engine.element?.seeking) {
      return this.#wait(s, drift);
    }
    s.unmeasuredSince = null;

    if (a > p.hardSeek) {
      // Seek by subtracting the drift from its own position: live timelines
      // differ between streams, so the master's currentTime cannot be copied.
      s.engine.seek(s.engine.currentTime - drift);
      s.engine.setPlaybackRate(base);
      s.correcting = false;
      this.#hardSeeks++;
      this.#coolUntil = this.#now() + SEEK_COOLDOWN_MS;
      return { stream: s.id, drift, action: 'hard-seek', rate: base };
    }

    if (!s.correcting && a > p.deadZone) s.correcting = true;
    else if (s.correcting && a < p.releaseZone) s.correcting = false;

    if (!s.correcting) {
      s.engine.setPlaybackRate(base);
      return { stream: s.id, drift, action: 'ok', rate: base };
    }

    const delta = Math.max(-p.maxRateDelta, Math.min(p.maxRateDelta, -p.gain * drift));
    const rate = base + delta;
    s.engine.setPlaybackRate(rate);
    return { stream: s.id, drift, action: 'correcting', rate };
  }

  /**
   * The slave cannot be measured now: wait, but not forever. Past `STUCK_MS`
   * with the master playing, it is asked to seek to its own position, which
   * restarts loading in an engine that missed the previous seek.
   * see docs/browser-quirks.md#webkit-hls-seek
   */
  #wait(s: Slave, drift: number): SyncSample {
    const rate = s.engine.getPlaybackRate();
    const master = this.#master.engine;
    if (master.paused || master.element?.seeking) {
      s.unmeasuredSince = null;
      return { stream: s.id, drift, action: 'waiting', rate };
    }
    const now = this.#now();
    s.unmeasuredSince ??= now;
    if (now - s.unmeasuredSince < STUCK_MS) {
      return { stream: s.id, drift, action: 'waiting', rate };
    }
    s.unmeasuredSince = null;
    s.engine.seek(s.engine.currentTime);
    this.#coolUntil = now + SEEK_COOLDOWN_MS;
    return { stream: s.id, drift, action: 'recover', rate };
  }

  /**
   * Snaps the slaves to the master, without smooth correction: after a user
   * seek, or at start, where playing in sequence leaves ~70 ms of start-up lag.
   */
  align(): void {
    if (this.mode === 'impossible') return;
    this.#coolUntil = this.#now() + ALIGN_COOLDOWN_MS;
    const t = this.#master.engine.currentTime;
    const base = this.#master.engine.getPlaybackRate();
    for (const s of this.#slaves) {
      const d = this.#drift(s, t);
      s.engine.seek(d === null ? t : s.engine.currentTime - d);
      s.engine.setPlaybackRate(base);
      s.correcting = false;
      s.unmeasuredSince = null;
    }
  }
}
