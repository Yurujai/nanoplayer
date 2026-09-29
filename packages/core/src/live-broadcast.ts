/**
 * Whether each stream of a live event is on air, and the retries when not.
 * How a stream reconnects is up to the caller.
 */
import type { CoreEvents } from './core-events.js';
import type { EventBus } from './events.js';
import { LiveTracker, type LiveStatus, type RetryPolicy } from './live.js';

export interface LiveBroadcastOptions {
  bus: EventBus<CoreEvents>;
  retry?: RetryPolicy;
  /** Retries a stream. On failure it must mark it unavailable and retry again. */
  reconnect: (streamId: string) => void;
}

export class LiveBroadcast {
  readonly #tracker = new LiveTracker();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: LiveBroadcastOptions) {}

  get overall(): LiveStatus {
    return this.#tracker.overall;
  }

  status(streamId: string): LiveStatus {
    return this.#tracker.status(streamId);
  }

  markLive(streamId: string): void {
    if (this.#tracker.markLive(streamId)) this.#announce(streamId);
  }

  markUnavailable(streamId: string): void {
    if (this.#tracker.markUnavailable(streamId)) this.#announce(streamId);
  }

  retryLater(streamId: string): void {
    clearTimeout(this.#timers.get(streamId));
    const delay = this.#tracker.nextDelay(streamId, this.options.retry);
    this.#timers.set(streamId, setTimeout(() => {
      this.#timers.delete(streamId);
      this.options.reconnect(streamId);
    }, delay));
  }

  cancelRetries(): void {
    for (const t of this.#timers.values()) clearTimeout(t);
    this.#timers.clear();
  }

  reset(): void {
    this.cancelRetries();
    this.#tracker.reset();
  }

  #announce(streamId: string): void {
    const status = this.#tracker.status(streamId);
    if (status === 'unknown') return;
    this.options.bus.emit('live:status', {
      stream: streamId,
      status,
      ...(status === 'live' ? {} :
        { retryInMs: this.#tracker.nextDelay(streamId, this.options.retry) }),
    });
  }
}
