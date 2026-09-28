/**
 * Hides the controls after a while without activity, and never when it would
 * get in the way: not while paused (there is nothing to see behind them), not
 * with the menu open, and not with focus inside, which would lose sight of the
 * control someone is using from the keyboard.
 */
export class AutoHide {
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly delayMs: number,
    private readonly canHide: () => boolean,
  ) {}

  /** Shows the controls and, if something is playing, schedules hiding them. */
  wake(isPlaying: boolean): void {
    this.root.classList.remove('np--inactive');
    this.#clear();
    if (isPlaying) this.schedule();
  }

  schedule(): void {
    if (this.delayMs <= 0) return;
    this.#clear();
    this.#timer = setTimeout(() => this.sleep(), this.delayMs);
  }

  sleep(): void {
    if (!this.canHide()) return;
    if (this.root.contains(this.root.ownerDocument.activeElement)) return;
    this.root.classList.add('np--inactive');
  }

  destroy(): void {
    this.#clear();
    this.root.classList.remove('np--inactive');
  }

  #clear(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
