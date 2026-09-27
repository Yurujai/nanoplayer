// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANTICIPACION_MS } from '../src/chain.js';
import type { EngineFactory, MediaEngine } from '../src/engine.js';
import { Player } from '../src/player.js';

type Falso = MediaEngine & {
  _set(t: number): void;
  _cb(): any;
  _muted(): boolean;
  _plays: number;
};

const DURACIONES: Record<string, number> = { intro: 5, outro: 4 };

/**
 * Motor de mentira. Cada flujo tiene su duración, el tiempo se mueve a mano y
 * el primer fotograma llega un tic después del `play()`, como en un navegador:
 * es lo que permite comprobar que el cambio espera a la imagen.
 */
function factoriaFalsa(opts: { fallan?: string[] } = {}) {
  const porId = new Map<string, Falso>();
  const factory: EngineFactory = {
    name: 'falso',
    canPlay: () => 'probably',
    create() {
      let currentTime = 0, paused = true, muted = false, duracion = 60;
      let cb: any = {};
      let fotogramas: Array<() => void> = [];
      const element = {
        seeking: false,
        videoWidth: 640,
        requestVideoFrameCallback(f: () => void) { fotogramas.push(f); return 1; },
      };
      const e = {
        name: 'falso',
        get element() { return element as unknown as HTMLVideoElement; },
        attached: true,
        async attach(container: HTMLElement, s: { id: string }, o: any) {
          if (opts.fallan?.includes(s.id)) throw new Error(`no carga ${s.id}`);
          cb = o?.callbacks ?? {};
          muted = !!o?.muted;
          duracion = DURACIONES[s.id] ?? 60;
          if (o?.startAt) currentTime = o.startAt;
          container.appendChild(document.createElement('video'));
          porId.set(s.id, e as never);
        },
        detach() {},
        async play() {
          e._plays++;
          paused = false;
          cb.onPlay?.();
          cb.onPlaying?.();
          setTimeout(() => {
            if (paused) return;
            const f = fotogramas; fotogramas = [];
            f.forEach((x) => x());
          }, 10);
        },
        pause() { if (paused) return; paused = true; cb.onPause?.(); },
        seek(t: number) { currentTime = t; },
        get currentTime() { return currentTime; },
        get duration() { return duracion; },
        get paused() { return paused; },
        get ended() { return false; },
        get buffered() { return null; },
        get seekable() { return null; },
        getPlaybackRate: () => 1,
        setPlaybackRate() {},
        setVolume() {},
        setMuted(m: boolean) { muted = m; },
        destroy() {},
        _set(t: number) { currentTime = t; cb.onTime?.(t, duracion); },
        _cb: () => cb,
        _muted: () => muted,
        _plays: 0,
      };
      return e as never;
    },
  };
  return { factory, porId };
}

const fuente = (src: string) => ({ sources: [{ src, type: 'video/mp4' }] });
const contenido = (over: Record<string, unknown> = {}) => ({
  id: 'c', duration: 60,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
  ...over,
});

let container: HTMLElement;

const nuevo = (manifest: unknown, opts: { fallan?: string[] } = {}) => {
  const { factory, porId } = factoriaFalsa(opts);
  const p = new Player({ container, manifest: manifest as never, engines: [factory] });
  const motor = (id: string) => porId.get(id)!;
  const fases: Array<{ from: string; to: string; skipped: boolean }> = [];
  p.on('chain:phase', (x) => fases.push(x));
  const finales: number[] = [];
  p.on('ended', ({ at }) => finales.push(at));
  return { p, motor, fases, finales };
};

/** Lleva la pieza a `antes` segundos de su final y deja correr la vigilancia. */
async function acercarAlFinal(e: Falso, antes: number) {
  e._set(e.duration - antes);
  await vi.advanceTimersByTimeAsync(100);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => { vi.useRealTimers(); });

