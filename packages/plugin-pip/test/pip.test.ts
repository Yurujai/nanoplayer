// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  create, type BarControlDecl, type EngineFactory, type Manifest, type Player,
  type UiSlots,
} from '@nanoplayer/core';
import '../src/index.js';

/** An engine that mounts a real `<video>` in its box. */
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
      currentTime: 0,
      duration: 0,
      paused: true,
      async play() {},
      pause() {},
      seek() {},
      getPlaybackRate: () => 1,
      setPlaybackRate() {},
      setVolume() {},
      setMuted() {},
    } as never;
  },
}];

const lecture: Manifest = {
  id: 'lecture',
  streams: [
    { id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] },
    { id: 'slides', role: 'presentation', audio: false, sources: [{ src: 'slides.mp4', type: 'video/mp4' }] },
  ],
};

/** The standard API, as Chrome and Safari offer it. */
function browserWithPip() {
  Object.defineProperty(document, 'pictureInPictureEnabled', { value: true, configurable: true });
  let floating: Element | null = null;
  Object.defineProperty(document, 'pictureInPictureElement', { get: () => floating, configurable: true });
  const request = vi.fn(async function (this: HTMLVideoElement) {
    floating = this;
    this.dispatchEvent(new Event('enterpictureinpicture', { bubbles: true }));
    return {} as PictureInPictureWindow;
  });
  HTMLVideoElement.prototype.requestPictureInPicture = request;
  document.exitPictureInPicture = vi.fn(async () => {
    const was = floating;
    floating = null;
    was?.dispatchEvent(new Event('leavepictureinpicture', { bubbles: true }));
  });
  return { request };
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  delete (document as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled;
  delete (document as { pictureInPictureElement?: Element }).pictureInPictureElement;
});

async function mount(manifest = lecture) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const player = create(host, { manifest, engines, registry: false });
  await player.resolve();
  await new Promise((r) => setTimeout(r, 0));
  await player.attach();
  let control: BarControlDecl | undefined;
  const refresh = vi.fn();
  const ui: UiSlots = {
    addBarControl: (c) => { control = c; return () => {}; },
    addSettingsPanel: () => () => {},
    addTimelineMarkers: () => () => {},
    addOverlay: () => ({ element: document.createElement('div'), remove: () => {} }),
    refresh,
  };
  player.setUi(ui);
  const label = () => (typeof control?.label === 'function' ? control.label() : control?.label);
  const press = async () => { control?.onActivate(); await new Promise((r) => setTimeout(r, 0)); };
  return { player, control: () => control, label, press, refresh };
}

const videoOf = (player: Player, role: string) =>
  player.container.querySelector<HTMLVideoElement>(`[data-role="${role}"] video`);

describe('picture-in-picture plugin', () => {
  it('offers no button where the browser cannot float a video', async () => {
    const { control } = await mount();
    expect(control()).toBeUndefined();
  });

  it('does not switch on for audio only: there is no picture to float', async () => {
    browserWithPip();
    const { control } = await mount({
      id: 'radio',
      streams: [{ id: 'a', role: 'presenter', audio: true, sources: [{ src: 'a.m4a', type: 'audio/mp4' }] }],
    });
    expect(control()).toBeUndefined();
  });

  it('floats the master video and the label turns into closing it', async () => {
    const { request } = browserWithPip();
    const { player, label, press, refresh } = await mount();
    expect(label()).toBe('Abrir en una ventana flotante');
    await press();
    expect(request.mock.contexts[0]).toBe(player.master?.element);
    expect(refresh, 'repaints when the browser says it floats').toHaveBeenCalled();
    expect(label()).toBe('Cerrar la ventana flotante');
    await press();
    expect(document.exitPictureInPicture).toHaveBeenCalled();
    expect(label()).toBe('Abrir en una ventana flotante');
  });

  it('floats the slides when the layout shows only them', async () => {
    const { request } = browserWithPip();
    const { player, press } = await mount();
    player.bus.emit('layout:change', { layout: 'presentation' });
    await press();
    expect(request.mock.contexts[0]).toBe(videoOf(player, 'presentation'));
  });

  it('a refusal from the browser leaves the button as it was', async () => {
    const { request } = browserWithPip();
    request.mockRejectedValueOnce(new DOMException('No metadata yet', 'InvalidStateError'));
    const { label, press } = await mount();
    await press();
    expect(label()).toBe('Abrir en una ventana flotante');
  });
});
