/**
 * Dónde está el borde de un directo y cuánto se va por detrás.
 *
 * Todo sale del motor del maestro: su tramo alcanzable (`seekable`) es la
 * ventana DVR, y su final, el borde.
 */
import type { MediaEngine } from './engine.js';

/**
 * Margen por detrás del borde al saltar al directo, en segundos, cuando el
 * motor no sabe recomendar una posición. Ir al final exacto provoca un corte
 * inmediato: ese instante todavía no está en el búfer.
 */
export const LIVE_EDGE_MARGIN = 3;

/**
 * Hasta cuántos segundos por detrás se sigue considerando "en directo". S5
 * midió unos 6 s de retraso normal con hls.js: la tolerancia deja margen para
 * no llamar "retrasado" a lo que es el búfer haciendo su trabajo.
 */
export const LIVE_EDGE_TOLERANCE = 12;

export class LiveEdge {
  constructor(private readonly master: () => MediaEngine | null) {}

  /** Cuánto se puede retroceder, en segundos. `0` si no hay nada que recorrer. */
  get window(): number {
    const s = this.master()?.seekable;
    if (!s || s.length === 0) return 0;
    const w = s.end(s.length - 1) - s.start(0);
    return Number.isFinite(w) && w > 0 ? w : 0;
  }

  /** La posición más reciente disponible. */
  get edge(): number {
    const s = this.master()?.seekable;
    if (!s || s.length === 0) return 0;
    const e = s.end(s.length - 1);
    return Number.isFinite(e) ? e : 0;
  }

  /**
   * Dónde conviene ver el directo, si el motor lo sabe. Depende de la duración
   * de los segmentos: con segmentos de 6 s, quedarse a 3 s del borde dejaba el
   * vídeo entrecortado (medido).
   */
  get recommended(): number | null {
    const p = this.master()?.liveSyncPosition?.();
    return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null;
  }

  behind(position: number): number {
    return Math.max(0, this.edge - position);
  }

  /**
   * Si `position` está en directo. Sin borde conocido no se está en él: antes
   * la resta de dos ceros entraba en la tolerancia y un directo que aún no
   * había empezado se declaraba "en el borde" de nada. Con posición
   * recomendada, la tolerancia se cuenta desde ella: con segmentos largos el
   * borde avanza a saltos y, contado desde él, "ir al directo" aparecía nada
   * más volver al directo.
   */
  isAtEdge(position: number): boolean {
    if (this.edge <= 0) return false;
    const recomendada = this.recommended;
    if (recomendada !== null) return recomendada - position <= LIVE_EDGE_TOLERANCE;
    return this.behind(position) <= LIVE_EDGE_TOLERANCE;
  }

  /** Adónde saltar para volver al directo, o `null` si aún no hay adónde. */
  get seekTarget(): number | null {
    const destino = this.recommended ?? this.edge - LIVE_EDGE_MARGIN;
    return destino > 0 ? destino : null;
  }
}
