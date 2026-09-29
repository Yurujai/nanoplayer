/**
 * A player's lifecycle: holds the state, validates each transition and keeps
 * the position across evictions. No DOM, so it is testable without a browser.
 */
import type { EventBus } from './events.js';
import type { CoreEvents } from './core-events.js';
import {
  assertTransition, canTransition, WITH_ENGINE, WITH_MANIFEST,
  type PlayerState,
} from './state.js';

export class Lifecycle {
  #state: PlayerState = 'idle';
  #resumeAt = 0;
  readonly #bus: EventBus<CoreEvents>;

  constructor(bus: EventBus<CoreEvents>) {
    this.#bus = bus;
  }

  get state(): PlayerState {
    return this.#state;
  }

  /** Where to continue when engines are attached again after an eviction. */
  get resumeAt(): number {
    return this.#resumeAt;
  }

  get hasManifest(): boolean {
    return WITH_MANIFEST.includes(this.#state);
  }

  get hasEngine(): boolean {
    return WITH_ENGINE.includes(this.#state);
  }

  get isDestroyed(): boolean {
    return this.#state === 'destroyed';
  }

  can(to: PlayerState): boolean {
    return canTransition(this.#state, to);
  }

  /** Throws on a disallowed transition. */
  transition(to: PlayerState): void {
    assertTransition(this.#state, to);
    const from = this.#state;
    this.#state = to;
    // Back to `idle` is a full reset: start over, do not continue.
    if (to === 'idle') this.#resumeAt = 0;

    this.#bus.emit('state:change', { from, to });
    if (to === 'destroyed') this.#bus.emit('destroy', {});
  }

  rememberPosition(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.#resumeAt = seconds;
  }

  /** Idempotent. */
  destroy(): void {
    if (this.#state === 'destroyed') return;
    this.transition('destroyed');
  }
}
