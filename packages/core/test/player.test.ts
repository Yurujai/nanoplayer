// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineFactory, MediaEngine } from '../src/engine.js';
import { Player } from '../src/player.js';

/** Fake engine: attaches instantly and lets tests inspect what it is asked. */
function fakeFactory() {
  const created: Array<MediaEngine & Record<string, any>> = [];
  const factory: EngineFactory = {
    name: 'fake',
    canPlay: () => 'probably',
    create() {
      let currentTime = 0, rate = 1, paused = true, muted = false, volume = 1;
      let attached = false;
      let cb: any = {};
      const e = {
        name: 'fake',
        get element() { return { seeking: false } as HTMLVideoElement; },
        get attached() { return attached; },
        async attach(container: HTMLElement, _s: unknown, o: any) {
          attached = true;
          cb = o?.callbacks ?? {};
          muted = !!o?.muted;
          if (o?.startAt) currentTime = o.startAt;
          container.appendChild(document.createElement('video'));
        },
        detach() { attached = false; },
        // The Player relies on callbacks to know it really plays. A real <video>
        // fires `play` when asked and `playing` when it starts; HLS has a gap.
        async play() { paused = false; cb.onPlay?.(); cb.onPlaying?.(); },
        pause() { paused = true; cb.onPause?.(); },
        seek(s: number) { currentTime = s; },
        get currentTime() { return currentTime; },
        get duration() { return 60; },
        get paused() { return paused; },
        get ended() { return false; },
        get buffered() { return null; },
        get seekable() { return null; },
        getPlaybackRate: () => rate,
        setPlaybackRate(r: number) { rate = r; },
        setVolume(v: number) { volume = v; },
        setMuted(m: boolean) { muted = m; },
        destroy() { attached = false; },
        // Test helpers
        _cb: () => cb,
        _muted: () => muted,
        _volume: () => volume,
        _set(t: number) { currentTime = t; },
      };
      created.push(e as never);
      return e as never;
    },
  };
  return { factory, created };
}

const MONO = {
  id: 'm', duration: 60,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
};
const DUAL = {
  id: 'd', duration: 60,
  streams: [
    { id: 'cam', role: 'presenter', audio: true,
      sources: [{ src: 'a.mp4', type: 'video/mp4' }] },
    { id: 'slides', role: 'presentation', audio: false,
      sources: [{ src: 'b.mp4', type: 'video/mp4' }] },
  ],
};

let container: HTMLElement;

const setup = (manifest: unknown, extra: Record<string, unknown> = {}) => {
  const { factory, created } = fakeFactory();
  const p = new Player({
    container, manifest: manifest as never, engines: [factory], ...extra,
  });
  return { p, created };
};

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('Player · zero network until asked', () => {
  it('constructing it resolves and downloads nothing', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { p } = setup('https://example/manifest.json');
    expect(p.state).toBe('idle');
    expect(p.manifest).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.children).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('resolving creates no media element', async () => {
    const { p } = setup(MONO);
    await p.resolve();
    expect(p.state).toBe('resolved');
    expect(container.querySelectorAll('video')).toHaveLength(0);
  });

  it('elements appear only on attach', async () => {
    const { p } = setup(DUAL);
    await p.attach();
    expect(p.state).toBe('attached');
    expect(container.querySelectorAll('video')).toHaveLength(2);
  });
});

describe('Player · manifest', () => {
  it('uses the injected resolver instead of fetch', async () => {
    const manifestResolver = vi.fn(async () => MONO);
    const { p } = setup('any/thing.json', { manifestResolver });
    await p.resolve();
    expect(manifestResolver).toHaveBeenCalledWith('any/thing.json');
    expect(p.manifest?.id).toBe('m');
  });

  it('an invalid manifest leaves the player idle', async () => {
    const broken = { id: 'x', streams: [
      { id: 'a', role: 'presenter', audio: true, sources: [{ src: 'a', type: 'video/mp4' }] },
      { id: 'b', role: 'presentation', audio: true, sources: [{ src: 'b', type: 'video/mp4' }] },
    ] };
    const { p } = setup(broken);
    await expect(p.resolve()).rejects.toMatchObject({ code: 'manifest/invalid' });
    expect(p.state).toBe('idle');
  });

  it('the validation error reaches the bus with the reason', async () => {
    const { p } = setup({ id: 'x' });
    const seen: string[] = [];
    p.on('manifest:resolve:fail', ({ error }) => seen.push(error.message));
    await p.resolve().catch(() => {});
    expect(seen[0]).toMatch(/streams/);
  });

  it('resolving twice does not repeat the request', async () => {
    const manifestResolver = vi.fn(async () => MONO);
    const { p } = setup('x.json', { manifestResolver });
    await p.resolve();
    await p.resolve();
    expect(manifestResolver).toHaveBeenCalledTimes(1);
  });
});

