// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  create, type EngineFactory, type Manifest, type Player, type SettingsGroupDecl,
  type SettingsPanelDecl, type UiSlots,
} from '@nanoplayer/core';
import '../src/index.js';
import { captionStyle, cssVariables, DEFAULT_STYLE } from '../src/style.js';

/** An engine that mounts a real `<video>` in its box and removes it on detach. */
const engines: EngineFactory[] = [{
  name: 'fake',
  canPlay: () => 'probably',
  create: () => {
    let video: HTMLVideoElement | null = null;
    return {
      get element() { return video; },
      async attach(box: HTMLElement) {
        video = document.createElement('video');
        box.appendChild(video);
      },
      destroy() { video?.remove(); video = null; },
      pause() {},
      setVolume() {},
      setMuted() {},
    } as never;
  },
}];

const lecture: Manifest = {
  id: 'lecture',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
  textTracks: [{ src: 'en.vtt', lang: 'en' }],
};

/** Node 25 defines its own `localStorage`, undefined without a file, hiding happy-dom's. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
  };
}

let page: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  page = document.body;
  vi.stubGlobal('localStorage', memoryStorage());
  captionStyle.reload();
});

async function mount(): Promise<Player> {
  const host = document.createElement('div');
  page.appendChild(host);
  const player = create(host, { manifest: lecture, engines, registry: false });
  await player.resolve();
  await new Promise((r) => setTimeout(r, 0));
  await player.attach();
  return player;
}

const tracksIn = (player: Player) => player.master?.element?.querySelectorAll('track').length ?? 0;

describe('captions plugin', () => {
  it('puts the tracks on its own player, with two players sharing a stream id', async () => {
    const first = await mount();
    const second = await mount();
    expect(tracksIn(first)).toBe(1);
    expect(tracksIn(second), 'the second player got none').toBe(1);
  });

  it('mounts the tracks again after the player is detached and re-attached', async () => {
    const player = await mount();
    player.detach();
    await player.attach();
    expect(tracksIn(player)).toBe(1);
  });
});

/** Slots that keep what the plugin declares, so a test can drive it like the menu would. */
function fakeUi() {
  const panels: SettingsPanelDecl[] = [];
  const layer = document.createElement('div');
  const slots: UiSlots = {
    addBarControl: () => () => {},
    addSettingsPanel: (p) => { panels.push(p); return () => {}; },
    addTimelineMarkers: () => () => {},
    addOverlay: () => ({ element: layer, remove: () => layer.remove() }),
    refresh: () => {},
  };
  const group = () => panels.find((p): p is SettingsGroupDecl => 'panels' in p)!;
  const choice = (id: string) => group().panels.find((p) => p.id === id)!;
  return { slots, layer, group, choice };
}

async function mountWithUi() {
  const player = await mount();
  const ui = fakeUi();
  player.setUi(ui.slots);
  return ui;
}

describe('caption style', () => {
  it('writes no variables by default, so a site theme still applies', () => {
    expect(Object.values(cssVariables({ ...DEFAULT_STYLE })).every((v) => v === null)).toBe(true);
  });

  it('keeps the default background colour when only the opacity changes', () => {
    const vars = cssVariables({ ...DEFAULT_STYLE, opacity: '50' });
    expect(vars['--np-cue-bg']).toBe('rgba(0,0,0,0.5)');
  });

  it('offers every setting in one group with a reset', async () => {
    const ui = await mountWithUi();
    expect(ui.group().panels.map((p) => p.id))
      .toEqual(['size', 'color', 'background', 'opacity', 'font', 'edge']);
    expect(ui.group().onReset).toBeTypeOf('function');
    expect(ui.choice('color').options.map((o) => o.label)).toContain('Amarillo');
  });

  it('applies a choice to the captions layer', async () => {
    const ui = await mountWithUi();
    ui.choice('size').onSelect('150');
    ui.choice('color').onSelect('yellow');
    expect(ui.layer.style.getPropertyValue('--np-cue-scale')).toBe('1.5');
    expect(ui.layer.style.getPropertyValue('--np-cue-color')).toBe('rgb(255,255,0)');
    expect(ui.choice('size').getValue()).toBe('150');
  });

  it('reset clears the variables again', async () => {
    const ui = await mountWithUi();
    ui.choice('edge').onSelect('outline');
    ui.group().onReset?.();
    expect(ui.layer.style.getPropertyValue('--np-cue-edge')).toBe('');
  });

  it('one choice reaches every player on the page', async () => {
    const first = await mountWithUi();
    const second = await mountWithUi();
    first.choice('font').onSelect('mono');
    expect(second.layer.style.getPropertyValue('--np-cue-font')).toContain('monospace');
  });

  it('is remembered between visits', async () => {
    (await mountWithUi()).choice('size').onSelect('200');
    captionStyle.reload();
    const ui = await mountWithUi();
    expect(ui.layer.style.getPropertyValue('--np-cue-scale')).toBe('2');
  });

  it('ignores stored values it does not know', () => {
    localStorage.setItem('nanoplayer:caption-style', JSON.stringify({ size: '9000', color: 'red' }));
    captionStyle.reload();
    expect(captionStyle.get()).toEqual({ ...DEFAULT_STYLE, color: 'red' });
  });

  it('still works when storage throws', async () => {
    const blocked = () => { throw new Error('blocked'); };
    vi.stubGlobal('localStorage', { ...memoryStorage(), getItem: blocked, setItem: blocked });
    const ui = await mountWithUi();
    ui.choice('color').onSelect('cyan');
    expect(ui.layer.style.getPropertyValue('--np-cue-color')).toBe('rgb(0,255,255)');
  });
});
