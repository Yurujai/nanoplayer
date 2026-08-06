// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineFactory } from '../src/engine.js';
import { Player } from '../src/player.js';
import { PlayerRegistry, createBatchResolver } from '../src/registry.js';

/** Motor de mentira que engancha al instante. */
const factoriaFalsa = (): EngineFactory => ({
  name: 'falso',
  canPlay: () => 'probably',
  create() {
    let paused = true, t = 0;
    return {
      name: 'falso',
      get element() { return { seeking: false } as HTMLVideoElement; },
      get attached() { return true; },
      async attach(c: HTMLElement) { c.appendChild(document.createElement('video')); },
      detach() {},
      async play() { paused = false; },
      pause() { paused = true; },
      seek(s: number) { t = s; },
      get currentTime() { return t; },
      get duration() { return 60; },
      get paused() { return paused; },
      get ended() { return false; },
      get buffered() { return null; },
      getPlaybackRate: () => 1,
      setPlaybackRate() {},
      setVolume() {},
      setMuted() {},
      destroy() {},
    } as never;
  },
});

const MANIFIESTO = {
  id: 'x', duration: 60,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
};

let reloj = 0;
const nuevoPlayer = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new Player({
    container, manifest: MANIFIESTO as never, engines: [factoriaFalsa()],
  });
};

beforeEach(() => {
  document.body.innerHTML = '';
  reloj = 0;
});

describe('reproducción exclusiva', () => {
  it('al reproducir uno se pausan los demás', async () => {
    const r = new PlayerRegistry({ now: () => reloj++ });
    const a = nuevoPlayer(), b = nuevoPlayer();
    r.register(a); r.register(b);

    await a.play();
    expect(a.state).toBe('active');

    await b.play();
    expect(b.state).toBe('active');
    expect(a.state, 'el primero debe haberse pausado').toBe('attached');
  });

  it('se puede desactivar', async () => {
    const r = new PlayerRegistry({ exclusive: false, now: () => reloj++ });
    const a = nuevoPlayer(), b = nuevoPlayer();
    r.register(a); r.register(b);
    await a.play();
    await b.play();
    expect(a.state).toBe('active');
    expect(b.state).toBe('active');
  });

  it('deja de aplicarse al darse de baja', async () => {
    const r = new PlayerRegistry({ now: () => reloj++ });
    const a = nuevoPlayer(), b = nuevoPlayer();
    const baja = r.register(a); r.register(b);
    await a.play();
    baja();
    await b.play();
    expect(a.state).toBe('active');
  });
});

describe('presupuesto de recursos', () => {
  it('suelta el motor del menos usado al pasarse', async () => {
    // S2 midió el techo del navegador en 17 elementos <video> en WebKit y 18
    // en Blink: sin presupuesto, una página con muchos reproductores lo agota.
    const r = new PlayerRegistry({ maxAttached: 2, now: () => reloj++ });
    const a = nuevoPlayer(), b = nuevoPlayer(), c = nuevoPlayer();
    r.register(a); r.register(b); r.register(c);

    await a.attach();
    await b.attach();
    expect(r.attachedCount).toBe(2);

    await c.attach();
    expect(r.attachedCount, 'debe volver al presupuesto').toBe(2);
    expect(a.state, 'el más antiguo pierde el motor').toBe('resolved');
    expect(c.state).toBe('attached');
  });

  it('el desalojado conserva su posición', async () => {
    const r = new PlayerRegistry({ maxAttached: 1, now: () => reloj++ });
    const a = nuevoPlayer(), b = nuevoPlayer();
    r.register(a); r.register(b);

    await a.attach();
    a.seek(25);
    await b.attach();

    expect(a.state).toBe('resolved');
    expect(a.resumeAt).toBe(25);
  });

  it('nunca desaloja al que acaba de engancharse', async () => {
    const r = new PlayerRegistry({ maxAttached: 1, now: () => reloj++ });
    const a = nuevoPlayer(), b = nuevoPlayer();
    r.register(a); r.register(b);
    await a.attach();
    await b.attach();
    expect(b.state).toBe('attached');
  });

  it('prefiere desalojar a los pausados antes que a los que reproducen', async () => {
    // Quitarle el motor a un vídeo en marcha es justo lo que no debe pasar.
    const r = new PlayerRegistry({ maxAttached: 2, exclusive: false, now: () => reloj++ });
    const reproduciendo = nuevoPlayer(), pausado = nuevoPlayer(), nuevo = nuevoPlayer();
    r.register(reproduciendo); r.register(pausado); r.register(nuevo);

    await reproduciendo.play();     // el más antiguo, pero está activo
    await pausado.attach();
    await nuevo.attach();

    expect(reproduciendo.state, 'sigue reproduciendo').toBe('active');
    expect(pausado.state, 'el pausado cede el motor').toBe('resolved');
  });

  it('sin presupuesto configurado no desaloja a nadie', async () => {
    const r = new PlayerRegistry({ now: () => reloj++ });
    const ps = [nuevoPlayer(), nuevoPlayer(), nuevoPlayer()];
    for (const p of ps) r.register(p);
    for (const p of ps) await p.attach();
    expect(r.attachedCount).toBe(3);
  });
});

