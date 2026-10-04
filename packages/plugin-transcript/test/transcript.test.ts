// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create, type EngineFactory, type Manifest, type PanelDecl, type UiSlots } from '@nanoplayer/core';
import '../src/index.js';

const VTT = {
  'en.vtt': 'WEBVTT\n\n00:00.000 --> 00:05.000\nFirst\n\n00:05.000 --> 00:10.000\nSecond\n\n00:20.000 --> 00:25.000\nThird',
  'es.vtt': 'WEBVTT\n\n00:00.000 --> 00:05.000\nPrimera',
};

const engines: EngineFactory[] = [{
  name: 'fake', canPlay: () => 'probably',
  create: () => ({ element: null, async attach() {}, destroy() {}, pause() {}, setVolume() {}, setMuted() {} }) as never,
}];

const lecture: Manifest = {
  id: 'lecture',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
  textTracks: [
    { src: 'es.vtt', lang: 'es', label: 'Español' },
    { src: 'en.vtt', lang: 'en', label: 'English' },
    { src: 'desc.vtt', lang: 'en', kind: 'descriptions' },
  ],
};

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = VTT[url as keyof typeof VTT];
    return body ? new Response(body) : new Response('', { status: 404 });
  }));
});

async function mount(manifest: Manifest = lecture, lang = 'en') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const player = create(host, { manifest, engines, registry: false, lang });
  await player.resolve();
  await settle();
  let decl: PanelDecl | undefined;
  const element = document.createElement('section');
  document.body.appendChild(element);
  const ui: UiSlots = {
    addBarControl: () => () => {},
    addSettingsPanel: () => () => {},
    addTimelineMarkers: () => () => {},
    addOverlay: () => ({ element: document.createElement('div'), remove: () => {} }),
    addPanel: (d) => { decl = d; return { element, isOpen: true, remove: () => element.remove() }; },
    refresh: () => {},
  };
  player.setUi(ui);
  let now = 0;
  vi.spyOn(player, 'currentTime', 'get').mockImplementation(() => now);
  const at = (t: number) => { now = t; player.bus.emit('time', { current: t, duration: 60 }); };
  const open = async () => { decl!.onOpen!(); await settle(); await settle(); };
  const phrases = () => [...element.querySelectorAll<HTMLButtonElement>('.np-transcript__cue')];
  return { player, decl: () => decl, element, at, open, phrases };
}

describe('transcript plugin', () => {
  it('asks for a panel, and downloads nothing until it is opened', async () => {
    const { decl } = await mount();
    expect(decl()?.label).toBe('Transcript');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lists the phrases of the interface language, never the descriptions', async () => {
    const { open, phrases } = await mount();
    await open();
    expect(fetch).toHaveBeenCalledWith('en.vtt');
    expect(phrases().map((b) => b.textContent)).toEqual(['0:00First', '0:05Second', '0:20Third']);
  });

  it('marks the phrase under way, and the last one through a silence', async () => {
    const { open, phrases, at } = await mount();
    await open();
    at(6);
    expect(phrases()[1]!.getAttribute('aria-current')).toBe('true');
    at(15);
    expect(phrases()[1]!.getAttribute('aria-current')).toBe('true');
    at(21);
    expect(phrases()[1]!.hasAttribute('aria-current')).toBe(false);
    expect(phrases()[2]!.getAttribute('aria-current')).toBe('true');
  });

  it('a phrase jumps there', async () => {
    const { player, open, phrases } = await mount();
    const seek = vi.spyOn(player, 'seek').mockImplementation(() => {});
    await open();
    phrases()[2]!.click();
    expect(seek).toHaveBeenCalledWith(20);
  });

  it('is one tab stop, on the phrase under way, and arrows move inside', async () => {
    const { open, phrases, at } = await mount();
    await open();
    at(6);
    expect(phrases().map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    phrases()[1]!.focus();
    phrases()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(phrases()[2]);
    phrases()[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(phrases()[0]);
    at(21);
    expect(document.activeElement, 'playback does not pull focus away').toBe(phrases()[0]);
  });

  it('switches language from its own picker', async () => {
    const { open, phrases, element } = await mount();
    await open();
    const select = element.querySelector('select')!;
    select.value = 'es';
    select.dispatchEvent(new Event('change'));
    await settle(); await settle();
    expect(phrases().map((b) => b.textContent)).toEqual(['0:00Primera']);
  });

  it('says so when the file cannot be loaded', async () => {
    const { open, element } = await mount({ ...lecture, textTracks: [{ src: 'missing.vtt', lang: 'en' }] });
    await open();
    expect(element.querySelector('[role="status"]')!.textContent).toBe('The transcript could not be loaded.');
  });

  it('a video with descriptions only has no transcript', async () => {
    const { decl } = await mount({ ...lecture, textTracks: [{ src: 'desc.vtt', lang: 'en', kind: 'descriptions' }] });
    expect(decl()).toBeUndefined();
  });
});
