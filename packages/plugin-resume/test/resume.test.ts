// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create, type EngineFactory, type Manifest, type Player, type UiSlots } from '@nanoplayer/core';
import {
  clockTime, localPositionStore, shouldResume, type PositionStore, type SavedPosition,
} from '../src/index.js';

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
  name: 'fake',
  canPlay: () => 'probably',
  create: () => ({
    element: null, async attach() {}, destroy() {}, pause() {}, setVolume() {}, setMuted() {},
    getPlaybackRate: () => 1,
  }) as never,
}];

const lecture: Manifest = {
  id: 'lecture-7',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
};

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('localStorage', memoryStorage());
});

const settle = () => new Promise((r) => setTimeout(r, 0));

async function mount(options: { manifest?: Manifest; store?: PositionStore } = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const player = create(host, {
    manifest: options.manifest ?? lecture, engines, registry: false,
    ...(options.store ? { plugins: { resume: { store: options.store } } } : {}),
  });
  const overlays: HTMLElement[] = [];
  const ui: UiSlots = {
    addBarControl: () => () => {},
    addSettingsPanel: () => () => {},
    addTimelineMarkers: () => () => {},
    addOverlay: () => {
      const el = document.createElement('div');
      overlays.push(el);
      return { element: el, remove: () => el.remove() };
    },
    refresh: () => {},
  };
  player.setUi(ui);
  await player.resolve();
  await settle();
  await settle();
  return { player, overlays };
}

/** Drives the clock as playback would. */
function playing(player: Player, duration = 600) {
  let now = 0;
  vi.spyOn(player, 'currentTime', 'get').mockImplementation(() => now);
  vi.spyOn(player, 'duration', 'get').mockReturnValue(duration);
  return (t: number) => { now = t; player.bus.emit('time', { current: t, duration }); };
}

describe('resume plugin', () => {
  it('saves the position as the lecture plays, and resumes it next time', async () => {
    const first = await mount();
    const at = playing(first.player);
    at(5); at(12); at(130);
    first.player.bus.emit('pause', { at: 130 });
    expect(localPositionStore.load('lecture-7')).toEqual({ time: 130, duration: 600 });

    const again = await mount();
    await again.player.attach();
    expect(again.player.resumeAt).toBe(130);
  });

  it('says where it continues from, once playback starts', async () => {
    localPositionStore.save('lecture-7', { time: 750, duration: 3600 });
    const { player, overlays } = await mount();
    await player.attach();
    expect(overlays).toHaveLength(0);
    player.bus.emit('play', { at: 750 });
    const notice = overlays[0]!.querySelector('[role="status"]')!;
    expect(notice.textContent).toBe('Continuando desde 12:30');
  });

  it('a finished lecture starts over next time', async () => {
    const { player } = await mount();
    const at = playing(player);
    at(300);
    player.bus.emit('pause', { at: 300 });
    player.bus.emit('ended', { at: 600 });
    expect(localPositionStore.load('lecture-7')).toBeNull();
  });

  it('a viewer who already pressed play keeps their start, however late the store answers', async () => {
    let answer!: (p: SavedPosition) => void;
    const store: PositionStore = {
      load: () => new Promise((r) => { answer = r; }),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const { player } = await mount({ store });
    const seek = vi.spyOn(player, 'seek');
    player.bus.emit('play', { at: 0 });
    answer({ time: 300, duration: 600 });
    await settle();
    expect(seek).not.toHaveBeenCalled();
  });

  it('an LMS store replaces local storage, and its failures never reach playback', async () => {
    const store: PositionStore = {
      load: async () => ({ time: 200, duration: 600 }),
      save: vi.fn(async () => { throw new Error('LMS down'); }),
      clear: vi.fn(),
    };
    const { player } = await mount({ store });
    await player.attach();
    expect(player.resumeAt).toBe(200);
    const at = playing(player);
    at(240);
    expect(store.save).toHaveBeenCalledWith('lecture-7', { time: 240, duration: 600 });
    expect(localPositionStore.load('lecture-7')).toBeNull();
  });

  it('a start already chosen, as a link to a time, wins over the remembered one', async () => {
    localPositionStore.save('lecture-7', { time: 300, duration: 600 });
    const { player } = await mount();
    player.seek(42);
    await player.attach();
    expect(player.resumeAt).toBe(42);
  });

  it('does not switch on for live', async () => {
    const { player } = await mount({ manifest: { ...lecture, live: true } });
    const at = playing(player);
    at(300);
    player.bus.emit('pause', { at: 300 });
    expect(localPositionStore.load('lecture-7')).toBeNull();
  });
});

describe('what is worth resuming', () => {
  it('not the first seconds, and not the very end', () => {
    expect(shouldResume({ time: 4, duration: 600 })).toBe(false);
    expect(shouldResume({ time: 590, duration: 600 })).toBe(false);
    expect(shouldResume({ time: 120, duration: 600 })).toBe(true);
    expect(shouldResume(null)).toBe(false);
  });

  it('on a short clip the end is a share of it, not a fixed twenty seconds', () => {
    expect(shouldResume({ time: 21, duration: 40 })).toBe(true);
    expect(shouldResume({ time: 39, duration: 40 })).toBe(false);
  });

  it('local storage keeps only the latest hundred lectures', () => {
    for (let i = 0; i < 105; i++) {
      vi.spyOn(Date, 'now').mockReturnValue(1000 + i);
      localPositionStore.save(`l${i}`, { time: 60, duration: 600 });
    }
    expect(localPositionStore.load('l0')).toBeNull();
    expect(localPositionStore.load('l104')).not.toBeNull();
  });

  it('formats like the control bar', () => {
    expect(clockTime(750)).toBe('12:30');
    expect(clockTime(3750)).toBe('1:02:30');
  });
});
