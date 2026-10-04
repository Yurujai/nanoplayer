import type { Player, Translate } from '@nanoplayer/core';
import { createButton, createRange, Listeners } from './dom.js';
import { formatPercent } from './format.js';
import { ICONS } from './icons.js';

const VOLUME_STEP = 0.05;

/** Mute button and volume slider, kept in step with the player. */
export class VolumeControl {
  readonly element: HTMLElement;
  readonly #button: HTMLButtonElement;
  readonly #slider: HTMLInputElement;
  readonly #listeners = new Listeners();
  /** What unmuting goes back to. */
  #previous = 1;

  constructor(
    doc: Document,
    private readonly player: Player,
    private readonly t: Translate,
  ) {
    this.#button = createButton(doc, t('ui.mute'), ICONS.volumeHigh);
    this.#slider = createRange(doc, t('ui.volume'), 0, 1, 0.01);
    this.#slider.value = '1';
    this.element = doc.createElement('div');
    this.element.className = 'np__volume';
    this.element.append(this.#button, this.#slider);

    this.#listeners.on(this.#button, 'click', () => this.toggleMute());
    this.#listeners.on(this.#slider, 'input', () => this.set(Number(this.#slider.value)));
    // From the player, not assumed: painted only on change, the full slider showed
    // no fill until moved, and a muted start (autoplay 'muted') showed full volume.
    this.#listeners.add(player.on('volumechange', () => this.#sync()));
    this.#sync();
  }

  /** What the player has now: muted reads as zero, the slider's own idea of silence. */
  #sync(): void {
    const v = this.player.muted ? 0 : this.player.volume;
    if (this.player.volume > 0) this.#previous = this.player.volume;
    this.#slider.value = String(v);
    this.#render(v);
  }

  /**
   * How much wider hovering makes it. The bar keeps that room free: growing
   * into a full row pushed the last control, full screen, out of the player.
   * The slider's open size lives in the stylesheet (5rem plus .75rem margin).
   */
  growth(): number {
    if (getComputedStyle(this.#slider).display === 'none') return 0;
    const rem = parseFloat(getComputedStyle(this.element.ownerDocument.documentElement).fontSize) || 16;
    return Math.max(0, rem * 5.75 - this.#slider.getBoundingClientRect().width);
  }

  get value(): number {
    return Number(this.#slider.value);
  }

  /** Volume 0 is muted, so the player and the button agree on what silence is. */
  set(volume: number): void {
    const v = Math.min(1, Math.max(0, volume));
    if (v > 0) this.#previous = v;
    this.#slider.value = String(v);
    this.player.setVolume(v);
    this.player.setMuted(v === 0);
    this.#render(v);
  }

  toggleMute(): void {
    this.set(this.value === 0 ? this.#previous : 0);
  }

  step(direction: 1 | -1): void {
    this.set(this.value + direction * VOLUME_STEP);
  }

  destroy(): void {
    this.#listeners.removeAll();
  }

  #render(v: number): void {
    const muted = v === 0;
    this.#button.innerHTML = muted ? ICONS.volumeMuted : v < 0.5 ? ICONS.volumeLow : ICONS.volumeHigh;
    this.#button.setAttribute('aria-label', muted ? this.t('ui.unmute') : this.t('ui.mute'));
    this.#slider.setAttribute('aria-valuetext', formatPercent(v, this.t.lang));
    this.#slider.style.setProperty('--np-progress', `${v * 100}%`);
  }
}
