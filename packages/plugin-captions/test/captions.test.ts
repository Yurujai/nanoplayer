// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { create, type EngineFactory, type Manifest, type Player } from '@nanoplayer/core';
import '../src/index.js';

/** An engine that mounts a real `<video>` in its box and removes it on detach. */
const engines: EngineFactory[] = [{
  name: 'fake',
  canPlay: () => 'probably',
  create: () => {
    let video: HTMLVideoElement | null = null;
    return {
      get element() { return video; },
      async attach(box: HTMLElement) {
        video = document.createElement('video');
        box.appendChild(video);
      },
      destroy() { video?.remove(); video = null; },
      pause() {},
      setVolume() {},
      setMuted() {},
    } as never;
  },
}];

const lecture: Manifest = {
  id: 'lecture',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
  textTracks: [{ src: 'en.vtt', lang: 'en' }],
};

let page: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  page = document.body;
});

async function mount(): Promise<Player> {
  const host = document.createElement('div');
  page.appendChild(host);
  const player = create(host, { manifest: lecture, engines, registry: false });
  await player.resolve();
  await new Promise((r) => setTimeout(r, 0));
  await player.attach();
  return player;
}

const tracksIn = (player: Player) => player.master?.element?.querySelectorAll('track').length ?? 0;

describe('captions plugin', () => {
  it('puts the tracks on its own player, with two players sharing a stream id', async () => {
    const first = await mount();
    const second = await mount();
    expect(tracksIn(first)).toBe(1);
    expect(tracksIn(second), 'the second player got none').toBe(1);
  });

  it('mounts the tracks again after the player is detached and re-attached', async () => {
    const player = await mount();
    player.detach();
    await player.attach();
    expect(tracksIn(player)).toBe(1);
  });
});
