/**
 * Bus de eventos tipado.
 *
 * Es el sistema nervioso del reproductor y el cimiento de tres cosas a la vez:
 * la UI reacciona a él, los plugins se enganchan a él, y la analítica futura se
 * conecta sin tocar el núcleo. Por eso `onAny` existe desde el primer día: si
 * el bus no es observable por completo, enchufar un destino de analítica más
 * adelante obliga a rediseñar.
 *
 * Dos decisiones que parecen detalles y no lo son:
 *
 *   - **Un oyente que lanza no puede tumbar al reproductor.** Los plugins son
 *     código de terceros; si uno revienta, el resto debe seguir recibiendo
 *     eventos. Se aísla cada llamada y el error se reporta aparte.
 *   - **Modificar los oyentes durante un `emit` no altera esa emisión.** Sin
 *     esto, desuscribirse dentro de un manejador se salta a los siguientes, y
 *     es un fallo que aparece una vez cada mil y no hay quien lo reproduzca.
 */

export type Unsubscribe = () => void;

/** Carga útil de un evento que no lleva datos. */
export type Empty = Record<string, never>;

/**
 * Contrato de eventos: nombre → forma de su carga útil.
 *
 * Es `object` y no `Record<string, unknown>` a propósito. Las interfaces de
 * TypeScript no tienen firma de índice implícita, así que un
 * `interface MisEventos { ... }` no satisface un `Record<string, unknown>` y
 * habría que declarar los contratos como `type`.
 *
 * Y eso importa: al ser interfaces, un plugin puede **añadir sus propios
 * eventos por fusión de declaraciones** y recibirlos tipados sin que el núcleo
 * sepa que existe. Cerrar esa puerta por un detalle de la restricción genérica
 * sería un mal cambio.
 */
export type EventMap = object;

export type Listener<T> = (payload: T) => void;
export type AnyListener<E extends EventMap> = <K extends keyof E & string>(
  type: K,
  payload: E[K],
) => void;

/** Contexto de un fallo de un oyente, para poder señalar al culpable. */
export interface ListenerErrorInfo {
  type: string;
  error: unknown;
}

export interface EventBusOptions {
  /**
   * Qué hacer cuando un oyente lanza. Por defecto va a `console.error`: nunca
   * en silencio, porque un plugin que falla sin ruido es indepurable.
   */
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
        console.error(`[nanoplayer] un oyente de "${info.type}" ha lanzado:`, info.error);
      });
  }

  /** Suscribe. Devuelve la función para darse de baja. */
  on<K extends keyof E & string>(type: K, fn: Listener<E[K]>): Unsubscribe {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(fn as Listener<never>);
    return () => this.off(type, fn);
  }

  /** Como `on`, pero se da de baja tras la primera emisión. */
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

  /**
   * Observa **todos** los eventos. Es la vía por la que un destino de analítica
   * se conecta sin que el núcleo sepa que existe.
   */
  onAny(fn: AnyListener<E>): Unsubscribe {
    this.#any.add(fn);
    return () => {
      this.#any.delete(fn);
    };
  }

  emit<K extends keyof E & string>(type: K, payload: E[K]): void {
    // Copias: suscribirse o desuscribirse dentro de un manejador no debe
    // afectar a la emisión en curso.
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

  /** Número de oyentes; de un tipo concreto o de todos, incluidos los `onAny`. */
  listenerCount(type?: keyof E & string): number {
    if (type !== undefined) return this.#listeners.get(type)?.size ?? 0;
    let n = this.#any.size;
    for (const set of this.#listeners.values()) n += set.size;
    return n;
  }

  /** Suelta todas las suscripciones. Se llama al destruir el reproductor. */
  clear(): void {
    this.#listeners.clear();
    this.#any.clear();
  }
}
