// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineFactory, MediaEngine } from '../src/engine.js';
import { Player } from '../src/player.js';

/** Motor de mentira: engancha al instante y deja inspeccionar lo que le piden. */
function factoriaFalsa() {
  const creados: Array<MediaEngine & Record<string, any>> = [];
  const factory: EngineFactory = {
    name: 'falso',
    canPlay: () => 'probably',
    create() {
      let currentTime = 0, rate = 1, paused = true, muted = false, volume = 1;
      let attached = false;
      let cb: any = {};
      const e = {
        name: 'falso',
        get element() { return { seeking: false } as HTMLVideoElement; },
        get attached() { return attached; },
        async attach(container: HTMLElement, _s: unknown, o: any) {
          attached = true;
          cb = o?.callbacks ?? {};
          muted = !!o?.muted;
          if (o?.startAt) currentTime = o.startAt;
          container.appendChild(document.createElement('video'));
        },
        detach() { attached = false; },
        // Un motor de verdad avisa por callback, y el Player se apoya en eso
        // para saber si de verdad está sonando. Sin esto el falso miente.
        async play() { paused = false; cb.onPlay?.(); },
        pause() { paused = true; cb.onPause?.(); },
        seek(s: number) { currentTime = s; },
        get currentTime() { return currentTime; },
        get duration() { return 60; },
        get paused() { return paused; },
        get ended() { return false; },
        get buffered() { return null; },
        getPlaybackRate: () => rate,
        setPlaybackRate(r: number) { rate = r; },
        setVolume(v: number) { volume = v; },
        setMuted(m: boolean) { muted = m; },
        destroy() { attached = false; },
        // Ayudas de prueba
        _cb: () => cb,
        _muted: () => muted,
        _volume: () => volume,
        _set(t: number) { currentTime = t; },
      };
      creados.push(e as never);
      return e as never;
    },
  };
  return { factory, creados };
}

const MONO = {
  id: 'm', duration: 60,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
};
const DUAL = {
  id: 'd', duration: 60,
  streams: [
    { id: 'cam', role: 'presenter', audio: true,
      sources: [{ src: 'a.mp4', type: 'video/mp4' }] },
    { id: 'slides', role: 'presentation', audio: false,
      sources: [{ src: 'b.mp4', type: 'video/mp4' }] },
  ],
};

let container: HTMLElement;

const nuevo = (manifest: unknown, extra: Record<string, unknown> = {}) => {
  const { factory, creados } = factoriaFalsa();
  const p = new Player({
    container, manifest: manifest as never, engines: [factory], ...extra,
  });
  return { p, creados };
};

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('Player · cero red hasta que se pide', () => {
  it('construirlo no resuelve ni descarga nada', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { p } = nuevo('https://ejemplo/manifiesto.json');
    expect(p.state).toBe('idle');
    expect(p.manifest).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.children).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('resolver no crea ningún elemento multimedia', async () => {
    const { p } = nuevo(MONO);
    await p.resolve();
    expect(p.state).toBe('resolved');
    expect(container.querySelectorAll('video')).toHaveLength(0);
  });

  it('los elementos aparecen solo al enganchar', async () => {
    const { p } = nuevo(DUAL);
    await p.attach();
    expect(p.state).toBe('attached');
    expect(container.querySelectorAll('video')).toHaveLength(2);
  });
});

describe('Player · manifiesto', () => {
  it('usa el resolutor inyectado en vez de fetch', async () => {
    // Es el punto de extensión que permite agrupar 32 peticiones en una.
    const manifestResolver = vi.fn(async () => MONO);
    const { p } = nuevo('cualquier/cosa.json', { manifestResolver });
    await p.resolve();
    expect(manifestResolver).toHaveBeenCalledWith('cualquier/cosa.json');
    expect(p.manifest?.id).toBe('m');
  });

  it('un manifiesto inválido deja el reproductor en idle', async () => {
    const roto = { id: 'x', streams: [
      { id: 'a', role: 'presenter', audio: true, sources: [{ src: 'a', type: 'video/mp4' }] },
      { id: 'b', role: 'presentation', audio: true, sources: [{ src: 'b', type: 'video/mp4' }] },
    ] };
    const { p } = nuevo(roto);
    await expect(p.resolve()).rejects.toMatchObject({ code: 'manifest/invalid' });
    expect(p.state).toBe('idle');
  });

  it('el error de validación llega por el bus con el motivo', async () => {
    const { p } = nuevo({ id: 'x' });
    const visto: string[] = [];
    p.on('manifest:resolve:fail', ({ error }) => visto.push(error.message));
    await p.resolve().catch(() => {});
    expect(visto[0]).toMatch(/streams/);
  });

  it('resolver dos veces no repite la petición', async () => {
    const manifestResolver = vi.fn(async () => MONO);
    const { p } = nuevo('x.json', { manifestResolver });
    await p.resolve();
    await p.resolve();
    expect(manifestResolver).toHaveBeenCalledTimes(1);
  });
});

describe('Player · audio y maestro', () => {
  it('solo suena el stream con audio', async () => {
    const { p, creados } = nuevo(DUAL);
    await p.attach();
    expect(creados[0]!._muted()).toBe(false);   // cam, lleva audio
    expect(creados[1]!._muted()).toBe(true);    // slides
  });

  it('el maestro es el que lleva el audio', async () => {
    const { p, creados } = nuevo(DUAL);
    await p.attach();
    expect(p.master).toBe(creados[0]);
  });

  it('la velocidad se aplica al maestro, no a los esclavos', async () => {
    // Los esclavos la heredan por el lazo de sincronización, que ajusta su
    // velocidad relativa a la del maestro.
    const { p, creados } = nuevo(DUAL);
    await p.attach();
    p.setPlaybackRate(1.5);
    expect(creados[0]!.getPlaybackRate()).toBe(1.5);
  });
});

