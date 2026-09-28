/**
 * El timeline que se enseña cuando hay recorte.
 *
 * El recorte no toca el medio: **remapea el tiempo que se enseña**. Para el
 * motor y para el sincronizador nada cambia —siguen en tiempo del medio—, y la
 * traducción ocurre solo en esta frontera, que es la que ve todo el mundo de
 * fuera. Tenerla en un único sitio importa: con la conversión repartida, el
 * primero que se olvidara de restar dejaría una barra de progreso mintiendo.
 */
export interface TrimRange {
  start: number;
  end: number;
}

export class TrimTimeline {
  constructor(readonly range: TrimRange | null) {}

  /** De tiempo del medio al que se enseña. */
  toVisible(media: number): number {
    const r = this.range;
    return r ? Math.max(0, media - r.start) : media;
  }

  /** Del tiempo que se enseña al del medio, acotado al recorte. */
  toMedia(visible: number): number {
    const r = this.range;
    return r ? Math.min(r.end, Math.max(r.start, r.start + visible)) : visible;
  }

  /** Lo que dura lo que se enseña, o `null` si no hay recorte que lo diga. */
  get duration(): number | null {
    const r = this.range;
    return r ? Math.max(0, r.end - r.start) : null;
  }
}
