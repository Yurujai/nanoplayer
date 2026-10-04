// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  create, type BarControlDecl, type EngineFactory, type Manifest, type SettingsGroupDecl, type UiSlots,
} from '@nanoplayer/core';
import { interpreterPreference } from '../src/index.js';

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

const engines: EngineFactory[] = [{
  name: 'fake', canPlay: () => 'probably',
  create: () => ({ element: null, async attach() {}, destroy() {}, pause() {}, setVolume() {}, setMuted() {} }) as never,
}];

const withInterpreter: Manifest = {
  id: 'lecture',
  streams: [
    { id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] },
    { id: 'sign', role: 'interpreter', audio: false, sources: [{ src: 'sign.mp4', type: 'video/mp4' }] },
  ],
};

const settle = () => new Promise((r) => setTimeout(r, 0));
const players: Array<{ destroy(): void }> = [];

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('localStorage', memoryStorage());
  interpreterPreference.reload();
});
afterEach(() => { for (const p of players.splice(0)) p.destroy(); vi.unstubAllGlobals(); });

async function mount(manifest: Manifest = withInterpreter) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const player = create(host, { manifest, engines, registry: false, lang: 'en' });
  players.push(player);
  await player.resolve();
  await settle();
  let control: BarControlDecl | undefined;
  let group: SettingsGroupDecl | undefined;
  const ui: UiSlots = {
    addBarControl: (c) => { control = c; return () => {}; },
    addSettingsPanel: (p) => { group = p as SettingsGroupDecl; return () => {}; },
    addTimelineMarkers: () => () => {}, addTimelinePreview: () => () => {},
    addOverlay: () => ({ element: document.createElement('div'), remove: () => {} }),
    addPanel: () => ({ element: document.createElement('div'), isOpen: false, remove: () => {} }),
    refresh: vi.fn(),
  };
  player.setUi(ui);
  const panel = (id: string) => group!.panels.find((p) => p.id === id)!;
  return { player, host, control: () => control, group: () => group, panel };
}

describe('sign language plugin', () => {
  it('shows the interpreter by default, bottom right, medium', async () => {
    const { host } = await mount();
    expect(host.dataset['interpreter']).toBe('on');
    expect(host.dataset['interpreterCorner']).toBe('bottom-right');
    expect(host.style.getPropertyValue('--np-interpreter-width')).toBe('28%');
  });

  it('a toggle in the bar hides it, its state shown by form and by aria-pressed', async () => {
    const { host, control } = await mount();
    expect(control()!.label).toBe('Sign language interpreter');
    expect(control()!.pressed!()).toBe(true);
    const shown = (control()!.icon as () => string)();
    control()!.onActivate();
    expect(host.dataset['interpreter']).toBe('off');
    expect(control()!.pressed!()).toBe(false);
    expect((control()!.icon as () => string)()).not.toBe(shown);
    expect((control()!.icon as () => string)()).toContain('fill="none"');
  });

  it('moves to another corner and grows from the settings menu', async () => {
    const { host, group, panel } = await mount();
    expect(group()!.label).toBe('Sign language interpreter');
    expect(panel('position').options.map((o) => o.label)).toEqual(['Bottom right', 'Bottom left', 'Top right', 'Top left']);
    panel('position').onSelect('top-left');
    panel('size').onSelect('large');
    expect(host.dataset['interpreterCorner']).toBe('top-left');
    expect(host.style.getPropertyValue('--np-interpreter-width')).toBe('36%');
  });

  it('is remembered between visits and shared by every player on the page', async () => {
    const first = await mount();
    const second = await mount({ ...withInterpreter, id: 'other' });
    first.control()!.onActivate();
    expect(second.host.dataset['interpreter'], 'the other player follows').toBe('off');
    interpreterPreference.reload();
    const later = await mount();
    expect(later.host.dataset['interpreter']).toBe('off');
  });

  it('ignores stored values it does not know', () => {
    localStorage.setItem('nanoplayer:interpreter', JSON.stringify({ visible: 'yes', corner: 'middle', size: 'large' }));
    interpreterPreference.reload();
    expect(interpreterPreference.get()).toEqual({ visible: true, corner: 'bottom-right', size: 'large' });
  });

  it('does nothing without an interpreter stream, and cleans up after itself', async () => {
    const plain = await mount({ ...withInterpreter, streams: [withInterpreter.streams[0]!] });
    expect(plain.control()).toBeUndefined();
    expect(plain.host.dataset['interpreter']).toBeUndefined();
    const { player, host } = await mount();
    player.destroy();
    expect(host.dataset['interpreter']).toBeUndefined();
    expect(host.style.getPropertyValue('--np-interpreter-width')).toBe('');
  });
});
