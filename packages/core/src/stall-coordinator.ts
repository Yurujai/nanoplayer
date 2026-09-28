/**
 * Coordina los flujos del contenido cuando uno se queda sin datos.
 *
 * Que uno se quede sin buffer y los demás sigan destroza la sincronización:
 * S1 midió que frenarlos deja el pico de deriva en 7 ms, frente a dejar correr
 * al maestro. Tres reglas, todas aprendidas a base de fallos:
 *
 * 1. **Solo si ya sonaba de verdad.** `play` significa que se ha pedido, no
 *    que suene; con HLS enganchar termina al parsear la lista, antes de tener
 *    un solo segmento, así que el `waiting` inicial es inevitable.
 * 2. **A quien está atascado no se le pausa.** Ya está parado por falta de
 *    datos, y pausarlo aborta su propio `play()` en vuelo con un `AbortError`.
 * 3. **Atascarse es de cada flujo.** Un salto deja a varios rellenando búfer a
 *    la vez; con un solo indicador, el primero en recuperarse lo bajaba y el
 *    segundo se quedaba parado para siempre (medido: 733 ms de deriva clavada
 *    tras retroceder en un directo dual).
 */
import type { MediaEngine } from './engine.js';

export class StallCoordinator {
  readonly #atascados = new Set<string>();
  #pausadosAqui = false;
  #sonando = false;

  constructor(private readonly engines: () => Iterable<[string, MediaEngine]>) {}

  /** Si el contenido llegó a sonar de verdad, y no solo a pedirse. */
  get playing(): boolean {
    return this.#sonando;
  }

  isStalled(streamId: string): boolean {
    return this.#atascados.has(streamId);
  }

  markPlaying(): void {
    this.#sonando = true;
  }

  markNotPlaying(): void {
    this.#sonando = false;
  }

  /**
   * El usuario ha pausado: lo que se frenó aquí ya no se reanuda. Reanudar por
   * sistema resucitaría un vídeo que se había pausado a propósito.
   */
  userPaused(): void {
    this.#sonando = false;
    this.#pausadosAqui = false;
  }

  stallStarted(streamId: string): void {
    this.#atascados.add(streamId);
    if (!this.#sonando) return;
    for (const [id, engine] of this.engines()) {
      if (this.#atascados.has(id)) continue;
      this.#pausadosAqui = true;
      engine.pause();
    }
  }

  stallEnded(streamId: string): void {
    this.#atascados.delete(streamId);
    if (this.#atascados.size > 0 || !this.#pausadosAqui) return;
    this.#pausadosAqui = false;
    for (const [, engine] of this.engines()) void engine.play().catch(() => {});
  }

  /** Al soltar los motores: un atasco pendiente dejaría el conjunto bloqueado. */
  reset(): void {
    this.#atascados.clear();
    this.#pausadosAqui = false;
  }
}
