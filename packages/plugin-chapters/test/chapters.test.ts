// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { create, plugins, type Manifest, type Player } from '@nanoplayer/core';
import { attachControls, type ControlBar } from '@nanoplayer/ui';
import '../src/index.js';

const CHAPTERS = [
  { kind: 'chapter', start: 0, end: 12, title: 'Welcome' },
  { kind: 'chapter', start: 12, end: 28, title: 'The first law' },
  { kind: 'chapter', start: 28, title: 'Wrap-up' },
] as const;

const lesson = (over: Partial<Manifest> = {}): Manifest => ({
  id: 'lesson', duration: 40,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
  annotations: [...CHAPTERS],
  ...over,
});

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

async function mount(manifest: Manifest): Promise<{ p: Player; bar: ControlBar }> {
  const p = create(host, { manifest, lang: 'en', registry: false });
  const bar = attachControls(p);
  await p.resolve();
  // Plugin activation runs after `manifest:resolve:ok`.
  await new Promise((r) => setTimeout(r, 0));
  return { p, bar };
}

/** Seeks and notifies the bar, as an engine would. */
function goTo(p: Player, t: number): void {
  p.seek(t);
  p.bus.emit('time', { current: t, duration: p.duration });
}

const marks = () =>
  [...host.querySelectorAll<HTMLElement>('.np__mark')].map((m) => m.style.left);
const progress = () => host.querySelector<HTMLInputElement>('.np__range')!;
const segment = () => host.querySelector('.np__segment')?.textContent;

describe('chapters · progress bar', () => {
  it('activates only when the manifest has chapters', async () => {
    await mount(lesson());
    expect(plugins.active).toContain('chapters');
  });

  it('marks where each chapter starts, except the first', async () => {
    await mount(lesson());
    expect(marks()).toEqual(['30%', '70%']);
  });

  it('shows the current chapter and announces it with the position', async () => {
    const { p } = await mount(lesson());
    goTo(p, 20);
    expect(segment()).toBe('The first law');
    expect(progress().getAttribute('aria-valuetext')).toMatch(/, The first law$/);
    goTo(p, 30);
    expect(segment()).toBe('Wrap-up');
  });

  it('hovering shows the time and chapter at that point', async () => {
    await mount(lesson());
    const range = progress();
    range.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 6,
      right: 400, bottom: 6, x: 0, y: 0, toJSON() {} }) as DOMRect;
    range.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 }));
    const tip = host.querySelector<HTMLElement>('.np__tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe('0:20 · The first law');
    range.dispatchEvent(new PointerEvent('pointerleave'));
    expect(tip.hidden).toBe(true);
  });

  it('with a trim, marks are remapped to the visible time', async () => {
    // 10 to 30: 20 s visible, chapters start at 2 and 18.
    const { p } = await mount(lesson({
      annotations: [...CHAPTERS, { kind: 'trim', start: 10, end: 30 }],
    }));
    expect(marks()).toEqual(['10%', '90%']);
    goTo(p, 0);
    expect(segment()).toBe('Welcome');
  });
});

describe('chapters · settings menu', () => {
  const open = (bar: ControlBar) => {
    bar.settings.open();
    const entry = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((el) => el.textContent?.startsWith('Chapters'));
    entry?.click();
    return [...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  };

  it('lists the chapters and marks the current one', async () => {
    const { p, bar } = await mount(lesson());
    goTo(p, 20);
    const options = open(bar);
    // The ✓ is visual only; the state lives in aria-checked.
    expect(options.map((o) => o.textContent?.replace('✓', '').trim()))
      .toEqual(['Welcome', 'The first law', 'Wrap-up']);
    expect(options[1]!.getAttribute('aria-checked')).toBe('true');
  });

  it('choosing one jumps to its start', async () => {
    const { p, bar } = await mount(lesson());
    open(bar).find((o) => o.textContent?.trim() === 'Wrap-up')!.click();
    expect(p.currentTime).toBe(28);
  });

  it('with a trim, jumps to the visible time', async () => {
    const { p, bar } = await mount(lesson({
      annotations: [...CHAPTERS, { kind: 'trim', start: 10, end: 30 }],
    }));
    open(bar).find((o) => o.textContent?.trim() === 'The first law')!.click();
    expect(p.currentTime).toBe(2);
  });

  it('leaves out chapters the trim excludes entirely', async () => {
    const { bar } = await mount(lesson({
      annotations: [...CHAPTERS, { kind: 'trim', start: 14, end: 26 }],
    }));
    // A single visible chapter: nowhere to jump, so no panel.
    bar.settings.open();
    const entries = [...host.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent);
    expect(entries.some((e) => e?.startsWith('Chapters'))).toBe(false);
  });
});
