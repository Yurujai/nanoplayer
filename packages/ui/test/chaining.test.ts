// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Player, type EngineFactory, type Manifest } from '@nanoplayer/core';
import { attachControls } from '../src/control-bar.js';
import { injectStyles } from '../src/styles.js';
import '../src/strings.js';

const DURATIONS: Record<string, number> = { intro: 5, outro: 4 };

/** Fake engine: time moves by hand, and a frame arrives one tick after play. */
function fakeFactory() {
  const byId = new Map<string, any>();
  const factory: EngineFactory = {
    name: 'fake',
    canPlay: () => 'probably',
    create() {
      let t = 0, paused = true, cb: any = {}, duration = 60;
      let frames: Array<() => void> = [];
      const e: any = {
        name: 'fake', attached: true,
        element: {
          videoWidth: 640,
          requestVideoFrameCallback(f: () => void) { frames.push(f); return 1; },
        },
        async attach(box: HTMLElement, s: { id: string }, o: any) {
          cb = o?.callbacks ?? {};
          duration = DURATIONS[s.id] ?? 60;
          box.appendChild(document.createElement('video'));
          byId.set(s.id, e);
        },
        detach() {},
        async play() {
          paused = false; cb.onPlay?.(); cb.onPlaying?.();
          setTimeout(() => { const f = frames; frames = []; f.forEach((x) => x()); }, 10);
        },
        pause() { if (!paused) { paused = true; cb.onPause?.(); } },
        seek(s: number) { t = s; },
        get currentTime() { return t; },
        get duration() { return duration; },
        get paused() { return paused; },
        ended: false, buffered: null, seekable: null,
        getPlaybackRate: () => 1, setPlaybackRate() {}, setVolume() {}, setMuted() {},
        destroy() {},
        _set(s: number) { t = s; cb.onTime?.(s, duration); },
      };
      return e;
    },
  };
  return { factory, byId };
}

const MANIFEST: Manifest = {
  id: 'x', duration: 60,
  intro: { sources: [{ src: 'intro.mp4', type: 'video/mp4' }] },
  outro: { sources: [{ src: 'outro.mp4', type: 'video/mp4' }] },
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
};

const { intro: _, ...OUTRO_ONLY } = MANIFEST;

let host: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => { vi.useRealTimers(); });

const mount = (manifest: Manifest = MANIFEST) => {
  const { factory, byId } = fakeFactory();
  const p = new Player({ container: host, manifest, engines: [factory], lang: 'es' });
  attachControls(p);
  return { p, engine: (id: string) => byId.get(id) };
};

const skipButton = () => host.querySelector<HTMLButtonElement>('button.np__skip')!;
const announced = () => host.querySelector('[role="status"]')?.textContent ?? '';
const progressRow = () => host.querySelector<HTMLInputElement>('.np__range')!.parentElement!;
const timeText = () => host.querySelector('.np__time')?.textContent;

describe('chain · stage', () => {
  it('intro and outro go into the stage, after the streams', async () => {
    const { p } = mount();
    await p.play();
    const order = [...host.querySelector('.np__stage')!.children]
      .map((c) => (c as HTMLElement).dataset['stream'] ?? (c as HTMLElement).dataset['bumper']);
    expect(order).toEqual(['cam', 'intro', 'outro']);
  });

  it('only the piece named by data-phase is visible', async () => {
    injectStyles(document);
    const { p, engine } = mount();
    await p.play();
    const opacity = (id: string) =>
      getComputedStyle(host.querySelector<HTMLElement>(`[data-bumper="${id}"]`)!).opacity;
    expect(opacity('intro')).toBe('1');
    expect(opacity('outro')).toBe('0');

    engine('intro')._set(4.8);
    await vi.advanceTimersByTimeAsync(100);
    expect(opacity('intro')).toBe('0');
  });
});

describe('chain · skip intro', () => {
  it('hidden with the poster, shown during the intro', async () => {
    const { p } = mount();
    expect(skipButton().hidden).toBe(true);
    await p.play();
    expect(skipButton().hidden).toBe(false);
    expect(skipButton().textContent).toBe('Saltar cabecera');
  });

  it('comes before the bar in tab order', () => {
    mount();
    const bar = host.querySelector('.np__bar')!;
    expect(skipButton().compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clicking it skips, hides it and keeps focus in the player', async () => {
    const { p } = mount();
    await p.play();
    skipButton().focus();
    skipButton().click();
    await vi.advanceTimersByTimeAsync(20);
    expect(p.phase).toBe('main');
    expect(skipButton().hidden).toBe(true);
    expect(document.activeElement).toBe(host);
    expect(announced()).toBe('Cabecera saltada');
  });

  it('does not exist for the outro', async () => {
    const { p, engine } = mount(OUTRO_ONLY);
    await p.play();
    engine('cam')._set(59.8);
    await vi.advanceTimersByTimeAsync(100);
    expect(p.phase).toBe('outro');
    expect(skipButton().hidden).toBe(true);
  });
});

describe('chain · progress', () => {
  it('during the intro the bar hides and the time says what is left', async () => {
    const { p, engine } = mount();
    await p.play();
    expect(progressRow().hidden).toBe(true);
    engine('intro')._set(2);
    expect(timeText()).toBe('Cabecera · 0:03');
  });

  it('the bar comes back with the content', async () => {
    const { p, engine } = mount();
    await p.play();
    engine('intro')._set(4.8);
    await vi.advanceTimersByTimeAsync(100);
    expect(p.phase).toBe('main');
    expect(progressRow().hidden).toBe(false);
  });

  it('the outro is announced and its bar cannot be dragged', async () => {
    const { p, engine } = mount(OUTRO_ONLY);
    await p.play();
    engine('cam')._set(59.8);
    await vi.advanceTimersByTimeAsync(100);
    expect(announced()).toBe('Cierre');
    expect(progressRow().hidden).toBe(true);
    expect(timeText()).toMatch(/^Cierre/);
  });
});

describe('chain · keyboard', () => {
  const press = (key: string) =>
    host.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  it('during the intro seeking keys do not move the content blindly', async () => {
    const { p } = mount();
    await p.play();
    for (const k of ['ArrowRight', 'l', 'End', '5']) press(k);
    expect(p.phase).toBe('intro');
    expect(p.currentTime).toBe(0);
  });

  it('during the outro forward does nothing and backward returns to the content', async () => {
    const { p, engine } = mount(OUTRO_ONLY);
    await p.play();
    engine('cam')._set(59.8);
    await vi.advanceTimersByTimeAsync(100);
    press('ArrowRight');
    press('End');
    expect(p.phase).toBe('outro');
    press('ArrowLeft');
    expect(p.phase).toBe('main');
    expect(p.currentTime).toBe(55);
  });
});
