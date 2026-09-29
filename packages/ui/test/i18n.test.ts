// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Player, strings } from '@nanoplayer/core';
import type { Manifest } from '@nanoplayer/core';
import { attachControls } from '../src/control-bar.js';
import '../src/strings.js';

const MANIFEST: Manifest = {
  id: 'x',
  streams: [{
    id: 'a', role: 'presenter', audio: true,
    sources: [{ src: 'a.mp4', type: 'video/mp4' }],
  }],
};

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

const player = (options: Record<string, unknown> = {}) =>
  new Player({ container: host, manifest: MANIFEST, ...options });

/** Buttons' accessible names: what a screen reader announces. */
const labels = () => [...host.querySelectorAll('button')]
  .map((b) => b.getAttribute('aria-label'));

describe('UI language', () => {
  it('uses the document language when nothing is said', () => {
    document.documentElement.lang = 'en';
    attachControls(player());
    expect(labels()).toContain('Play');
  });

  it("the player's language wins over the document's", () => {
    document.documentElement.lang = 'en';
    attachControls(player({ lang: 'es' }));
    expect(labels()).toContain('Reproducir');
  });

  it('falls back to the base language for an unknown one instead of going blank', () => {
    attachControls(player({ lang: 'is' }));
    expect(labels()).toContain('Reproducir');
    expect(labels().every((e) => e && e.length > 0)).toBe(true);
  });
});

describe('custom strings', () => {
  it('adds a whole language without touching the code', () => {
    attachControls(player({
      lang: 'eu',
      strings: {
        eu: {
          'ui.play': 'Erreproduzitu',
          'ui.mute': 'Mututu',
          'ui.fullscreenEnter': 'Pantaila osoa',
        },
      },
    }));
    const l = labels();
    expect(l).toContain('Erreproduzitu');
    expect(l).toContain('Mututu');
    expect(l).toContain('Pantaila osoa');
  });

  it('what the new language does not cover keeps working', () => {
    // A half-done translation cannot leave buttons without an accessible name.
    attachControls(player({ lang: 'eu', strings: { eu: { 'ui.play': 'Erreproduzitu' } } }));
    expect(labels()).toContain('Erreproduzitu');
    expect(labels().every((e) => e && e.length > 0)).toBe(true);
  });

  it('changes a single word and leaves the rest', () => {
    attachControls(player({ strings: { es: { 'ui.play': 'Dale al play' } } }));
    const l = labels();
    expect(l).toContain('Dale al play');
    expect(l).toContain('Silenciar');
  });

  it('the bar can speak a different language than the player', () => {
    const p = player({ lang: 'es' });
    attachControls(p, { lang: 'en' });
    expect(labels()).toContain('Play');
    expect(p.lang).toBe('es');
  });
});

describe('the UI catalogue', () => {
  it('covers both built-in languages with the same keys', () => {
    const es = strings.translator('es');
    const en = strings.translator('en');
    for (const k of ['ui.play', 'ui.pause', 'ui.mute', 'ui.settings.label',
                     'ui.poster.play', 'ui.layout.pip', 'ui.live.badge']) {
      expect(es(k), `${k} missing in es`).not.toBe(k);
      expect(en(k), `${k} missing in en`).not.toBe(k);
    }
  });
});
