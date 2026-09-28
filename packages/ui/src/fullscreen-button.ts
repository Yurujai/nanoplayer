import type { Player, Translate } from '@nanoplayer/core';
import { createButton, Listeners } from './dom.js';
import { ICONS } from './icons.js';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/**
 * Full screen for the whole player, or for the master video alone where the
 * container cannot go full screen. That second way is iPhone's only one (S2:
 * no container full screen on iOS), and it loses the second stream.
 */
export class FullscreenButton {
  readonly element: HTMLButtonElement;
  readonly #listeners = new Listeners();

  constructor(
    private readonly root: HTMLElement,
    private readonly player: Player,
    private readonly t: Translate,
  ) {
    const doc = root.ownerDocument;
    this.element = createButton(doc, t('ui.fullscreenEnter'), ICONS.fullscreenEnter);
    this.#listeners.on(this.element, 'click', () => this.toggle());
    this.#listeners.on(doc, 'fullscreenchange', () => this.render());
    this.#listeners.on(doc, 'webkitfullscreenchange', () => this.render());
  }

  toggle(): void {
    if (this.#isFullscreen()) {
      void (this.#doc.exitFullscreen?.() ?? this.#doc.webkitExitFullscreen?.());
      return;
    }
    const root = this.root as FullscreenElement;
    const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
    if (request) {
      void request.call(root).catch(() => {});
      return;
    }
    (this.player.master?.element as IosVideo | null)?.webkitEnterFullscreen?.();
  }

  render(): void {
    this.element.hidden = !this.#isAvailable();
    const inside = this.#isFullscreen();
    this.element.innerHTML = inside ? ICONS.fullscreenExit : ICONS.fullscreenEnter;
    this.element.setAttribute('aria-label',
      inside ? this.t('ui.fullscreenExit') : this.t('ui.fullscreenEnter'));
  }

  destroy(): void {
    this.#listeners.removeAll();
  }

  get #doc(): FullscreenDocument {
    return this.root.ownerDocument as FullscreenDocument;
  }

  #isFullscreen(): boolean {
    return !!(this.#doc.fullscreenElement ?? this.#doc.webkitFullscreenElement);
  }

  /**
   * Inside an iframe without `allow="fullscreen"` the request is refused: a
   * button that does nothing is worse than no button. The iOS video way still
   * counts as available.
   */
  #isAvailable(): boolean {
    if (this.#doc.fullscreenEnabled ?? this.#doc.webkitFullscreenEnabled) return true;
    return 'webkitEnterFullscreen' in this.#doc.createElement('video');
  }
}
