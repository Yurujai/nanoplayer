/**
 * The content streams: their engines, the boxes they mount in and the
 * synchronizer that keeps them together. Only the mechanics; position, muting
 * and callbacks are decided by the caller.
 */
import type { CoreEvents } from './core-events.js';
import { selectEngine, type AttachOptions, type EngineFactory, type MediaEngine } from './engine.js';
import { playerError } from './errors.js';
import type { EventBus } from './events.js';
import type { Manifest, Stream } from './manifest.js';
import { masterStream, slaveStreams } from './manifest-queries.js';
import { Synchronizer, type SyncProfile } from './sync.js';

export interface ContentSetOptions {
  container: HTMLElement;
  engines: readonly EngineFactory[];
  bus: EventBus<CoreEvents>;
  syncProfile?: SyncProfile;
}

export class ContentSet {
  readonly #engines = new Map<string, MediaEngine>();
  readonly #boxes = new Map<string, HTMLElement>();
  #sync: Synchronizer | null = null;

  constructor(private readonly options: ContentSetOptions) {}

  engine(streamId: string): MediaEngine | null {
    return this.#engines.get(streamId) ?? null;
  }

  entries(): IterableIterator<[string, MediaEngine]> {
    return this.#engines.entries();
  }

  engines(): IterableIterator<MediaEngine> {
    return this.#engines.values();
  }

  /**
   * Attaches a stream and returns the chosen engine's name. In a live stream
   * the box is kept on failure: the UI puts the "not on air" notice in it.
   */
  async attach(stream: Stream, options: AttachOptions, keepBoxOnFailure: boolean): Promise<string> {
    const factory = selectEngine(this.options.engines, stream);
    if (!factory) {
      throw playerError('engine/unsupported', `No engine can play stream "${stream.id}"`);
    }
    // A retry must reuse the box, not add another.
    let box = this.#boxes.get(stream.id);
    if (!box) {
      box = document.createElement('div');
      box.dataset['stream'] = stream.id;
      box.dataset['role'] = stream.role;
      this.options.container.appendChild(box);
      this.#boxes.set(stream.id, box);
    }

    const engine = factory.create();
    this.#engines.set(stream.id, engine);
    try {
      await engine.attach(box, stream, options);
    } catch (error) {
      engine.destroy();
      this.#engines.delete(stream.id);
      if (!keepBoxOnFailure) {
        box.remove();
        this.#boxes.delete(stream.id);
      }
      throw error;
    }
    return factory.name;
  }

  mountSync(manifest: Manifest): void {
    const masterId = masterStream(manifest).id;
    const master = this.#engines.get(masterId);
    const slaves = slaveStreams(manifest)
      .map((s) => ({ id: s.id, engine: this.#engines.get(s.id) }))
      .filter((x): x is { id: string; engine: MediaEngine } => !!x.engine);
    if (!master || slaves.length === 0) return;

    this.#sync = new Synchronizer({
      master: { id: masterId, engine: master },
      slaves,
      live: manifest.live === true,
      bus: this.options.bus,
      ...(this.options.syncProfile ? { profile: this.options.syncProfile } : {}),
    });
    this.#sync.align();
  }

  /**
   * The master first: it sets the clock the others chase. Aligning before the
   * loop starts, or the start-up lag would stay as an offset.
   */
  async play(masterId: string): Promise<void> {
    await this.#engines.get(masterId)?.play();
    for (const [id, e] of this.#engines) {
      if (id !== masterId) await e.play().catch(() => {});
    }
    this.#sync?.align();
    this.#sync?.start();
  }

  pause(): void {
    this.#sync?.stop();
    for (const e of this.#engines.values()) e.pause();
  }

  /** Snaps the slaves into place after a seek. */
  align(): void {
    this.#sync?.align();
  }

  release(): void {
    this.#sync?.stop();
    this.#sync = null;
    for (const e of this.#engines.values()) e.destroy();
    this.#engines.clear();
    for (const box of this.#boxes.values()) box.remove();
    this.#boxes.clear();
  }
}
