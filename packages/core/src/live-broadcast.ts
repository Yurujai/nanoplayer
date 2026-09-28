/**
 * Si cada flujo de un directo está emitiendo, y los reintentos cuando no.
 *
 * La espera crece entre intentos: un evento que empieza dos horas tarde serían
 * miles de peticiones inútiles por espectador. Con tope, porque una espera sin
 * límite tardaría minutos en enterarse de que ya ha empezado. Cómo se reconecta
 * un flujo no es cosa de esta clase: se lo dice quien la usa.
 */
import type { CoreEvents } from './core-events.js';
import type { EventBus } from './events.js';
import { LiveTracker, type LiveStatus, type RetryPolicy } from './live.js';

export interface LiveBroadcastOptions {
  bus: EventBus<CoreEvents>;
  retry?: RetryPolicy;
  /** Vuelve a intentar un flujo. Si falla, debe volver a marcarlo y reintentar. */
  reconnect: (streamId: string) => void;
}

export class LiveBroadcast {
  readonly #tracker = new LiveTracker();
  readonly #esperas = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: LiveBroadcastOptions) {}

  get overall(): LiveStatus {
    return this.#tracker.overall;
  }

  status(streamId: string): LiveStatus {
    return this.#tracker.status(streamId);
  }

  markLive(streamId: string): void {
    if (this.#tracker.markLive(streamId)) this.#anunciar(streamId);
  }

  markUnavailable(streamId: string): void {
    if (this.#tracker.markUnavailable(streamId)) this.#anunciar(streamId);
  }

  retryLater(streamId: string): void {
    clearTimeout(this.#esperas.get(streamId));
    const espera = this.#tracker.nextDelay(streamId, this.options.retry);
    this.#esperas.set(streamId, setTimeout(() => {
      this.#esperas.delete(streamId);
      this.options.reconnect(streamId);
    }, espera));
  }

  cancelRetries(): void {
    for (const t of this.#esperas.values()) clearTimeout(t);
    this.#esperas.clear();
  }

  reset(): void {
    this.cancelRetries();
    this.#tracker.reset();
  }

  #anunciar(streamId: string): void {
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
