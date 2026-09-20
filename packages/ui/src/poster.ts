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
import type { Player, Translate } from '@nanoplayer/core';
import { ICONS } from './icons.js';

export class Poster {
  readonly #player: Player;
  readonly #raiz: HTMLElement;
  readonly #capa: HTMLElement;
  readonly #boton: HTMLButtonElement;
  readonly #t: Translate;
  #desatar: Array<() => void> = [];
  #ocupado = false;

  constructor(player: Player) {
    this.#player = player;
    this.#raiz = player.container;
    // El traductor del reproductor, no uno propio: el idioma se resuelve una
    // sola vez y todo el mundo dice lo mismo.
    this.#t = player.t;
    const doc = this.#raiz.ownerDocument;

    this.#capa = doc.createElement('div');
    this.#capa.className = 'np__poster';

    this.#boton = doc.createElement('button');
    this.#boton.type = 'button';
    this.#boton.className = 'np__poster-play';
    this.#boton.innerHTML = ICONS.play;
    this.#boton.setAttribute('aria-label', this.#t('ui.poster.play'));
    this.#boton.addEventListener('click', () => this.#arrancar());

    this.#capa.appendChild(this.#boton);
    /*
     * Delante de la barra en el DOM, y por tanto en el orden de tabulación.
     *
     * En el estado inicial este botón es el único control grande y visible de
     * la pantalla, y añadiéndolo al final se alcanzaba en el Tab 9, después de
     * toda una barra que ni siquiera se está viendo. El orden de tabulación
     * debe seguir al orden visual, y aquí el póster va por delante.
     */
    const barra = this.#raiz.querySelector('.np__bar');
    if (barra) this.#raiz.insertBefore(this.#capa, barra);
    else this.#raiz.appendChild(this.#capa);

    this.#desatar.push(player.on('state:change', () => this.#pintar()));
    this.#desatar.push(player.on('manifest:resolve:ok', () => this.#pintarImagen()));
    this.#pintarImagen();
    this.#pintar();
  }

  async #arrancar(): Promise<void> {
    if (this.#ocupado) return;
    this.#ocupado = true;
    this.#boton.disabled = true;
    this.#boton.setAttribute('aria-label', this.#t('ui.poster.loading'));
    this.#capa.classList.add('np__poster--cargando');
    try {
      // `play()` resuelve y engancha por su cuenta si hace falta: el ciclo
      // completo idle → active detrás de un solo gesto.
      await this.#player.play();
    } catch {
      // El error viaja por el bus; aquí solo se restituye el botón para poder
      // reintentar en vez de dejar un póster muerto.
      this.#boton.disabled = false;
      this.#boton.setAttribute('aria-label', this.#t('ui.poster.play'));
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
    this.#raiz.classList.toggle('np--sin-poster', !src);
  }

  #pintar(): void {
    const conMedios = this.#player.state === 'attached' || this.#player.state === 'active';
    /*
     * Con solo audio la capa **se queda**: no hay imagen detrás que enseñar, y
     * retirarla dejaría un rectángulo negro donde estaba la carátula. Lo que sí
     * desaparece es el botón grande, porque a partir de ahí manda la barra.
     *
     * Con vídeo se retira entera en cuanto hay medios: mantenerla hasta
     * `active` dejaría un velo sobre el primer fotograma.
     */
    const soloAudio = this.#player.audioOnly;
    this.#capa.hidden = conMedios && !soloAudio;
    this.#capa.classList.toggle('np__poster--fondo', conMedios && soloAudio);
    this.#boton.hidden = conMedios && soloAudio;
    this.#raiz.classList.toggle('np--solo-audio', soloAudio);
    this.#raiz.classList.toggle('np--con-poster', !conMedios);
    if (!conMedios) {
      this.#boton.disabled = false;
      this.#boton.setAttribute('aria-label', this.#t('ui.poster.play'));
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
