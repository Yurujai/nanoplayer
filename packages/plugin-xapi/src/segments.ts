/**
 * What was really watched, as intervals of visible time. Progress comes from
 * their union, not from the position: dragging to the end has not watched it.
 */
export class PlayedSegments {
  #closed: Array<[number, number]> = [];
  #openAt: number | null = null;

  get playing(): boolean {
    return this.#openAt !== null;
  }

  start(at: number): void {
    if (this.#openAt === null) this.#openAt = at;
  }

  end(at: number): void {
    if (this.#openAt === null) return;
    if (at > this.#openAt) this.#closed.push([this.#openAt, at]);
    this.#openAt = null;
  }

  /** With the open segment counted up to `now`. */
  #all(now?: number): Array<[number, number]> {
    const all = [...this.#closed];
    if (this.#openAt !== null && now !== undefined && now > this.#openAt) all.push([this.#openAt, now]);
    return all;
  }

  /** The xAPI Video Profile format: `0[.]12.5[,]30[.]41`. */
  format(now?: number): string {
    const round = (n: number) => String(Math.round(n * 1000) / 1000);
    return this.#all(now).map(([a, b]) => `${round(a)}[.]${round(b)}`).join('[,]');
  }

  /** Share of `duration` watched, 0 to 1, each second counted once. */
  progress(duration: number, now?: number): number {
    if (!(duration > 0)) return 0;
    const sorted = this.#all(now).sort((a, b) => a[0] - b[0]);
    let watched = 0;
    let reach = -Infinity;
    for (const [a, b] of sorted) {
      const from = Math.max(a, reach);
      if (b > from) watched += b - from;
      reach = Math.max(reach, b);
    }
    return Math.min(1, watched / duration);
  }
}
