/**
 * Los flujos del contenido: sus motores, las cajas donde se montan y el
 * sincronizador que los mantiene juntos.
 *
 * Solo hace lo mecánico. Qué posición, si va en silencio y qué callbacks usa
 * cada flujo lo decide quien lo usa, que es quien sabe de recorte, cabecera o
 * directo.
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
  readonly #motores = new Map<string, MediaEngine>();
  readonly #cajas = new Map<string, HTMLElement>();
  #sync: Synchronizer | null = null;

  constructor(private readonly options: ContentSetOptions) {}

  engine(streamId: string): MediaEngine | null {
    return this.#motores.get(streamId) ?? null;
  }

  entries(): IterableIterator<[string, MediaEngine]> {
    return this.#motores.entries();
  }

  engines(): IterableIterator<MediaEngine> {
    return this.#motores.values();
  }

  /**
   * Engancha un flujo y devuelve el nombre del motor elegido.
   *
   * En directo, **la caja se conserva aunque falle**: es el hueco donde la
   * interfaz pone el aviso de que ese flujo no emite. Sin ella el mensaje
   * acabaría encima del flujo que sí funciona.
   */
  async attach(stream: Stream, options: AttachOptions, keepBoxOnFailure: boolean): Promise<string> {
    const factory = selectEngine(this.options.engines, stream);
    if (!factory) {
      throw playerError('engine/unsupported', `No engine can play stream "${stream.id}"`);
    }
    // Reutilizar la caja si ya existe: un reintento no debe duplicarla.
    let caja = this.#cajas.get(stream.id);
    if (!caja) {
      caja = document.createElement('div');
      caja.dataset['stream'] = stream.id;
      caja.dataset['role'] = stream.role;
      this.options.container.appendChild(caja);
      this.#cajas.set(stream.id, caja);
    }

    const engine = factory.create();
    this.#motores.set(stream.id, engine);
    try {
      await engine.attach(caja, stream, options);
    } catch (error) {
      engine.destroy();
      this.#motores.delete(stream.id);
      if (!keepBoxOnFailure) {
        caja.remove();
        this.#cajas.delete(stream.id);
      }
      throw error;
    }
    return factory.name;
  }

  /** Monta el sincronizador con los flujos que hayan enganchado. */
  mountSync(manifest: Manifest): void {
    const maestroId = masterStream(manifest).id;
    const maestro = this.#motores.get(maestroId);
    const esclavos = slaveStreams(manifest)
      .map((s) => ({ id: s.id, engine: this.#motores.get(s.id) }))
      .filter((x): x is { id: string; engine: MediaEngine } => !!x.engine);
    if (!maestro || esclavos.length === 0) return;

    this.#sync = new Synchronizer({
      master: { id: maestroId, engine: maestro },
      slaves: esclavos,
      live: manifest.live === true,
      bus: this.options.bus,
      ...(this.options.syncProfile ? { profile: this.options.syncProfile } : {}),
    });
    this.#sync.align();
  }

  /**
   * Arranca todos los flujos. El maestro primero: es quien fija el reloj que
   * los demás persiguen. Se cuadra antes de arrancar el lazo, porque el retraso
   * de partida quedaría como offset y la corrección suave tardaría en absorberlo.
   */
  async play(masterId: string): Promise<void> {
    await this.#motores.get(masterId)?.play();
    for (const [id, e] of this.#motores) {
      if (id !== masterId) await e.play().catch(() => {});
    }
    this.#sync?.align();
    this.#sync?.start();
  }

  pause(): void {
    this.#sync?.stop();
    for (const e of this.#motores.values()) e.pause();
  }

  /** Cuadra los esclavos de golpe, tras un salto. */
  align(): void {
    this.#sync?.align();
  }

  /** Suelta motores, sincronizador y cajas. */
  release(): void {
    this.#sync?.stop();
    this.#sync = null;
    for (const e of this.#motores.values()) e.destroy();
    this.#motores.clear();
    for (const caja of this.#cajas.values()) caja.remove();
    this.#cajas.clear();
  }
}
