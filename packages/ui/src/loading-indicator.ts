import { hasEngine, type Player } from '@nanoplayer/core';

/**
 * A spinner over the video while any content stream has run out of data.
 * Screen readers already hear "buffering" from the live region, so it is
 * `aria-hidden`: announced twice it would be noise.
 */
export class LoadingIndicator {
  readonly element: HTMLElement;
  readonly #stalled = new Set<string>();
  readonly #unsubscribe: Array<() => void> = [];

  constructor(doc: Document, private readonly player: Player) {
    this.element = doc.createElement('div');
    this.element.className = 'np__loading';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = '<span class="np__spinner"></span>';
    this.element.hidden = true;

    const clear = () => { this.#stalled.clear(); this.#render(); };
    this.#unsubscribe.push(
      player.on('stall:start', ({ stream }) => { this.#stalled.add(stream); this.#render(); }),
      player.on('stall:end', ({ stream }) => { this.#stalled.delete(stream); this.#render(); }),
      // No `stall:end` follows these: without clearing, the spinner would stay forever.
      player.on('engine:detach', clear),
      player.on('error', clear),
      player.on('ended', clear),
      player.on('state:change', () => this.#render()),
    );
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  #render(): void {
    this.element.hidden = this.#stalled.size === 0 || !hasEngine(this.player.state);
  }

  destroy(): void {
    for (const off of this.#unsubscribe) off();
    this.element.remove();
  }
}
