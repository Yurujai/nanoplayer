// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineFactory, MediaEngine } from '../src/engine.js';
import { Player } from '../src/player.js';

/** Motor de mentira, con control manual del tiempo del medio. */
function factoriaFalsa() {
  const creados: Array<MediaEngine & Record<string, any>> = [];
  const factory: EngineFactory = {
    name: 'falso',
    canPlay: () => 'probably',
    create() {
      let currentTime = 0, rate = 1, paused = true;
      let cb: any = {};
      const e = {
        name: 'falso',
        get element() { return { seeking: false } as HTMLVideoElement; },
        get attached() { return true; },
        async attach(container: HTMLElement, _s: unknown, o: any) {
          cb = o?.callbacks ?? {};
          if (o?.startAt) currentTime = o.startAt;
          container.appendChild(document.createElement('video'));
        },
        detach() {},
        async play() { paused = false; cb.onPlay?.(); cb.onPlaying?.(); },
        pause() { paused = true; cb.onPause?.(); },
        seek(s: number) { currentTime = s; cb.onSeeked?.(s); },
        get currentTime() { return currentTime; },
        get duration() { return 600; },
        get paused() { return paused; },
        get ended() { return false; },
        get buffered() { return null; },
        get seekable() { return null; },
        getPlaybackRate: () => rate,
        setPlaybackRate(r: number) { rate = r; },
        setVolume() {}, setMuted() {},
        destroy() {},
        /** Mueve el medio y dispara el `time`, como haría un <video> de verdad. */
        _avanzar(t: number) { currentTime = t; cb.onTime?.(t, 600); },
        _arranqueEn: () => currentTime,
      };
      creados.push(e as never);
      return e as never;
    },
  };
  return { factory, creados };
}

/** Un medio de 600 s del que solo interesan los segundos 100 a 160. */
const RECORTADO = {
  id: 'r', duration: 600,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
  annotations: [{ kind: 'trim', start: 100, end: 160 }],
};

const SIN_RECORTE = {
  id: 's', duration: 600,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
};

let container: HTMLElement;

const nuevo = (manifest: unknown) => {
  const { factory, creados } = factoriaFalsa();
  const p = new Player({ container, manifest: manifest as never, engines: [factory] });
  return { p, creados };
};

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('recorte · el timeline que se enseña', () => {
  it('la duración es la del recorte, no la del medio', async () => {
    const { p } = nuevo(RECORTADO);
    await p.attach();
    expect(p.duration).toBe(60);
  });

  it('sin recorte no cambia nada', async () => {
    const { p } = nuevo(SIN_RECORTE);
    await p.attach();
    expect(p.duration).toBe(600);
    expect(p.trim).toBeNull();
  });

  it('la reproducción empieza en el inicio del recorte', async () => {
    // El motor arranca en el segundo 100 del fichero, y para fuera eso es 0.
    const { p, creados } = nuevo(RECORTADO);
    await p.attach();
    expect(creados[0]!._arranqueEn()).toBe(100);
    expect(p.currentTime).toBe(0);
  });

  it('el tiempo se cuenta desde el recorte', async () => {
    const { p, creados } = nuevo(RECORTADO);
    await p.attach();
    creados[0]!._avanzar(130);
    expect(p.currentTime).toBe(30);
  });

  it('saltar traduce al tiempo del medio', async () => {
    const { p, creados } = nuevo(RECORTADO);
    await p.attach();
    p.seek(20);
    expect(creados[0]!.currentTime).toBe(120);
    expect(p.currentTime).toBe(20);
  });

  it('no se puede saltar fuera del recorte', async () => {
    // Ni antes del principio ni después del final: el material está ahí, pero
    // para quien mira no existe.
    const { p, creados } = nuevo(RECORTADO);
    await p.attach();
    p.seek(-30);
    expect(creados[0]!.currentTime).toBe(100);
    p.seek(9999);
    expect(creados[0]!.currentTime).toBe(160);
  });

  it('expone el recorte para quien pinte sobre el timeline', async () => {
    const { p } = nuevo(RECORTADO);
    await p.attach();
    expect(p.trim).toEqual({ start: 100, end: 160 });
  });
});

