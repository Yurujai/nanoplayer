import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvents } from '../src/core-events.js';
import type { MediaEngine } from '../src/engine.js';
import { EventBus } from '../src/events.js';
import {
  SYNC_PROFILES, Synchronizer, detectProfile,
  type Scheduler, type SyncProfile,
} from '../src/sync.js';

/** Fake engine with time under control, to cause drift. */
function fakeEngine(t = 0) {
  let currentTime = t;
  let rate = 1;
  let seeking = false;
  const seeks: number[] = [];
  return {
    name: 'fake',
    get element() { return { seeking } as HTMLVideoElement; },
    get attached() { return true; },
    attach: async () => {},
    detach: () => {},
    play: async () => {},
    pause: () => {},
    seek(s: number) { currentTime = s; seeks.push(s); },
    get currentTime() { return currentTime; },
    get duration() { return 100; },
    get paused() { return false; },
    get ended() { return false; },
    get buffered() { return null; },
    get seekable() { return null; },
    getPlaybackRate: () => rate,
    setPlaybackRate(r: number) { rate = r; },
    setVolume: () => {},
    setMuted: () => {},
    destroy: () => {},
    // Test helpers
    _set(s: number) { currentTime = s; },
    _seeking(v: boolean) { seeking = v; },
    _seeks: seeks,
  } satisfies MediaEngine & Record<string, unknown>;
}

const P: SyncProfile = SYNC_PROFILES.blink;

let master: ReturnType<typeof fakeEngine>;
let slave: ReturnType<typeof fakeEngine>;

const sync = (profile: SyncProfile = P, scheduler?: Scheduler) =>
  new Synchronizer({
    master: { id: 'cam', engine: master },
    slaves: [{ id: 'slides', engine: slave }],
    profile,
    ...(scheduler ? { scheduler } : {}),
  });

beforeEach(() => {
  master = fakeEngine(10);
  slave = fakeEngine(10);
});

describe('per-engine profiles', () => {
  it('WebKit lowers the hard-seek threshold, not the gain', () => {
    // see docs/browser-quirks.md#sync-profiles
    expect(SYNC_PROFILES.webkit.hardSeek).toBeLessThan(SYNC_PROFILES.blink.hardSeek);
    expect(SYNC_PROFILES.webkit.gain).toBe(SYNC_PROFILES.blink.gain);
  });

  it('detects WebKit by ManagedMediaSource', () => {
    const g = globalThis as { ManagedMediaSource?: unknown };
    const previous = g.ManagedMediaSource;
    g.ManagedMediaSource = function () {};
    expect(detectProfile()).toBe('webkit');
    if (previous === undefined) delete g.ManagedMediaSource;
    else g.ManagedMediaSource = previous;
  });
});

