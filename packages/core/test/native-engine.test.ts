// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confidenceFor, selectEngine, type EngineFactory } from '../src/engine.js';
import { NativeEngine, nativeEngineFactory } from '../src/native-engine.js';
import type { Stream } from '../src/manifest.js';

/**
 * Elemento `<video>` gobernable.
 *
 * happy-dom crea el elemento pero no reproduce nada: `readyState` se queda a 0
 * y `play()` no existe. Se le injertan las partes multimedia para poder simular
 * carga, fallos y stalls con precisión. La reproducción de verdad se comprueba
 * con Playwright, no aquí.
 */
function videoGobernable() {
  const el = document.createElement('video') as HTMLVideoElement;
  let readyState = 0;
  let networkState = 0;
  let paused = true;
  let error: MediaError | null = null;

  Object.defineProperties(el, {
    readyState: { get: () => readyState, configurable: true },
    networkState: { get: () => networkState, configurable: true },
    paused: { get: () => paused, configurable: true },
    error: { get: () => error, configurable: true },
    duration: { value: 120, configurable: true, writable: true },
  });

  el.load = vi.fn(() => { networkState = 1; });
  el.play = vi.fn(async () => {
    paused = false;
    el.dispatchEvent(new Event('play'));
  });
  el.pause = vi.fn(() => {
    paused = true;
    el.dispatchEvent(new Event('pause'));
  });

  return Object.assign(el, {
    /** Simula que el medio ya tiene datos utilizables. */
    simularCarga() {
      readyState = 2;
      el.dispatchEvent(new Event('loadeddata'));
    },
    /** Simula un fallo del medio con el código de `MediaError` indicado. */
    simularError(code: number, message = '') {
      error = { code, message } as MediaError;
      el.dispatchEvent(new Event('error'));
    },
    /** Simula que `play()` es rechazado por la política del navegador. */
    bloquearPlay(name = 'NotAllowedError') {
      el.play = vi.fn(async () => {
        const e = new Error('bloqueado');
        e.name = name;
        throw e;
      });
    },
  });
}

const stream = (over: Partial<Stream> = {}): Stream => ({
  id: 'cam', role: 'presenter', audio: true,
  sources: [{ src: 'cam.mp4', type: 'video/mp4' }],
  ...over,
});

let container: HTMLElement;
let video: ReturnType<typeof videoGobernable>;
let reloj: number;

const motor = () => new NativeEngine({
  now: () => reloj,
  createElement: () => video,
});

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  video = videoGobernable();
  reloj = 0;
});

describe('NativeEngine · attach', () => {
  it('mete el elemento en el contenedor con sus fuentes', async () => {
    const e = motor();
    const p = e.attach(container, stream({
      sources: [
        { src: 'a.m3u8', type: 'application/vnd.apple.mpegurl' },
        { src: 'a.mp4', type: 'video/mp4' },
      ],
    }));
    video.simularCarga();
    await p;

    expect(container.contains(video)).toBe(true);
    const fuentes = [...video.querySelectorAll('source')];
    expect(fuentes.map((s) => s.getAttribute('type')))
      .toEqual(['application/vnd.apple.mpegurl', 'video/mp4']);
  });

  it('marca playsinline, que es obligatorio en iPhone', async () => {
    const e = motor();
    const p = e.attach(container, stream());
    video.simularCarga();
    await p;
    // Propiedad y atributo: Safari antiguo solo mira el atributo.
    expect(video.playsInline).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
  });

  it('resuelve con loadeddata, sin esperar a canplay', async () => {
    const e = motor();
    let resuelto = false;
    const p = e.attach(container, stream()).then(() => { resuelto = true; });

    video.dispatchEvent(new Event('canplay'));
    await Promise.resolve();
    expect(resuelto, 'canplay no debe resolver por sí solo').toBe(false);

    video.simularCarga();
    await p;
    expect(resuelto).toBe(true);
  });

  it('continúa desde la posición recuperada de un desalojo', async () => {
    const e = motor();
    const p = e.attach(container, stream(), { startAt: 137.5 });
    video.simularCarga();
    await p;
    expect(video.currentTime).toBe(137.5);
  });

  it('rechaza con el error traducido si el medio falla al cargar', async () => {
    const e = motor();
    const onError = vi.fn();
    const p = e.attach(container, stream(), { callbacks: { onError } });
    video.simularError(4, 'formato no soportado');

    await expect(p).rejects.toMatchObject({ code: 'engine/unsupported' });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'engine/unsupported' }),
    );
  });

  it('no deja engancharse dos veces', async () => {
    const e = motor();
    const p = e.attach(container, stream());
    video.simularCarga();
    await p;
    await expect(e.attach(container, stream())).rejects.toThrow(/ya está enganchado/);
  });
});

