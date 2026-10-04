// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  create, type BarControlDecl, type EngineFactory, type Manifest, type Player, type UiSlots,
} from '@nanoplayer/core';
import '../src/index.js';

/** The browser's RemotePlayback: it reports devices and connection as they come and go. */
function fakeRemote() {
  const remote = Object.assign(new EventTarget(), {
    state: 'disconnected' as RemotePlaybackState,
    onAvailability: null as ((available: boolean) => void) | null,
    watchAvailability: vi.fn(async (cb: (available: boolean) => void) => { remote.onAvailability = cb; return 7; }),
    cancelWatchAvailability: vi.fn(async () => {}),
    prompt: vi.fn(async () => {}),
  });
  const setState = (state: RemotePlaybackState) => {
    remote.state = state;
    remote.dispatchEvent(new Event(state === 'connected' ? 'connect' : state === 'connecting' ? 'connecting' : 'disconnect'));
  };
  return Object.assign(remote, { setState });
}

let remotes: Array<ReturnType<typeof fakeRemote>> = [];
let withRemote = true;

const engines: EngineFactory[] = [{
  name: 'fake', canPlay: () => 'probably',
  create: () => {
    let video: HTMLVideoElement | null = null;
    return {
      get element() { return video; },
      async attach(box: HTMLElement) {
        video = document.createElement('video');
        // happy-dom has a `remote` of its own; without the API it must not be there.
        const remote = withRemote ? fakeRemote() : undefined;
        if (remote) remotes.push(remote);
        Object.defineProperty(video, 'remote', { value: remote });
        box.appendChild(video);
      },
      destroy() { video?.remove(); video = null; },
      pause() {}, setVolume() {}, setMuted() {},
    } as never;
  },
}];

const lecture: Manifest = {
  id: 'lecture',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
};

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  remotes = [];
  withRemote = true;
});

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const player: Player = create(host, { manifest: lecture, engines, registry: false, lang: 'en' });
  await player.resolve();
  await settle();
  let control: BarControlDecl | undefined;
  const overlays = new Map<string, HTMLElement>();
  const ui: UiSlots = {
    addBarControl: (c) => { control = c; return () => {}; },
    addSettingsPanel: () => () => {},
    addTimelineMarkers: () => () => {},
    addTimelinePreview: () => () => {},
    addOverlay: (d) => {
      const el = document.createElement('div');
      overlays.set(d.id, el);
      return { element: el, remove: () => { el.remove(); overlays.delete(d.id); } };
    },
    addPanel: () => ({ element: document.createElement('div'), isOpen: false, remove: () => {} }),
    refresh: vi.fn(),
  };
  player.setUi(ui);
  await player.attach();
  await settle();
  const label = () => (typeof control!.label === 'function' ? control!.label() : control!.label);
  return { player, control: () => control!, label, overlays };
}

describe('cast plugin', () => {
  it('shows no button until there is a device to send to', async () => {
    const { control } = await mount();
    expect(control().available!()).toBe(false);
    remotes[0]!.onAvailability!(true);
    expect(control().available!()).toBe(true);
  });

  it('the button opens the browser\'s own device picker', async () => {
    const { control } = await mount();
    remotes[0]!.onAvailability!(true);
    control().onActivate();
    expect(remotes[0]!.prompt).toHaveBeenCalled();
  });

  it('while connected it says where the picture went', async () => {
    const { control, label, overlays } = await mount();
    remotes[0]!.onAvailability!(true);
    remotes[0]!.setState('connected');
    expect(control().pressed!()).toBe(true);
    expect(label()).toBe('Playing on another screen');
    const notice = overlays.get('cast')!.querySelector('[role="status"]')!;
    expect(notice.textContent).toBe('Playing on another screen');
    remotes[0]!.setState('disconnected');
    expect(overlays.has('cast')).toBe(false);
    expect(label()).toBe('Play on another screen');
  });

  it('a reattach watches the new video and lets go of the old one', async () => {
    const { player } = await mount();
    player.detach();
    await player.attach();
    await settle();
    expect(remotes).toHaveLength(2);
    expect(remotes[0]!.cancelWatchAvailability).toHaveBeenCalledWith(7);
    expect(remotes[1]!.watchAvailability).toHaveBeenCalled();
  });

  it('falls back to Safari\'s AirPlay picker without the standard API', async () => {
    withRemote = false;
    const picker = vi.fn();
    HTMLVideoElement.prototype.webkitShowPlaybackTargetPicker = picker;
    const { player, control } = await mount();
    const video = player.master!.element!;
    video.dispatchEvent(Object.assign(new Event('webkitplaybacktargetavailabilitychanged'), { availability: 'available' }));
    expect(control().available!()).toBe(true);
    control().onActivate();
    expect(picker).toHaveBeenCalled();
    delete (HTMLVideoElement.prototype as { webkitShowPlaybackTargetPicker?: unknown }).webkitShowPlaybackTargetPicker;
  });
});