describe('Player · duration', () => {
  it('without engine metadata, uses the manifest\'s', async () => {
    // see docs/browser-quirks.md#ios-no-preload
    const { p, created } = setup({ ...MONO, duration: 42 });
    await p.attach();
    Object.defineProperty(created[0], 'duration', { get: () => 0 });
    expect(p.duration).toBe(42);
  });
});

describe('Player · volume', () => {
  it('volumechange reports the real state, not fixed values', async () => {
    const { p } = setup(MONO);
    const seen: Array<{ volume: number; muted: boolean }> = [];
    p.on('volumechange', (e) => seen.push(e));
    p.setVolume(0.4);
    p.setMuted(true);
    p.setVolume(0.6);
    expect(seen).toEqual([
      { volume: 0.4, muted: false },
      { volume: 0.4, muted: true },
      { volume: 0.6, muted: true },
    ]);
    expect(p.volume).toBe(0.6);
    expect(p.muted).toBe(true);
  });

  it('the chosen volume survives an eviction', async () => {
    const { p, created } = setup(MONO);
    await p.attach();
    p.setVolume(0.3);
    p.detach();
    await p.attach();
    expect(created.at(-1)!._volume()).toBe(0.3);
  });
});

describe('Player · audio and master', () => {
  it('only the stream with audio is heard', async () => {
    const { p, created } = setup(DUAL);
    await p.attach();
    expect(created[0]!._muted()).toBe(false);   // cam, carries audio
    expect(created[1]!._muted()).toBe(true);    // slides
  });

  it('the master is the one carrying audio', async () => {
    const { p, created } = setup(DUAL);
    await p.attach();
    expect(p.master).toBe(created[0]);
  });

  it('the rate applies to the master, not the slaves', async () => {
    const { p, created } = setup(DUAL);
    await p.attach();
    p.setPlaybackRate(1.5);
    expect(created[0]!.getPlaybackRate()).toBe(1.5);
  });
});

describe('Player · eviction', () => {
  it('releases the engines and keeps the position', async () => {
    const { p, created } = setup(DUAL);
    await p.play();
    created[0]!._set(42);

    p.detach();
    expect(p.state).toBe('resolved');
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(p.resumeAt).toBe(42);
  });

  it('reattaching resumes where it was', async () => {
    const { p, created } = setup(DUAL);
    await p.attach();
    created[0]!._set(42);
    p.detach();
    await p.attach();
    expect(p.currentTime).toBe(42);
  });

  it('emits engine:detach with the position', async () => {
    const { p, created } = setup(MONO);
    await p.attach();
    created[0]!._set(17);
    const fn = vi.fn();
    p.on('engine:detach', fn);
    p.detach();
    expect(fn).toHaveBeenCalledWith({ at: 17 });
  });

  it('evicts even if the pause event arrives late', async () => {
    // With an async `pause` (hls.js) the state was still `active` and the
    // forbidden transition threw.
    const { factory, created } = fakeFactory();
    const p = new Player({ container, manifest: DUAL as never, engines: [factory] });
    await p.play();
    expect(p.state).toBe('active');

    // The fake stops reporting: the event has not arrived yet.
    for (const e of created) e._cb().onPause = undefined;

    expect(() => p.detach()).not.toThrow();
    expect(p.state).toBe('resolved');
  });

  it('evicting with no engine attached does nothing', async () => {
    const { p } = setup(MONO);
    await p.resolve();
    expect(() => p.detach()).not.toThrow();
    expect(p.state).toBe('resolved');
  });
});

