// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  create, type EngineFactory, type Manifest, type OverlayDecl, type TimelineMarkersDecl, type UiSlots,
} from '@nanoplayer/core';
import { activitiesOf } from '../src/index.js';

const engines: EngineFactory[] = [{
  name: 'fake', canPlay: () => 'probably',
  create: () => ({ element: null, async attach() {}, destroy() {}, pause() {}, setVolume() {}, setMuted() {} }) as never,
}];

const lecture: Manifest = {
  id: 'lecture',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
  annotations: [
    { kind: 'h5p', start: 30, data: { src: 'https://lms.example/h5p/embed.php?id=7', title: 'Quick check' } },
    { kind: 'h5p', start: 90, data: { src: 'javascript:alert(1)', title: 'Nope' } },
  ],
};

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { document.body.innerHTML = ''; });

async function mount(manifest: Manifest = lecture) {
  const host = document.createElement('div');
  host.tabIndex = 0;
  document.body.appendChild(host);
  const player = create(host, { manifest, engines, registry: false, lang: 'en' });
  await player.resolve();
  await settle();
  const overlays: Array<{ decl: OverlayDecl; element: HTMLElement }> = [];
  let markers: TimelineMarkersDecl | undefined;
  const ui: UiSlots = {
    addBarControl: () => () => {},
    addSettingsPanel: () => () => {},
    addTimelineMarkers: (d) => { markers = d; return () => {}; },
    addTimelinePreview: () => () => {},
    addOverlay: (decl) => {
      const element = document.createElement('div');
      host.appendChild(element);
      overlays.push({ decl, element });
      return { element, remove: () => element.remove() };
    },
    addPanel: () => ({ element: document.createElement('div'), isOpen: false, remove: () => {} }),
    refresh: () => {},
  };
  player.setUi(ui);
  let now = 0;
  let paused = false;
  vi.spyOn(player, 'currentTime', 'get').mockImplementation(() => now);
  vi.spyOn(player, 'paused', 'get').mockImplementation(() => paused);
  const pause = vi.spyOn(player, 'pause').mockImplementation(() => { paused = true; });
  const play = vi.spyOn(player, 'play').mockImplementation(async () => { paused = false; });
  const at = (t: number) => { now = t; player.bus.emit('time', { current: t, duration: 120 }); };
  const seek = (t: number) => { now = t; player.bus.emit('seek:end', { at: t }); };
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  return { player, host, overlays, markers: () => markers, at, seek, pause, play, dialog };
}

describe('H5P plugin', () => {
  it('marks each activity on the bar, and leaves out unsafe URLs', async () => {
    const { markers } = await mount();
    expect(markers()?.markers).toEqual([{ start: 30, end: 31, label: 'Quick check' }]);
  });

  it('playing through one pauses the video and opens the activity over it', async () => {
    const { at, pause, overlays, dialog } = await mount();
    at(29); at(29.5);
    expect(dialog()).toBeNull();
    at(30.2);
    expect(pause).toHaveBeenCalled();
    expect(overlays[0]!.decl.interactive).toBe(true);
    const frame = dialog()!.querySelector('iframe')!;
    expect(frame.src).toBe('https://lms.example/h5p/embed.php?id=7');
    expect(frame.title).toBe('Quick check');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
  });

  it('is a dialog named by its title, with focus inside', async () => {
    const { at, dialog } = await mount();
    at(29.5); at(30.2);
    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog()!.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledBy)!.textContent).toBe('Quick check');
    expect(document.activeElement).toBe(dialog());
  });

  it('continuing closes it, plays on, and gives focus back', async () => {
    const { host, at, play, dialog } = await mount();
    host.focus();
    at(29.5); at(30.2);
    dialog()!.querySelector<HTMLButtonElement>('button')!.click();
    expect(dialog()).toBeNull();
    expect(play).toHaveBeenCalled();
    expect(document.activeElement).toBe(host);
  });

  it('Escape continues too, and keys inside do not reach the player\'s shortcuts', async () => {
    const { host, at, play, dialog } = await mount();
    const onKey = vi.fn();
    host.addEventListener('keydown', onKey);
    at(29.5); at(30.2);
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(onKey).not.toHaveBeenCalled();
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).toBeNull();
    expect(play).toHaveBeenCalled();
  });

  it('seeking over an activity does not open it', async () => {
    const { at, seek, dialog } = await mount();
    at(10);
    seek(50);
    at(50.3);
    expect(dialog()).toBeNull();
  });

  it('a big jump between updates counts as a seek, not as playing through', async () => {
    const { at, dialog } = await mount();
    at(10); at(45);
    expect(dialog()).toBeNull();
  });
});

describe('activities', () => {
  it('only http(s) pages, relative ones resolved, untitled ones named', () => {
    const list = activitiesOf({
      ...lecture,
      annotations: [
        { kind: 'h5p', start: 5, data: { src: '/h5p/embed/3' } },
        { kind: 'h5p', start: 6, data: { src: 'data:text/html,<script>' } },
        { kind: 'h5p', start: 7, data: {} },
      ],
    }, 'Activity');
    expect(list).toEqual([{ start: 5, src: new URL('/h5p/embed/3', document.baseURI).href, title: 'Activity' }]);
  });
});
