// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Player, strings } from '@nanoplayer/core';
import type { Manifest } from '@nanoplayer/core';
import { attachControls } from '../src/control-bar.js';
import '../src/strings.js';

const MANIFIESTO: Manifest = {
  id: 'x',
  streams: [{
    id: 'a', role: 'presenter', audio: true,
    sources: [{ src: 'a.mp4', type: 'video/mp4' }],
  }],
};

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

const jugador = (opciones: Record<string, unknown> = {}) =>
  new Player({ container: host, manifest: MANIFIESTO, ...opciones });

/** Nombre accesible de un botón, que es lo que anuncia un lector de pantalla. */
const etiquetas = () => [...host.querySelectorAll('button')]
  .map((b) => b.getAttribute('aria-label'));

describe('idioma de la interfaz', () => {
  it('usa el del documento cuando no se dice nada', () => {
    document.documentElement.lang = 'en';
    attachControls(jugador());
    expect(etiquetas()).toContain('Play');
  });

  it('el del reproductor manda sobre el del documento', () => {
    document.documentElement.lang = 'en';
    attachControls(jugador({ lang: 'es' }));
    expect(etiquetas()).toContain('Reproducir');
  });

  it('cae al idioma base ante uno desconocido, en vez de quedarse en blanco', () => {
    attachControls(jugador({ lang: 'is' }));
    expect(etiquetas()).toContain('Reproducir');
    expect(etiquetas().every((e) => e && e.length > 0)).toBe(true);
  });
});

describe('cadenas propias', () => {
  it('añade un idioma entero sin tocar el código', () => {
    /*
     * El caso que justifica todo esto. Antes, euskera obligaba a editar seis
     * ficheros en dos paquetes: un fork. Ahora es el argumento `strings`.
     */
    attachControls(jugador({
      lang: 'eu',
      strings: {
        eu: {
          'ui.play': 'Erreproduzitu',
          'ui.mute': 'Mututu',
          'ui.fullscreenEnter': 'Pantaila osoa',
        },
      },
    }));
    const e = etiquetas();
    expect(e).toContain('Erreproduzitu');
    expect(e).toContain('Mututu');
    expect(e).toContain('Pantaila osoa');
  });

  it('lo que el idioma nuevo no cubra sigue funcionando', () => {
    // Una traducción a medias no puede dejar botones sin nombre accesible.
    attachControls(jugador({ lang: 'eu', strings: { eu: { 'ui.play': 'Erreproduzitu' } } }));
    expect(etiquetas()).toContain('Erreproduzitu');
    expect(etiquetas().every((e) => e && e.length > 0)).toBe(true);
  });

  it('cambia una sola palabra sin tocar el resto', () => {
    // El caso real no es traducir: es que una universidad diga «Pizarra»
    // donde pone «Diapositivas». Eso no debería acabar en un PR al proyecto.
    attachControls(jugador({ strings: { es: { 'ui.play': 'Dale al play' } } }));
    const e = etiquetas();
    expect(e).toContain('Dale al play');
    expect(e).toContain('Silenciar');
  });

  it('la barra puede hablar otro idioma que el reproductor', () => {
    const p = jugador({ lang: 'es' });
    attachControls(p, { lang: 'en' });
    expect(etiquetas()).toContain('Play');
    expect(p.lang).toBe('es');
  });
});

describe('el catálogo de la interfaz', () => {
  it('cubre los dos idiomas de serie con las mismas claves', () => {
    // Un idioma con una clave de menos deja un botón diciendo `ui.algo`.
    const es = strings.translator('es');
    const en = strings.translator('en');
    for (const k of ['ui.play', 'ui.pause', 'ui.mute', 'ui.settings.label',
                     'ui.poster.play', 'ui.layout.pip', 'ui.live.badge']) {
      expect(es(k), `falta ${k} en es`).not.toBe(k);
      expect(en(k), `falta ${k} en en`).not.toBe(k);
    }
  });
});