describe('Player · stalls', () => {
  it('on recovery, the held-back streams restart', async () => {
    const { p, created } = setup(DUAL);
    await p.play();
    created[1]!._cb().onStallStart();
    expect(created[0]!.paused).toBe(true);
    created[1]!._cb().onStallEnd(250);
    await Promise.resolve();
    expect(created.every((e) => !e.paused)).toBe(true);
  });

  it('if both stall, the last to recover also resumes', async () => {
    // With a single flag the first to recover cleared it and the slave stayed
    // paused, dragged by the sync loop in 733 ms seeks forever.
    const { p, created } = setup(DUAL);
    await p.play();

    created[0]!._cb().onStallStart();
    created[1]!._cb().onStallStart();

    created[0]!._cb().onStallEnd(200);
    await Promise.resolve();
    expect(created[1]!.paused, 'the one still stalled is not resumed').toBe(true);

    created[1]!._cb().onStallEnd(300);
    await Promise.resolve();
    expect(created.every((e) => !e.paused), 'nobody stays paused').toBe(true);
  });

  it('while one is still stalled, the others are not released', async () => {
    const { p, created } = setup(DUAL);
    await p.play();

    created[1]!._cb().onStallStart();
    expect(created[0]!.paused).toBe(true);

    // Another stall of the same stream before it recovers: still stalled.
    created[1]!._cb().onStallStart();
    created[1]!._cb().onStallEnd(120);
    await Promise.resolve();
    expect(created.every((e) => !e.paused)).toBe(true);
  });
});

describe('Player · start-up does not abort itself', () => {
  it('a stall during start-up pauses nothing', async () => {
    // Pausing on the initial `waiting` aborted the fresh play().
    // see docs/browser-quirks.md#play-abort
    const { p, created } = setup(DUAL);
    await p.attach();
    expect(p.state).toBe('attached');

    created[1]!._cb().onStallStart();
    expect(created.every((e) => e.paused), 'nobody should pause yet').toBe(true);

    await p.play();
    expect(p.state).toBe('active');
    expect(created.every((e) => !e.paused)).toBe(true);
  });

  it('a stall between "asked" and "playing" does not pause either', async () => {
    // HLS attaches before it has a segment, so `play` fires well before
    // `playing`. see docs/browser-quirks.md#play-abort
    const { p, created } = setup(DUAL);
    await p.attach();
    // Playback is asked for but not yet playing.
    created[0]!._cb().onPlay();
    expect(p.state).toBe('active');

    created[1]!._cb().onStallStart();
    expect(created.every((e) => e.paused), 'nobody should pause yet').toBe(true);
  });

  it('once playing, a stall holds back the OTHERS', async () => {
    // Letting the rest run would make drift spike (S1).
    const { p, created } = setup(DUAL);
    await p.play();
    created[1]!._cb().onStallStart();
    expect(created[0]!.paused, 'the other is held back').toBe(true);
  });

  it('the stalled one is not paused: it would abort its own play()', async () => {
    // see docs/browser-quirks.md#play-abort
    const { p, created } = setup(DUAL);
    await p.play();
    created[0]!._cb().onStallStart();
    expect(created[0]!.paused, 'the stalled one is still not paused').toBe(false);
    expect(created[1]!.paused, 'the other is').toBe(true);
  });

  it('does not resume a video the user had paused', async () => {
    const { p, created } = setup(DUAL);
    await p.play();
    p.pause();
    created[1]!._cb().onStallEnd(300);
    expect(created.every((e) => e.paused), 'must stay paused').toBe(true);
  });
});

