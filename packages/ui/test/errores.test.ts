// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Player, playerError, strings, type Manifest } from '@nanoplayer/core';
import { attachControls } from '../src/control-bar.js';
import '../src/strings.js';

const MANIFIESTO: Manifest = {
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

const montar = (opciones: Record<string, unknown> = {}) => {
  const p = new Player({ container: host, manifest: MANIFIESTO, ...opciones });
  attachControls(p);
  return p;
};

/** Lo que anunciaría un lector de pantalla. */
const anuncio = () => host.querySelector('[role="status"]')?.textContent ?? '';

describe('errores · lo que se le dice a quien mira', () => {
  it('anuncia un texto propio del código, no el diagnóstico', () => {
    /*
     * El mensaje del error es para quien integra: lleva detalles técnicos y va
     * en inglés. Anunciarlo tal cual le leía a un usuario con lector de
     * pantalla cosas como «hls.js cannot run in this browser».
     */
    const p = montar({ lang: 'es' });
    p.bus.emit('error', {
      error: playerError('media/network', 'HLS network error: fragLoadError 404'),
    });
    expect(anuncio()).toBe('Se ha perdido la conexión con el vídeo');
    expect(anuncio()).not.toContain('fragLoadError');
  });

  it('cada código dice algo distinto', () => {
    const p = montar({ lang: 'es' });
    p.bus.emit('error', { error: playerError('engine/unsupported', 'No engine can play') });
    expect(anuncio()).toBe('Este navegador no puede reproducir este vídeo');
    p.bus.emit('error', { error: playerError('manifest/fetch', '404 requesting /x.json') });
    expect(anuncio()).toBe('No se ha podido cargar el vídeo');
  });

  it('se traduce como todo lo demás', () => {
    const p = montar({ lang: 'en' });
    p.bus.emit('error', { error: playerError('media/blocked', 'The browser blocked playback') });
    expect(anuncio()).toBe('Press play to start');
  });

  it('acepta cadenas propias', () => {
    const p = montar({
      lang: 'es',
      strings: { es: { 'ui.error.media/network': 'Revisa tu conexión' } },
    });
    p.bus.emit('error', { error: playerError('media/network', 'whatever') });
    expect(anuncio()).toBe('Revisa tu conexión');
  });

  it('un código sin clave cae al genérico, no enseña la clave', () => {
    // Si mañana se añade un código y nadie escribe su texto, el usuario no
    // puede acabar oyendo «ui.error.algo/nuevo».
    const p = montar({ lang: 'es' });
    p.bus.emit('error', {
      error: { code: 'algo/nuevo' as never, message: 'x', retryable: false },
    });
    expect(anuncio()).toBe('No se ha podido reproducir el vídeo');
  });

  it('hay texto para los ocho códigos, en los dos idiomas', () => {
    const codigos = ['manifest/fetch', 'manifest/invalid', 'engine/unsupported',
      'engine/failed', 'media/decode', 'media/network', 'media/blocked', 'internal'];
    for (const lang of ['es', 'en']) {
      const t = strings.translator(lang);
      for (const c of codigos) {
        const k = `ui.error.${c}`;
        expect(t(k), `falta ${k} en ${lang}`).not.toBe(k);
      }
    }
  });
});

describe('errores · el diagnóstico sigue entero', () => {
  it('quien integra recibe el mensaje técnico sin tocar', () => {
    // Traducir para el usuario no puede costarle el detalle a quien depura.
    const p = montar();
    const visto: string[] = [];
    p.on('error', ({ error }) => visto.push(error.message));
    p.bus.emit('error', {
      error: playerError('media/decode', 'HLS decoding error: bufferAppendError'),
    });
    expect(visto).toEqual(['HLS decoding error: bufferAppendError']);
  });
});
