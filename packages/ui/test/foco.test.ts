// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Player, type Manifest } from '@nanoplayer/core';
import { attachControls } from '../src/control-bar.js';
import '../src/strings.js';

const MANIFIESTO: Manifest = {
  id: 'x',
  poster: 'p.jpg',
  streams: [{
    id: 'a', role: 'presenter', audio: true,
    sources: [{ src: 'a.mp4', type: 'video/mp4' }],
  }],
};

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

/** Lo que recorrería el Tab, en orden de documento. */
const tabulables = () =>
  [...host.querySelectorAll<HTMLElement>('button, input, [tabindex]')]
    .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled)
    .map((el) => el.getAttribute('aria-label') ?? el.tagName.toLowerCase());

describe('orden de tabulación', () => {
  it('el botón del póster va antes que la barra', () => {
    /*
     * En el estado inicial es el único control grande y visible, y estaba el
     * último: se alcanzaba en el Tab 9, detrás de una barra que ni se ve. El
     * orden de tabulación tiene que seguir al visual.
     */
    const p = new Player({ container: host, manifest: MANIFIESTO, lang: 'es' });
    attachControls(p);
    const orden = tabulables();
    const poster = orden.indexOf('Reproducir vídeo');
    const primeroDeLaBarra = orden.indexOf('Posición');
    expect(poster, 'el botón del póster no está en el orden').toBeGreaterThanOrEqual(0);
    expect(poster).toBeLessThan(primeroDeLaBarra);
  });

  it('el contenedor es alcanzable y lleva nombre', () => {
    // Es el asidero del que depende Safari con sus ajustes de fábrica: allí
    // Tab no entra en los botones, y los atajos llegan por el contenedor.
    const p = new Player({ container: host, manifest: MANIFIESTO, lang: 'es' });
    attachControls(p, { label: 'Una clase' });
    expect(host.tabIndex).toBe(0);
    expect(host.getAttribute('role')).toBe('region');
    expect(host.getAttribute('aria-label')).toBe('Una clase');
  });

  it('todo lo tabulable tiene nombre accesible', () => {
    const p = new Player({ container: host, manifest: MANIFIESTO, lang: 'es' });
    attachControls(p);
    const sinNombre = [...host.querySelectorAll<HTMLElement>('button, input')]
      .filter((el) => !(el.getAttribute('aria-label') ?? '').trim());
    expect(sinNombre.map((e) => e.outerHTML.slice(0, 60))).toEqual([]);
  });

  it('nada dentro del reproductor se salta el orden natural', () => {
    // Un tabindex positivo reordena el documento entero y rompe el recorrido
    // de la página que lo integra, no solo el del reproductor.
    const p = new Player({ container: host, manifest: MANIFIESTO, lang: 'es' });
    attachControls(p);
    const positivos = [...host.querySelectorAll<HTMLElement>('[tabindex]')]
      .filter((el) => el.tabIndex > 0);
    expect(positivos.map((e) => e.tagName)).toEqual([]);
  });
});
