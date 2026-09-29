// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineFactory, MediaEngine } from '../src/engine.js';
import { Player } from '../src/player.js';

/** Fake engine, with manual control of media time. */
function fakeFactory() {
  const created: Array<MediaEngine & Record<string, any>> = [];
  const factory: EngineFactory = {
    name: 'fake',
    canPlay: () => 'probably',
    create() {
      let currentTime = 0, rate = 1, paused = true;
      let cb: any = {};
      const e = {
        name: 'fake',
        get element() { return { seeking: false } as HTMLVideoElement; },
        get attached() { return true; },
        async attach(container: HTMLElement, _s: unknown, o: any) {
          cb = o?.callbacks ?? {};
          if (o?.startAt) currentTime = o.startAt;
          container.appendChild(document.createElement('video'));
        },
        detach() {},
        async play() { paused = false; cb.onPlay?.(); cb.onPlaying?.(); },
        pause() { paused = true; cb.onPause?.(); },
        seek(s: number) { currentTime = s; cb.onSeeked?.(s); },
        get currentTime() { return currentTime; },
        get duration() { return 600; },
        get paused() { return paused; },
        get ended() { return false; },
        get buffered() { return null; },
        get seekable() { return null; },
        getPlaybackRate: () => rate,
        setPlaybackRate(r: number) { rate = r; },
        setVolume() {}, setMuted() {},
        destroy() {},
        /** Moves the media and fires `time`, as a real <video> would. */
        _advance(t: number) { currentTime = t; cb.onTime?.(t, 600); },
        _startedAt: () => currentTime,
      };
      created.push(e as never);
      return e as never;
    },
  };
  return { factory, created };
}

/** A 600 s media of which only seconds 100 to 160 matter. */
const TRIMMED = {
  id: 'r', duration: 600,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
  annotations: [{ kind: 'trim', start: 100, end: 160 }],
};

const UNTRIMMED = {
  id: 's', duration: 600,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
};

let container: HTMLElement;

const setup = (manifest: unknown) => {
  const { factory, created } = fakeFactory();
  const p = new Player({ container, manifest: manifest as never, engines: [factory] });
  return { p, created };
};

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('trim · the visible timeline', () => {
  it('the duration is the trim\'s, not the media\'s', async () => {
    const { p } = setup(TRIMMED);
    await p.attach();
    expect(p.duration).toBe(60);
  });

  it('without a trim nothing changes', async () => {
    const { p } = setup(UNTRIMMED);
    await p.attach();
    expect(p.duration).toBe(600);
    expect(p.trim).toBeNull();
  });

  it('playback starts at the start of the trim', async () => {
    // The engine starts at second 100 of the file, which is 0 outside.
    const { p, created } = setup(TRIMMED);
    await p.attach();
    expect(created[0]!._startedAt()).toBe(100);
    expect(p.currentTime).toBe(0);
  });

  it('time is counted from the trim', async () => {
    const { p, created } = setup(TRIMMED);
    await p.attach();
    created[0]!._advance(130);
    expect(p.currentTime).toBe(30);
  });

  it('seeking maps to media time', async () => {
    const { p, created } = setup(TRIMMED);
    await p.attach();
    p.seek(20);
    expect(created[0]!.currentTime).toBe(120);
    expect(p.currentTime).toBe(20);
  });

  it('cannot seek outside the trim', async () => {
    const { p, created } = setup(TRIMMED);
    await p.attach();
    p.seek(-30);
    expect(created[0]!.currentTime).toBe(100);
    p.seek(9999);
    expect(created[0]!.currentTime).toBe(160);
  });

  it('exposes the trim for whoever draws on the timeline', async () => {
    const { p } = setup(TRIMMED);
    await p.attach();
    expect(p.trim).toEqual({ start: 100, end: 160 });
  });

  it('converts times for those that get them from the manifest', async () => {
    const { p } = setup(TRIMMED);
    await p.attach();
    expect(p.toVisibleTime(130)).toBe(30);
    expect(p.toVisibleTime(50), 'before the trim, at the start').toBe(0);
    expect(p.toMediaTime(30)).toBe(130);
    expect(p.toMediaTime(999), 'clamped to the trim\'s end').toBe(160);
  });
});

describe('trim · the player enforces the end', () => {
  it('stops and announces at the trim\'s end', async () => {
    // The file has 440 s more and the engine does not know they are spare.
    const { p, created } = setup(TRIMMED);
    await p.attach();
    const ended = vi.fn();
    p.on('ended', ended);
    await p.play();

    created[0]!._advance(159);
    expect(ended).not.toHaveBeenCalled();
    expect(p.paused).toBe(false);

    created[0]!._advance(160);
    expect(ended).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledWith({ at: 60 });
    expect(p.paused).toBe(true);
  });

  it('does not repeat the announcement on every tick', async () => {
    const { p, created } = setup(TRIMMED);
    await p.attach();
    const ended = vi.fn();
    p.on('ended', ended);
    await p.play();
    created[0]!._advance(160);
    created[0]!._advance(161);
    created[0]!._advance(200);
    expect(ended).toHaveBeenCalledOnce();
  });

  it('the last `time` matches the duration', async () => {
    // Ending at 59.8 would leave the bar short of the end.
    const { p, created } = setup(TRIMMED);
    await p.attach();
    const times: number[] = [];
    p.on('time', ({ current }) => times.push(current));
    await p.play();
    created[0]!._advance(160);
    expect(times.at(-1)).toBe(60);
  });

  it('seeking back rearms the end', async () => {
    const { p, created } = setup(TRIMMED);
    await p.attach();
    const ended = vi.fn();
    p.on('ended', ended);
    await p.play();
    created[0]!._advance(160);
    p.seek(10);
    created[0]!._advance(160);
    expect(ended).toHaveBeenCalledTimes(2);
  });

  it('play after the end restarts', async () => {
    const { p, created } = setup(TRIMMED);
    await p.attach();
    await p.play();
    created[0]!._advance(160);
    await p.play();
    expect(created[0]!.currentTime).toBe(100);
    expect(p.currentTime).toBe(0);
  });
});

describe('trim · eviction', () => {
  it('detaching and reattaching keeps the visible position', async () => {
    // `resumeAt` is visible time; mixing it with media time would resume at
    // second 30 of the file, outside the trim.
    const { p, created } = setup(TRIMMED);
    await p.attach();
    created[0]!._advance(130);
    expect(p.currentTime).toBe(30);

    p.detach();
    expect(p.resumeAt).toBe(30);

    await p.attach();
    expect(created[1]!._startedAt()).toBe(130);
    expect(p.currentTime).toBe(30);
  });
});

describe('trim · before resolving', () => {
  it('the duration is known without touching the network', () => {
    const { p } = setup(TRIMMED);
    expect(p.state).toBe('idle');
    expect(p.duration).toBe(60);
    expect(p.trim).toEqual({ start: 100, end: 160 });
  });

  it('a manifest by URL makes nothing up', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { p } = setup('https://example/m.json');
    expect(p.trim).toBeNull();
    expect(p.duration).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
