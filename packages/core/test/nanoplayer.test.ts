// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EngineFactory } from '../src/engine.js';
import { create, NanoPlayer, VERSION, registry } from '../src/nanoplayer.js';
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
    // A page with 32 create() calls makes zero requests.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (let i = 0; i < 32; i++) {
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
