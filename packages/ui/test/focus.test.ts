// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Player, type Manifest } from '@nanoplayer/core';
import { attachControls } from '../src/control-bar.js';
import '../src/strings.js';

const MANIFEST: Manifest = {
  id: 'x',
  poster: 'p.jpg',
  streams: [{
    id: 'a', role: 'presenter', audio: true,
    sources: [{ src: 'a.mp4', type: 'video/mp4' }],
  }],
};

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

/** What Tab would walk through, in document order. */
const tabbable = () =>
  [...host.querySelectorAll<HTMLElement>('button, input, [tabindex]')]
    .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled)
    .map((el) => el.getAttribute('aria-label') ?? el.tagName.toLowerCase());

describe('tab order', () => {
  it('the poster button comes before the bar', () => {
    // It used to be last, reached at Tab 9 behind a bar that is not even visible.
    const p = new Player({ container: host, manifest: MANIFEST, lang: 'es' });
    attachControls(p);
    const order = tabbable();
    const poster = order.indexOf('Reproducir vídeo');
    const firstInBar = order.indexOf('Posición');
    expect(poster, 'the poster button is not in the order').toBeGreaterThanOrEqual(0);
    expect(poster).toBeLessThan(firstInBar);
  });

  it('the container is reachable and named', () => {
    // Safari's anchor with default settings (see docs/browser-quirks.md#webkit-tab).
    const p = new Player({ container: host, manifest: MANIFEST, lang: 'es' });
    attachControls(p, { label: 'A lecture' });
    expect(host.tabIndex).toBe(0);
    expect(host.getAttribute('role')).toBe('region');
    expect(host.getAttribute('aria-label')).toBe('A lecture');
  });

  it('everything tabbable has an accessible name', () => {
    const p = new Player({ container: host, manifest: MANIFEST, lang: 'es' });
    attachControls(p);
    const unnamed = [...host.querySelectorAll<HTMLElement>('button, input')]
      .filter((el) => !(el.getAttribute('aria-label') ?? '').trim());
    expect(unnamed.map((e) => e.outerHTML.slice(0, 60))).toEqual([]);
  });

  it('nothing inside the player skips the natural order', () => {
    // A positive tabindex reorders the whole host page, not just the player.
    const p = new Player({ container: host, manifest: MANIFEST, lang: 'es' });
    attachControls(p);
    const positive = [...host.querySelectorAll<HTMLElement>('[tabindex]')]
      .filter((el) => el.tabIndex > 0);
    expect(positive.map((e) => e.tagName)).toEqual([]);
  });
});