describe('Synchronizer · correction', () => {
  it('does not touch the master: its audio would be heard', () => {
    slave._set(10.2);
    sync().tick();
    expect(master.getPlaybackRate()).toBe(1);
  });

  it('does not correct inside the dead zone', () => {
    slave._set(10 + P.deadZone / 2);
    const [m] = sync().tick();
    expect(m!.action).toBe('ok');
    expect(slave.getPlaybackRate()).toBe(1);
  });

  it('speeds up a slave that lags behind', () => {
    slave._set(9.9);            // 100 ms behind
    const [m] = sync().tick();
    expect(m!.action).toBe('correcting');
    expect(slave.getPlaybackRate()).toBeGreaterThan(1);
  });

  it('slows down a slave that runs ahead', () => {
    slave._set(10.1);
    sync().tick();
    expect(slave.getPlaybackRate()).toBeLessThan(1);
  });

  it('does not exceed the rate cap', () => {
    slave._set(10 - P.hardSeek * 0.9);   // large drift, but no seek
    sync().tick();
    expect(slave.getPlaybackRate()).toBeLessThanOrEqual(1 + P.maxRateDelta);
  });

  it('hard-seeks when drift spikes', () => {
    slave._set(10 + P.hardSeek + 0.1);
    const s = sync();
    const [m] = s.tick();
    expect(m!.action).toBe('hard-seek');
    expect(slave.currentTime).toBe(10);
    expect(slave.getPlaybackRate()).toBe(1);
    expect(s.hardSeeks).toBe(1);
  });

  it('does not measure during a seek: the reading means nothing', () => {
    slave._set(9.5);
    slave._seeking(true);
    const [m] = sync().tick();
    expect(m!.action).toBe('waiting');
    expect(slave._seeks).toHaveLength(0);
  });

  it('keeps correcting between the release and engage thresholds', () => {
    // Without hysteresis it stops in the dead zone with a fixed offset (S1: 28.8 ms).
    const s = sync();
    slave._set(10 - 0.1);        // engages
    expect(s.tick()[0]!.action).toBe('correcting');

    slave._set(10 - 0.02);       // inside deadZone, outside releaseZone
    expect(s.tick()[0]!.action, 'must keep correcting').toBe('correcting');

    slave._set(10 - 0.004);      // below releaseZone
    expect(s.tick()[0]!.action).toBe('ok');
  });

  it('after releasing it does not engage again until past the threshold', () => {
    const s = sync();
    slave._set(10 - 0.1); s.tick();
    slave._set(10 - 0.001); s.tick();          // releases
    slave._set(10 - 0.02);                     // below deadZone
    expect(s.tick()[0]!.action).toBe('ok');
  });

  it('respects the master\'s rate when correcting', () => {
    master.setPlaybackRate(2);
    slave._set(9.9);
    sync().tick();
    expect(slave.getPlaybackRate()).toBeGreaterThan(2);
    expect(slave.getPlaybackRate()).toBeLessThanOrEqual(2 + P.maxRateDelta);
  });
});

