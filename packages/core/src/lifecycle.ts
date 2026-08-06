/**
 * Ciclo de vida de una instancia: guarda el estado, valida cada transición y
 * conserva la posición entre desalojos.
 *
 * No sabe reproducir nada ni toca el DOM. Solo responde a "¿en qué estado
 * estoy?", "¿puedo pasar a este otro?" y "¿por dónde iba antes de que me
 * soltaran el motor?". Mantenerlo así es lo que permite probar el ciclo de vida
 * entero sin navegador.
 */
import type { EventBus } from './events.js';
import type { CoreEvents } from './core-events.js';
import {
  assertTransition, canTransition, WITH_ENGINE, WITH_MANIFEST,
  type PlayerState,
} from './state.js';

export class Lifecycle {
  #state: PlayerState = 'idle';
  #resumeAt = 0;
  readonly #bus: EventBus<CoreEvents>;

  constructor(bus: EventBus<CoreEvents>) {
    this.#bus = bus;
  }

  get state(): PlayerState {
    return this.#state;
  }

  /**
   * Posición desde la que continuar al volver a enganchar el motor.
   *
   * Es lo que hace del desalojo algo aceptable para el usuario: se le sueltan
   * los recursos, pero al volver retoma donde estaba en lugar de empezar de
   * cero.
   */
  get resumeAt(): number {
    return this.#resumeAt;
  }

  get hasManifest(): boolean {
    return WITH_MANIFEST.includes(this.#state);
  }

  get hasEngine(): boolean {
    return WITH_ENGINE.includes(this.#state);
  }

  get isDestroyed(): boolean {
    return this.#state === 'destroyed';
  }

  can(to: PlayerState): boolean {
    return canTransition(this.#state, to);
  }

  /**
   * Cambia de estado. Lanza si la transición no está permitida: un cambio
   * imposible es un fallo de programación, y tragárselo deja el reproductor
   * incoherente de una forma que se manifiesta lejos de la causa.
   */
  transition(to: PlayerState): void {
    assertTransition(this.#state, to);
    const from = this.#state;
    this.#state = to;

    // Un reinicio completo descarta también la posición: volver a `idle`
    // significa empezar de cero, no continuar.
    if (to === 'idle') this.#resumeAt = 0;

    this.#bus.emit('state:change', { from, to });
    if (to === 'destroyed') this.#bus.emit('destroy', {});
  }

  /**
   * Anota por dónde va la reproducción, para poder retomarla tras un desalojo.
   * Lo llama el reproductor antes de soltar el motor.
   */
  rememberPosition(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.#resumeAt = seconds;
  }

  /** Va a `destroyed` desde donde sea. Idempotente. */
  destroy(): void {
    if (this.#state === 'destroyed') return;
    this.transition('destroyed');
  }
}
