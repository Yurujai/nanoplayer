// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineFactory } from '../src/engine.js';
import { Player } from '../src/player.js';
import { PlayerRegistry, createBatchResolver } from '../src/registry.js';

/** Fake engine that attaches instantly. */
const fakeFactory = (): EngineFactory => ({
  name: 'fake',
  canPlay: () => 'probably',
  create() {
    let paused = true, t = 0;
    let cb: { onPlay?: () => void; onPause?: () => void } = {};
    return {
      name: 'fake',
      get element() { return { seeking: false } as HTMLVideoElement; },
      get attached() { return true; },
      async attach(c: HTMLElement, _s: unknown, o?: { callbacks?: typeof cb }) {
        cb = o?.callbacks ?? {};
        c.appendChild(document.createElement('video'));
      },
      detach() {},
      // The Player derives its state from these, as with a real <video>.
      async play() { paused = false; cb.onPlay?.(); },
      pause() { paused = true; cb.onPause?.(); },
      seek(s: number) { t = s; },
      get currentTime() { return t; },
      get duration() { return 60; },
      get paused() { return paused; },
      get ended() { return false; },
      get buffered() { return null; },
      get seekable() { return null; },
      getPlaybackRate: () => 1,
      setPlaybackRate() {},
      setVolume() {},
      setMuted() {},
      destroy() {},
    } as never;
  },
});

const MANIFEST = {
  id: 'x', duration: 60,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
};

let clock = 0;
const newPlayer = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new Player({
    container, manifest: MANIFEST as never, engines: [fakeFactory()],
  });
};

beforeEach(() => {
  document.body.innerHTML = '';
  clock = 0;
});

describe('exclusive playback', () => {
  it('playing one pauses the others', async () => {
    const r = new PlayerRegistry({ now: () => clock++ });
    const a = newPlayer(), b = newPlayer();
    r.register(a); r.register(b);

    await a.play();
    expect(a.state).toBe('active');

    await b.play();
    expect(b.state).toBe('active');
    expect(a.state, 'the first must have paused').toBe('attached');
  });

  it('can be turned off', async () => {
    const r = new PlayerRegistry({ exclusive: false, now: () => clock++ });
    const a = newPlayer(), b = newPlayer();
    r.register(a); r.register(b);
    await a.play();
    await b.play();
    expect(a.state).toBe('active');
    expect(b.state).toBe('active');
  });

  it('stops applying once unregistered', async () => {
    const r = new PlayerRegistry({ now: () => clock++ });
    const a = newPlayer(), b = newPlayer();
    const unregister = r.register(a); r.register(b);
    await a.play();
    unregister();
    await b.play();
    expect(a.state).toBe('active');
  });
});

describe('resource budget', () => {
  it('releases the least recently used engine when over budget', async () => {
    // see docs/browser-quirks.md#decoder-limit
    const r = new PlayerRegistry({ maxAttached: 2, now: () => clock++ });
    const a = newPlayer(), b = newPlayer(), c = newPlayer();
    r.register(a); r.register(b); r.register(c);

    await a.attach();
    await b.attach();
    expect(r.attachedCount).toBe(2);

    await c.attach();
    expect(r.attachedCount, 'must return to budget').toBe(2);
    expect(a.state, 'the oldest loses its engine').toBe('resolved');
    expect(c.state).toBe('attached');
  });

  it('the evicted one keeps its position', async () => {
    const r = new PlayerRegistry({ maxAttached: 1, now: () => clock++ });
    const a = newPlayer(), b = newPlayer();
    r.register(a); r.register(b);

    await a.attach();
    a.seek(25);
    await b.attach();

    expect(a.state).toBe('resolved');
    expect(a.resumeAt).toBe(25);
  });

  it('never evicts the one that just attached', async () => {
    const r = new PlayerRegistry({ maxAttached: 1, now: () => clock++ });
    const a = newPlayer(), b = newPlayer();
    r.register(a); r.register(b);
    await a.attach();
    await b.attach();
    expect(b.state).toBe('attached');
  });

  it('prefers evicting paused players over playing ones', async () => {
    const r = new PlayerRegistry({ maxAttached: 2, exclusive: false, now: () => clock++ });
    const playing = newPlayer(), paused = newPlayer(), latest = newPlayer();
    r.register(playing); r.register(paused); r.register(latest);

    await playing.play();           // the oldest, but active
    await paused.attach();
    await latest.attach();

    expect(playing.state, 'still playing').toBe('active');
    expect(paused.state, 'the paused one gives up its engine').toBe('resolved');
  });

  it('with no budget configured it evicts nobody', async () => {
    const r = new PlayerRegistry({ now: () => clock++ });
    const ps = [newPlayer(), newPlayer(), newPlayer()];
    for (const p of ps) r.register(p);
    for (const p of ps) await p.attach();
    expect(r.attachedCount).toBe(3);
  });
});

