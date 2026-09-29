/**
 * Broadcast status of a live stream. `interrupted` (it was on air and dropped)
 * is kept apart from `waiting` (it never was): telling someone who watched for
 * twenty minutes that the event has not started would be absurd.
 */
export type LiveStatus = 'unknown' | 'waiting' | 'live' | 'interrupted';

export interface RetryPolicy {
  /** First delay, in ms. */
  initialMs?: number;
  /** Delay cap, in ms. */
  maxMs?: number;
  /** Multiplier between attempts. */
  factor?: number;
}

const DEFAULTS: Required<RetryPolicy> = {
  initialMs: 2000,
  maxMs: 30000,
  factor: 1.6,
};

/**
 * Growing delay between retries: without growth, an event starting two hours
 * late means thousands of useless requests per viewer; without a cap, it takes
 * minutes to notice it started.
 */
export function backoff(attempt: number, policy: RetryPolicy = {}): number {
  const p = { ...DEFAULTS, ...policy };
  const delay = p.initialMs * Math.pow(p.factor, Math.max(0, attempt));
  return Math.min(p.maxMs, Math.round(delay));
}

/** Tracks each live stream's status from attach outcomes. No network, no HLS. */
export class LiveTracker {
  readonly #statuses = new Map<string, LiveStatus>();
  readonly #everLive = new Set<string>();
  readonly #attempts = new Map<string, number>();

  status(streamId: string): LiveStatus {
    return this.#statuses.get(streamId) ?? 'unknown';
  }

  /** The whole set is live if **any** stream is. */
  get overall(): LiveStatus {
    const all = [...this.#statuses.values()];
    if (all.length === 0) return 'unknown';
    if (all.includes('live')) return 'live';
    if (all.includes('interrupted')) return 'interrupted';
    return all.includes('waiting') ? 'waiting' : 'unknown';
  }

  get streams(): string[] {
    return [...this.#statuses.keys()];
  }

  /** Streams still not on air. */
  get pending(): string[] {
    return [...this.#statuses.entries()]
      .filter(([, s]) => s === 'waiting' || s === 'interrupted')
      .map(([id]) => id);
  }

  markLive(streamId: string): boolean {
    this.#everLive.add(streamId);
    this.#attempts.delete(streamId);
    return this.#set(streamId, 'live');
  }

  /** `interrupted` if the stream was ever live, `waiting` otherwise. */
  markUnavailable(streamId: string): boolean {
    const status = this.#everLive.has(streamId) ? 'interrupted' : 'waiting';
    this.#attempts.set(streamId, (this.#attempts.get(streamId) ?? 0) + 1);
    return this.#set(streamId, status);
  }

  nextDelay(streamId: string, policy?: RetryPolicy): number {
    return backoff((this.#attempts.get(streamId) ?? 1) - 1, policy);
  }

  reset(): void {
    this.#statuses.clear();
    this.#everLive.clear();
    this.#attempts.clear();
  }

  /** Returns `true` when the status changed. */
  #set(streamId: string, status: LiveStatus): boolean {
    if (this.#statuses.get(streamId) === status) return false;
    this.#statuses.set(streamId, status);
    return true;
  }
}
