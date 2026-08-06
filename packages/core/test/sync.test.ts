import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaEngine } from '../src/engine.js';
import {
  SYNC_PROFILES, Synchronizer, detectProfile,
  type Scheduler, type SyncProfile,
} from '../src/sync.js';

/** Motor de mentira con el tiempo bajo control, para poder provocar derivas. */
function motorFalso(t = 0) {
  let currentTime = t;
  let rate = 1;
  let seeking = false;
  const seeks: number[] = [];
  return {
    name: 'falso',
    get element() { return { seeking } as HTMLVideoElement; },
    get attached() { return true; },
    attach: async () => {},
    detach: () => {},
    play: async () => {},
    pause: () => {},
    seek(s: number) { currentTime = s; seeks.push(s); },
    get currentTime() { return currentTime; },
    get duration() { return 100; },
    get paused() { return false; },
    get ended() { return false; },
    get buffered() { return null; },
    getPlaybackRate: () => rate,
    setPlaybackRate(r: number) { rate = r; },
    setVolume: () => {},
    setMuted: () => {},
    destroy: () => {},
    // Ayudas de prueba
    _set(s: number) { currentTime = s; },
    _seeking(v: boolean) { seeking = v; },
    _seeks: seeks,
  } satisfies MediaEngine & Record<string, unknown>;
}

const P: SyncProfile = SYNC_PROFILES.blink;

let maestro: ReturnType<typeof motorFalso>;
let esclavo: ReturnType<typeof motorFalso>;

const sinc = (profile: SyncProfile = P, scheduler?: Scheduler) =>
  new Synchronizer({
    master: { id: 'cam', engine: maestro },
    slaves: [{ id: 'slides', engine: esclavo }],
    profile,
    ...(scheduler ? { scheduler } : {}),
  });

beforeEach(() => {
  maestro = motorFalso(10);
  esclavo = motorFalso(10);
});

describe('perfiles por motor', () => {
  it('WebKit baja el umbral de salto duro, no sube la ganancia', () => {
    // S2 midió en iPhone buena mediana con excursiones severas. Eso no se
    // arregla con más ganancia: se arregla corrigiendo antes las excursiones.
    expect(SYNC_PROFILES.webkit.hardSeek).toBeLessThan(SYNC_PROFILES.blink.hardSeek);
    expect(SYNC_PROFILES.webkit.gain).toBe(SYNC_PROFILES.blink.gain);
  });

  it('detecta WebKit por ManagedMediaSource', () => {
    const g = globalThis as { ManagedMediaSource?: unknown };
    const previo = g.ManagedMediaSource;
    g.ManagedMediaSource = function () {};
    expect(detectProfile()).toBe('webkit');
    if (previo === undefined) delete g.ManagedMediaSource;
    else g.ManagedMediaSource = previo;
  });
});

