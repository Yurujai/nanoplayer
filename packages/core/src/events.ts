/**
 * Typed event bus: the UI reacts to it, plugins hook into it, and analytics
 * plugs in through `onAny` without touching the core. A throwing listener is
 * isolated so it cannot take the player down, and listeners added or removed
 * during an `emit` do not change that emission.
 */

export type Unsubscribe = () => void;

/** Payload of an event that carries no data. */
export type Empty = Record<string, never>;

/**
 * Event name → payload shape. `object`, not `Record<string, unknown>`, so event
 * maps can be interfaces and plugins can add their own events by declaration
 * merging.
 */
export type EventMap = object;

export type Listener<T> = (payload: T) => void;
export type AnyListener<E extends EventMap> = <K extends keyof E & string>(
  type: K,
  payload: E[K],
) => void;

/** Context of a failing listener, to point at the culprit. */
export interface ListenerErrorInfo {
  type: string;
  error: unknown;
}

export interface EventBusOptions {
  /** What to do when a listener throws. Defaults to `console.error`, never silence. */
  onListenerError?: (info: ListenerErrorInfo) => void;
}

export class EventBus<E extends EventMap> {
  readonly #listeners = new Map<string, Set<Listener<never>>>();
  readonly #any = new Set<AnyListener<E>>();
  readonly #onListenerError: (info: ListenerErrorInfo) => void;

  constructor(options: EventBusOptions = {}) {
    this.#onListenerError =
      options.onListenerError ??
      ((info) => {
        console.error(`[nanoplayer] a "${info.type}" listener threw:`, info.error);
      });
  }

  /** Returns the function that unsubscribes. */
  on<K extends keyof E & string>(type: K, fn: Listener<E[K]>): Unsubscribe {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(fn as Listener<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof E & string>(type: K, fn: Listener<E[K]>): Unsubscribe {
    const un = this.on(type, ((payload: E[K]) => {
      un();
      fn(payload);
    }) as Listener<E[K]>);
    return un;
  }

  off<K extends keyof E & string>(type: K, fn: Listener<E[K]>): void {
    const set = this.#listeners.get(type);
    if (!set) return;
    set.delete(fn as Listener<never>);
    if (set.size === 0) this.#listeners.delete(type);
  }

  /** Observes every event: how an analytics sink plugs in. */
  onAny(fn: AnyListener<E>): Unsubscribe {
    this.#any.add(fn);
    return () => {
      this.#any.delete(fn);
    };
  }

  emit<K extends keyof E & string>(type: K, payload: E[K]): void {
    // Copies, so unsubscribing inside a handler does not skip the next ones.
    const set = this.#listeners.get(type);
    if (set) {
      for (const fn of [...set]) {
        try {
          (fn as Listener<E[K]>)(payload);
        } catch (error) {
          this.#onListenerError({ type, error });
        }
      }
    }
    for (const fn of [...this.#any]) {
      try {
        fn(type, payload);
      } catch (error) {
        this.#onListenerError({ type, error });
      }
    }
  }

  /** Listener count for a type, or of all, `onAny` included. */
  listenerCount(type?: keyof E & string): number {
    if (type !== undefined) return this.#listeners.get(type)?.size ?? 0;
    let n = this.#any.size;
    for (const set of this.#listeners.values()) n += set.size;
    return n;
  }

  clear(): void {
    this.#listeners.clear();
    this.#any.clear();
  }
}
