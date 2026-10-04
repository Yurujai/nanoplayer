/**
 * Coordination between the players on one page. It comes from a real course
 * page with dozens of players where each fetched its metadata and buffered on
 * load, bringing the application's servers down. Here it is default behaviour:
 *
 *   1. **Exclusive playback** — starting one pauses the others.
 *   2. **Resource budget** — at most N players with engines attached; the one
 *      unused for longest is evicted. see docs/browser-quirks.md#decoder-limit
 *   3. **Resolve on visibility** — what is off screen does not fetch its manifest.
 */
import type { Player } from './player.js';
import type { Unsubscribe } from './events.js';
import { hasEngine } from './state.js';

export interface RegistryOptions {
  /** Pause the others when one plays. On by default. */
  exclusive?: boolean;
  /**
   * Maximum players with engines attached at once; `0` or absent turns it off.
   * Leave room below the browser's limit: a dual-stream player uses two elements.
   */
  maxAttached?: number;
  /** Resolve the manifest when entering the viewport. */
  resolveWhenVisible?: boolean;
  /** Look-ahead margin of the visibility observer. */
  rootMargin?: string;
  /** Injectable for tests. */
  now?: () => number;
  createObserver?: (cb: IntersectionObserverCallback, options: IntersectionObserverInit)
    => IntersectionObserver;
}

interface Entry {
  player: Player;
  lastUsed: number;
  undo: Unsubscribe[];
}

export class PlayerRegistry {
  readonly #entries = new Map<Player, Entry>();
  readonly #opts: Required<Pick<RegistryOptions, 'exclusive' | 'maxAttached' | 'resolveWhenVisible' | 'rootMargin'>>;
  readonly #now: () => number;
  #observer: IntersectionObserver | null = null;
  readonly #byElement = new WeakMap<Element, Player>();

  constructor(options: RegistryOptions = {}) {
    this.#opts = {
      exclusive: options.exclusive ?? true,
      maxAttached: options.maxAttached ?? 0,
      resolveWhenVisible: options.resolveWhenVisible ?? false,
      rootMargin: options.rootMargin ?? '200px',
    };
    this.#now = options.now ?? (() => Date.now());

    if (this.#opts.resolveWhenVisible) {
      const create = options.createObserver
        ?? ((cb, o) => new IntersectionObserver(cb, o));
      try {
        this.#observer = create(
          (entries) => this.#onVisible(entries),
          { rootMargin: this.#opts.rootMargin },
        );
      } catch {
        // Without IntersectionObserver only the optimisation is lost.
        this.#observer = null;
      }
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  /** How many have engines attached right now. */
  get attachedCount(): number {
    let n = 0;
    for (const { player } of this.#entries.values()) {
      if (hasEngine(player.state)) n++;
    }
    return n;
  }

  players(): Player[] {
    return [...this.#entries.keys()];
  }

  register(player: Player): Unsubscribe {
    if (this.#entries.has(player)) return () => this.unregister(player);

    const undo: Unsubscribe[] = [];
    const entry: Entry = { player, lastUsed: this.#now(), undo };
    this.#entries.set(player, entry);

    undo.push(player.on('play', () => {
      entry.lastUsed = this.#now();
      if (this.#opts.exclusive) this.#pauseOthers(player);
      this.#enforceBudget(player);
    }));

    undo.push(player.on('engine:attach:ok', () => {
      entry.lastUsed = this.#now();
      this.#enforceBudget(player);
    }));

    undo.push(player.on('destroy', () => this.unregister(player)));

    if (this.#observer) {
      this.#byElement.set(player.container, player);
      this.#observer.observe(player.container);
    }

    return () => this.unregister(player);
  }

  unregister(player: Player): void {
    const entry = this.#entries.get(player);
    if (!entry) return;
    for (const off of entry.undo) off();
    this.#entries.delete(player);
    this.#observer?.unobserve(player.container);
  }

  pauseAll(): void {
    for (const { player } of this.#entries.values()) {
      if (player.state === 'active') player.pause();
    }
  }

  /** Detaches every engine: useful when a tab is hidden or a view unmounted. */
  detachAll(): void {
    for (const { player } of this.#entries.values()) player.detach();
  }

  destroy(): void {
    for (const player of [...this.#entries.keys()]) this.unregister(player);
    this.#observer?.disconnect();
    this.#observer = null;
  }

  #pauseOthers(except: Player): void {
    for (const { player } of this.#entries.values()) {
      if (player !== except && player.state === 'active') player.pause();
    }
  }

  /**
   * Detaches engines until back within budget. It acts after attaching, so the
   * limit can be exceeded by one for an instant. It never evicts the player
   * just used, and a playing one only as a last resort.
   */
  #enforceBudget(justUsed: Player): void {
    const max = this.#opts.maxAttached;
    if (max <= 0) return;

    let excess = this.attachedCount - max;
    if (excess <= 0) return;

    const candidates = [...this.#entries.values()]
      .filter((e) => e.player !== justUsed && hasEngine(e.player.state))
      .sort((a, b) => a.lastUsed - b.lastUsed);

    const ordered = [
      ...candidates.filter((e) => e.player.state !== 'active'),
      ...candidates.filter((e) => e.player.state === 'active'),
    ];

    for (const e of ordered) {
      if (excess <= 0) break;
      e.player.detach();
      excess--;
    }
  }

  #onVisible(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const player = this.#byElement.get(entry.target);
      if (!player || player.state !== 'idle') continue;
      // The failure already travels on the player's own bus.
      void player.resolve().catch(() => {});
    }
  }
}

export interface BatchResolverOptions {
  /** Milliseconds to wait to group requests. */
  windowMs?: number;
  /** Maximum items per batch. */
  maxBatch?: number;
}

/**
 * Turns a batch resolver into a single one: however many players a page has,
 * `fetchMany` gets all their keys at once and makes **one** request. It also
 * deduplicates: two players of the same video share the answer.
 *
 * ```ts
 * const resolver = createBatchResolver(async (ids) => {
 *   const r = await fetch('/api/videos?ids=' + ids.join(','));
 *   return r.json();            // { [id]: manifest }
 * });
 * ```
 */
export function createBatchResolver(
  fetchMany: (srcs: string[]) => Promise<Record<string, unknown>>,
  options: BatchResolverOptions = {},
): (src: string) => Promise<unknown> {
  const windowMs = options.windowMs ?? 10;
  const maxBatch = options.maxBatch ?? 50;

  let pending = new Map<string, Array<{
    resolve: (v: unknown) => void; reject: (e: unknown) => void;
  }>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const batch = pending;
    pending = new Map();
    if (batch.size === 0) return;

    fetchMany([...batch.keys()]).then(
      (result) => {
        for (const [src, waiting] of batch) {
          const value = result[src];
          for (const p of waiting) {
            if (value === undefined) {
              p.reject(new Error(`The batch returned nothing for "${src}"`));
            } else {
              p.resolve(value);
            }
          }
        }
      },
      (error) => {
        for (const waiting of batch.values()) {
          for (const p of waiting) p.reject(error);
        }
      },
    );
  };

  return (src) => new Promise((resolve, reject) => {
    const already = pending.get(src);
    if (already) { already.push({ resolve, reject }); return; }
    pending.set(src, [{ resolve, reject }]);

    if (pending.size >= maxBatch) {
      if (timer) clearTimeout(timer);
      flush();
      return;
    }
    timer ??= setTimeout(flush, windowMs);
  });
}
