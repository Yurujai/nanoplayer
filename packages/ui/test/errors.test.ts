// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Player, playerError, strings, type Manifest } from '@nanoplayer/core';
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

const mount = (options: Record<string, unknown> = {}) => {
  const p = new Player({ container: host, manifest: MANIFEST, ...options });
  attachControls(p);
  return p;
};

/** What a screen reader would announce. */
const announced = () => host.querySelector('[role="status"]')?.textContent ?? '';

describe('errors · what the viewer is told', () => {
  it('announces text chosen by the code, not the diagnostic message', () => {
    // The message is English detail for integrators; it used to be read aloud.
    const p = mount({ lang: 'es' });
    p.bus.emit('error', {
      error: playerError('media/network', 'HLS network error: fragLoadError 404'),
    });
    expect(announced()).toBe('Se ha perdido la conexión con el vídeo');
    expect(announced()).not.toContain('fragLoadError');
  });

  it('each code says something different', () => {
    const p = mount({ lang: 'es' });
    p.bus.emit('error', { error: playerError('engine/unsupported', 'No engine can play') });
    expect(announced()).toBe('Este navegador no puede reproducir este vídeo');
    p.bus.emit('error', { error: playerError('manifest/fetch', '404 requesting /x.json') });
    expect(announced()).toBe('No se ha podido cargar el vídeo');
  });

  it('is translated like everything else', () => {
    const p = mount({ lang: 'en' });
    p.bus.emit('error', { error: playerError('media/blocked', 'The browser blocked playback') });
    expect(announced()).toBe('Press play to start');
  });

  it('accepts custom strings', () => {
    const p = mount({
      lang: 'es',
      strings: { es: { 'ui.error.media/network': 'Revisa tu conexión' } },
    });
    p.bus.emit('error', { error: playerError('media/network', 'whatever') });
    expect(announced()).toBe('Revisa tu conexión');
  });

  it('a code without a key falls back to the generic text, never the key', () => {
    const p = mount({ lang: 'es' });
    p.bus.emit('error', {
      error: { code: 'something/new' as never, message: 'x', retryable: false },
    });
    expect(announced()).toBe('No se ha podido reproducir el vídeo');
  });

  it('there is text for all eight codes in both languages', () => {
    const codes = ['manifest/fetch', 'manifest/invalid', 'engine/unsupported',
      'engine/failed', 'media/decode', 'media/network', 'media/blocked', 'internal'];
    for (const lang of ['es', 'en']) {
      const t = strings.translator(lang);
      for (const c of codes) {
        const k = `ui.error.${c}`;
        expect(t(k), `${k} missing in ${lang}`).not.toBe(k);
      }
    }
  });
});

describe('errors · the diagnostics stay whole', () => {
  it('integrators get the technical message untouched', () => {
    const p = mount();
    const seen: string[] = [];
    p.on('error', ({ error }) => seen.push(error.message));
    p.bus.emit('error', {
      error: playerError('media/decode', 'HLS decoding error: bufferAppendError'),
    });
    expect(seen).toEqual(['HLS decoding error: bufferAppendError']);
  });
});
