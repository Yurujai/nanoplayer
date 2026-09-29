// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Player, playerError, type EngineFactory, type Manifest } from '@nanoplayer/core';
import { attachControls } from '../src/control-bar.js';
import '../src/strings.js';

/** Un motor que nunca engancha: el directo aún no emite. */
const sinEmision: EngineFactory = {
  name: 'sin-emision',
  canPlay: () => 'probably',
  create: () => ({
    async attach() { throw playerError('media/network', 'not broadcasting'); },
    destroy() {},
  }) as never,
};

const DIRECTO: Manifest = {
  id: 'vivo', live: true,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'cam.m3u8', type: 'application/vnd.apple.mpegurl' }] }],
};

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

describe('directo que aún no emite', () => {
  it('al pulsar play se retira el póster y se ve el aviso de espera', async () => {
    const p = new Player({ container: host, manifest: DIRECTO, engines: [sinEmision], lang: 'en',
                           liveRetry: { initialMs: 60_000, maxMs: 60_000 } });
    attachControls(p);
    const poster = host.querySelector<HTMLElement>('.np__poster')!;
    expect(poster.hidden).toBe(false);

    await p.play().catch(() => {});
    expect(p.state).toBe('resolved');
    expect(poster.hidden).toBe(true);
    expect(host.querySelector('.np__espera')?.textContent)
      .toBe('The broadcast has not started yet');
    p.destroy();
  });
});
