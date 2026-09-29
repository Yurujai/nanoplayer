/**
 * When one content stream runs out of data, the others are held so they do
 * not run away from it (S1: 7 ms drift peak instead of letting the master run).
 */
import type { MediaEngine } from './engine.js';

export class StallCoordinator {
  readonly #stalled = new Set<string>();
  #pausedHere = false;
  #playing = false;

  constructor(private readonly engines: () => Iterable<[string, MediaEngine]>) {}

  /** Whether the content actually started playing, not merely was asked to. */
  get playing(): boolean {
    return this.#playing;
  }

  isStalled(streamId: string): boolean {
    return this.#stalled.has(streamId);
  }

  markPlaying(): void {
    this.#playing = true;
  }

  markNotPlaying(): void {
    this.#playing = false;
  }

  /** What was held here is not resumed: that would restart a video the user paused. */
  userPaused(): void {
    this.#playing = false;
    this.#pausedHere = false;
  }

  stallStarted(streamId: string): void {
    this.#stalled.add(streamId);
    // The initial `waiting` of HLS start-up is normal: only act once it played.
    if (!this.#playing) return;
    for (const [id, engine] of this.engines()) {
      // Pausing the stalled one aborts its own in-flight play().
      if (this.#stalled.has(id)) continue;
      this.#pausedHere = true;
      engine.pause();
    }
  }

  stallEnded(streamId: string): void {
    this.#stalled.delete(streamId);
    // Stalls are per stream: with one shared flag a second stalled stream stayed
    // paused forever (733 ms of drift stuck after seeking back in a dual live).
    if (this.#stalled.size > 0 || !this.#pausedHere) return;
    this.#pausedHere = false;
    for (const [, engine] of this.engines()) void engine.play().catch(() => {});
  }

  reset(): void {
    this.#stalled.clear();
    this.#pausedHere = false;
  }
}