describe('Synchronizer · lifecycle', () => {
  const manualScheduler = () => {
    let tick: (() => void) | null = null;
    const s: Scheduler & { step(): void } = {
      start(t) { tick = t; },
      stop() { tick = null; },
      step() { tick?.(); },
    };
    return s;
  };

  it('start and stop switch the loop on and off', () => {
    const ag = manualScheduler();
    const s = sync(P, ag);
    expect(s.running).toBe(false);
    s.start();
    expect(s.running).toBe(true);
    s.stop();
    expect(s.running).toBe(false);
  });

  it('start is idempotent', () => {
    const ag = manualScheduler();
    const spy = vi.spyOn(ag, 'start');
    const s = sync(P, ag);
    s.start(); s.start();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('stopping restores the slave\'s natural rate', () => {
    const ag = manualScheduler();
    const s = sync(P, ag);
    s.start();
    slave._set(9.8);
    ag.step();
    expect(slave.getPlaybackRate()).not.toBe(1);
    s.stop();
    expect(slave.getPlaybackRate()).toBe(1);
  });

  it('does not start without slaves: nothing to sync', () => {
    const s = new Synchronizer({
      master: { id: 'cam', engine: master }, slaves: [], profile: P,
    });
    s.start();
    expect(s.running).toBe(false);
  });

  it('align snaps the slaves at once', () => {
    slave._set(9.3);
    slave.setPlaybackRate(1.2);
    sync().align();
    expect(slave.currentTime).toBe(10);
    expect(slave.getPlaybackRate()).toBe(1);
  });
});

describe('Synchronizer · several slaves', () => {
  it('corrects each with its own state', () => {
    const b = fakeEngine(10);
    const s = new Synchronizer({
      master: { id: 'cam', engine: master },
      slaves: [{ id: 'a', engine: slave }, { id: 'b', engine: b }],
      profile: P,
    });
    slave._set(9.9);   // needs correcting
    b._set(10.001);      // fine
    const samples = s.tick();
    expect(samples.map((m) => m.action)).toEqual(['correcting', 'ok']);
    expect(samples.map((m) => m.stream)).toEqual(['a', 'b']);
  });
});

/* ---------------------------------------------------------------- live -- */

/** Fake engine that also reports its absolute time. */
function engineWithClock(currentTime: number, clock: number | null) {
  const m = fakeEngine(currentTime) as ReturnType<typeof fakeEngine> & {
    getProgramTime(): number | null;
    _clock(h: number | null): void;
  };
  let h = clock;
  m.getProgramTime = () => h;
  m._clock = (v: number | null) => { h = v; };
  return m;
}

describe('Synchronizer · live', () => {
  const T0 = 1_700_000_000_000;

  it('measures by absolute time, not currentTime', () => {
    // Synced streams whose currentTime differs by 20 s.
    // see docs/browser-quirks.md#live-currenttime-origin
    const master = engineWithClock(30, T0);
    const slave = engineWithClock(10, T0);      // 20 s apart in currentTime
    const s = new Synchronizer({
      master: { id: 'cam', engine: master },
      slaves: [{ id: 'slides', engine: slave }],
      live: true, profile: P,
    });

    expect(s.mode).toBe('program');
    const [m] = s.tick();
    expect(m!.drift).toBe(0);
    expect(m!.action, 'must correct nothing').toBe('ok');
    expect(slave._seeks, 'not a single seek').toHaveLength(0);
  });

  it('detects real drift even when currentTime matches', () => {
    // The reverse: identical currentTime but three seconds of real offset.
    const master = engineWithClock(30, T0);
    const slave = engineWithClock(30, T0 - 3000);
    const s = new Synchronizer({
      master: { id: 'cam', engine: master },
      slaves: [{ id: 'slides', engine: slave }],
      live: true, profile: P,
    });
    const [m] = s.tick();
    expect(m!.drift).toBeCloseTo(-3, 2);
    expect(m!.action).toBe('hard-seek');
  });

  it('the hard seek aligns by clock, not by copying the master\'s position', () => {
    // Copying the master's currentTime would jump to another timeline.
    const master = engineWithClock(30, T0);
    const slave = engineWithClock(100, T0 - 3000);
    new Synchronizer({
      master: { id: 'cam', engine: master },
      slaves: [{ id: 'slides', engine: slave }],
      live: true, profile: P,
    }).tick();
    // 100 - (-3) = 103, not 30.
    expect(slave._seeks[0]).toBeCloseTo(103, 2);
  });

  it('without absolute time it does NOT correct, and warns once', () => {
    // S5: faking sync that cannot be measured is worse than not offering it.
    const bus = new EventBus<CoreEvents>({ onListenerError: () => {} });
    const warnings: string[] = [];
    bus.on('sync:unavailable', ({ reason }) => warnings.push(reason));

    const master = engineWithClock(30, null);
    const slave = engineWithClock(10, null);
    const s = new Synchronizer({
      master: { id: 'cam', engine: master },
      slaves: [{ id: 'slides', engine: slave }],
      live: true, profile: P, bus,
    });

    expect(s.mode).toBe('impossible');
    s.tick(); s.tick(); s.tick();

    expect(slave._seeks, 'must touch nothing').toHaveLength(0);
    expect(slave.getPlaybackRate()).toBe(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/PROGRAM-DATE-TIME/);
  });

  it('align touches nothing either if it cannot measure', () => {
    const master = engineWithClock(30, null);
    const slave = engineWithClock(10, null);
    new Synchronizer({
      master: { id: 'cam', engine: master },
      slaves: [{ id: 'slides', engine: slave }],
      live: true, profile: P,
    }).align();
    expect(slave._seeks).toHaveLength(0);
  });

  it('on demand it still measures by currentTime', () => {
    const master = engineWithClock(30, T0);
    const slave = engineWithClock(29.9, T0);
    const s = new Synchronizer({
      master: { id: 'cam', engine: master },
      slaves: [{ id: 'slides', engine: slave }],
      profile: P,                       // no `live`
    });
    expect(s.mode).toBe('timeline');
    expect(s.tick()[0]!.drift).toBeCloseTo(-0.1, 3);
  });

  it('a slave briefly without a clock does not break the loop', () => {
    // It can happen while the playlist reloads.
    const master = engineWithClock(30, T0);
    const slave = engineWithClock(30, null);
    const s = new Synchronizer({
      master: { id: 'cam', engine: master },
      slaves: [{ id: 'slides', engine: slave }],
      live: true, profile: P,
    });
    const [m] = s.tick();
    expect(m!.action).toBe('waiting');
    expect(slave._seeks).toHaveLength(0);
  });
});

describe('Synchronizer · cooldown after a seek', () => {
  const withClock = (t: { value: number }) => new Synchronizer({
    master: { id: 'cam', engine: master },
    slaves: [{ id: 'slides', engine: slave }],
    profile: P,
    now: () => t.value,
  });

  it('does not measure while the seek settles', () => {
    // Without it, after seeking back live the loop sat at 270 ms, hard-seeking
    // every few seconds instead of converging. With it: 0 ms.
    const t = { value: 1000 };
    const s = withClock(t);
    s.align();

    slave._set(9.5);                       // half a second off
    expect(s.tick()[0]!.action, 'must not react yet').toBe('waiting');
    expect(slave._seeks.length, 'nor seek').toBeLessThanOrEqual(1);

    t.value += 2000;                          // past the cooldown
    expect(s.tick()[0]!.action).not.toBe('waiting');
  });

  it('a hard seek also cools down, so they do not chain', () => {
    const t = { value: 1000 };
    const s = withClock(t);
    slave._set(10 + P.hardSeek + 0.5);
    expect(s.tick()[0]!.action).toBe('hard-seek');
    expect(s.hardSeeks).toBe(1);

    // Right after, even if still off, it does not chain another seek.
    slave._set(10 + P.hardSeek + 0.5);
    expect(s.tick()[0]!.action).toBe('waiting');
    expect(s.hardSeeks, 'still just one').toBe(1);

    t.value += 1000;
    expect(s.tick()[0]!.action).toBe('hard-seek');
  });

  it('the cooldown does not alter the steady state', () => {
    const t = { value: 100000 };
    const s = withClock(t);
    slave._set(9.9);
    expect(s.tick()[0]!.action).toBe('correcting');
  });
});

describe('Synchronizer · stuck slave', () => {
  const withClock = (t: { value: number }, bus?: EventBus<CoreEvents>) => new Synchronizer({
    master: { id: 'cam', engine: master },
    slaves: [{ id: 'slides', engine: slave }],
    profile: P,
    now: () => t.value,
    ...(bus ? { bus } : {}),
  });

  it('reports waiting as waiting, not ok', () => {
    // WebKit left a slave `seeking` forever while the bus said "ok" 200 times.
    // see docs/browser-quirks.md#webkit-hls-seek
    const bus = new EventBus<CoreEvents>();
    const actions: string[] = [];
    bus.on('sync:drift', ({ action }) => actions.push(action));
    const s = withClock({ value: 1000 }, bus);
    slave._seeking(true);
    s.tick();
    expect(actions).toEqual(['waiting']);
  });

  it('past the margin, forces the slave to reposition', () => {
    const t = { value: 1000 };
    const s = withClock(t);
    slave._seeking(true);
    expect(s.tick()[0]!.action).toBe('waiting');
    t.value += 3000;
    expect(s.tick()[0]!.action, 'still within the margin').toBe('waiting');
    expect(slave._seeks).toEqual([]);

    t.value += 1500;
    expect(s.tick()[0]!.action).toBe('recover');
    // To its own position: that restarts loading in the engine.
    expect(slave._seeks).toEqual([10]);
  });

  it('if the master is seeking too, waiting is normal', () => {
    const t = { value: 1000 };
    const s = withClock(t);
    slave._seeking(true);
    master._seeking(true);
    s.tick();
    t.value += 10_000;
    expect(s.tick()[0]!.action).toBe('waiting');
    expect(slave._seeks).toEqual([]);
  });

  it('a good measurement resets the count', () => {
    const t = { value: 1000 };
    const s = withClock(t);
    slave._seeking(true);
    s.tick();
    t.value += 3000;
    slave._seeking(false);
    s.tick();
    slave._seeking(true);
    t.value += 3000;
    expect(s.tick()[0]!.action, 'the count started over').toBe('waiting');
  });
});