describe('resolución por visibilidad', () => {
  it('solo resuelve lo que entra en pantalla', async () => {
    // Con 32 reproductores en una página, apenas unos pocos se ven.
    let callback: IntersectionObserverCallback | null = null;
    const observados: Element[] = [];
    const r = new PlayerRegistry({
      resolveWhenVisible: true,
      createObserver: (cb) => {
        callback = cb;
        return {
          observe: (el: Element) => observados.push(el),
          unobserve: () => {}, disconnect: () => {},
        } as unknown as IntersectionObserver;
      },
    });

    const a = nuevoPlayer(), b = nuevoPlayer();
    r.register(a); r.register(b);
    expect(observados).toHaveLength(2);
    expect(a.state).toBe('idle');

    callback!([{ target: a.container, isIntersecting: true } as never], null as never);
    await new Promise((res) => setTimeout(res, 0));

    expect(a.state, 'el visible resuelve').toBe('resolved');
    expect(b.state, 'el que sigue fuera no').toBe('idle');
  });

  it('sin IntersectionObserver el registro sigue funcionando', async () => {
    const r = new PlayerRegistry({
      resolveWhenVisible: true,
      createObserver: () => { throw new Error('no soportado'); },
      now: () => reloj++,
    });
    const a = nuevoPlayer(), b = nuevoPlayer();
    expect(() => { r.register(a); r.register(b); }).not.toThrow();
    await a.play(); await b.play();
    expect(a.state, 'la exclusividad sigue aplicándose').toBe('attached');
  });
});

describe('gestión del registro', () => {
  it('un reproductor destruido se da de baja solo', async () => {
    const r = new PlayerRegistry({ now: () => reloj++ });
    const a = nuevoPlayer();
    r.register(a);
    expect(r.size).toBe(1);
    a.destroy();
    expect(r.size).toBe(0);
  });

  it('registrar dos veces no duplica', () => {
    const r = new PlayerRegistry();
    const a = nuevoPlayer();
    r.register(a); r.register(a);
    expect(r.size).toBe(1);
  });

  it('pauseAll y detachAll actúan sobre todos', async () => {
    const r = new PlayerRegistry({ exclusive: false, now: () => reloj++ });
    const ps = [nuevoPlayer(), nuevoPlayer()];
    for (const p of ps) { r.register(p); await p.play(); }

    r.pauseAll();
    expect(ps.every((p) => p.state === 'attached')).toBe(true);

    r.detachAll();
    expect(ps.every((p) => p.state === 'resolved')).toBe(true);
  });
});

describe('createBatchResolver', () => {
  it('junta varias peticiones en una sola llamada', async () => {
    // El problema original: 32 reproductores generaban 32 peticiones.
    const fetchMany = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { id }])));
    const resolver = createBatchResolver(fetchMany, { windowMs: 5 });

    const r = await Promise.all(['a', 'b', 'c'].map((id) => resolver(id)));

    expect(fetchMany).toHaveBeenCalledTimes(1);
    expect(fetchMany).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(r).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  it('deduplica: dos reproductores del mismo vídeo comparten respuesta', async () => {
    const fetchMany = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { id }])));
    const resolver = createBatchResolver(fetchMany, { windowMs: 5 });

    const [x, y] = await Promise.all([resolver('a'), resolver('a')]);
    expect(fetchMany).toHaveBeenCalledWith(['a']);
    expect(x).toEqual(y);
  });

  it('vacía el lote al llegar al tope sin esperar la ventana', async () => {
    const fetchMany = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { id }])));
    const resolver = createBatchResolver(fetchMany, { windowMs: 10_000, maxBatch: 2 });

    const p = Promise.all([resolver('a'), resolver('b')]);
    await expect(p).resolves.toHaveLength(2);
    expect(fetchMany).toHaveBeenCalledTimes(1);
  });

  it('un fallo del lote rechaza a todos los que esperaban', async () => {
    const resolver = createBatchResolver(async () => { throw new Error('500'); },
      { windowMs: 5 });
    await expect(Promise.all([resolver('a'), resolver('b')])).rejects.toThrow('500');
  });

  it('si el lote no trae una clave, solo falla esa', async () => {
    const resolver = createBatchResolver(
      async () => ({ a: { id: 'a' } }), { windowMs: 5 });
    const [ra, rb] = await Promise.allSettled([resolver('a'), resolver('b')]);
    expect(ra.status).toBe('fulfilled');
    expect(rb.status).toBe('rejected');
  });

  it('lotes sucesivos son independientes', async () => {
    const fetchMany = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { id }])));
    const resolver = createBatchResolver(fetchMany, { windowMs: 5 });
    await resolver('a');
    await resolver('b');
    expect(fetchMany).toHaveBeenCalledTimes(2);
  });
});
