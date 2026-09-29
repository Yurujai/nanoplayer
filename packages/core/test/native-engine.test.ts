// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confidenceFor, selectEngine, type EngineFactory } from '../src/engine.js';
import { NativeEngine, nativeEngineFactory } from '../src/native-engine.js';
import type { Stream } from '../src/manifest.js';

/**
 * A drivable `<video>`: happy-dom plays nothing, so the media parts are grafted
 * on to simulate loading, failures and stalls. Real playback is tested with
 * Playwright.
 */
function drivableVideo() {
  const el = document.createElement('video') as HTMLVideoElement;
  let readyState = 0;
  let networkState = 0;
  let paused = true;
  let error: MediaError | null = null;

  Object.defineProperties(el, {
    readyState: { get: () => readyState, configurable: true },
    networkState: { get: () => networkState, configurable: true },
    paused: { get: () => paused, configurable: true },
    error: { get: () => error, configurable: true },
    duration: { value: 120, configurable: true, writable: true },
  });

  el.load = vi.fn(() => { networkState = 1; });
  el.play = vi.fn(async () => {
    paused = false;
    el.dispatchEvent(new Event('play'));
  });
  el.pause = vi.fn(() => {
    paused = true;
    el.dispatchEvent(new Event('pause'));
  });

  return Object.assign(el, {
    /** Like iOS: downloads nothing until the first `play()`, and fires `suspend`. */
    simulateSuspend() {
      el.dispatchEvent(new Event('suspend'));
    },
    /** Metadata arrives, with no picture data yet. */
    simulateMetadata() {
      readyState = 1;
      el.dispatchEvent(new Event('loadedmetadata'));
    },
    /** The media has usable data. */
    simulateLoad() {
      readyState = 2;
      el.dispatchEvent(new Event('loadeddata'));
    },
    /** A media failure with the given `MediaError` code. */
    simulateError(code: number, message = '') {
      error = { code, message } as MediaError;
      el.dispatchEvent(new Event('error'));
    },
    /** `play()` rejected, by default as the browser's autoplay policy does. */
    rejectPlay(name = 'NotAllowedError') {
      el.play = vi.fn(async () => {
        const e = new Error('blocked');
        e.name = name;
        throw e;
      });
    },
  });
}

const stream = (over: Partial<Stream> = {}): Stream => ({
  id: 'cam', role: 'presenter', audio: true,
  sources: [{ src: 'cam.mp4', type: 'video/mp4' }],
  ...over,
});

let container: HTMLElement;
let video: ReturnType<typeof drivableVideo>;
let clock: number;

const engine = () => new NativeEngine({
  now: () => clock,
  createElement: () => video,
});

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  video = drivableVideo();
  clock = 0;
});

describe('NativeEngine · attach', () => {
  it('puts the element in the container with its sources', async () => {
    const e = engine();
    const p = e.attach(container, stream({
      sources: [
        { src: 'a.m3u8', type: 'application/vnd.apple.mpegurl' },
        { src: 'a.mp4', type: 'video/mp4' },
      ],
    }));
    video.simulateLoad();
    await p;

    expect(container.contains(video)).toBe(true);
    const sources = [...video.querySelectorAll('source')];
    expect(sources.map((s) => s.getAttribute('type')))
      .toEqual(['application/vnd.apple.mpegurl', 'video/mp4']);
  });

  it('sets playsinline, required on iPhone', async () => {
    const e = engine();
    const p = e.attach(container, stream());
    video.simulateLoad();
    await p;
    // Property and attribute. see docs/browser-quirks.md#ios-playsinline
    expect(video.playsInline).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
  });

  it('resolves on loadeddata, without waiting for canplay', async () => {
    const e = engine();
    let resolved = false;
    const p = e.attach(container, stream()).then(() => { resolved = true; });

    video.dispatchEvent(new Event('canplay'));
    await Promise.resolve();
    expect(resolved, 'canplay must not resolve on its own').toBe(false);

    video.simulateLoad();
    await p;
    expect(resolved).toBe(true);
  });

  it('also resolves if the browser preloads nothing (iOS)', async () => {
    // Attach used to wait forever and play did nothing.
    // see docs/browser-quirks.md#ios-no-preload
    const e = engine();
    const p = e.attach(container, stream());
    video.simulateSuspend();
    await p;
    expect(video.readyState).toBe(0);
  });

  it('without metadata, the restored position applies when it arrives', async () => {
    const e = engine();
    const p = e.attach(container, stream(), { startAt: 137.5 });
    video.simulateSuspend();
    await p;
    expect(video.currentTime).not.toBe(137.5);
    video.simulateMetadata();
    expect(video.currentTime).toBe(137.5);
  });

  it('resumes from the position restored after an eviction', async () => {
    const e = engine();
    const p = e.attach(container, stream(), { startAt: 137.5 });
    video.simulateLoad();
    await p;
    expect(video.currentTime).toBe(137.5);
  });

  it('rejects with the mapped error if the media fails to load', async () => {
    const e = engine();
    const onError = vi.fn();
    const p = e.attach(container, stream(), { callbacks: { onError } });
    video.simulateError(4, 'unsupported format');

    await expect(p).rejects.toMatchObject({ code: 'engine/unsupported' });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'engine/unsupported' }),
    );
  });

  it('does not allow attaching twice', async () => {
    const e = engine();
    const p = e.attach(container, stream());
    video.simulateLoad();
    await p;
    await expect(e.attach(container, stream())).rejects.toThrow(/already attached/);
  });
});

