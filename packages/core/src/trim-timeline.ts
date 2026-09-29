/**
 * The timeline shown when the manifest declares a trim. The media is not
 * touched: engines and the synchronizer keep working in media time, and only
 * this boundary converts to the time the outside world sees.
 */
export interface TrimRange {
  start: number;
  end: number;
}

export class TrimTimeline {
  constructor(readonly range: TrimRange | null) {}

  toVisible(media: number): number {
    const r = this.range;
    return r ? Math.max(0, media - r.start) : media;
  }

  /** Clamped to the trim. */
  toMedia(visible: number): number {
    const r = this.range;
    return r ? Math.min(r.end, Math.max(r.start, r.start + visible)) : visible;
  }

  /** Length of the trimmed span, or `null` without a trim. */
  get duration(): number | null {
    const r = this.range;
    return r ? Math.max(0, r.end - r.start) : null;
  }
}
