// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type EngineFactory, type Manifest, type SettingsActionDecl, type UiSlots,
} from '@nanoplayer/core';
import { linkTo, parseTime, readLink } from '../src/index.js';

describe('parseTime', () => {
  it('reads every way people write a time', () => {
    expect(parseTime('750')).toBe(750);
    expect(parseTime('750s')).toBe(750);
    expect(parseTime('12:30')).toBe(750);
    expect(parseTime('1:02:30')).toBe(3750);
    expect(parseTime('1h2m30s')).toBe(3750);
    expect(parseTime('2m')).toBe(120);
    expect(parseTime('soon')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
});

describe('links', () => {
  it('read t and v from the hash, then the query', () => {
    expect(readLink({ hash: '#t=12:30&v=lecture-3', search: '' })).toEqual({ time: 750, video: 'lecture-3' });
    expect(readLink({ hash: '', search: '?t=90' })).toEqual({ time: 90, video: null });
  });

  it('are made in the hash, or in the query when the hash is the page\'s own route', () => {
    expect(linkTo('https://campus.example/l3', 750, 'lecture-3')).toBe('https://campus.example/l3#t=12:30&v=lecture-3');
    expect(linkTo('https://campus.example/l3#t=1:00&v=lecture-3', 90, 'lecture-3'))
      .toBe('https://campus.example/l3#t=1:30&v=lecture-3');
    expect(linkTo('https://campus.example/app#/course/3', 90, 'lecture-3'))
      .toBe('https://campus.example/app?t=1%3A30&v=lecture-3#/course/3');
  });
});

const engines: EngineFactory[] = [{
  name: 'fake', canPlay: () => 'probably',
  create: () => ({ element: null, async attach() {}, destroy() {}, pause() {}, setVolume() {}, setMuted() {} }) as never,
}];
const lecture = (id: string): Manifest => ({
  id, streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
});
const settle = () => new Promise((r) => setTimeout(r, 0));

const players: Array<{ destroy(): void }> = [];

async function mount(id: string, hash = '') {
  // Each test is a fresh page: the first player takes a bare time.
  vi.resetModules();
  await import('../src/index.js');
  history.replaceState(null, '', `/lecture${hash}`);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const { create: fresh } = await import('@nanoplayer/core');
  const player = fresh(host, { manifest: lecture(id), engines, registry: false, lang: 'en' });
  players.push(player);
  await player.resolve();
  await settle(); await settle();
  let action: SettingsActionDecl | undefined;
  const overlays: HTMLElement[] = [];
  const ui: UiSlots = {
    addBarControl: () => () => {},
    addSettingsPanel: (p) => { action = p as SettingsActionDecl; return () => {}; },
    addTimelineMarkers: () => () => {}, addTimelinePreview: () => () => {},
    addOverlay: () => { const el = document.createElement('div'); overlays.push(el); return { element: el, remove: () => el.remove() }; },
    addPanel: () => ({ element: document.createElement('div'), isOpen: false, remove: () => {} }),
    refresh: () => {},
  };
  player.setUi(ui);
  return { player, action: () => action, overlays };
}

beforeEach(() => { document.body.innerHTML = ''; });
// A player left alive keeps its plugins listening to the page's hash.
afterEach(() => { for (const p of players.splice(0)) p.destroy(); });

describe('time links plugin', () => {
  it('opens the lecture at the time the link names', async () => {
    const { player } = await mount('lecture-3', '#t=12:30');
    expect(player.resumeAt).toBe(750);
  });

  it('with v, only the player of that manifest takes it', async () => {
    const other = await mount('lecture-1', '#t=12:30&v=lecture-3');
    expect(other.player.resumeAt).toBe(0);
    const named = await mount('lecture-3', '#t=12:30&v=lecture-3');
    expect(named.player.resumeAt).toBe(750);
  });

  it('a link to a time on the same page jumps there and plays', async () => {
    const { player } = await mount('lecture-3');
    const seek = vi.spyOn(player, 'seek').mockImplementation(() => {});
    const play = vi.spyOn(player, 'play').mockResolvedValue();
    history.replaceState(null, '', '/lecture#t=2:00');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(seek).toHaveBeenCalledWith(120);
    expect(play).toHaveBeenCalled();
  });

  it('copies a link to the current moment, and says so', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { player, action, overlays } = await mount('lecture-3');
    vi.spyOn(player, 'currentTime', 'get').mockReturnValue(754.6);
    expect(action()?.label).toBe('Copy link to this moment');
    action()!.onActivate();
    await settle();
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/#t=12:34&v=lecture-3$/));
    expect(overlays[0]!.querySelector('[role="status"]')!.textContent).toBe('Link copied: 12:34');
    vi.unstubAllGlobals();
  });

  it('when copying is refused, shows the link so it can be taken by hand', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => { throw new Error('denied'); } } });
    document.execCommand = () => false;
    const { action, overlays } = await mount('lecture-3');
    action()!.onActivate();
    await settle();
    expect(overlays[0]!.textContent).toMatch(/Could not copy it\. The link is http.*#t=0:00&v=lecture-3/);
    vi.unstubAllGlobals();
  });

  it('does not switch on for live', async () => {
    vi.resetModules();
    await import('../src/index.js');
    history.replaceState(null, '', '/lecture#t=12:30');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { create: fresh } = await import('@nanoplayer/core');
    const player = fresh(host, { manifest: { ...lecture('live'), live: true }, engines, registry: false });
    await player.resolve();
    await settle();
    expect(player.resumeAt).toBe(0);
  });
});