describe('resolution on visibility', () => {
  it('resolves only what comes on screen', async () => {
    let callback: IntersectionObserverCallback | null = null;
    const observed: Element[] = [];
    const r = new PlayerRegistry({
      resolveWhenVisible: true,
      createObserver: (cb) => {
        callback = cb;
        return {
          observe: (el: Element) => observed.push(el),
          unobserve: () => {}, disconnect: () => {},
        } as unknown as IntersectionObserver;
      },
    });

    const a = newPlayer(), b = newPlayer();
    r.register(a); r.register(b);
    expect(observed).toHaveLength(2);
    expect(a.state).toBe('idle');

    callback!([{ target: a.container, isIntersecting: true } as never], null as never);
    await new Promise((res) => setTimeout(res, 0));

    expect(a.state, 'the visible one resolves').toBe('resolved');
    expect(b.state, 'the one still off screen does not').toBe('idle');
  });

  it('without IntersectionObserver the registry still works', async () => {
    const r = new PlayerRegistry({
      resolveWhenVisible: true,
      createObserver: () => { throw new Error('unsupported'); },
      now: () => clock++,
    });
    const a = newPlayer(), b = newPlayer();
    expect(() => { r.register(a); r.register(b); }).not.toThrow();
    await a.play(); await b.play();
    expect(a.state, 'exclusivity still applies').toBe('attached');
  });
});

describe('registry management', () => {
  it('a destroyed player unregisters itself', async () => {
    const r = new PlayerRegistry({ now: () => clock++ });
    const a = newPlayer();
    r.register(a);
    expect(r.size).toBe(1);
    a.destroy();
    expect(r.size).toBe(0);
  });

  it('registering twice does not duplicate', () => {
    const r = new PlayerRegistry();
    const a = newPlayer();
    r.register(a); r.register(a);
    expect(r.size).toBe(1);
  });

  it('pauseAll and detachAll act on all', async () => {
    const r = new PlayerRegistry({ exclusive: false, now: () => clock++ });
    const ps = [newPlayer(), newPlayer()];
    for (const p of ps) { r.register(p); await p.play(); }

    r.pauseAll();
    expect(ps.every((p) => p.state === 'attached')).toBe(true);

    r.detachAll();
    expect(ps.every((p) => p.state === 'resolved')).toBe(true);
  });
});

describe('createBatchResolver', () => {
  it('batches several requests into one call', async () => {
    const fetchMany = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { id }])));
    const resolver = createBatchResolver(fetchMany, { windowMs: 5 });

    const r = await Promise.all(['a', 'b', 'c'].map((id) => resolver(id)));

    expect(fetchMany).toHaveBeenCalledTimes(1);
    expect(fetchMany).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(r).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  it('deduplicates: two players of the same video share the response', async () => {
    const fetchMany = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { id }])));
    const resolver = createBatchResolver(fetchMany, { windowMs: 5 });

    const [x, y] = await Promise.all([resolver('a'), resolver('a')]);
    expect(fetchMany).toHaveBeenCalledWith(['a']);
    expect(x).toEqual(y);
  });

  it('flushes the batch at the cap without waiting for the window', async () => {
    const fetchMany = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { id }])));
    const resolver = createBatchResolver(fetchMany, { windowMs: 10_000, maxBatch: 2 });

    const p = Promise.all([resolver('a'), resolver('b')]);
    await expect(p).resolves.toHaveLength(2);
    expect(fetchMany).toHaveBeenCalledTimes(1);
  });

  it('a batch failure rejects everyone waiting', async () => {
    const resolver = createBatchResolver(async () => { throw new Error('500'); },
      { windowMs: 5 });
    await expect(Promise.all([resolver('a'), resolver('b')])).rejects.toThrow('500');
  });

  it('if the batch lacks a key, only that one fails', async () => {
    const resolver = createBatchResolver(
      async () => ({ a: { id: 'a' } }), { windowMs: 5 });
    const [ra, rb] = await Promise.allSettled([resolver('a'), resolver('b')]);
    expect(ra.status).toBe('fulfilled');
    expect(rb.status).toBe('rejected');
  });

  it('successive batches are independent', async () => {
    const fetchMany = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { id }])));
    const resolver = createBatchResolver(fetchMany, { windowMs: 5 });
    await resolver('a');
    await resolver('b');
    expect(fetchMany).toHaveBeenCalledTimes(2);
  });
});
