// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { strings, type Player } from '@nanoplayer/core';
import { ProgressBar } from '../src/progress-bar.js';
import '../src/strings.js';

const t = strings.translator('en');

function bar(player: Partial<Player>) {
  const p = {
    duration: 600, currentTime: 0, phase: 'main', manifest: { id: 'x', streams: [] },
    toVisibleTime: (s: number) => s, toMediaTime: (s: number) => s, master: null,
    ...player,
  } as unknown as Player;
  const progress = new ProgressBar(document, p, t, () => {});
  document.body.appendChild(progress.row);
  const range = progress.row.querySelector<HTMLInputElement>('input')!;
  range.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 6 }) as DOMRect;
  const tip = progress.row.querySelector<HTMLElement>('.np__tip')!;
  const hover = (x: number) => range.dispatchEvent(new PointerEvent('pointermove', { clientX: x }));
  return { progress, tip, hover };
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('progress bar · time under the pointer', () => {
  it('shows without chapters too', () => {
    const { tip, hover } = bar({});
    hover(50);
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe('2:30');
    expect(tip.getAttribute('aria-hidden'), 'the slider already speaks the position').toBe('true');
  });

  it('adds the chapter when there are chapters', () => {
    const { progress, tip, hover } = bar({});
    progress.setMarkers('chapters', [{ start: 0, label: 'Welcome' }, { start: 300, label: 'Entropy' }]);
    hover(150);
    expect(tip.textContent).toBe('7:30 · Entropy');
  });

  it('live, says how far behind the edge that point is', () => {
    const { tip, hover } = bar({ manifest: { id: 'x', live: true, streams: [] }, dvrWindow: 120 } as never);
    hover(100);
    expect(tip.textContent).toBe('−1:00');
    hover(200);
    expect(tip.textContent).toBe('LIVE');
  });

  it('nothing while the duration is unknown, or live without a window to scrub', () => {
    const unknown = bar({ duration: 0 });
    unknown.hover(50);
    expect(unknown.tip.hidden).toBe(true);
    const live = bar({ manifest: { id: 'x', live: true, streams: [] }, dvrWindow: 0 } as never);
    live.hover(50);
    expect(live.tip.hidden).toBe(true);
  });
});

describe('progress bar · thumbnails', () => {
  it('draws the sprite region for the media time under the pointer', () => {
    const asked: number[] = [];
    const { progress, tip, hover } = bar({ toMediaTime: (s: number) => s + 12 } as never);
    progress.setPreview({
      id: 'thumbs',
      imageAt: (t) => { asked.push(t); return { url: 'sheet.jpg', x: 160, y: 90, width: 160, height: 90 }; },
    });
    hover(50);
    expect(asked, 'media time, past the trim').toEqual([162]);
    const thumb = tip.querySelector<HTMLElement>('.np__thumb')!;
    expect(thumb.style.backgroundImage).toContain('sheet.jpg');
    expect(thumb.style.backgroundPosition).toBe('-160px -90px');
    expect(thumb.style.width).toBe('160px');
    expect(tip.textContent).toBe('2:30');
  });

  it('without a picture yet, just the time', () => {
    const { progress, tip, hover } = bar({});
    progress.setPreview({ id: 'thumbs', imageAt: () => null });
    hover(50);
    expect(tip.querySelector('.np__thumb')).toBeNull();
    expect(tip.textContent).toBe('2:30');
  });
});

describe('progress bar · remaining time', () => {
  it('counts down to the end when asked', () => {
    const { progress } = bar({ currentTime: 150 });
    progress.render();
    expect(progress.time.textContent).toBe('2:30 / 10:00');
    progress.remaining = true;
    progress.render();
    expect(progress.time.textContent).toBe('−7:30 / 10:00');
  });
});
