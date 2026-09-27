// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Player, type EngineFactory, type Manifest } from '@nanoplayer/core';
import { attachControls } from '../src/control-bar.js';
import { injectStyles } from '../src/styles.js';
import '../src/strings.js';

const DURACIONES: Record<string, number> = { intro: 5, outro: 4 };

/** Motor de mentira: el tiempo se mueve a mano y hay imagen un tic después del play. */
function factoriaFalsa() {
  const porId = new Map<string, any>();
  const factory: EngineFactory = {
    name: 'falso',
    canPlay: () => 'probably',
    create() {
      let t = 0, paused = true, cb: any = {}, duracion = 60;
      let fotogramas: Array<() => void> = [];
      const e: any = {
        name: 'falso', attached: true,
        element: {
          videoWidth: 640,
          requestVideoFrameCallback(f: () => void) { fotogramas.push(f); return 1; },
        },
        async attach(caja: HTMLElement, s: { id: string }, o: any) {
          cb = o?.callbacks ?? {};
          duracion = DURACIONES[s.id] ?? 60;
          caja.appendChild(document.createElement('video'));
          porId.set(s.id, e);
        },
        detach() {},
        async play() {
          paused = false; cb.onPlay?.(); cb.onPlaying?.();
          setTimeout(() => { const f = fotogramas; fotogramas = []; f.forEach((x) => x()); }, 10);
        },
        pause() { if (!paused) { paused = true; cb.onPause?.(); } },
        seek(s: number) { t = s; },
        get currentTime() { return t; },
        get duration() { return duracion; },
        get paused() { return paused; },
        ended: false, buffered: null, seekable: null,
        getPlaybackRate: () => 1, setPlaybackRate() {}, setVolume() {}, setMuted() {},
        destroy() {},
        _set(s: number) { t = s; cb.onTime?.(s, duracion); },
      };
      return e;
    },
  };
  return { factory, porId };
}

const MANIFIESTO: Manifest = {
  id: 'x', duration: 60,
  intro: { sources: [{ src: 'intro.mp4', type: 'video/mp4' }] },
  outro: { sources: [{ src: 'outro.mp4', type: 'video/mp4' }] },
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
};

const { intro: _, ...SOLO_COLA } = MANIFIESTO;

let host: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => { vi.useRealTimers(); });

const montar = (manifest: Manifest = MANIFIESTO) => {
  const { factory, porId } = factoriaFalsa();
  const p = new Player({ container: host, manifest, engines: [factory], lang: 'es' });
  attachControls(p);
  return { p, motor: (id: string) => porId.get(id) };
};

const saltar = () => host.querySelector<HTMLButtonElement>('button.np__skip')!;
const anuncio = () => host.querySelector('[role="status"]')?.textContent ?? '';
const filaProgreso = () => host.querySelector<HTMLInputElement>('.np__range')!.parentElement!;
const tiempo = () => host.querySelector('.np__time')?.textContent;

describe('cadena · escenario', () => {
  it('la cabecera y la cola van al escenario, detrás de los streams', async () => {
    const { p } = montar();
    await p.play();
    const orden = [...host.querySelector('.np__stage')!.children]
      .map((c) => (c as HTMLElement).dataset['stream'] ?? (c as HTMLElement).dataset['bumper']);
    expect(orden).toEqual(['cam', 'intro', 'outro']);
  });

  it('solo se ve la pieza que dice data-phase', async () => {
    injectStyles(document);
    const { p, motor } = montar();
    await p.play();
    const opacidad = (id: string) =>
      getComputedStyle(host.querySelector<HTMLElement>(`[data-bumper="${id}"]`)!).opacity;
    expect(opacidad('intro')).toBe('1');
    expect(opacidad('outro')).toBe('0');

    motor('intro')._set(4.8);
    await vi.advanceTimersByTimeAsync(100);
    expect(opacidad('intro')).toBe('0');
  });
});

describe('cadena · saltar cabecera', () => {
  it('no aparece con el póster, sí durante la cabecera', async () => {
    const { p } = montar();
    expect(saltar().hidden).toBe(true);
    await p.play();
    expect(saltar().hidden).toBe(false);
    expect(saltar().textContent).toBe('Saltar cabecera');
  });

  it('va antes que la barra en el orden de tabulación', () => {
    montar();
    const bar = host.querySelector('.np__bar')!;
    expect(saltar().compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('al pulsarlo salta, desaparece y deja el foco en el reproductor', async () => {
    const { p } = montar();
    await p.play();
    saltar().focus();
    saltar().click();
    await vi.advanceTimersByTimeAsync(20);
    expect(p.phase).toBe('main');
    expect(saltar().hidden).toBe(true);
    expect(document.activeElement).toBe(host);
    expect(anuncio()).toBe('Cabecera saltada');
  });

  it('no existe para la cola', async () => {
    const { p, motor } = montar(SOLO_COLA);
    await p.play();
    motor('cam')._set(59.8);
    await vi.advanceTimersByTimeAsync(100);
    expect(p.phase).toBe('outro');
    expect(saltar().hidden).toBe(true);
  });
});

describe('cadena · progreso', () => {
  it('durante la cabecera la barra se esconde y el tiempo dice cuánto le queda', async () => {
    const { p, motor } = montar();
    await p.play();
    expect(filaProgreso().hidden).toBe(true);
    motor('intro')._set(2);
    expect(tiempo()).toBe('Cabecera · 0:03');
  });

  it('en el contenido la barra vuelve', async () => {
    const { p, motor } = montar();
    await p.play();
    motor('intro')._set(4.8);
    await vi.advanceTimersByTimeAsync(100);
    expect(p.phase).toBe('main');
    expect(filaProgreso().hidden).toBe(false);
  });

  it('en la cola se anuncia y la barra no se puede arrastrar', async () => {
    const { p, motor } = montar(SOLO_COLA);
    await p.play();
    motor('cam')._set(59.8);
    await vi.advanceTimersByTimeAsync(100);
    expect(anuncio()).toBe('Cierre');
    expect(filaProgreso().hidden).toBe(true);
    expect(tiempo()).toMatch(/^Cierre/);
  });
});

describe('cadena · teclado', () => {
  const tecla = (key: string) =>
    host.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  it('durante la cabecera las teclas de salto no mueven el contenido a ciegas', async () => {
    const { p } = montar();
    await p.play();
    for (const k of ['ArrowRight', 'l', 'End', '5']) tecla(k);
    expect(p.phase).toBe('intro');
    expect(p.currentTime).toBe(0);
  });

  it('durante la cola, hacia delante no hace nada y hacia atrás vuelve al contenido', async () => {
    const { p, motor } = montar(SOLO_COLA);
    await p.play();
    motor('cam')._set(59.8);
    await vi.advanceTimersByTimeAsync(100);
    tecla('ArrowRight');
    tecla('End');
    expect(p.phase).toBe('outro');
    tecla('ArrowLeft');
    expect(p.phase).toBe('main');
    expect(p.currentTime).toBe(55);
  });
});
