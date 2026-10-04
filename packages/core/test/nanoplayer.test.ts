// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EngineFactory } from '../src/engine.js';
import { create, NanoPlayer, VERSION, registry } from '../src/nanoplayer.js';
import { Player } from '../src/player.js';
import { PlayerRegistry } from '../src/registry.js';

/** Fake engine: happy-dom's `canPlayType` returns '', so the native engine plays nothing. */
const fakeEngine: EngineFactory = {
  name: 'fake',
  canPlay: () => 'probably',
  create: () => {
    let paused = true;
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
      async play() { paused = false; cb.onPlay?.(); },
      pause() { paused = true; cb.onPause?.(); },
      seek() {},
      get currentTime() { return 0; }, get duration() { return 60; },
      get paused() { return paused; }, get ended() { return false; },
      get buffered() { return null; },
      get seekable() { return null; },
      getPlaybackRate: () => 1, setPlaybackRate() {}, setVolume() {}, setMuted() {},
      destroy() {},
    } as never;
  },
};

const MANIFEST = {
  id: 'x', duration: 60,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
};

beforeEach(() => {
  document.body.innerHTML = '<div id="p"></div><div id="q"></div>';
  for (const p of registry.players()) registry.unregister(p);
});

describe('NanoPlayer.create', () => {
  it('accepts a selector', () => {
    const p = create('#p', { manifest: MANIFEST as never, registry: false });
    expect(p.container.id).toBe('p');
  });

  it('accepts an element', () => {
    const el = document.getElementById('p')!;
    const p = create(el, { manifest: MANIFEST as never, registry: false });
    expect(p.container).toBe(el);
  });

  it('fails clearly if the selector finds nothing', () => {
    expect(() => create('#missing', { manifest: MANIFEST as never }))
      .toThrow(/No element found/);
  });

  it('downloads nothing on creation', () => {
    // A page full of create() calls makes zero requests.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (let i = 0; i < 50; i++) {
      const el = document.createElement('div');
      document.body.appendChild(el);
      create(el, { manifest: 'https://example/v.json', registry: false });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('joins the page\'s shared registry on its own', async () => {
    const a = create('#p', { manifest: MANIFEST as never, engines: [fakeEngine] });
    const b = create('#q', { manifest: MANIFEST as never, engines: [fakeEngine] });
    expect(registry.size).toBe(2);
    await a.play();
    await b.play();
    expect(a.state, 'exclusivity works with no configuration').toBe('attached');
  });

  it('registry:false leaves the player isolated', () => {
    create('#p', { manifest: MANIFEST as never, registry: false });
    expect(registry.size).toBe(0);
  });

  it('accepts an own registry', () => {
    const own = new PlayerRegistry();
    create('#p', { manifest: MANIFEST as never, registry: own });
    expect(own.size).toBe(1);
    expect(registry.size).toBe(0);
  });
});

describe('public surface', () => {
  it('exposes what the <script> case needs', () => {
    for (const k of ['create', 'registry', 'plugins', 'Player', 'VERSION']) {
      expect(NanoPlayer, k).toHaveProperty(k);
    }
  });

  it('the version matches package.json', () => {
    // Path from the repo root: under happy-dom `import.meta.url` is an http URL.
    const pkg = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });
});

describe('NanoPlayer.create · autoplay and loop', () => {
  const blocked = Object.assign(new Error('blocked'), { code: 'media/blocked', retryable: false });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  afterEach(() => vi.restoreAllMocks());

  it('true tries with sound, and a refusal leaves it there', async () => {
    const play = vi.spyOn(Player.prototype, 'play').mockRejectedValue(blocked);
    const p = create('#p', { manifest: MANIFEST as never, registry: false, autoplay: true });
    await settle();
    expect(play).toHaveBeenCalledTimes(1);
    expect(p.muted).toBe(false);
  });

  it("'muted' starts muted, which browsers allow", async () => {
    const play = vi.spyOn(Player.prototype, 'play').mockResolvedValue();
    const p = create('#p', { manifest: MANIFEST as never, registry: false, autoplay: 'muted' });
    await settle();
    expect(p.muted).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("'any' retries muted only when the browser blocks sound", async () => {
    const play = vi.spyOn(Player.prototype, 'play')
      .mockRejectedValueOnce(blocked).mockResolvedValueOnce();
    const p = create('#p', { manifest: MANIFEST as never, registry: false, autoplay: 'any' });
    await settle();
    expect(play).toHaveBeenCalledTimes(2);
    expect(p.muted).toBe(true);
  });

  it("'any' does not retry a real failure", async () => {
    const play = vi.spyOn(Player.prototype, 'play')
      .mockRejectedValue(Object.assign(new Error('x'), { code: 'media/network', retryable: true }));
    const p = create('#p', { manifest: MANIFEST as never, registry: false, autoplay: 'any' });
    await settle();
    expect(play).toHaveBeenCalledTimes(1);
    expect(p.muted).toBe(false);
  });

  it('loop starts over at the end', async () => {
    const p = create('#p', { manifest: MANIFEST as never, registry: false, loop: true });
    const seek = vi.spyOn(p, 'seek').mockImplementation(() => {});
    const play = vi.spyOn(p, 'play').mockResolvedValue();
    p.bus.emit('ended', { at: 60 });
    expect(seek).toHaveBeenCalledWith(0);
    expect(play).toHaveBeenCalled();
  });

  it('without loop the end is the end', () => {
    const p = create('#p', { manifest: MANIFEST as never, registry: false });
    const play = vi.spyOn(p, 'play').mockResolvedValue();
    p.bus.emit('ended', { at: 60 });
    expect(play).not.toHaveBeenCalled();
  });
});

describe('NanoPlayer.create · leaving the container clean', () => {
  it('destroying takes the chain\'s phase off the container, for whoever uses it next', async () => {
    const withIntro = { ...MANIFEST, intro: { sources: [{ src: 'intro.mp4', type: 'video/mp4' }] } };
    const p = create('#p', { manifest: withIntro as never, registry: false });
    await p.resolve();
    expect(p.container.dataset['phase']).toBe('intro');
    p.destroy();
    expect(p.container.dataset['phase']).toBeUndefined();
  });
});

describe('NanoPlayer.create · attaching streams', () => {
  it('prepares the streams together, so the waits do not add up, in their order', async () => {
    const started: string[] = [];
    const arrive: Array<() => void> = [];
    const engines: EngineFactory[] = [{
      name: 'slow', canPlay: () => 'probably',
      create: () => ({
        element: null, paused: true, currentTime: 0, duration: 60,
        attach: (_box: HTMLElement, stream: { id: string }) => {
          started.push(stream.id);
          return new Promise<void>((r) => arrive.push(r));
        },
        destroy() {}, pause() {}, seek() {}, setVolume() {}, setMuted() {}, async play() {},
        getPlaybackRate: () => 1, setPlaybackRate() {},
      }) as never,
    }];
    const dual = { ...MANIFEST, streams: [MANIFEST.streams[0], {
      id: 'slides', role: 'presentation', audio: false, sources: [{ src: 's.mp4', type: 'video/mp4' }],
    }] };
    const p = create('#p', { manifest: dual as never, engines, registry: false });
    const attaching = p.attach();
    await new Promise((r) => setTimeout(r, 0));
    expect(started, 'the slides do not wait for the speaker').toEqual(['cam', 'slides']);
    expect([...p.container.querySelectorAll('[data-stream]')].map((b) => (b as HTMLElement).dataset['stream']))
      .toEqual(['cam', 'slides']);
    arrive.forEach((r) => r());
    await attaching;
    expect(p.state).toBe('attached');
  });
});
