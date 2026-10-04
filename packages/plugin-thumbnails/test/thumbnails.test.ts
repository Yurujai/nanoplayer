// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  create, type EngineFactory, type Manifest, type TimelinePreviewDecl, type UiSlots,
} from '@nanoplayer/core';
import { parseThumbnails } from '../src/index.js';

describe('parseThumbnails', () => {
  it('reads sprite regions, relative to the WebVTT file', () => {
    const cues = parseThumbnails([
      'WEBVTT', '',
      '00:00.000 --> 00:05.000', 'sheet.jpg#xywh=0,0,160,90', '',
      '00:05.000 --> 00:10.000', 'sheet.jpg#xywh=pixel:160,0,160,90', '',
      '00:10.000 --> 00:15.000', '/frames/3.jpg',
    ].join('\n'), 'https://cdn.example/lecture/thumbs.vtt');
    expect(cues.map((c) => c.image)).toEqual([
      { url: 'https://cdn.example/lecture/sheet.jpg', x: 0, y: 0, width: 160, height: 90 },
      { url: 'https://cdn.example/lecture/sheet.jpg', x: 160, y: 0, width: 160, height: 90 },
      { url: 'https://cdn.example/frames/3.jpg' },
    ]);
  });
});

const engines: EngineFactory[] = [{
  name: 'fake', canPlay: () => 'probably',
  create: () => ({ element: null, async attach() {}, destroy() {}, pause() {}, setVolume() {}, setMuted() {} }) as never,
}];

const lecture: Manifest = {
  id: 'lecture',
  thumbnails: 'https://cdn.example/lecture/thumbs.vtt',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
};

const VTT = 'WEBVTT\n\n00:00.000 --> 00:05.000\nsheet.jpg#xywh=0,0,160,90\n\n00:05.000 --> 00:10.000\nsheet.jpg#xywh=160,0,160,90';
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(VTT)));
});

async function mount(manifest: Manifest = lecture) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const player = create(host, { manifest, engines, registry: false });
  await player.resolve();
  await settle();
  let preview: TimelinePreviewDecl | undefined;
  const ui: UiSlots = {
    addBarControl: () => () => {},
    addSettingsPanel: () => () => {},
    addTimelineMarkers: () => () => {},
    addTimelinePreview: (d) => { preview = d; return () => {}; },
    addOverlay: () => ({ element: document.createElement('div'), remove: () => {} }),
    addPanel: () => ({ element: document.createElement('div'), isOpen: false, remove: () => {} }),
    refresh: () => {},
  };
  player.setUi(ui);
  return { player, preview: () => preview };
}

describe('thumbnails plugin', () => {
  it('fetches nothing with the page', async () => {
    const { preview } = await mount();
    expect(preview()).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('the first hover loads the file, and then each time has its picture', async () => {
    const { preview } = await mount();
    expect(preview()!.imageAt(7), 'still loading').toBeNull();
    await settle(); await settle();
    expect(preview()!.imageAt(7)).toEqual({
      url: 'https://cdn.example/lecture/sheet.jpg', x: 160, y: 0, width: 160, height: 90,
    });
    expect(preview()!.imageAt(42), 'past the last cue').toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('playback starting loads it too, so the first hover already has pictures', async () => {
    const { player } = await mount();
    player.bus.emit('engine:attach:ok', { engine: 'fake', resumeAt: 0 });
    expect(fetch).toHaveBeenCalledWith('https://cdn.example/lecture/thumbs.vtt');
  });

  it('does not switch on without a thumbnails file', async () => {
    const { preview } = await mount({ ...lecture, thumbnails: undefined });
    expect(preview()).toBeUndefined();
  });
});
