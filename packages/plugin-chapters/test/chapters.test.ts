// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { create, plugins, type Manifest, type Player } from '@nanoplayer/core';
import { attachControls, type ControlBar } from '@nanoplayer/ui';
import '../src/index.js';

const CAPITULOS = [
  { kind: 'chapter', start: 0, end: 12, title: 'Welcome' },
  { kind: 'chapter', start: 12, end: 28, title: 'The first law' },
  { kind: 'chapter', start: 28, title: 'Wrap-up' },
] as const;

const clase = (over: Partial<Manifest> = {}): Manifest => ({
  id: 'clase', duration: 40,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
  annotations: [...CAPITULOS],
  ...over,
});

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

/** Un reproductor con barra y el manifiesto resuelto, sin tocar la red de vídeo. */
async function montar(manifest: Manifest): Promise<{ p: Player; barra: ControlBar }> {
  const p = create(host, { manifest, lang: 'en', registry: false });
  const barra = attachControls(p);
  await p.resolve();
  // La activación de plugins va por detrás de `manifest:resolve:ok`.
  await new Promise((r) => setTimeout(r, 0));
  return { p, barra };
}

/** Lleva el reproductor a `t` y avisa a la barra, como haría el motor. */
function ir(p: Player, t: number): void {
  p.seek(t);
  p.bus.emit('time', { current: t, duration: p.duration });
}

const marcas = () =>
  [...host.querySelectorAll<HTMLElement>('.np__mark')].map((m) => m.style.left);
const progreso = () => host.querySelector<HTMLInputElement>('.np__range')!;
const tramo = () => host.querySelector('.np__segment')?.textContent;

describe('capítulos · barra de progreso', () => {
  it('se activa solo si el manifiesto trae capítulos', async () => {
    await montar(clase());
    expect(plugins.active).toContain('chapters');
  });

  it('marca dónde empieza cada capítulo, salvo el primero', async () => {
    await montar(clase());
    expect(marcas()).toEqual(['30%', '70%']);
  });

  it('enseña el capítulo en curso y lo anuncia con la posición', async () => {
    const { p } = await montar(clase());
    ir(p, 20);
    expect(tramo()).toBe('The first law');
    expect(progreso().getAttribute('aria-valuetext')).toMatch(/, The first law$/);
    ir(p, 30);
    expect(tramo()).toBe('Wrap-up');
  });

  it('al pasar el ratón dice el tiempo y el capítulo de ese punto', async () => {
    await montar(clase());
    const barra = progreso();
    barra.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 6,
      right: 400, bottom: 6, x: 0, y: 0, toJSON() {} }) as DOMRect;
    barra.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 }));
    const etiqueta = host.querySelector<HTMLElement>('.np__tip')!;
    expect(etiqueta.hidden).toBe(false);
    expect(etiqueta.textContent).toBe('0:20 · The first law');
    barra.dispatchEvent(new PointerEvent('pointerleave'));
    expect(etiqueta.hidden).toBe(true);
  });

  it('con recorte, las marcas se remapean al tiempo que se enseña', async () => {
    // Del 10 al 30: se ven 20 s, y los capítulos empiezan en 2 y en 18.
    const { p } = await montar(clase({
      annotations: [...CAPITULOS, { kind: 'trim', start: 10, end: 30 }],
    }));
    expect(marcas()).toEqual(['10%', '90%']);
    ir(p, 0);
    expect(tramo()).toBe('Welcome');
  });
});

describe('capítulos · menú de ajustes', () => {
  /** Abre el panel de capítulos y devuelve sus opciones. */
  const abrir = (barra: ControlBar) => {
    barra.settings.open();
    const entrada = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((el) => el.textContent?.startsWith('Chapters'));
    entrada?.click();
    return [...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  };

  it('lista los capítulos y marca el actual', async () => {
    const { p, barra } = await montar(clase());
    ir(p, 20);
    const opciones = abrir(barra);
    // La marca ✓ de la opción activa es visual; el estado va en aria-checked.
    expect(opciones.map((o) => o.textContent?.replace('✓', '').trim()))
      .toEqual(['Welcome', 'The first law', 'Wrap-up']);
    expect(opciones[1]!.getAttribute('aria-checked')).toBe('true');
  });

  it('elegir uno salta a su principio', async () => {
    const { p, barra } = await montar(clase());
    abrir(barra).find((o) => o.textContent?.trim() === 'Wrap-up')!.click();
    expect(p.currentTime).toBe(28);
  });

  it('con recorte, salta al tiempo que se enseña', async () => {
    const { p, barra } = await montar(clase({
      annotations: [...CAPITULOS, { kind: 'trim', start: 10, end: 30 }],
    }));
    abrir(barra).find((o) => o.textContent?.trim() === 'The first law')!.click();
    expect(p.currentTime).toBe(2);
  });

  it('deja fuera los capítulos que el recorte deja enteros fuera', async () => {
    const { barra } = await montar(clase({
      annotations: [...CAPITULOS, { kind: 'trim', start: 14, end: 26 }],
    }));
    // Un solo capítulo visible: no hay adónde saltar y el panel no aparece.
    barra.settings.open();
    const entradas = [...host.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent);
    expect(entradas.some((e) => e?.startsWith('Chapters'))).toBe(false);
  });
});
