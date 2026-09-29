// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Player, playerError, type EngineFactory, type Manifest } from '@nanoplayer/core';
import { attachControls } from '../src/control-bar.js';
import '../src/strings.js';

/** An engine that never attaches: the live stream is not on air yet. */
const offAir: EngineFactory = {
  name: 'off-air',
  canPlay: () => 'probably',
  create: () => ({
    async attach() { throw playerError('media/network', 'not broadcasting'); },
    destroy() {},
  }) as never,
};

const LIVE: Manifest = {
  id: 'live', live: true,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'cam.m3u8', type: 'application/vnd.apple.mpegurl' }] }],
};

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

describe('live stream not on air yet', () => {
  it('pressing play removes the poster and shows the waiting notice', async () => {
    const p = new Player({ container: host, manifest: LIVE, engines: [offAir], lang: 'en',
                           liveRetry: { initialMs: 60_000, maxMs: 60_000 } });
    attachControls(p);
    const poster = host.querySelector<HTMLElement>('.np__poster')!;
    expect(poster.hidden).toBe(false);

    await p.play().catch(() => {});
    expect(p.state).toBe('resolved');
    expect(poster.hidden).toBe(true);
    expect(host.querySelector('.np__waiting')?.textContent)
      .toBe('The broadcast has not started yet');
    p.destroy();
  });
});
