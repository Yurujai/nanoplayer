/**
 * Initial state: the poster and the play button. While it shows, no video has
 * been downloaded. The big button is also the user gesture that autoplay
 * policies require anyway.
 */
import { hasEngine, type Player, type Translate } from '@nanoplayer/core';
import { ICONS } from './icons.js';

export class Poster {
  readonly #player: Player;
  readonly #root: HTMLElement;
  readonly #layer: HTMLElement;
  readonly #button: HTMLButtonElement;
  readonly #t: Translate;
  #unsubscribe: Array<() => void> = [];
  #busy = false;

  constructor(player: Player) {
    this.#player = player;
    this.#root = player.container;
    this.#t = player.t;
    const doc = this.#root.ownerDocument;

    this.#layer = doc.createElement('div');
    this.#layer.className = 'np__poster';

    this.#button = doc.createElement('button');
    this.#button.type = 'button';
    this.#button.className = 'np__poster-play';
    this.#button.innerHTML = ICONS.play;
    this.#button.setAttribute('aria-label', this.#t('ui.poster.play'));
    this.#button.addEventListener('click', () => this.#start());

    this.#layer.appendChild(this.#button);
    // Before the bar, so it comes first in tab order: it is the only visible
    // control at this point (test: "the poster button comes before the bar").
    const bar = this.#root.querySelector('.np__bar');
    if (bar) this.#root.insertBefore(this.#layer, bar);
    else this.#root.appendChild(this.#layer);

    this.#unsubscribe.push(player.on('state:change', () => this.#render()));
    this.#unsubscribe.push(player.on('live:status', () => this.#render()));
    this.#unsubscribe.push(player.on('manifest:resolve:ok', () => this.#renderImage()));
    this.#renderImage();
    this.#render();
  }

  async #start(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    this.#button.disabled = true;
    this.#button.setAttribute('aria-label', this.#t('ui.poster.loading'));
    this.#layer.classList.add('np__poster--loading');
    try {
      await this.#player.play();
    } catch {
      // The error travels on the bus; restore the button so the user can retry.
      this.#button.disabled = false;
      this.#button.setAttribute('aria-label', this.#t('ui.poster.play'));
      this.#layer.classList.remove('np__poster--loading');
    } finally {
      this.#busy = false;
    }
  }

  #renderImage(): void {
    const src = this.#player.poster;
    if (src) this.#layer.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
    this.#root.classList.toggle('np--no-poster', !src);
  }

  #render(): void {
    // A live stream that is not on air yet goes back to `resolved` after play:
    // the per-stream waiting notice must show, not the poster on top of it
    // (test: "pressing play removes the poster and shows the waiting notice").
    const waitingForLive = !!this.#player.manifest?.live && this.#player.liveStatus !== 'unknown';
    const hasMedia = hasEngine(this.#player.state) || waitingForLive;
    // Audio only keeps the layer as a backdrop: removing it would leave a black box.
    const audioOnly = this.#player.audioOnly;
    this.#layer.hidden = hasMedia && !audioOnly;
    this.#layer.classList.toggle('np__poster--backdrop', hasMedia && audioOnly);
    this.#button.hidden = hasMedia && audioOnly;
    this.#root.classList.toggle('np--audio-only', audioOnly);
    this.#root.classList.toggle('np--with-poster', !hasMedia);
    // Not while a play is starting: the lifecycle passes through states without
    // media on its way, and resetting here dropped the loading state at once.
    // The button looked idle for seconds and viewers pressed it again
    // (test: "keeps showing it is loading").
    if (!hasMedia && !this.#busy) {
      this.#button.disabled = false;
      this.#button.setAttribute('aria-label', this.#t('ui.poster.play'));
      this.#layer.classList.remove('np__poster--loading');
    }
  }

  destroy(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    this.#layer.remove();
    this.#root.classList.remove('np--with-poster');
  }
}
