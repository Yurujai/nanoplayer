// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../src/manifest.js';
import { Player } from '../src/player.js';
import {
  PluginRegistry, topoSort, type PluginManifest,
} from '../src/plugins.js';

const MANIFEST = {
  id: 'x', duration: 60,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
  textTracks: [{ src: 'es.vtt', lang: 'es' }],
} as unknown as Manifest;

let player: Player;

/** Fake plugin that records when it is activated. */
const plug = (
  id: string,
  extra: Partial<PluginManifest> = {},
  trace: string[] = [],
): PluginManifest => ({
  id,
  load: () => ({
    activate: () => { trace.push(`activate:${id}`); },
    deactivate: () => { trace.push(`deactivate:${id}`); },
  }),
  ...extra,
});

beforeEach(() => {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  document.body.appendChild(container);
  player = new Player({ container, manifest: MANIFEST as never });
});

describe('topoSort', () => {
  it('puts dependencies before their users', () => {
    const order = topoSort([
      plug('b', { dependsOn: ['a'] }),
      plug('a'),
      plug('c', { dependsOn: ['b'] }),
    ]).map((m) => m.id);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('reports cycles with the full path', () => {
    // No implicit resolution by load order: it works until two imports swap.
    expect(() => topoSort([
      plug('a', { dependsOn: ['b'] }),
      plug('b', { dependsOn: ['a'] }),
    ])).toThrow(/dependency cycle/);
  });

  it('reports a missing dependency', () => {
    expect(() => topoSort([plug('a', { dependsOn: ['ghost'] })]))
      .toThrow(/depends on "ghost"/);
  });

  it('accepts shared dependencies without duplicates', () => {
    const order = topoSort([
      plug('b', { dependsOn: ['base'] }),
      plug('c', { dependsOn: ['base'] }),
      plug('base'),
    ]).map((m) => m.id);
    expect(order[0]).toBe('base');
    expect(order).toHaveLength(3);
  });
});

describe('registration and activation', () => {
  it('the plugin registers itself; the core does not import it', () => {
    const r = new PluginRegistry();
    r.register(plug('captions'));
    expect(r.has('captions')).toBe(true);
    expect(r.registered).toEqual(['captions']);
  });

  it('rejects two plugins with the same id', () => {
    const r = new PluginRegistry();
    r.register(plug('a'));
    expect(() => r.register(plug('a'))).toThrow(/id "a"/);
  });

  it('activating is configuration, never a build', async () => {
    const r = new PluginRegistry();
    r.register(plug('chromecast'));
    const res = await r.activate(player, { chromecast: true });
    expect(res.activated).toEqual(['chromecast']);
  });

  it('what is neither configured nor auto-activated stays out', async () => {
    const r = new PluginRegistry();
    r.register(plug('chromecast'));
    const res = await r.activate(player, {});
    expect(res.activated).toEqual([]);
    expect(res.skipped).toEqual(['chromecast']);
  });

  it('the plugin\'s config reaches its context', async () => {
    const r = new PluginRegistry();
    let received: unknown;
    r.register({
      id: 'h5p',
      load: () => ({ activate: (ctx) => { received = ctx.config; } }),
    });
    await r.activate(player, { h5p: { library: 'H5P.Blanks 1.14' } });
    expect(received).toEqual({ library: 'H5P.Blanks 1.14' });
  });

  it('activates itself if the manifest calls for it', async () => {
    const r = new PluginRegistry();
    r.register(plug('captions', {
      activateWhen: (m) => (m?.textTracks?.length ?? 0) > 0,
    }));
    const res = await r.activate(player, {}, MANIFEST);
    expect(res.activated).toEqual(['captions']);
  });

  it('does not activate itself if the manifest does not call for it', async () => {
    const r = new PluginRegistry();
    r.register(plug('h5p', {
      activateWhen: (m) => (m?.annotations ?? []).some((a) => a.kind === 'h5p'),
    }));
    const res = await r.activate(player, {}, MANIFEST);
    expect(res.activated).toEqual([]);
  });

  it('an explicit false beats the automatic condition', async () => {
    const r = new PluginRegistry();
    r.register(plug('captions', { activateWhen: () => true }));
    const res = await r.activate(player, { captions: false }, MANIFEST);
    expect(res.activated).toEqual([]);
  });

  it('pulls in dependencies even if not asked for', async () => {
    const trace: string[] = [];
    const r = new PluginRegistry();
    r.register(plug('base', {}, trace));
    r.register(plug('top', { dependsOn: ['base'] }, trace));

    const res = await r.activate(player, { top: true });
    expect(res.activated).toEqual(['base', 'top']);
    expect(trace).toEqual(['activate:base', 'activate:top']);
  });

  it('a plugin that blows up does not stop the others activating', async () => {
    const r = new PluginRegistry();
    r.register({ id: 'broken', load: () => ({ activate: () => { throw new Error('boom'); } }) });
    r.register(plug('healthy'));

    const res = await r.activate(player, { broken: true, healthy: true });
    expect(res.activated).toEqual(['healthy']);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]!.id).toBe('broken');
  });

  it('a failure loading the implementation is collected too', async () => {
    const r = new PluginRegistry();
    r.register({ id: 'slow', load: async () => { throw new Error('404'); } });
    const res = await r.activate(player, { slow: true });
    expect(res.failed[0]!.id).toBe('slow');
    expect(res.activated).toEqual([]);
  });

  it('does not load the implementation of what is not activated', async () => {
    // H5P is not downloaded unless the video has H5P annotations.
    const load = vi.fn(() => ({ activate: () => {} }));
    const r = new PluginRegistry();
    r.register({ id: 'heavy', load });
    await r.activate(player, {});
    expect(load).not.toHaveBeenCalled();

    await r.activate(player, { heavy: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('activating twice does not reactivate what is active', async () => {
    const trace: string[] = [];
    const r = new PluginRegistry();
    r.register(plug('a', {}, trace));
    await r.activate(player, { a: true });
    await r.activate(player, { a: true });
    expect(trace).toEqual(['activate:a']);
  });

  const another = () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    return new Player({ container: c, manifest: MANIFEST as never });
  };

  it('each player activates its own plugins', async () => {
    // Tracked per plugin id, the second player on a page got no captions
    // because they were "already active".
    const trace: string[] = [];
    const r = new PluginRegistry();
    r.register(plug('a', {}, trace));
    const second = another();
    await r.activate(player, { a: true });
    await r.activate(second, { a: true });
    expect(trace).toEqual(['activate:a', 'activate:a']);
    expect(r.activeFor(player)).toEqual(['a']);
    expect(r.activeFor(second)).toEqual(['a']);
  });

  it('destroying a player deactivates only its own', async () => {
    const trace: string[] = [];
    const r = new PluginRegistry();
    r.register(plug('a', {}, trace));
    const second = another();
    await r.activate(player, { a: true });
    await r.activate(second, { a: true });
    trace.length = 0;

    second.destroy();
    await Promise.resolve();
    expect(trace).toEqual(['deactivate:a']);
    expect(r.activeFor(second)).toEqual([]);
    expect(r.activeFor(player)).toEqual(['a']);
  });

  it('deactivates in reverse order, for the dependencies', async () => {
    const trace: string[] = [];
    const r = new PluginRegistry();
    r.register(plug('base', {}, trace));
    r.register(plug('top', { dependsOn: ['base'] }, trace));
    await r.activate(player, { top: true });
    trace.length = 0;

    await r.deactivateAll();
    expect(trace).toEqual(['deactivate:top', 'deactivate:base']);
    expect(r.active).toEqual([]);
  });

  it('a failure deactivating does not stop the rest', async () => {
    const trace: string[] = [];
    const r = new PluginRegistry();
    r.register({ id: 'bad', load: () => ({
      activate: () => {}, deactivate: () => { throw new Error('boom'); },
    }) });
    r.register(plug('good', {}, trace));
    await r.activate(player, { bad: true, good: true });
    trace.length = 0;

    await r.deactivateAll();
    expect(trace).toContain('deactivate:good');
    expect(r.active).toEqual([]);
  });
});
