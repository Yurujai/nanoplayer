import type { Player } from '@nanoplayer/core';
import { Listeners } from './dom.js';
import { seekBy } from './seek.js';

const DOUBLE_TAP_MS = 300;
const TAP_SEEK = 10;
const HINT_MS = 700;

export interface GestureActions {
  togglePlay(): void;
  toggleFullscreen(): void;
  /** Shows the controls if hidden, hides them if shown. */
  toggleControls(): void;
  isMenuOpen(): boolean;
}

type Side = 'back' | 'forward';

/**
 * Pointer gestures on the video. Every one has a keyboard and button
 * equivalent (play, F, J/L): these are shortcuts, never the only way.
 *
 * - Mouse: click plays or pauses, double click toggles full screen.
 * - Touch: a tap shows or hides the controls, as pausing on every touch to
 *   reveal them would be hostile; a double tap on either half seeks 10 s,
 *   and each further quick tap adds 10 s more.
 */
export class VideoGestures {
  readonly #listeners = new Listeners();
  readonly #hint: HTMLElement;
  #pointer = 'mouse';
  #menuWasOpen = false;
  #lastTap: { at: number; side: Side } | null = null;
  #streak = 0;
  #hintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly stage: HTMLElement,
    root: HTMLElement,
    private readonly player: Player,
    private readonly actions: GestureActions,
    private readonly now: () => number = () => performance.now(),
  ) {
    const doc = root.ownerDocument;
    this.#hint = doc.createElement('div');
    this.#hint.className = 'np__seek-hint';
    this.#hint.setAttribute('aria-hidden', 'true');
    this.#hint.hidden = true;
    root.appendChild(this.#hint);

    // On the window, in capture: it runs before the menu's own outside-click
    // handler closes it. A click that only closes the menu must not pause.
    const win = doc.defaultView ?? globalThis;
    this.#listeners.on(win, 'pointerdown', (ev: PointerEvent) => {
      if (!stage.contains(ev.target as Node)) return;
      this.#pointer = ev.pointerType || 'mouse';
      this.#menuWasOpen = actions.isMenuOpen();
    }, true);
    this.#listeners.on(stage, 'click', (ev: MouseEvent) => this.#onClick(ev));
    this.#listeners.on(stage, 'dblclick', () => {
      if (this.#pointer !== 'touch') actions.toggleFullscreen();
    });
  }

  #onClick(ev: MouseEvent): void {
    if (this.#menuWasOpen) {
      this.#menuWasOpen = false;
      return;
    }
    if (this.#pointer === 'touch') this.#onTap(ev.clientX);
    else this.actions.togglePlay();
  }

  #onTap(x: number): void {
    const box = this.stage.getBoundingClientRect();
    const side: Side = x < box.left + box.width / 2 ? 'back' : 'forward';
    const at = this.now();
    const last = this.#lastTap;
    this.#lastTap = { at, side };

    const repeated = last && at - last.at < DOUBLE_TAP_MS && last.side === side;
    if (!repeated) {
      this.#streak = 0;
      this.actions.toggleControls();
      return;
    }
    // The intro has no bar to refer a seek to, as with the seeking keys.
    if (this.player.phase === 'intro') return;
    seekBy(this.player, side === 'back' ? -TAP_SEEK : TAP_SEEK);
    this.#streak += 1;
    this.#showHint(side);
  }

  #showHint(side: Side): void {
    const hint = this.#hint;
    hint.dataset['side'] = side;
    hint.textContent = `${side === 'back' ? '−' : '+'}${this.#streak * TAP_SEEK} s`;
    hint.hidden = false;
    // Restarts the fade for every tap of a streak.
    hint.style.animation = 'none';
    void hint.offsetWidth;
    hint.style.animation = '';
    if (this.#hintTimer) clearTimeout(this.#hintTimer);
    this.#hintTimer = setTimeout(() => {
      hint.hidden = true;
      this.#streak = 0;
    }, HINT_MS);
  }

  destroy(): void {
    if (this.#hintTimer) clearTimeout(this.#hintTimer);
    this.#listeners.removeAll();
    this.#hint.remove();
  }
}
