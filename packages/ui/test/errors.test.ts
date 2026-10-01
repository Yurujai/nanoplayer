// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('errors · on screen', () => {
  const panel = () => host.querySelector<HTMLElement>('.np__error')!;
  const retry = () => host.querySelector<HTMLButtonElement>('.np__error-retry')!;

  it('shows the same text the screen reader hears', () => {
    const p = mount({ lang: 'es' });
    expect(panel().hidden).toBe(true);
    p.bus.emit('error', { error: playerError('media/decode', 'bufferAppendError') });
    expect(panel().hidden).toBe(false);
    expect(panel().textContent).toContain('No se ha podido reproducir el vídeo');
    expect(panel().getAttribute('role'), 'announced once, by the live region').toBeNull();
  });

  it('offers a retry only when retrying can help', () => {
    const p = mount();
    p.bus.emit('error', { error: playerError('media/decode', 'x') });
    expect(retry().hidden).toBe(true);
    p.bus.emit('error', { error: playerError('media/network', 'x') });
    expect(retry().hidden).toBe(false);
  });

  it('retrying releases a broken engine and plays again', () => {
    const p = mount();
    vi.spyOn(p, 'state', 'get').mockReturnValue('active');
    const detach = vi.spyOn(p, 'detach').mockImplementation(() => {});
    const play = vi.spyOn(p, 'play').mockResolvedValue();
    p.bus.emit('error', { error: playerError('media/network', 'x') });
    retry().focus();
    retry().click();
    expect(detach).toHaveBeenCalled();
    expect(play).toHaveBeenCalled();
    expect(panel().hidden).toBe(true);
    expect(document.activeElement, 'focus stays in the player').toBe(host);
  });

  it('goes away once playback starts', () => {
    const p = mount();
    p.bus.emit('error', { error: playerError('media/network', 'x') });
    p.bus.emit('play', { at: 0 });
    expect(panel().hidden).toBe(true);
  });

  it('stays out of the way of blocked autoplay, which only needs play', () => {
    const p = mount();
    p.bus.emit('error', { error: playerError('media/blocked', 'x') });
    expect(panel().hidden).toBe(true);
  });

  it('leaves live drops to the interrupted notice, which retries by itself', async () => {
    const p = mount({ manifest: { ...MANIFEST, live: true } });
    await p.resolve();
    p.bus.emit('error', { error: playerError('media/network', 'x') });
    expect(panel().hidden).toBe(true);
  });
});

describe('loading indicator', () => {
  const spinner = () => host.querySelector<HTMLElement>('.np__loading')!;
  const playing = () => {
    const p = mount();
    vi.spyOn(p, 'state', 'get').mockReturnValue('active');
    return p;
  };

  it('shows while a stream has no data, and is hidden from screen readers', () => {
    const p = playing();
    expect(spinner().hidden).toBe(true);
    p.bus.emit('stall:start', { stream: 'a' });
    expect(spinner().hidden).toBe(false);
    expect(spinner().getAttribute('aria-hidden')).toBe('true');
    p.bus.emit('stall:end', { stream: 'a', durationMs: 300 });
    expect(spinner().hidden).toBe(true);
  });

  it('waits for every stalled stream', () => {
    const p = playing();
    p.bus.emit('stall:start', { stream: 'a' });
    p.bus.emit('stall:start', { stream: 'b' });
    p.bus.emit('stall:end', { stream: 'a', durationMs: 300 });
    expect(spinner().hidden).toBe(false);
  });

  it('does not outlive the engine, which never reports the end of its stall', () => {
    const p = playing();
    p.bus.emit('stall:start', { stream: 'a' });
    p.bus.emit('engine:detach', { at: 3 });
    expect(spinner().hidden).toBe(true);
  });

  it('gives way to an error', () => {
    const p = playing();
    p.bus.emit('stall:start', { stream: 'a' });
    p.bus.emit('error', { error: playerError('media/network', 'x') });
    expect(spinner().hidden).toBe(true);
  });
});
