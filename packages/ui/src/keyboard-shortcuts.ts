import type { Player } from '@nanoplayer/core';
import { seekBy } from './seek.js';

const SHORT_SEEK = 5;
const LONG_SEEK = 10;

/** What the shortcuts can ask the control bar to do. */
export interface ShortcutActions {
  togglePlay(): void;
  toggleMute(): void;
  stepVolume(direction: 1 | -1): void;
  toggleFullscreen(): void;
  isMenuOpen(): boolean;
  /** A shortcut ran: the bar should show itself. */
  used(): void;
}

interface Shortcut {
  keys: readonly string[];
  /** Moves the playback position: blocked during the intro, which has no bar to refer it to. */
  seeks: boolean;
  run(player: Player): void;
}

/** Keys the focused control already uses: taking them would break native behaviour. */
const CONTROL_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', ' ', 'Enter', 'PageUp', 'PageDown',
]);

const isControl = (el: EventTarget | null) => el instanceof HTMLInputElement
  || el instanceof HTMLButtonElement
  || el instanceof HTMLSelectElement
  || el instanceof HTMLTextAreaElement;

/**
 * Player keyboard shortcuts, as one table: a shortcut that moves the position
 * says so once, and that single flag is what blocks it during the intro.
 * During the outro seeking keys still run: backwards they return to the
 * content, forwards the player ignores them because the outro cannot be skipped.
 */
export class KeyboardShortcuts {
  readonly #shortcuts: readonly Shortcut[];

  constructor(private readonly player: Player, private readonly actions: ShortcutActions) {
    const by = (delta: number) => (p: Player) => seekBy(p, delta);
    this.#shortcuts = [
      { keys: [' ', 'k', 'K'], seeks: false, run: () => actions.togglePlay() },
      { keys: ['ArrowLeft'], seeks: true, run: by(-SHORT_SEEK) },
      { keys: ['ArrowRight'], seeks: true, run: by(SHORT_SEEK) },
      { keys: ['j', 'J'], seeks: true, run: by(-LONG_SEEK) },
      { keys: ['l', 'L'], seeks: true, run: by(LONG_SEEK) },
      { keys: ['ArrowUp'], seeks: false, run: () => actions.stepVolume(1) },
      { keys: ['ArrowDown'], seeks: false, run: () => actions.stepVolume(-1) },
      { keys: ['m', 'M'], seeks: false, run: () => actions.toggleMute() },
      { keys: ['f', 'F'], seeks: false, run: () => actions.toggleFullscreen() },
      { keys: ['Home'], seeks: true, run: (p) => p.seek(0) },
      { keys: ['End'], seeks: true, run: (p) => p.seek(p.duration || 0) },
      ...['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) => ({
        keys: [key], seeks: true, run: (p: Player) => p.seek((Number(key) / 10) * (p.duration || 0)),
      })),
    ];
  }

  handle(ev: KeyboardEvent): void {
    if (isControl(ev.target) && CONTROL_KEYS.has(ev.key)) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (this.actions.isMenuOpen()) return;

    const shortcut = this.#shortcuts.find((s) => s.keys.includes(ev.key));
    if (!shortcut) return;
    if (shortcut.seeks && this.player.phase === 'intro') return;
    shortcut.run(this.player);
    ev.preventDefault();
    this.actions.used();
  }
}