describe('NativeEngine · detach', () => {
  const enganchado = async () => {
    const e = motor();
    const p = e.attach(container, stream());
    video.simularCarga();
    await p;
    return e;
  };

  it('suelta el recurso, no solo el nodo del DOM', async () => {
    // La lección cara de S2: quitar del DOM no libera el decodificador. Sin
    // vaciar la fuente y llamar a load(), una medición de 17 vídeos dio 2.
    const e = await enganchado();
    e.detach();

    expect(video.pause).toHaveBeenCalled();
    expect(video.hasAttribute('src')).toBe(false);
    expect(video.querySelectorAll('source')).toHaveLength(0);
    expect(video.load).toHaveBeenCalled();
    expect(container.contains(video)).toBe(false);
    expect(e.attached).toBe(false);
  });

  it('desata los oyentes: ya no llegan callbacks', async () => {
    const onPlay = vi.fn();
    const e = motor();
    const p = e.attach(container, stream(), { callbacks: { onPlay } });
    video.simularCarga();
    await p;

    e.detach();
    video.dispatchEvent(new Event('play'));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('es idempotente y no falla sin haber enganchado', () => {
    const e = motor();
    expect(() => { e.detach(); e.detach(); }).not.toThrow();
  });

  it('permite volver a engancharse después', async () => {
    const e = await enganchado();
    e.detach();
    video = videoGobernable();
    const p = e.attach(container, stream());
    video.simularCarga();
    await expect(p).resolves.toBeUndefined();
  });
});

describe('NativeEngine · reproducción', () => {
  const enganchado = async (cb = {}) => {
    const e = motor();
    const p = e.attach(container, stream(), { callbacks: cb });
    video.simularCarga();
    await p;
    return e;
  };

  it('distingue el bloqueo por autoplay de un fallo del medio', async () => {
    // La UI reacciona distinto: uno se arregla enseñando un botón de play.
    const e = await enganchado();
    video.bloquearPlay('NotAllowedError');
    await expect(e.play()).rejects.toMatchObject({
      code: 'media/blocked', retryable: false,
    });
  });

  it('trata cualquier otro rechazo como fallo de reproducción', async () => {
    const e = await enganchado();
    video.bloquearPlay('AbortError');
    await expect(e.play()).rejects.toMatchObject({ code: 'media/decode' });
  });

  it('propaga play y pause a los callbacks', async () => {
    const onPlay = vi.fn(), onPause = vi.fn();
    const e = await enganchado({ onPlay, onPause });
    await e.play();
    e.pause();
    expect(onPlay).toHaveBeenCalled();
    expect(onPause).toHaveBeenCalled();
  });

  it('ignora posiciones de seek absurdas en vez de propagarlas', async () => {
    const e = await enganchado();
    e.seek(50);
    e.seek(-1);
    e.seek(Number.NaN);
    expect(video.currentTime).toBe(50);
  });

  it('acota el volumen al rango válido', async () => {
    const e = await enganchado();
    e.setVolume(5);
    expect(video.volume).toBe(1);
    e.setVolume(-2);
    expect(video.volume).toBe(0);
  });

  it('rechaza velocidades imposibles', async () => {
    const e = await enganchado();
    e.setPlaybackRate(1.5);
    e.setPlaybackRate(0);
    e.setPlaybackRate(-1);
    e.setPlaybackRate(Number.NaN);
    expect(e.getPlaybackRate()).toBe(1.5);
  });

  it('expone duración 0 en vez de NaN o Infinity', async () => {
    const e = await enganchado();
    Object.defineProperty(video, 'duration', { value: Number.NaN, configurable: true });
    expect(e.duration).toBe(0);
    Object.defineProperty(video, 'duration', { value: Infinity, configurable: true });
    expect(e.duration).toBe(0);
  });
});

describe('NativeEngine · contabilidad de stalls', () => {
  const enganchado = async (cb: object) => {
    const e = motor();
    const p = e.attach(container, stream(), { callbacks: cb });
    video.simularCarga();
    await p;
    return e;
  };

  it('mide cuánto duró quedarse sin buffer', async () => {
    // Es la señal que permitirá saber si las excursiones de sincronización que
    // S2 midió en iPhone vienen de buffering o de otra cosa.
    const onStallStart = vi.fn(), onStallEnd = vi.fn();
    await enganchado({ onStallStart, onStallEnd });

    reloj = 1000;
    video.dispatchEvent(new Event('waiting'));
    reloj = 1350;
    video.dispatchEvent(new Event('playing'));

    expect(onStallStart).toHaveBeenCalledTimes(1);
    expect(onStallEnd).toHaveBeenCalledWith(350);
  });

  it('no cuenta dos veces un stall que sigue abierto', async () => {
    const onStallStart = vi.fn();
    await enganchado({ onStallStart });
    video.dispatchEvent(new Event('waiting'));
    video.dispatchEvent(new Event('waiting'));
    expect(onStallStart).toHaveBeenCalledTimes(1);
  });

  it('no inventa un fin de stall si no hubo stall', async () => {
    const onStallEnd = vi.fn();
    await enganchado({ onStallEnd });
    video.dispatchEvent(new Event('playing'));
    expect(onStallEnd).not.toHaveBeenCalled();
  });

  it('un detach a mitad de stall no deja el contador colgado', async () => {
    const onStallEnd = vi.fn();
    const e = await enganchado({ onStallEnd });
    video.dispatchEvent(new Event('waiting'));
    e.detach();
    video.dispatchEvent(new Event('playing'));
    expect(onStallEnd).not.toHaveBeenCalled();
  });
});

describe('NativeEngine · destroy', () => {
  it('suelta el recurso y deja el motor inservible', async () => {
    const e = motor();
    const p = e.attach(container, stream());
    video.simularCarga();
    await p;

    e.destroy();
    expect(e.attached).toBe(false);
    expect(container.contains(video)).toBe(false);
    await expect(e.attach(container, stream())).rejects.toThrow(/destruido/);
  });
});

describe('selección de motor', () => {
  it('traduce canPlayType para fuentes normales', () => {
    // happy-dom devuelve cadena vacía: para el motor eso es "no".
    expect(nativeEngineFactory.canPlay({ src: 'a.mp4', type: 'video/mp4' }))
      .toBe('no');
    expect(nativeEngineFactory.canPlay({ src: 'a.mp4', type: '' })).toBe('no');
  });

  it('con HLS NO se fía de canPlayType, que miente', () => {
    // Medido en S2: devolvió "maybe" en los cinco navegadores probados,
    // incluido Chrome de escritorio, que no reproduce HLS nativo.
    const hls = { src: 'a.m3u8', type: 'application/vnd.apple.mpegurl' };
    const g = globalThis as { MediaSource?: unknown };
    const previo = g.MediaSource;

    // Con MSE presente se rebaja, para que un motor con hls.js pueda ganar.
    g.MediaSource = function () {};
    expect(nativeEngineFactory.canPlay(hls)).toBe('maybe');

    // Sin MSE (el caso de iOS) el soporte nativo es la única vía posible.
    delete g.MediaSource;
    expect(nativeEngineFactory.canPlay(hls)).toBe('probably');

    if (previo !== undefined) g.MediaSource = previo;
  });

  it('reconoce las variantes del tipo MIME de HLS, con parámetros incluidos', () => {
    const g = globalThis as { MediaSource?: unknown };
    const previo = g.MediaSource;
    delete g.MediaSource;
    for (const type of [
      'application/x-mpegURL',
      'APPLICATION/VND.APPLE.MPEGURL',
      'application/vnd.apple.mpegurl; charset=utf-8',
    ]) {
      expect(nativeEngineFactory.canPlay({ src: 'a.m3u8', type }), type).toBe('probably');
    }
    if (previo !== undefined) g.MediaSource = previo;
  });

  it('la confianza de un stream es la mejor de sus fuentes', () => {
    const fake: EngineFactory = {
      name: 'fake',
      canPlay: (s) => (s.type === 'video/mp4' ? 'probably' : 'no'),
      create: () => { throw new Error('no usado'); },
    };
    expect(confidenceFor(fake, stream({
      sources: [{ src: 'a.webm', type: 'video/webm' }, { src: 'a.mp4', type: 'video/mp4' }],
    }))).toBe('probably');
  });

  it('gana el más confiado, y a empate el registrado antes', () => {
    const mk = (name: string, c: 'probably' | 'maybe' | 'no'): EngineFactory => ({
      name, canPlay: () => c, create: () => { throw new Error('no usado'); },
    });
    const s = stream();
    expect(selectEngine([mk('a', 'maybe'), mk('b', 'probably')], s)?.name).toBe('b');
    expect(selectEngine([mk('a', 'maybe'), mk('b', 'maybe')], s)?.name).toBe('a');
    expect(selectEngine([mk('a', 'no')], s)).toBeNull();
    expect(selectEngine([], s)).toBeNull();
  });
});
