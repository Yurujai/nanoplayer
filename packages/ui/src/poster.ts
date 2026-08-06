/**
 * Estado inicial: póster y botón de reproducción.
 *
 * Es la cara visible del ciclo de vida perezoso. Mientras esto se ve, **no se
 * ha descargado ni un byte de vídeo**: solo la imagen. Es lo que permite una
 * página con muchos reproductores sin tumbar los servidores, y aquí es el
 * comportamiento por defecto en lugar de algo que el integrador tenga que
 * montarse por fuera.
 *
 * También cubre el hueco de la política de autoplay: en la práctica, la
 * inmensa mayoría de navegadores exige una interacción para reproducir con
 * sonido. El botón grande no es una concesión estética, es el gesto que hace
 * falta de todas formas.
 */
import type { Player } from '@nanoplayer/core';
import { ICONS } from './icons.js';

interface Textos {
  play: string; loading: string;
}

const TEXTOS: Record<string, Textos> = {
  es: { play: 'Reproducir vídeo', loading: 'Cargando…' },
  en: { play: 'Play video', loading: 'Loading…' },
};

export class Poster {
  readonly #player: Player;
  readonly #raiz: HTMLElement;
  readonly #capa: HTMLElement;
  readonly #boton: HTMLButtonElement;
  readonly #t: Textos;
  #desatar: Array<() => void> = [];
  #ocupado = false;

  constructor(player: Player, lang = 'es') {
    this.#player = player;
    this.#raiz = player.container;
    this.#t = TEXTOS[lang.slice(0, 2)] ?? TEXTOS['es']!;
    const doc = this.#raiz.ownerDocument;

    this.#capa = doc.createElement('div');
    this.#capa.className = 'np__poster';

    this.#boton = doc.createElement('button');
    this.#boton.type = 'button';
    this.#boton.className = 'np__poster-play';
    this.#boton.innerHTML = ICONS.play;
    this.#boton.setAttribute('aria-label', this.#t.play);
    this.#boton.addEventListener('click', () => this.#arrancar());

    this.#capa.appendChild(this.#boton);
    this.#raiz.appendChild(this.#capa);

    this.#desatar.push(player.on('state:change', () => this.#pintar()));
    this.#desatar.push(player.on('manifest:resolve:ok', () => this.#pintarImagen()));
    this.#pintarImagen();
    this.#pintar();
  }

  async #arrancar(): Promise<void> {
    if (this.#ocupado) return;
    this.#ocupado = true;
    this.#boton.disabled = true;
    this.#boton.setAttribute('aria-label', this.#t.loading);
    this.#capa.classList.add('np__poster--cargando');
    try {
      // `play()` resuelve y engancha por su cuenta si hace falta: el ciclo
      // completo idle → active detrás de un solo gesto.
      await this.#player.play();
    } catch {
      // El error viaja por el bus; aquí solo se restituye el botón para poder
      // reintentar en vez de dejar un póster muerto.
      this.#boton.disabled = false;
      this.#boton.setAttribute('aria-label', this.#t.play);
      this.#capa.classList.remove('np__poster--cargando');
    } finally {
      this.#ocupado = false;
    }
  }

  #pintarImagen(): void {
    // `player.poster` no obliga a resolver: sale de lo que pasó el integrador o
    // del manifiesto si vino ya cargado.
    const src = this.#player.poster;
    if (src) this.#capa.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
  }

  #pintar(): void {
    // Se retira en cuanto hay imagen que enseñar detrás. Mantenerlo hasta
    // `active` dejaría un velo sobre el primer fotograma.
    const conMedios = this.#player.state === 'attached' || this.#player.state === 'active';
    this.#capa.hidden = conMedios;
    this.#raiz.classList.toggle('np--con-poster', !conMedios);
    if (!conMedios) {
      this.#boton.disabled = false;
      this.#boton.setAttribute('aria-label', this.#t.play);
      this.#capa.classList.remove('np__poster--cargando');
    }
  }

  destroy(): void {
    for (const off of this.#desatar) off();
    this.#desatar = [];
    this.#capa.remove();
    this.#raiz.classList.remove('np--con-poster');
  }
}
