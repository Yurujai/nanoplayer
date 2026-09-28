import type { Player, Translate } from '@nanoplayer/core';

export interface LiveNoticesContext {
  root: HTMLElement;
  stage: HTMLElement;
  player: Player;
  t: Translate;
  announce(message: string): void;
  /**
   * Moves the player's stream boxes into the stage. The notice for a stream
   * that is not broadcasting arrives **before** `engine:attach:ok`, while its
   * box still hangs from the container: without collecting first, the notice
   * ended up loose in the stage, on top of the stream that was broadcasting.
   */
  collectStreams(): void;
}

/**
 * The notice over each live stream that is not on air. It goes **over that
 * stream's box**, not the whole player: if the camera broadcasts and the
 * slides do not, the camera must stay visible.
 */
export class LiveNotices {
  constructor(private readonly ctx: LiveNoticesContext) {}

  update(stream: string, status: string): void {
    const { root, t } = this.ctx;
    this.ctx.collectStreams();
    const existing = root.querySelector<HTMLElement>(`[data-espera="${CSS.escape(stream)}"]`);
    if (status === 'live') {
      existing?.remove();
      return;
    }

    // "Not started yet" and "interrupted" differ: someone who was watching for
    // twenty minutes must not read that it has not started.
    const text = t(status === 'interrupted' ? 'ui.live.interrupted' : 'ui.live.waiting');
    if (existing) {
      existing.querySelector('.np__espera-texto')!.textContent = text;
      return;
    }
    const box = root.querySelector<HTMLElement>(`[data-stream="${CSS.escape(stream)}"]`);
    (box ?? this.ctx.stage).appendChild(this.#notice(stream, text));
    this.ctx.announce(text);
  }

  #notice(stream: string, text: string): HTMLElement {
    const doc = this.ctx.root.ownerDocument;
    const layer = doc.createElement('div');
    layer.className = 'np__espera';
    layer.dataset['espera'] = stream;
    layer.setAttribute('role', 'status');
    const image = this.ctx.player.liveWaitingImage;
    if (image) layer.style.backgroundImage = `url("${image.replace(/"/g, '%22')}")`;
    const p = doc.createElement('p');
    p.className = 'np__espera-texto';
    p.textContent = text;
    layer.appendChild(p);
    return layer;
  }
}