describe('cadena · sin cabecera ni cola', () => {
  it('empieza y se queda en el contenido', async () => {
    const { p, fases } = nuevo(contenido());
    await p.play();
    expect(p.phase).toBe('main');
    expect(container.querySelector('[data-bumper]')).toBeNull();
    expect(fases).toEqual([]);
  });
});

describe('cadena · cabecera', () => {
  it('suena la cabecera y el contenido espera detrás, mudo y parado', async () => {
    const { p, motor } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    await p.play();
    expect(p.phase).toBe('intro');
    expect(container.dataset['phase']).toBe('intro');
    expect(motor('intro').paused).toBe(false);
    expect(motor('intro')._muted()).toBe(false);
    expect(motor('cam').paused).toBe(true);
    expect(motor('cam')._muted()).toBe(true);
    expect(p.state).toBe('active');
    expect(p.paused).toBe(false);
  });

  it('desbloquea el contenido y la cola en el arranque, sin dejarlos sonando', async () => {
    const { p, motor } = nuevo(contenido({ intro: fuente('intro.mp4'), outro: fuente('outro.mp4') }));
    await p.play();
    for (const id of ['cam', 'outro']) {
      expect(motor(id)._plays, id).toBe(1);
      expect(motor(id).paused, id).toBe(true);
    }
  });

  it('no cambia antes de la ventana de anticipación', async () => {
    const { p, motor } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    await p.play();
    await acercarAlFinal(motor('intro'), 1.5);
    expect(p.phase).toBe('intro');
    expect(motor('cam').paused).toBe(true);
  });

  it('arranca el contenido antes del final y cambia en su primer fotograma', async () => {
    const { p, motor, fases } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    await p.play();
    motor('intro')._set(5 - ANTICIPACION_MS / 1000 + 0.1);
    await vi.advanceTimersByTimeAsync(50);
    // Ya arrancado, pero todavía no a la vista: falta su primer fotograma.
    expect(motor('cam').paused).toBe(false);
    expect(motor('cam')._muted()).toBe(true);
    expect(p.phase).toBe('intro');

    await vi.advanceTimersByTimeAsync(20);
    expect(p.phase).toBe('main');
    expect(container.dataset['phase']).toBe('main');
    expect(motor('cam')._muted()).toBe(false);
    expect(motor('intro').paused).toBe(true);
    expect(fases).toEqual([{ from: 'intro', to: 'main', skipped: false }]);
    expect(p.state).toBe('active');
  });

  it('no emite pause ni play en el cambio: para quien mira no se ha parado', async () => {
    const { p, motor } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    await p.play();
    const vistos: string[] = [];
    p.on('play', () => vistos.push('play'));
    p.on('pause', () => vistos.push('pause'));
    await acercarAlFinal(motor('intro'), 0.3);
    expect(p.phase).toBe('main');
    expect(vistos).toEqual([]);
  });

  it('el progreso de la cabecera va por chain:time, no por time', async () => {
    const { p, motor } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    const time = vi.fn(), chain = vi.fn();
    p.on('time', time);
    p.on('chain:time', chain);
    await p.play();
    motor('intro')._set(2);
    expect(chain).toHaveBeenCalledWith({ phase: 'intro', current: 2, duration: 5 });
    expect(time).not.toHaveBeenCalled();
    expect(p.currentTime).toBe(0);
  });

  it('si la vigilancia no llega, el final de la cabecera fuerza el cambio', async () => {
    const { p, motor } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    await p.play();
    motor('intro')._cb().onEnded();
    await vi.advanceTimersByTimeAsync(20);
    expect(p.phase).toBe('main');
  });
});

