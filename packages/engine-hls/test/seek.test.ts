// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stream } from '@nanoplayer/core';

/**
 * hls.js de mentira: parsea la lista al cargarla y deja ver qué se le pide.
 * Lo que se prueba es la decisión del motor, no hls.js.
 */
const instancias: Array<{ startLoad: ReturnType<typeof vi.fn> }> = [];
vi.mock('hls.js', () => {
  class HlsFalso {
    static Events = { MANIFEST_PARSED: 'manifestParsed', ERROR: 'error' };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    static isSupported = () => true;
    #oyentes = new Map<string, Array<() => void>>();
    startLoad = vi.fn();
    constructor() { instancias.push(this); }
    on(ev: string, fn: () => void) { this.#oyentes.set(ev, [...(this.#oyentes.get(ev) ?? []), fn]); }
    off() {}
    attachMedia() {}
    loadSource() { queueMicrotask(() => this.#oyentes.get('manifestParsed')?.forEach((f) => f())); }
    destroy() {}
    recoverMediaError() {}
  }
  return { default: HlsFalso };
});

const { HlsEngine } = await import('../src/index.js');

const stream: Stream = {
  id: 'cam', role: 'presenter', audio: true,
  sources: [{ src: 'directo.m3u8', type: 'application/vnd.apple.mpegurl' }],
};

/** Hace que el elemento diga que tiene cargado el tramo [inicio, fin). */
function conCargado(el: HTMLVideoElement, inicio: number, fin: number): void {
  Object.defineProperty(el, 'buffered', {
    configurable: true,
    get: () => ({ length: 1, start: () => inicio, end: () => fin }),
  });
}

let container: HTMLElement;

beforeEach(() => {
  instancias.length = 0;
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  (globalThis as { MediaSource?: unknown }).MediaSource = function () {};
});

async function enganchado() {
  const e = new HlsEngine();
  await e.attach(container, stream);
  conCargado(e.element!, 36, 72);
  return { e, hls: instancias[0]! };
}

describe('HlsEngine · saltar', () => {
  it('fuera de lo cargado, le dice a hls.js que cargue desde ahí', async () => {
    /*
     * En WebKit hls.js no se entera de un salto largo: se queda en reposo
     * apuntando al final de lo que tenía y el vídeo, en `seeking` para
     * siempre. Medido en un directo al retroceder y al volver al borde.
     */
    const { e, hls } = await enganchado();
    e.seek(1439);
    expect(hls.startLoad).toHaveBeenCalledWith(1439);
  });

  it('dentro de lo cargado no lo toca: no hace falta descargar nada', async () => {
    const { e, hls } = await enganchado();
    e.seek(50);
    expect(hls.startLoad).not.toHaveBeenCalled();
  });
});