describe('Player · state comes from the media, not intent', () => {
  it('if the element starts on its own, the state shows it', async () => {
    const { p, created } = setup(MONO);
    await p.attach();
    created[0]!._cb().onPlay();
    expect(p.state).toBe('active');
  });

  it('if the browser pauses it on its own, the state shows it', async () => {
    const { p, created } = setup(MONO);
    await p.play();
    expect(p.state).toBe('active');
    created[0]!._cb().onPause();
    expect(p.state).toBe('attached');
  });

  it('emits play and pause once', async () => {
    const { p } = setup(MONO);
    const onPlay = vi.fn(), onPause = vi.fn();
    p.on('play', onPlay); p.on('pause', onPause);
    await p.play();
    p.pause();
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});

describe('Player · destruction', () => {
  it('releases everything and stops emitting', async () => {
    const { p } = setup(DUAL);
    await p.attach();
    const fn = vi.fn();
    p.on('play', fn);
    p.destroy();
    expect(p.state).toBe('destroyed');
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('destroying twice does not fail', async () => {
    const { p } = setup(MONO);
    await p.attach();
    expect(() => { p.destroy(); p.destroy(); }).not.toThrow();
  });
});

describe('Player · live edge', () => {
  const LIVE = {
    id: 'v', live: true,
    streams: [{ id: 'cam', role: 'presenter', audio: true,
                sources: [{ src: 'v.m3u8', type: 'application/vnd.apple.mpegurl' }] }],
  };

  /** Gives the engine a seekable window of `[start, end]`. */
  const withWindow = (e: object, start: number, end: number) => {
    Object.defineProperty(e, 'seekable', {
      configurable: true,
      get: () => ({ length: 1, start: () => start, end: () => end }) as TimeRanges,
    });
  };

  it('the DVR window and edge come from seekable', async () => {
    const { p, created } = setup(LIVE);
    await p.attach();
    withWindow(created[0]!, 40, 160);
    expect(p.dvrWindow).toBe(120);
    expect(p.liveEdge).toBe(160);
  });

  it('without a known edge it is not at the edge', async () => {
    const { p } = setup(LIVE);
    await p.attach();
    // Both 0 used to fall within tolerance and showed LIVE before the event began.
    expect(p.liveEdge).toBe(0);
    expect(p.atLiveEdge).toBe(false);
  });

  it('falling far enough behind leaves the edge, and going back rejoins it', async () => {
    const { p, created } = setup(LIVE);
    await p.attach();
    const engine = created[0]! as Record<string, any>;
    withWindow(engine, 40, 160);

    engine._set(158);
    expect(p.atLiveEdge).toBe(true);

    engine._set(100);
    expect(p.behindLive).toBe(60);
    expect(p.atLiveEdge).toBe(false);

    // A margin, since the very last instant is rarely buffered yet.
    p.seekToLive();
    expect(p.currentTime).toBeLessThan(160);
    expect(p.atLiveEdge).toBe(true);
  });

  it('with long segments, goes where the engine recommends, not to the edge', async () => {
    // see docs/browser-quirks.md#live-segment-latency
    const { p, created } = setup(LIVE);
    await p.attach();
    const engine = created[0]! as Record<string, any>;
    withWindow(engine, 40, 160);
    engine['liveSyncPosition'] = () => 142;

    engine._set(100);
    p.seekToLive();
    expect(p.currentTime).toBe(142);
    // 18 s behind the edge, but where it is recommended to be: that is live.
    expect(p.atLiveEdge).toBe(true);

    // The edge moves a segment at a time, so a little behind is still live.
    engine._set(135);
    expect(p.atLiveEdge).toBe(true);

    engine._set(120);
    expect(p.atLiveEdge, 'much further back, no longer').toBe(false);
  });

  it('none of this applies on demand', async () => {
    const { p, created } = setup(MONO);
    await p.attach();
    withWindow(created[0]!, 0, 60);
    expect(p.atLiveEdge).toBe(false);
    expect(p.behindLive).toBe(0);
  });
});

describe('Player · no capable engine', () => {
  it('fails with engine/unsupported and returns to resolved', async () => {
    const useless: EngineFactory = {
      name: 'useless', canPlay: () => 'no',
      create: () => { throw new Error('unused'); },
    };
    const p = new Player({ container, manifest: MONO as never, engines: [useless] });
    await expect(p.attach()).rejects.toMatchObject({ code: 'engine/unsupported' });
    expect(p.state).toBe('resolved');
    expect(container.children).toHaveLength(0);
  });
});