describe('cadena · saltar', () => {
  it('saltar la cabecera cambia al contenido sin esperar a su final', async () => {
    const { p, motor, fases } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    await p.play();
    expect(p.canSkip).toBe(true);
    p.skipIntro();
    await vi.advanceTimersByTimeAsync(20);
    expect(p.phase).toBe('main');
    expect(motor('cam').paused).toBe(false);
    expect(fases).toEqual([{ from: 'intro', to: 'main', skipped: true }]);
  });

  it('saltarla antes de reproducir ni siquiera la engancha', async () => {
    const { p } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    await p.resolve();
    p.skipIntro();
    await p.play();
    expect(p.phase).toBe('main');
    expect(container.querySelector('[data-bumper="intro"]')).toBeNull();
  });

  it('saltarla en pausa arranca el contenido y el estado lo refleja', async () => {
    const { p } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    await p.play();
    p.pause();
    expect(p.state).toBe('attached');
    const play = vi.fn();
    p.on('play', play);
    p.skipIntro();
    await vi.advanceTimersByTimeAsync(20);
    expect(p.state).toBe('active');
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('en el contenido y en la cola no hay nada que saltar', async () => {
    const { p, motor } = nuevo(contenido({ outro: fuente('outro.mp4') }));
    await p.play();
    expect(p.canSkip).toBe(false);
    p.skipIntro();
    expect(p.phase).toBe('main');
    await acercarAlFinal(motor('cam'), 0.3);
    expect(p.phase).toBe('outro');
    expect(p.canSkip).toBe(false);
  });
});

describe('cadena · cola', () => {
  it('entra antes del final del contenido y el ended llega al acabar ella', async () => {
    const { p, motor, fases, finales } = nuevo(contenido({ outro: fuente('outro.mp4') }));
    await p.play();
    await acercarAlFinal(motor('cam'), 0.3);
    expect(p.phase).toBe('outro');
    expect(fases).toEqual([{ from: 'main', to: 'outro', skipped: false }]);
    expect(motor('outro')._muted()).toBe(false);
    expect(motor('cam').paused).toBe(true);
    expect(finales).toEqual([]);
    expect(p.currentTime).toBe(60);

    motor('outro').pause();
    motor('outro')._cb().onEnded();
    expect(finales).toEqual([60]);
  });

  it('con recorte, anticipa respecto al final del recorte', async () => {
    const { p, motor, finales } = nuevo(contenido({
      outro: fuente('outro.mp4'),
      annotations: [{ kind: 'trim', start: 10, end: 40 }],
    }));
    await p.play();
    motor('cam')._set(39.8);
    await vi.advanceTimersByTimeAsync(100);
    expect(p.phase).toBe('outro');
    expect(finales).toEqual([]);
  });

  it('al llegar al final del recorte se para ahí mientras entra la cola', async () => {
    const { p, motor } = nuevo(contenido({
      outro: fuente('outro.mp4'),
      annotations: [{ kind: 'trim', start: 10, end: 40 }],
    }));
    await p.play();
    motor('cam')._set(40);
    expect(motor('cam').paused).toBe(true);
    expect(p.state).toBe('active');
    await vi.advanceTimersByTimeAsync(20);
    expect(p.phase).toBe('outro');
  });

  it('hacia delante no se puede salir de la cola', async () => {
    const { p, motor } = nuevo(contenido({ outro: fuente('outro.mp4') }));
    await p.play();
    await acercarAlFinal(motor('cam'), 0.3);
    p.seek(60);
    p.seek(999);
    expect(p.phase).toBe('outro');
    expect(motor('outro').paused).toBe(false);
  });

  it('retroceder vuelve al contenido, y al llegar otra vez al final la cola suena de nuevo', async () => {
    const { p, motor, fases } = nuevo(contenido({ outro: fuente('outro.mp4') }));
    await p.play();
    await acercarAlFinal(motor('cam'), 0.3);
    p.seek(30);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.phase).toBe('main');
    expect(motor('outro').paused).toBe(true);
    expect(motor('cam').paused).toBe(false);
    expect(motor('cam')._muted()).toBe(false);
    expect(p.currentTime).toBe(30);

    await acercarAlFinal(motor('cam'), 0.3);
    expect(p.phase).toBe('outro');
    expect(fases.map((f) => f.to)).toEqual(['outro', 'main', 'outro']);
  });

  it('dar al play con todo visto vuelve al contenido, sin repetir la cabecera', async () => {
    const { p, motor } = nuevo(contenido({ intro: fuente('intro.mp4'), outro: fuente('outro.mp4') }));
    await p.play();
    await acercarAlFinal(motor('intro'), 0.3);
    await acercarAlFinal(motor('cam'), 0.3);
    motor('outro').pause();
    motor('outro')._cb().onEnded();

    await p.play();
    expect(p.phase).toBe('main');
    expect(p.currentTime).toBe(0);
    expect(motor('cam').paused).toBe(false);
  });
});

describe('cadena · cancelar', () => {
  it('pausar durante el cambio lo cancela y la pieza entrante se para', async () => {
    const { p, motor } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    await p.play();
    motor('intro')._set(4.6);
    await vi.advanceTimersByTimeAsync(50);
    expect(motor('cam').paused).toBe(false);
    p.pause();
    await vi.advanceTimersByTimeAsync(50);
    expect(p.phase).toBe('intro');
    expect(motor('cam').paused).toBe(true);
    expect(p.state).toBe('attached');

    // Al reanudar, la vigilancia lo vuelve a disparar.
    await p.play();
    await vi.advanceTimersByTimeAsync(100);
    expect(p.phase).toBe('main');
  });

  it('retroceder mientras entra la cola la deja para después', async () => {
    const { p, motor } = nuevo(contenido({ outro: fuente('outro.mp4') }));
    await p.play();
    motor('cam')._set(59.6);
    await vi.advanceTimersByTimeAsync(50);
    expect(motor('outro').paused).toBe(false);
    p.seek(20);
    await vi.advanceTimersByTimeAsync(50);
    expect(p.phase).toBe('main');
    expect(motor('outro').paused).toBe(true);
    expect(motor('cam').paused).toBe(false);
  });
});

describe('cadena · sonido', () => {
  it('silenciar durante la cabecera se mantiene al pasar al contenido', async () => {
    const { p, motor } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    await p.play();
    p.setMuted(true);
    expect(motor('intro')._muted()).toBe(true);
    await acercarAlFinal(motor('intro'), 0.3);
    expect(p.phase).toBe('main');
    expect(motor('cam')._muted()).toBe(true);
  });
});

describe('cadena · piezas que fallan', () => {
  it('una cabecera que no carga se omite y el contenido suena', async () => {
    const { p, motor } = nuevo(contenido({ intro: fuente('intro.mp4') }), { fallan: ['intro'] });
    const perdidas = vi.fn();
    p.on('chain:unavailable', perdidas);
    await p.play();
    expect(p.phase).toBe('main');
    expect(motor('cam').paused).toBe(false);
    expect(perdidas).toHaveBeenCalledWith(expect.objectContaining({ phase: 'intro' }));
  });

  it('sin la cola, el contenido termina como siempre', async () => {
    const { p, motor, finales } = nuevo(contenido({ outro: fuente('outro.mp4') }), { fallan: ['outro'] });
    await p.play();
    await acercarAlFinal(motor('cam'), 0.3);
    expect(p.phase).toBe('main');
    motor('cam')._cb().onEnded();
    expect(finales).toHaveLength(1);
  });
});

describe('cadena · desalojo', () => {
  it('soltar durante la cabecera la repite desde el principio al volver', async () => {
    const { p, motor } = nuevo(contenido({ intro: fuente('intro.mp4') }));
    await p.play();
    motor('intro')._set(3);
    p.detach();
    expect(container.querySelector('[data-bumper]')).toBeNull();
    await p.play();
    expect(p.phase).toBe('intro');
    expect(motor('intro').currentTime).toBe(0);
  });
});