describe('Synchronizer · corrección', () => {
  it('no toca al maestro: su audio se oiría', () => {
    esclavo._set(10.2);
    sinc().tick();
    expect(maestro.getPlaybackRate()).toBe(1);
  });

  it('dentro de la zona muerta no corrige', () => {
    esclavo._set(10 + P.deadZone / 2);
    const [m] = sinc().tick();
    expect(m!.action).toBe('ok');
    expect(esclavo.getPlaybackRate()).toBe(1);
  });

  it('acelera al esclavo que va por detrás', () => {
    esclavo._set(9.9);            // 100 ms por detrás
    const [m] = sinc().tick();
    expect(m!.action).toBe('correcting');
    expect(esclavo.getPlaybackRate()).toBeGreaterThan(1);
  });

  it('frena al esclavo que va por delante', () => {
    esclavo._set(10.1);
    sinc().tick();
    expect(esclavo.getPlaybackRate()).toBeLessThan(1);
  });

  it('no supera el techo de velocidad', () => {
    esclavo._set(10 - P.hardSeek * 0.9);   // deriva grande pero sin salto
    sinc().tick();
    expect(esclavo.getPlaybackRate()).toBeLessThanOrEqual(1 + P.maxRateDelta);
  });

  it('salta en duro cuando la deriva se dispara', () => {
    esclavo._set(10 + P.hardSeek + 0.1);
    const s = sinc();
    const [m] = s.tick();
    expect(m!.action).toBe('hard-seek');
    expect(esclavo.currentTime).toBe(10);
    expect(esclavo.getPlaybackRate()).toBe(1);
    expect(s.hardSeeks).toBe(1);
  });

  it('no mide durante un salto: la lectura no significa nada', () => {
    esclavo._set(9.5);
    esclavo._seeking(true);
    const [m] = sinc().tick();
    expect(m!.action).toBe('seeking');
    expect(esclavo._seeks).toHaveLength(0);
  });

  // --- histéresis: lo que evita el offset permanente ---------------------

  it('sigue corrigiendo entre el umbral de suelta y el de enganche', () => {
    // Sin histéresis se pararía al entrar en la zona muerta, dejando casi un
    // frame de offset fijo. Medido en S1: 28,8 ms permanentes.
    const s = sinc();
    esclavo._set(10 - 0.1);        // engancha
    expect(s.tick()[0]!.action).toBe('correcting');

    esclavo._set(10 - 0.02);       // dentro de deadZone, fuera de releaseZone
    expect(s.tick()[0]!.action, 'debe seguir corrigiendo').toBe('correcting');

    esclavo._set(10 - 0.004);      // por debajo de releaseZone
    expect(s.tick()[0]!.action).toBe('ok');
  });

  it('tras soltar no vuelve a enganchar hasta superar el umbral', () => {
    const s = sinc();
    esclavo._set(10 - 0.1); s.tick();
    esclavo._set(10 - 0.001); s.tick();          // suelta
    esclavo._set(10 - 0.02);                     // por debajo de deadZone
    expect(s.tick()[0]!.action).toBe('ok');
  });

  it('respeta la velocidad del maestro al corregir', () => {
    maestro.setPlaybackRate(2);
    esclavo._set(9.9);
    sinc().tick();
    expect(esclavo.getPlaybackRate()).toBeGreaterThan(2);
    expect(esclavo.getPlaybackRate()).toBeLessThanOrEqual(2 + P.maxRateDelta);
  });
});

describe('Synchronizer · ciclo de vida', () => {
  const agendador = () => {
    let tick: (() => void) | null = null;
    const s: Scheduler & { paso(): void } = {
      start(t) { tick = t; },
      stop() { tick = null; },
      paso() { tick?.(); },
    };
    return s;
  };

  it('start y stop encienden y apagan el lazo', () => {
    const ag = agendador();
    const s = sinc(P, ag);
    expect(s.running).toBe(false);
    s.start();
    expect(s.running).toBe(true);
    s.stop();
    expect(s.running).toBe(false);
  });

  it('start es idempotente', () => {
    const ag = agendador();
    const spy = vi.spyOn(ag, 'start');
    const s = sinc(P, ag);
    s.start(); s.start();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('al parar devuelve al esclavo su velocidad natural', () => {
    // Dejarlo corriendo a 1,25× tras apagar el lazo sería un fallo silencioso.
    const ag = agendador();
    const s = sinc(P, ag);
    s.start();
    esclavo._set(9.8);
    ag.paso();
    expect(esclavo.getPlaybackRate()).not.toBe(1);
    s.stop();
    expect(esclavo.getPlaybackRate()).toBe(1);
  });

  it('sin esclavos no arranca: no hay nada que sincronizar', () => {
    const s = new Synchronizer({
      master: { id: 'cam', engine: maestro }, slaves: [], profile: P,
    });
    s.start();
    expect(s.running).toBe(false);
  });

  it('align cuadra los esclavos de golpe', () => {
    // Hace falta al arrancar: enganchar y reproducir en secuencia deja unos
    // 70 ms de retraso de partida que no es deriva y nada corregiría solo.
    esclavo._set(9.3);
    esclavo.setPlaybackRate(1.2);
    sinc().align();
    expect(esclavo.currentTime).toBe(10);
    expect(esclavo.getPlaybackRate()).toBe(1);
  });
});

describe('Synchronizer · varios esclavos', () => {
  it('corrige cada uno con su propio estado', () => {
    const b = motorFalso(10);
    const s = new Synchronizer({
      master: { id: 'cam', engine: maestro },
      slaves: [{ id: 'a', engine: esclavo }, { id: 'b', engine: b }],
      profile: P,
    });
    esclavo._set(9.9);   // necesita corrección
    b._set(10.001);      // está bien
    const muestras = s.tick();
    expect(muestras.map((m) => m.action)).toEqual(['correcting', 'ok']);
    expect(muestras.map((m) => m.stream)).toEqual(['a', 'b']);
  });
});
