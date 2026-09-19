// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { plugins, type Manifest } from '@nanoplayer/core';
import { create, NanoPlayer } from '../src/index.js';

const MANIFIESTO: Manifest = {
  id: 'clase-1',
  title: 'Una clase',
  streams: [{
    id: 'cam', role: 'presenter', audio: true,
    sources: [{ src: 'cam.mp4', type: 'video/mp4' }],
  }],
  textTracks: [{ src: 'es.vtt', lang: 'es', kind: 'subtitles' }],
};

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  host.id = 'player';
  document.body.appendChild(host);
});

describe('create con pilas incluidas', () => {
  it('monta los controles sin pedirlo', () => {
    /*
     * Es la diferencia entera con el `create` del núcleo, que es headless. Lo
     * que había antes de este paquete era una etiqueta <script> que daba un
     * reproductor sin un solo botón.
     */
    create('#player', { manifest: MANIFIESTO });
    expect(host.querySelector('.np__bar')).not.toBeNull();
    expect(host.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  it('los botones llevan nombre accesible', () => {
    create('#player', { manifest: MANIFIESTO });
    const botones = [...host.querySelectorAll('button')];
    expect(botones.every((b) => (b.getAttribute('aria-label') ?? '').length > 0)).toBe(true);
  });

  it('acepta un elemento además de un selector', () => {
    create(host, { manifest: MANIFIESTO });
    expect(host.querySelector('.np__bar')).not.toBeNull();
  });

  it('`controls: false` deja el reproductor pelado', () => {
    // Para quien quiera su propia interfaz encima de este mismo bundle.
    create('#player', { manifest: MANIFIESTO, controls: false });
    expect(host.querySelector('.np__bar')).toBeNull();
  });

  it('`controls` con objeto configura la barra', () => {
    create('#player', { manifest: MANIFIESTO, controls: { lang: 'en' } });
    const etiquetas = [...host.querySelectorAll('button')]
      .map((b) => b.getAttribute('aria-label'));
    expect(etiquetas).toContain('Play');
  });

  it('el idioma se dice una vez y lo hereda la barra', () => {
    create('#player', { manifest: MANIFIESTO, lang: 'en' });
    const etiquetas = [...host.querySelectorAll('button')]
      .map((b) => b.getAttribute('aria-label'));
    expect(etiquetas).toContain('Play');
  });

  it('no descarga nada: el ciclo perezoso sigue intacto', () => {
    // Montar la interfaz no puede arrastrar medios. Es el principio 2, y es lo
    // primero que se rompería al juntar los paquetes sin mirar.
    const p = create('#player', { manifest: MANIFIESTO });
    expect(host.querySelectorAll('video').length).toBe(0);
    expect(p.state).toBe('idle');
  });

  it('trae el plugin de subtítulos ya registrado', () => {
    expect(plugins.has('captions')).toBe(true);
  });
});

describe('la global del caso <script>', () => {
  it('lleva lo que hace falta en el primer nivel', () => {
    for (const k of ['create', 'attachControls', 'registry', 'plugins', 'VERSION']) {
      expect(NanoPlayer, `falta ${k}`).toHaveProperty(k);
    }
  });

  it('su create es el que trae controles, no el headless del núcleo', () => {
    NanoPlayer.create('#player', { manifest: MANIFIESTO });
    expect(host.querySelector('.np__bar')).not.toBeNull();
  });
});
