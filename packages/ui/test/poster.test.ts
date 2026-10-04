// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Player, type EngineFactory } from '@nanoplayer/core';
import { attachControls } from '../src/control-bar.js';
import '../src/strings.js';

/** An engine whose media takes as long as the test says, as a slow network would. */
function slowEngine() {
  let arrive!: () => void;
  const factory: EngineFactory = {
    name: 'slow',
    canPlay: () => 'probably',
    create: () => ({
      element: null, paused: true,
      attach: () => new Promise<void>((r) => { arrive = r; }),
      destroy() {}, pause() {}, setVolume() {}, setMuted() {}, async play() {},
      getPlaybackRate: () => 1,
    }) as never,
  };
  return { factory, arrive: () => arrive() };
}

const MANIFEST = {
  id: 'x', streams: [{ id: 'a', role: 'presenter', audio: true, sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
};

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('poster', () => {
  it('keeps showing it is loading while the media is on its way', async () => {
    const engine = slowEngine();
    const player = new Player({ container: host, manifest: MANIFEST, engines: [engine.factory], lang: 'en' });
    attachControls(player);
    const layer = host.querySelector<HTMLElement>('.np__poster')!;
    const button = host.querySelector<HTMLButtonElement>('.np__poster-play')!;

    button.click();
    await settle();
    // The player has been through idle, resolving, resolved and attaching by now.
    expect(player.state).toBe('attaching');
    expect(layer.classList.contains('np__poster--loading')).toBe(true);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Loading…');

    engine.arrive();
    await settle();
    expect(layer.hidden, 'gone once there is media').toBe(true);
  });
});
