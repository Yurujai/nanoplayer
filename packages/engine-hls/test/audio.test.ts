// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Stream } from '@nanoplayer/core';

/** Fake hls.js with two audio renditions, one describing the video. */
const instances: FakeHls[] = [];
interface FakeHls {
  audioTrack: number;
  currentLevel: number;
  emit(event: string): void;
}
vi.mock('hls.js', () => {
  class Hls {
    static Events = {
      MANIFEST_PARSED: 'manifestParsed', ERROR: 'error',
      AUDIO_TRACKS_UPDATED: 'audioTracksUpdated', AUDIO_TRACK_SWITCHED: 'audioTrackSwitched',
      LEVELS_UPDATED: 'levelsUpdated', LEVEL_SWITCHED: 'levelSwitched',
    };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    static isSupported = () => true;
    audioTracks = [
      { name: 'Español', lang: 'es' },
      { name: 'Español AD', lang: 'es', characteristics: 'public.accessibility.describes-video' },
    ];
    levels = [
      { height: 360, bitrate: 800000, name: '' },
      { height: 720, bitrate: 2500000, name: '' },
    ];
    currentLevel = -1;
    get autoLevelEnabled() { return this.currentLevel === -1; }
    #track = 0;
    #listeners = new Map<string, Array<() => void>>();
    constructor() { instances.push(this as unknown as FakeHls); }
    get audioTrack() { return this.#track; }
    set audioTrack(i: number) { this.#track = i; this.emit('audioTrackSwitched'); }
    emit(ev: string) { this.#listeners.get(ev)?.forEach((f) => f()); }
    on(ev: string, fn: () => void) { this.#listeners.set(ev, [...(this.#listeners.get(ev) ?? []), fn]); }
    off(ev: string, fn: () => void) { this.#listeners.set(ev, (this.#listeners.get(ev) ?? []).filter((f) => f !== fn)); }
    attachMedia() {}
    loadSource() { queueMicrotask(() => this.emit('manifestParsed')); }
    destroy() {}
    startLoad() {}
    recoverMediaError() {}
  }
  return { default: Hls };
});

const { HlsEngine } = await import('../src/index.js');

const stream: Stream = {
  id: 'cam', role: 'presenter', audio: true,
  sources: [{ src: 'lecture.m3u8', type: 'application/vnd.apple.mpegurl' }],
};

async function attached(onAudioTracks = vi.fn()) {
  const engine = new HlsEngine(async () => (await import('hls.js')).default);
  await engine.attach(document.createElement('div'), stream, { callbacks: { onAudioTracks } });
  return { engine, hls: instances[instances.length - 1]!, onAudioTracks };
}

describe('HlsEngine · audio tracks', () => {
  it('lists the playlist renditions, marking the described one by its characteristics', async () => {
    const { engine } = await attached();
    expect(engine.getAudioTracks()).toEqual([
      { id: '0', label: 'Español', lang: 'es', describes: false },
      { id: '1', label: 'Español AD', lang: 'es', describes: true },
    ]);
    expect(engine.getAudioTrack()).toBe('0');
  });

  it('switches through hls.js and reports it', async () => {
    const { engine, hls, onAudioTracks } = await attached();
    engine.setAudioTrack('1');
    expect(hls.audioTrack).toBe(1);
    expect(onAudioTracks).toHaveBeenCalled();
  });

  it('ignores an id it does not have', async () => {
    const { engine, hls } = await attached();
    engine.setAudioTrack('7');
    expect(hls.audioTrack).toBe(0);
  });

  it('stops reporting once detached', async () => {
    const { engine, hls, onAudioTracks } = await attached();
    engine.detach();
    hls.emit('audioTracksUpdated');
    expect(onAudioTracks).not.toHaveBeenCalled();
  });
});

describe('HlsEngine · quality levels', () => {
  it('lists the ladder and starts on Auto', async () => {
    const { engine } = await attached();
    expect(engine.getQualities()).toEqual([
      { id: '0', height: 360, bitrate: 800000, label: '' },
      { id: '1', height: 720, bitrate: 2500000, label: '' },
    ]);
    expect(engine.autoQuality).toBe(true);
    expect(engine.getQuality()).toBe('auto');
  });

  it('a chosen level switches now, and Auto hands it back', async () => {
    const { engine, hls } = await attached();
    engine.setQuality('1');
    expect(hls.currentLevel).toBe(1);
    expect(engine.getQuality()).toBe('1');
    engine.setQuality('auto');
    expect(hls.currentLevel).toBe(-1);
    expect(engine.getQuality()).toBe('auto');
  });
});
