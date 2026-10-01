import { hasEngine, type Player, type PlayerError, type Translate } from '@nanoplayer/core';

/**
 * What failed, on screen, with a retry when retrying can help. The live
 * region has already announced it, so the panel is not a live region too.
 */
export class ErrorDisplay {
  readonly element: HTMLElement;
  readonly #message: HTMLElement;
  readonly #retry: HTMLButtonElement;
  readonly #unsubscribe: Array<() => void> = [];

  constructor(
    doc: Document,
    private readonly player: Player,
    t: Translate,
    private readonly text: (error: PlayerError) => string,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'np__error';
    this.element.hidden = true;

    const box = doc.createElement('div');
    box.className = 'np__error-box';
    this.#message = doc.createElement('p');
    this.#message.className = 'np__error-text';
    this.#retry = doc.createElement('button');
    this.#retry.type = 'button';
    this.#retry.className = 'np__error-retry';
    this.#retry.textContent = t('ui.error.retry');
    this.#retry.setAttribute('aria-label', t('ui.error.retry'));
    this.#retry.addEventListener('click', () => this.#onRetry());
    box.append(this.#message, this.#retry);
    this.element.appendChild(box);

    const hide = () => { this.element.hidden = true; };
    this.#unsubscribe.push(
      player.on('error', ({ error }) => this.#show(error)),
      player.on('play', hide),
      player.on('engine:attach:ok', hide),
    );
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  #show(error: PlayerError): void {
    // Blocked autoplay only needs the play button. A live drop shows the
    // interrupted notice and retries by itself.
    if (error.code === 'media/blocked') return;
    if (this.player.manifest?.live && error.retryable) return;
    this.#message.textContent = this.text(error);
    this.#retry.hidden = !error.retryable;
    this.element.hidden = false;
  }

  /** A broken engine does not recover in place: release it and start again from where it was. */
  #onRetry(): void {
    // The button is about to hide: keep focus in the player, not on <body>.
    if (this.element.contains(this.element.ownerDocument.activeElement)) this.player.container.focus();
    this.element.hidden = true;
    if (hasEngine(this.player.state)) this.player.detach();
    void this.player.play().catch(() => {});
  }

  destroy(): void {
    for (const off of this.#unsubscribe) off();
    this.element.remove();
  }
}
