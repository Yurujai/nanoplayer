// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stream } from '@nanoplayer/core';

/** Fake hls.js: parses the playlist on load and records what it is asked. */
const instances: Array<{ startLoad: ReturnType<typeof vi.fn> }> = [];
vi.mock('hls.js', () => {
  class FakeHls {
    static Events = { MANIFEST_PARSED: 'manifestParsed', ERROR: 'error' };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    static isSupported = () => true;
    #listeners = new Map<string, Array<() => void>>();
    startLoad = vi.fn();
    constructor() { instances.push(this); }
    on(ev: string, fn: () => void) { this.#listeners.set(ev, [...(this.#listeners.get(ev) ?? []), fn]); }
    off() {}
    attachMedia() {}
    loadSource() { queueMicrotask(() => this.#listeners.get('manifestParsed')?.forEach((f) => f())); }
    destroy() {}
    recoverMediaError() {}
  }
  return { default: FakeHls };
});

const { HlsEngine } = await import('../src/index.js');

const stream: Stream = {
  id: 'cam', role: 'presenter', audio: true,
  sources: [{ src: 'live.m3u8', type: 'application/vnd.apple.mpegurl' }],
};

/** Makes the element report [start, end) as buffered. */
function withBuffered(el: HTMLVideoElement, start: number, end: number): void {
  Object.defineProperty(el, 'buffered', {
    configurable: true,
    get: () => ({ length: 1, start: () => start, end: () => end }),
  });
}

let container: HTMLElement;

beforeEach(() => {
  instances.length = 0;
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  (globalThis as { MediaSource?: unknown }).MediaSource = function () {};
});

async function attached() {
  const e = new HlsEngine(async () => (await import('hls.js')).default);
  await e.attach(container, stream);
  withBuffered(e.element!, 36, 72);
  return { e, hls: instances[0]! };
}

describe('HlsEngine · seeking', () => {
  it('outside the buffer, tells hls.js to load from there', async () => {
    // WebKit: without this a long seek froze playback. See docs/browser-quirks.md#webkit-hls-seek
    const { e, hls } = await attached();
    e.seek(1439);
    expect(hls.startLoad).toHaveBeenCalledWith(1439);
  });

  it('inside the buffer, leaves hls.js alone', async () => {
    const { e, hls } = await attached();
    e.seek(50);
    expect(hls.startLoad).not.toHaveBeenCalled();
  });
});
