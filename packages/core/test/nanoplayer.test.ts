// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EngineFactory } from '../src/engine.js';
import { create, NanoPlayer, VERSION, registry } from '../src/nanoplayer.js';
import { PlayerRegistry } from '../src/registry.js';

/**
 * Motor de mentira.
 *
 * Hace falta porque happy-dom devuelve cadena vacía en `canPlayType`, así que
 * el motor nativo responde —correctamente— que no puede reproducir nada.
 */
const motorFalso: EngineFactory = {
  name: 'falso',
  canPlay: () => 'probably',
  create: () => {
    let paused = true;
    return {
      name: 'falso',
      get element() { return { seeking: false } as HTMLVideoElement; },
      get attached() { return true; },
      async attach(c: HTMLElement) { c.appendChild(document.createElement('video')); },
      detach() {}, async play() { paused = false; }, pause() { paused = true; },
      seek() {},
      get currentTime() { return 0; }, get duration() { return 60; },
      get paused() { return paused; }, get ended() { return false; },
      get buffered() { return null; },
      getPlaybackRate: () => 1, setPlaybackRate() {}, setVolume() {}, setMuted() {},
      destroy() {},
    } as never;
  },
};

const MANIFIESTO = {
  id: 'x', duration: 60,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
};

beforeEach(() => {
  document.body.innerHTML = '<div id="p"></div><div id="q"></div>';
  for (const p of registry.players()) registry.unregister(p);
});

describe('NanoPlayer.create', () => {
  it('acepta un selector', () => {
    const p = create('#p', { manifest: MANIFIESTO as never, registry: false });
    expect(p.container.id).toBe('p');
  });

  it('acepta un elemento', () => {
    const el = document.getElementById('p')!;
    const p = create(el, { manifest: MANIFIESTO as never, registry: false });
    expect(p.container).toBe(el);
  });

  it('falla claro si el selector no encuentra nada', () => {
    expect(() => create('#no-existe', { manifest: MANIFIESTO as never }))
      .toThrow(/No se encontró/);
  });

  it('no descarga nada al crearse', () => {
    // Una página con 32 llamadas a create() hace cero peticiones.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (let i = 0; i < 32; i++) {
      const el = document.createElement('div');
      document.body.appendChild(el);
      create(el, { manifest: 'https://ejemplo/v.json', registry: false });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('entra solo en el registro compartido de la página', async () => {
    // Que la coordinación sea el comportamiento por defecto es la diferencia
    // entre esto y tener que envolver el reproductor en JavaScript propio.
    const a = create('#p', { manifest: MANIFIESTO as never, engines: [motorFalso] });
    const b = create('#q', { manifest: MANIFIESTO as never, engines: [motorFalso] });
    expect(registry.size).toBe(2);
    await a.play();
    await b.play();
    expect(a.state, 'la exclusividad funciona sin configurar nada').toBe('attached');
  });

  it('registry:false deja el reproductor aislado', () => {
    create('#p', { manifest: MANIFIESTO as never, registry: false });
    expect(registry.size).toBe(0);
  });

  it('admite un registro propio', () => {
    const mio = new PlayerRegistry();
    create('#p', { manifest: MANIFIESTO as never, registry: mio });
    expect(mio.size).toBe(1);
    expect(registry.size).toBe(0);
  });
});

describe('superficie pública', () => {
  it('expone lo necesario para el caso <script>', () => {
    for (const k of ['create', 'registry', 'plugins', 'Player', 'VERSION']) {
      expect(NanoPlayer, k).toHaveProperty(k);
    }
  });

  it('la versión coincide con la de package.json', () => {
    // Guardián de deriva: dos sitios con el mismo número siempre acaban
    // separándose si nadie los vigila.
    // Ruta desde la raíz del repositorio: en entorno happy-dom `import.meta.url`
    // es una URL http y `readFileSync` la rechaza.
    const pkg = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });
});