describe('Player · desalojo', () => {
  it('suelta los motores y conserva la posición', async () => {
    const { p, creados } = nuevo(DUAL);
    await p.play();
    creados[0]!._set(42);

    p.detach();
    expect(p.state).toBe('resolved');
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(p.resumeAt).toBe(42);
  });

  it('al volver a enganchar retoma donde estaba', async () => {
    const { p, creados } = nuevo(DUAL);
    await p.attach();
    creados[0]!._set(42);
    p.detach();
    await p.attach();
    expect(p.currentTime).toBe(42);
  });

  it('emite engine:detach con la posición', async () => {
    const { p, creados } = nuevo(MONO);
    await p.attach();
    creados[0]!._set(17);
    const fn = vi.fn();
    p.on('engine:detach', fn);
    p.detach();
    expect(fn).toHaveBeenCalledWith({ at: 17 });
  });

  it('desaloja aunque el aviso de pausa llegue tarde', async () => {
    // Con un motor cuyo `pause` es asíncrono —hls.js lo es— el estado seguía
    // en `active` al intentar soltar, y la transición prohibida lanzaba.
    const { factory, creados } = factoriaFalsa();
    const p = new Player({ container, manifest: DUAL as never, engines: [factory] });
    await p.play();
    expect(p.state).toBe('active');

    // El falso deja de avisar: simula el aviso que aún no ha llegado.
    for (const e of creados) e._cb().onPause = undefined;

    expect(() => p.detach()).not.toThrow();
    expect(p.state).toBe('resolved');
  });

  it('desalojar sin motor enganchado no hace nada', async () => {
    const { p } = nuevo(MONO);
    await p.resolve();
    expect(() => p.detach()).not.toThrow();
    expect(p.state).toBe('resolved');
  });
});

describe('Player · stalls', () => {
  it('al recuperarse vuelven a arrancar', async () => {
    const { p, creados } = nuevo(DUAL);
    await p.play();
    creados[1]!._cb().onStallStart();
    creados[1]!._cb().onStallEnd(250);
    await Promise.resolve();
    expect(creados.every((e) => !e.paused)).toBe(true);
  });
});

describe('Player · el arranque no se aborta a sí mismo', () => {
  it('un stall durante el arranque no pausa nada', async () => {
    // Fallo real: el `waiting` inicial es normal —el navegador llena el
    // buffer— y pausar ahí abortaba el play() recién iniciado con un
    // AbortError. El vídeo no arrancaba y el botón se quedaba en "Reproducir".
    const { p, creados } = nuevo(DUAL);
    await p.attach();
    expect(p.state).toBe('attached');

    creados[1]!._cb().onStallStart();
    expect(creados.every((e) => e.paused), 'nadie debe pausarse aún').toBe(true);

    await p.play();
    expect(p.state).toBe('active');
    expect(creados.every((e) => !e.paused)).toBe(true);
  });

  it('ya reproduciendo, un stall sí pausa a todos', async () => {
    // La política de S1 sigue vigente donde tiene sentido: con la reproducción
    // en marcha, dejar correr al maestro dispara la deriva.
    const { p, creados } = nuevo(DUAL);
    await p.play();
    creados[1]!._cb().onStallStart();
    expect(creados.every((e) => e.paused)).toBe(true);
  });

  it('no resucita un vídeo que el usuario había pausado', async () => {
    const { p, creados } = nuevo(DUAL);
    await p.play();
    p.pause();
    creados[1]!._cb().onStallEnd(300);
    expect(creados.every((e) => e.paused), 'debe seguir pausado').toBe(true);
  });
});

describe('Player · el estado sale del medio, no de la intención', () => {
  it('si el elemento arranca por su cuenta, el estado lo refleja', async () => {
    // Sin esto la interfaz muestra lo que el Player creía que iba a pasar: el
    // botón decía "Reproducir" con el vídeo sonando.
    const { p, creados } = nuevo(MONO);
    await p.attach();
    creados[0]!._cb().onPlay();
    expect(p.state).toBe('active');
  });

  it('si el navegador lo pausa por su cuenta, el estado lo refleja', async () => {
    const { p, creados } = nuevo(MONO);
    await p.play();
    expect(p.state).toBe('active');
    creados[0]!._cb().onPause();
    expect(p.state).toBe('attached');
  });

  it('emite play y pause una sola vez', async () => {
    const { p } = nuevo(MONO);
    const onPlay = vi.fn(), onPause = vi.fn();
    p.on('play', onPlay); p.on('pause', onPause);
    await p.play();
    p.pause();
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});

describe('Player · destrucción', () => {
  it('suelta todo y deja de emitir', async () => {
    const { p } = nuevo(DUAL);
    await p.attach();
    const fn = vi.fn();
    p.on('play', fn);
    p.destroy();
    expect(p.state).toBe('destroyed');
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('destruir dos veces no falla', async () => {
    const { p } = nuevo(MONO);
    await p.attach();
    expect(() => { p.destroy(); p.destroy(); }).not.toThrow();
  });
});

describe('Player · sin motor capaz', () => {
  it('falla con engine/unsupported y vuelve a resolved', async () => {
    const inutil: EngineFactory = {
      name: 'inutil', canPlay: () => 'no',
      create: () => { throw new Error('no usado'); },
    };
    const p = new Player({ container, manifest: MONO as never, engines: [inutil] });
    await expect(p.attach()).rejects.toMatchObject({ code: 'engine/unsupported' });
    expect(p.state).toBe('resolved');
    expect(container.children).toHaveLength(0);
  });
});
