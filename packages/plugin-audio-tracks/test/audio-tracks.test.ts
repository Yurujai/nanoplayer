// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  create, strings, type AudioTrackInfo, type EngineCallbacks, type EngineFactory, type Manifest,
  type SettingsChoiceDecl, type SettingsPanelDecl,
} from '@nanoplayer/core';
import { trackLabel } from '../src/index.js';

/** An engine whose media carries audio tracks, and can be told they changed. */
function engineWith(tracks: AudioTrackInfo[]) {
  const state = { tracks, active: tracks[0]?.id ?? null, callbacks: {} as EngineCallbacks };
  const factory: EngineFactory = {
    name: 'fake',
    canPlay: () => 'probably',
    create: () => ({
      element: null,
      async attach(_box: HTMLElement, _stream: unknown, options: { callbacks?: EngineCallbacks }) {
        state.callbacks = options.callbacks ?? {};
      },
      destroy() {},
      pause() {},
      setVolume() {},
      setMuted() {},
      getAudioTracks: () => state.tracks,
      getAudioTrack: () => state.active,
      setAudioTrack: vi.fn((id: string) => { state.active = id; state.callbacks.onAudioTracks?.(); }),
    }) as never,
  };
  const changed = () => state.callbacks.onAudioTracks?.();
  return { factory, state, changed };
}

const lecture: Manifest = {
  id: 'lecture',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.m3u8', type: 'application/vnd.apple.mpegurl' }] }],
};

const SPANISH = { id: '0', label: '', lang: 'es', describes: false };
const DESCRIBED = { id: '1', label: '', lang: 'es', describes: true };
const ENGLISH = { id: '2', label: 'English (original)', lang: 'en', describes: false };

beforeEach(() => { document.body.innerHTML = ''; });

async function mount(tracks: AudioTrackInfo[]) {
  const engine = engineWith(tracks);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const player = create(host, { manifest: lecture, engines: [engine.factory], registry: false });
  await player.resolve();
  await new Promise((r) => setTimeout(r, 0));
  let panel: SettingsChoiceDecl | undefined;
  const removed = vi.fn();
  player.setUi({
    addBarControl: () => () => {},
    addSettingsPanel: (p: SettingsPanelDecl) => {
      panel = p as SettingsChoiceDecl;
      return () => { removed(); panel = undefined; };
    },
    addTimelineMarkers: () => () => {},
    addOverlay: () => ({ element: document.createElement('div'), remove: () => {} }),
    refresh: () => {},
  });
  await player.attach();
  // The media reports its tracks once loaded.
  engine.changed();
  return { player, engine, panel: () => panel };
}

describe('audio tracks plugin', () => {
  it('offers the tracks once the media reports more than one', async () => {
    const { panel } = await mount([SPANISH, DESCRIBED, ENGLISH]);
    expect(panel()?.label).toBe('Audio');
    expect(panel()?.options.map((o) => o.label))
      .toEqual(['español', 'español (audiodescripción)', 'English (original)']);
    expect(panel()?.getValue()).toBe('0');
  });

  it('offers nothing with a single track', async () => {
    const { panel } = await mount([SPANISH]);
    expect(panel()).toBeUndefined();
  });

  it('switches the track playing', async () => {
    const { panel, engine, player } = await mount([SPANISH, DESCRIBED]);
    const events: Array<string | null> = [];
    player.on('audio:tracks', ({ active }) => events.push(active));
    panel()!.onSelect('1');
    expect(player.audioTrack).toBe('1');
    expect(events).toEqual(['1']);
    expect(engine.state.active).toBe('1');
  });

  it('keeps the choice when the media starts over on its default track', async () => {
    const { panel, engine } = await mount([SPANISH, DESCRIBED]);
    panel()!.onSelect('1');
    // A reattach after an eviction brings the media back on its default.
    engine.state.active = '0';
    engine.changed();
    expect(engine.state.active).toBe('1');
  });
});

describe('track label', () => {
  const t = strings.translator('en');

  it('trusts the media label as it is', () => {
    expect(trackLabel(ENGLISH, 2, t)).toBe('English (original)');
  });

  it('marks the described one even when both carry the same label', () => {
    const plain = { ...SPANISH, label: 'Español' };
    const described = { ...DESCRIBED, label: 'Español' };
    expect(trackLabel(plain, 0, t)).toBe('Español');
    expect(trackLabel(described, 1, t)).toBe('Español (audio description)');
  });

  it('does not repeat what the label already says', () => {
    expect(trackLabel({ ...DESCRIBED, label: 'Audio description' }, 1, t)).toBe('Audio description');
  });

  it('otherwise says the language, and when it is the described one', () => {
    expect(trackLabel(DESCRIBED, 1, t)).toBe('español (audio description)');
  });

  it('without a language either, numbers it', () => {
    expect(trackLabel({ id: '4', label: '', lang: '', describes: false }, 4, t)).toBe('Track 5');
  });
});