describe('NativeEngine · detach', () => {
  const attached = async () => {
    const e = engine();
    const p = e.attach(container, stream());
    video.simulateLoad();
    await p;
    return e;
  };

  it('releases the resource, not just the DOM node', async () => {
    // Removing from the DOM does not free the decoder.
    // see docs/browser-quirks.md#decoder-release
    const e = await attached();
    e.detach();

    expect(video.pause).toHaveBeenCalled();
    expect(video.hasAttribute('src')).toBe(false);
    expect(video.querySelectorAll('source')).toHaveLength(0);
    expect(video.load).toHaveBeenCalled();
    expect(container.contains(video)).toBe(false);
    expect(e.attached).toBe(false);
  });

  it('unbinds the listeners: no more callbacks', async () => {
    const onPlay = vi.fn();
    const e = engine();
    const p = e.attach(container, stream(), { callbacks: { onPlay } });
    video.simulateLoad();
    await p;

    e.detach();
    video.dispatchEvent(new Event('play'));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('is idempotent and does not fail when never attached', () => {
    const e = engine();
    expect(() => { e.detach(); e.detach(); }).not.toThrow();
  });

  it('allows attaching again afterwards', async () => {
    const e = await attached();
    e.detach();
    video = drivableVideo();
    const p = e.attach(container, stream());
    video.simulateLoad();
    await expect(p).resolves.toBeUndefined();
  });
});

describe('NativeEngine · playback', () => {
  const attached = async (cb = {}) => {
    const e = engine();
    const p = e.attach(container, stream(), { callbacks: cb });
    video.simulateLoad();
    await p;
    return e;
  };

  it('tells an autoplay block from a media failure', async () => {
    // The UI reacts differently: a block is fixed by showing a play button.
    const e = await attached();
    video.rejectPlay('NotAllowedError');
    await expect(e.play()).rejects.toMatchObject({
      code: 'media/blocked', retryable: false,
    });
  });

  it('a play() interrupted by pause() is not a failure', async () => {
    // The chain's unlock did this and the outro was dropped as broken.
    // see docs/browser-quirks.md#play-abort
    const e = engine();
    const onError = vi.fn();
    const p = e.attach(container, stream(), { callbacks: { onError } });
    video.simulateLoad();
    await p;
    video.rejectPlay('AbortError');
    await expect(e.play()).resolves.toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  it('treats any other rejection as a playback failure', async () => {
    const e = await attached();
    video.rejectPlay('NotSupportedError');
    await expect(e.play()).rejects.toMatchObject({ code: 'media/decode' });
  });

  it('forwards play and pause to the callbacks', async () => {
    const onPlay = vi.fn(), onPause = vi.fn();
    const e = await attached({ onPlay, onPause });
    await e.play();
    e.pause();
    expect(onPlay).toHaveBeenCalled();
    expect(onPause).toHaveBeenCalled();
  });

  it('ignores nonsensical seek positions instead of forwarding them', async () => {
    const e = await attached();
    e.seek(50);
    e.seek(-1);
    e.seek(Number.NaN);
    expect(video.currentTime).toBe(50);
  });

  it('clamps the volume to the valid range', async () => {
    const e = await attached();
    e.setVolume(5);
    expect(video.volume).toBe(1);
    e.setVolume(-2);
    expect(video.volume).toBe(0);
  });

  it('rejects impossible rates', async () => {
    const e = await attached();
    e.setPlaybackRate(1.5);
    e.setPlaybackRate(0);
    e.setPlaybackRate(-1);
    e.setPlaybackRate(Number.NaN);
    expect(e.getPlaybackRate()).toBe(1.5);
  });

  it('reports duration 0 instead of NaN or Infinity', async () => {
    const e = await attached();
    Object.defineProperty(video, 'duration', { value: Number.NaN, configurable: true });
    expect(e.duration).toBe(0);
    Object.defineProperty(video, 'duration', { value: Infinity, configurable: true });
    expect(e.duration).toBe(0);
  });
});

describe('NativeEngine · stall accounting', () => {
  const attached = async (cb: object) => {
    const e = engine();
    const p = e.attach(container, stream(), { callbacks: cb });
    video.simulateLoad();
    await p;
    return e;
  };

  it('measures how long it ran out of buffer', async () => {
    const onStallStart = vi.fn(), onStallEnd = vi.fn();
    await attached({ onStallStart, onStallEnd });

    clock = 1000;
    video.dispatchEvent(new Event('waiting'));
    clock = 1350;
    video.dispatchEvent(new Event('playing'));

    expect(onStallStart).toHaveBeenCalledTimes(1);
    expect(onStallEnd).toHaveBeenCalledWith(350);
  });

  it('does not count an open stall twice', async () => {
    const onStallStart = vi.fn();
    await attached({ onStallStart });
    video.dispatchEvent(new Event('waiting'));
    video.dispatchEvent(new Event('waiting'));
    expect(onStallStart).toHaveBeenCalledTimes(1);
  });

  it('does not invent a stall end without a stall', async () => {
    const onStallEnd = vi.fn();
    await attached({ onStallEnd });
    video.dispatchEvent(new Event('playing'));
    expect(onStallEnd).not.toHaveBeenCalled();
  });

  it('a detach mid-stall does not leave the counter hanging', async () => {
    const onStallEnd = vi.fn();
    const e = await attached({ onStallEnd });
    video.dispatchEvent(new Event('waiting'));
    e.detach();
    video.dispatchEvent(new Event('playing'));
    expect(onStallEnd).not.toHaveBeenCalled();
  });
});

describe('NativeEngine · destroy', () => {
  it('releases the resource and leaves the engine unusable', async () => {
    const e = engine();
    const p = e.attach(container, stream());
    video.simulateLoad();
    await p;

    e.destroy();
    expect(e.attached).toBe(false);
    expect(container.contains(video)).toBe(false);
    await expect(e.attach(container, stream())).rejects.toThrow(/destroyed/);
  });
});

describe('engine selection', () => {
  it('maps canPlayType for normal sources', () => {
    // happy-dom returns '': for the engine that is "no".
    expect(nativeEngineFactory.canPlay({ src: 'a.mp4', type: 'video/mp4' }))
      .toBe('no');
    expect(nativeEngineFactory.canPlay({ src: 'a.mp4', type: '' })).toBe('no');
  });

  it('does NOT trust canPlayType for HLS, which lies', () => {
    // see docs/browser-quirks.md#canplaytype-hls
    const hls = { src: 'a.m3u8', type: 'application/vnd.apple.mpegurl' };
    const g = globalThis as { MediaSource?: unknown };
    const previous = g.MediaSource;

    // With MSE it is lowered, so an hls.js engine can win.
    g.MediaSource = function () {};
    expect(nativeEngineFactory.canPlay(hls)).toBe('maybe');

    // Without MSE (iOS) native support is the only way.
    delete g.MediaSource;
    expect(nativeEngineFactory.canPlay(hls)).toBe('probably');

    if (previous !== undefined) g.MediaSource = previous;
  });

  it('recognises HLS MIME type variants, parameters included', () => {
    const g = globalThis as { MediaSource?: unknown };
    const previous = g.MediaSource;
    delete g.MediaSource;
    for (const type of [
      'application/x-mpegURL',
      'APPLICATION/VND.APPLE.MPEGURL',
      'application/vnd.apple.mpegurl; charset=utf-8',
    ]) {
      expect(nativeEngineFactory.canPlay({ src: 'a.m3u8', type }), type).toBe('probably');
    }
    if (previous !== undefined) g.MediaSource = previous;
  });

  it('a stream\'s confidence is its best source\'s', () => {
    const fake: EngineFactory = {
      name: 'fake',
      canPlay: (s) => (s.type === 'video/mp4' ? 'probably' : 'no'),
      create: () => { throw new Error('unused'); },
    };
    expect(confidenceFor(fake, stream({
      sources: [{ src: 'a.webm', type: 'video/webm' }, { src: 'a.mp4', type: 'video/mp4' }],
    }))).toBe('probably');
  });

  it('the most confident wins, and on a tie the first registered', () => {
    const mk = (name: string, c: 'probably' | 'maybe' | 'no'): EngineFactory => ({
      name, canPlay: () => c, create: () => { throw new Error('unused'); },
    });
    const s = stream();
    expect(selectEngine([mk('a', 'maybe'), mk('b', 'probably')], s)?.name).toBe('b');
    expect(selectEngine([mk('a', 'maybe'), mk('b', 'maybe')], s)?.name).toBe('a');
    expect(selectEngine([mk('a', 'no')], s)).toBeNull();
    expect(selectEngine([], s)).toBeNull();
  });
});
