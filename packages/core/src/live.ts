/**
 * Estado de emisión de un directo.
 *
 * Distingue cuatro situaciones que se parecen y piden respuestas distintas.
 * La que más se confunde es la última:
 *
 * | Situación | Estado |
 * |---|---|
 * | Aún no se ha conseguido conectar, y nunca se consiguió | `waiting` |
 * | Está emitiendo | `live` |
 * | **Estuvo emitiendo y se cortó** | `interrupted` |
 * | No es un directo | `unknown` |
 *
 * Decirle "el evento aún no ha empezado" a quien llevaba veinte minutos
 * viéndolo sería desconcertante, así que el reproductor tiene que recordar si
 * llegó a emitir alguna vez.
 */
export type LiveStatus = 'unknown' | 'waiting' | 'live' | 'interrupted';

export interface RetryPolicy {
  /** Primera espera, en milisegundos. */
  initialMs?: number;
  /** Tope de la espera. */
  maxMs?: number;
  /** Multiplicador entre intentos. */
  factor?: number;
}

const POR_DEFECTO: Required<RetryPolicy> = {
  initialMs: 2000,
  maxMs: 30000,
  factor: 1.6,
};

/**
 * Espera creciente entre reintentos.
 *
 * Sin crecimiento, un evento que empieza dos horas tarde son miles de
 * peticiones inútiles por espectador. Con tope, porque una espera que crece sin
 * límite acaba tardando minutos en enterarse de que el directo ya empezó.
 */
export function backoff(intento: number, policy: RetryPolicy = {}): number {
  const p = { ...POR_DEFECTO, ...policy };
  const espera = p.initialMs * Math.pow(p.factor, Math.max(0, intento));
  return Math.min(p.maxMs, Math.round(espera));
}

/**
 * Lleva la cuenta del estado de cada flujo de un directo.
 *
 * No hace peticiones ni sabe de HLS: solo recibe qué pasó al intentar
 * enganchar y deduce el estado. Mantenerlo así lo hace probable sin navegador
 * y sirve para cualquier protocolo.
 */
export class LiveTracker {
  readonly #estados = new Map<string, LiveStatus>();
  readonly #emitioAlguna = new Set<string>();
  readonly #intentos = new Map<string, number>();

  status(streamId: string): LiveStatus {
    return this.#estados.get(streamId) ?? 'unknown';
  }

  /** Estado del conjunto: emite si **alguno** emite. */
  get overall(): LiveStatus {
    const todos = [...this.#estados.values()];
    if (todos.length === 0) return 'unknown';
    if (todos.includes('live')) return 'live';
    // Si alguno llegó a emitir, esto es una interrupción y no una espera.
    if (todos.includes('interrupted')) return 'interrupted';
    return todos.includes('waiting') ? 'waiting' : 'unknown';
  }

  get streams(): string[] {
    return [...this.#estados.keys()];
  }

  /** Cuántos flujos siguen sin emitir. */
  get pending(): string[] {
    return [...this.#estados.entries()]
      .filter(([, s]) => s === 'waiting' || s === 'interrupted')
      .map(([id]) => id);
  }

  markLive(streamId: string): boolean {
    this.#emitioAlguna.add(streamId);
    this.#intentos.delete(streamId);
    return this.#set(streamId, 'live');
  }

  /**
   * El flujo no está disponible.
   *
   * Se convierte en `interrupted` si ese flujo llegó a emitir alguna vez, y en
   * `waiting` si nunca lo hizo. Es la distinción que evita el mensaje absurdo.
   */
  markUnavailable(streamId: string): boolean {
    const estado = this.#emitioAlguna.has(streamId) ? 'interrupted' : 'waiting';
    this.#intentos.set(streamId, (this.#intentos.get(streamId) ?? 0) + 1);
    return this.#set(streamId, estado);
  }

  /** Espera hasta el próximo intento de ese flujo. */
  nextDelay(streamId: string, policy?: RetryPolicy): number {
    return backoff((this.#intentos.get(streamId) ?? 1) - 1, policy);
  }

  reset(): void {
    this.#estados.clear();
    this.#emitioAlguna.clear();
    this.#intentos.clear();
  }

  /** Devuelve `true` si el estado ha cambiado. */
  #set(streamId: string, estado: LiveStatus): boolean {
    if (this.#estados.get(streamId) === estado) return false;
    this.#estados.set(streamId, estado);
    return true;
  }
}
