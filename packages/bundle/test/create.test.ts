// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { plugins, type Manifest } from '@nanoplayer/core';
import { create, NanoPlayer } from '../src/index.js';

const MANIFEST: Manifest = {
  id: 'lecture-1',
  title: 'A lecture',
  streams: [{
    id: 'cam', role: 'presenter', audio: true,
    sources: [{ src: 'cam.mp4', type: 'video/mp4' }],
  }],
  textTracks: [{ src: 'es.vtt', lang: 'es', kind: 'subtitles' }],
};

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  host.id = 'player';
  document.body.appendChild(host);
});

describe('create, batteries included', () => {
  it('attaches the controls without being asked', () => {
    create('#player', { manifest: MANIFEST });
    expect(host.querySelector('.np__bar')).not.toBeNull();
    expect(host.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  it('every button has an accessible name', () => {
    create('#player', { manifest: MANIFEST });
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.every((b) => (b.getAttribute('aria-label') ?? '').length > 0)).toBe(true);
  });

  it('accepts an element as well as a selector', () => {
    create(host, { manifest: MANIFEST });
    expect(host.querySelector('.np__bar')).not.toBeNull();
  });

  it('`controls: false` leaves the player bare', () => {
    create('#player', { manifest: MANIFEST, controls: false });
    expect(host.querySelector('.np__bar')).toBeNull();
  });

  it('`controls` as an object configures the bar', () => {
    create('#player', { manifest: MANIFEST, controls: { lang: 'en' } });
    const labels = [...host.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Play');
  });

  it('the language is set once and the bar inherits it', () => {
    create('#player', { manifest: MANIFEST, lang: 'en' });
    const labels = [...host.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Play');
  });

  it('downloads nothing: the lazy lifecycle is intact', () => {
    const p = create('#player', { manifest: MANIFEST });
    expect(host.querySelectorAll('video').length).toBe(0);
    expect(p.state).toBe('idle');
  });

  it('ships the captions plugin already registered', () => {
    expect(plugins.has('captions')).toBe(true);
  });
});

describe('the <script> global', () => {
  it('has what is needed at the top level', () => {
    for (const k of ['create', 'attachControls', 'registry', 'plugins', 'VERSION']) {
      expect(NanoPlayer, `missing ${k}`).toHaveProperty(k);
    }
  });

  it('its create is the one with controls, not the headless core one', () => {
    NanoPlayer.create('#player', { manifest: MANIFEST });
    expect(host.querySelector('.np__bar')).not.toBeNull();
  });
});

describe('bundle surface', () => {
  it('re-exports every runtime export of the core', async () => {
    // The list is hand-written and once fell behind silently (firstFrame, the chain lead).
    const core = await import('@nanoplayer/core');
    const bundle = await import('../src/index.js');
    const missing = Object.keys(core).filter((k) => !(k in bundle));
    expect(missing).toEqual([]);
  });
});