describe('recorte · el final lo hace cumplir el reproductor', () => {
  it('para y avisa al llegar al final del recorte', async () => {
    // El fichero sigue teniendo 440 s por detrás y el motor no sabe que sobran.
    const { p, creados } = nuevo(RECORTADO);
    await p.attach();
    const terminado = vi.fn();
    p.on('ended', terminado);
    await p.play();

    creados[0]!._avanzar(159);
    expect(terminado).not.toHaveBeenCalled();
    expect(p.paused).toBe(false);

    creados[0]!._avanzar(160);
    expect(terminado).toHaveBeenCalledOnce();
    expect(terminado).toHaveBeenCalledWith({ at: 60 });
    expect(p.paused).toBe(true);
  });

  it('no repite el aviso en cada tic', async () => {
    const { p, creados } = nuevo(RECORTADO);
    await p.attach();
    const terminado = vi.fn();
    p.on('ended', terminado);
    await p.play();
    creados[0]!._avanzar(160);
    creados[0]!._avanzar(161);
    creados[0]!._avanzar(200);
    expect(terminado).toHaveBeenCalledOnce();
  });

  it('el último `time` cuadra con la duración', async () => {
    // Si el final dejara el tiempo en 59,8 la barra se quedaría sin llegar.
    const { p, creados } = nuevo(RECORTADO);
    await p.attach();
    const tiempos: number[] = [];
    p.on('time', ({ current }) => tiempos.push(current));
    await p.play();
    creados[0]!._avanzar(160);
    expect(tiempos.at(-1)).toBe(60);
  });

  it('volver atrás rearma el final', async () => {
    const { p, creados } = nuevo(RECORTADO);
    await p.attach();
    const terminado = vi.fn();
    p.on('ended', terminado);
    await p.play();
    creados[0]!._avanzar(160);
    p.seek(10);
    creados[0]!._avanzar(160);
    expect(terminado).toHaveBeenCalledTimes(2);
  });

  it('dar al play una vez terminado vuelve al principio', async () => {
    const { p, creados } = nuevo(RECORTADO);
    await p.attach();
    await p.play();
    creados[0]!._avanzar(160);
    await p.play();
    expect(creados[0]!.currentTime).toBe(100);
    expect(p.currentTime).toBe(0);
  });
});

describe('recorte · desalojo', () => {
  it('soltar y volver a enganchar conserva la posición visible', async () => {
    /*
     * `resumeAt` va en tiempo visible y el motor quiere el del medio. Si se
     * confundieran, un reproductor desalojado en el segundo 30 volvería en el
     * 30 del fichero, que está fuera del recorte.
     */
    const { p, creados } = nuevo(RECORTADO);
    await p.attach();
    creados[0]!._avanzar(130);
    expect(p.currentTime).toBe(30);

    p.detach();
    expect(p.resumeAt).toBe(30);

    await p.attach();
    expect(creados[1]!._arranqueEn()).toBe(130);
    expect(p.currentTime).toBe(30);
  });
});

describe('recorte · antes de resolver', () => {
  it('la duración se sabe sin tocar la red', () => {
    /*
     * Con recorte, la duración sale del manifiesto y no del motor. Si hubiera
     * que esperar a `resolve()`, la barra marcaría 0:00 hasta el primer play
     * aunque el dato estuviera ahí desde el principio.
     */
    const { p } = nuevo(RECORTADO);
    expect(p.state).toBe('idle');
    expect(p.duration).toBe(60);
    expect(p.trim).toEqual({ start: 100, end: 160 });
  });

  it('un manifiesto por URL no se inventa nada', () => {
    // Sin el manifiesto delante no hay recorte que saber, y pedirlo rompería
    // el principio de cero red.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { p } = nuevo('https://ejemplo/m.json');
    expect(p.trim).toBeNull();
    expect(p.duration).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
