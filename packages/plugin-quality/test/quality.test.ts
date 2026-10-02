// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_QUALITY, create, type EngineCallbacks, type EngineFactory, type Manifest, type QualityInfo,
  type SettingsChoiceDecl, type SettingsPanelDecl,
} from '@nanoplayer/core';
import { qualityLabels } from '../src/index.js';

const q = (id: string, height: number | null, bitrate: number | null = null, label = ''): QualityInfo =>
  ({ id, height, bitrate, label });

/** Engines that offer a ladder per stream, adaptive or not. */
function enginesWith(ladders: Record<string, { qualities: QualityInfo[]; auto: boolean }>) {
  const state: Record<string, { selected: string; playing: string; callbacks: EngineCallbacks }> = {};
  const factory: EngineFactory = {
    name: 'fake',
    canPlay: () => 'probably',
    create: () => {
      let id = '';
      return {
        element: null,
        async attach(_box: HTMLElement, stream: { id: string }, options: { callbacks?: EngineCallbacks }) {
          id = stream.id;
          const ladder = ladders[id]!;
          state[id] = {
            selected: ladder.auto ? AUTO_QUALITY : ladder.qualities[0]!.id,
            playing: ladder.qualities[0]!.id,
            callbacks: options.callbacks ?? {},
          };
        },
        destroy() {}, pause() {}, setVolume() {}, setMuted() {}, seek() {},
        currentTime: 0, duration: 0, paused: true, async play() {},
        getPlaybackRate: () => 1, setPlaybackRate() {},
        get autoQuality() { return ladders[id]?.auto; },
        getQualities: () => ladders[id]!.qualities,
        getQuality: () => state[id]!.selected,
        getPlayingQuality: () => state[id]!.playing,
        setQuality: vi.fn((quality: string) => {
          state[id]!.selected = quality;
          if (quality !== AUTO_QUALITY) state[id]!.playing = quality;
          state[id]!.callbacks.onQualities?.();
        }),
      } as never;
    },
  };
  return { factory, state };
}

const single: Manifest = {
  id: 'lecture',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.m3u8', type: 'application/vnd.apple.mpegurl' }] }],
};
const dual: Manifest = {
  id: 'lecture',
  streams: [
    single.streams[0]!,
    { id: 'slides', role: 'presentation', audio: false, sources: [{ src: 'slides.m3u8', type: 'application/vnd.apple.mpegurl' }] },
  ],
};

const HLS_LADDER = [q('0', 360, 800_000), q('1', 720, 2_500_000), q('2', 1080, 5_000_000)];

beforeEach(() => { document.body.innerHTML = ''; });

async function mount(manifest: Manifest, ladders: Parameters<typeof enginesWith>[0]) {
  const engines = enginesWith(ladders);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const player = create(host, { manifest, engines: [engines.factory], registry: false });
  await player.resolve();
  await new Promise((r) => setTimeout(r, 0));
  let panel: SettingsChoiceDecl | undefined;
  player.setUi({
    addBarControl: () => () => {},
    addSettingsPanel: (p: SettingsPanelDecl) => { panel = p as SettingsChoiceDecl; return () => { panel = undefined; }; },
    addTimelineMarkers: () => () => {},
    addOverlay: () => ({ element: document.createElement('div'), remove: () => {} }),
    refresh: () => {},
  });
  await player.attach();
  return { player, engines, panel: () => panel };
}

describe('quality plugin', () => {
  it('offers Auto first, saying what it picked, then the heights tallest first', async () => {
    const { panel } = await mount(single, { cam: { qualities: HLS_LADDER, auto: true } });
    expect(panel()?.label).toBe('Calidad');
    expect(panel()?.options.map((o) => o.label))
      .toEqual(['Automática (360p)', '1080p', '720p', '360p']);
    expect(panel()?.getValue()).toBe(AUTO_QUALITY);
  });

  it('a chosen quality sticks, and "Auto" follows the engine without a new panel', async () => {
    const { panel, engines } = await mount(single, { cam: { qualities: HLS_LADDER, auto: true } });
    const first = panel();
    panel()!.onSelect('2');
    expect(engines.state['cam']!.selected).toBe('2');
    expect(panel()!.getValue()).toBe('2');
    panel()!.onSelect(AUTO_QUALITY);
    engines.state['cam']!.playing = '1';
    expect(panel()!.options[0]!.label).toBe('Automática (720p)');
    expect(panel(), 'the same panel: rebuilding it would throw out a viewer inside').toBe(first);
  });

  it('files, unlike adaptive streaming, have no Auto', async () => {
    const { panel } = await mount(single, { cam: { qualities: [q('0', 720), q('1', 1080)], auto: false } });
    expect(panel()?.options.map((o) => o.label)).toEqual(['1080p', '720p']);
  });

  it('offers nothing with a single quality', async () => {
    const { panel } = await mount(single, { cam: { qualities: [q('0', 720)], auto: true } });
    expect(panel()).toBeUndefined();
  });

  it('the slides follow the presenter, with their tallest quality not above it', async () => {
    const { panel, engines } = await mount(dual, {
      cam: { qualities: HLS_LADDER, auto: true },
      slides: { qualities: [q('0', 480), q('1', 1080)], auto: true },
    });
    panel()!.onSelect('1');
    expect(engines.state['slides']!.selected, '720p presenter: 480p slides').toBe('0');
    panel()!.onSelect('2');
    expect(engines.state['slides']!.selected).toBe('1');
    panel()!.onSelect(AUTO_QUALITY);
    expect(engines.state['slides']!.selected).toBe(AUTO_QUALITY);
  });
});

describe('quality labels', () => {
  it('adds the bitrate only where two share a height', () => {
    const labels = qualityLabels([q('0', 720, 1_500_000), q('1', 720, 3_000_000), q('2', 1080, 5_000_000)]);
    expect([...labels.values()]).toEqual(['720p · 1.5 Mbps', '720p · 3.0 Mbps', '1080p']);
  });

  it('without a height, the media name, else the bitrate', () => {
    const labels = qualityLabels([q('0', null, null, 'Low'), q('1', null, 640_000)]);
    expect([...labels.values()]).toEqual(['Low', '0.64 Mbps']);
  });
});
