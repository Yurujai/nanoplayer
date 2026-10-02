// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type EngineFactory, type Manifest } from '@nanoplayer/core';
import { create } from '../src/index.js';

/** What a CDN tag of hls.js leaves on the page: the class on `window.Hls`. */
class PageHls {
  static Events = {
    MANIFEST_PARSED: 'manifestParsed', ERROR: 'error',
    AUDIO_TRACKS_UPDATED: 'audioTracksUpdated', AUDIO_TRACK_SWITCHED: 'audioTrackSwitched',
    LEVELS_UPDATED: 'levelsUpdated', LEVEL_SWITCHED: 'levelSwitched',
  };
  static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
  static isSupported = () => true;
  static loaded = vi.fn();
  #listeners = new Map<string, Array<() => void>>();
  audioTracks = [];
  audioTrack = -1;
  levels = [];
  currentLevel = -1;
  autoLevelEnabled = true;
  on(ev: string, fn: () => void) { this.#listeners.set(ev, [...(this.#listeners.get(ev) ?? []), fn]); }
  off() {}
  attachMedia() {}
  loadSource(src: string) {
    PageHls.loaded(src);
    queueMicrotask(() => this.#listeners.get('manifestParsed')?.forEach((f) => f()));
  }
  destroy() {}
  startLoad() {}
  recoverMediaError() {}
}

const HLS: Manifest = {
  id: 'lecture',
  streams: [{
    id: 'cam', role: 'presenter', audio: true,
    sources: [{ src: 'lecture.m3u8', type: 'application/vnd.apple.mpegurl' }],
  }],
};

const g = globalThis as { Hls?: unknown; MediaSource?: unknown };

beforeEach(() => {
  document.body.innerHTML = '<div id="player"></div>';
  g.MediaSource = function () {};
  PageHls.loaded.mockClear();
});
afterEach(() => {
  delete g.Hls;
  delete g.MediaSource;
});

describe('bundle · HLS through a window.Hls from a CDN', () => {
  it('plays HLS with the hls.js the page loaded', async () => {
    g.Hls = PageHls;
    const player = create('#player', { manifest: HLS });
    await player.attach();
    expect(player.master?.name).toBe('hls.js');
    expect(PageHls.loaded).toHaveBeenCalledWith('lecture.m3u8');
  });

  it('a tag that finishes after create still counts: the engine is chosen at play', async () => {
    const player = create('#player', { manifest: HLS });
    g.Hls = PageHls;
    await player.attach();
    expect(player.master?.name).toBe('hls.js');
  });

  it('engines passed by hand still win', async () => {
    g.Hls = PageHls;
    const mine: EngineFactory = {
      name: 'mine',
      canPlay: () => 'probably',
      create: () => ({ name: 'mine', element: null, async attach() {}, destroy() {}, setVolume() {}, setMuted() {} }) as never,
    };
    const player = create('#player', { manifest: HLS, engines: [mine] });
    await player.attach();
    expect(player.master?.name).toBe('mine');
    expect(PageHls.loaded).not.toHaveBeenCalled();
  });
});
