/**
 * Where a live stream's edge is and how far behind it playback runs, taken
 * from the master engine's seekable range (the DVR window).
 */
import type { MediaEngine } from './engine.js';

/**
 * Seconds behind the edge when going live and the engine does not recommend a
 * position: the exact edge is never buffered yet.
 */
export const LIVE_EDGE_MARGIN = 3;

/**
 * Seconds behind that still count as live. S5 measured about 6 s of normal lag
 * with hls.js; calling the buffer "behind" would be lying the other way.
 */
export const LIVE_EDGE_TOLERANCE = 12;

export class LiveEdge {
  constructor(private readonly master: () => MediaEngine | null) {}

  /** How far back one can go, in seconds. */
  get window(): number {
    const s = this.master()?.seekable;
    if (!s || s.length === 0) return 0;
    const w = s.end(s.length - 1) - s.start(0);
    return Number.isFinite(w) && w > 0 ? w : 0;
  }

  get edge(): number {
    const s = this.master()?.seekable;
    if (!s || s.length === 0) return 0;
    const e = s.end(s.length - 1);
    return Number.isFinite(e) ? e : 0;
  }

  /** see docs/browser-quirks.md#live-segment-latency */
  get recommended(): number | null {
    const p = this.master()?.liveSyncPosition?.();
    return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null;
  }

  behind(position: number): number {
    return Math.max(0, this.edge - position);
  }

  isAtEdge(position: number): boolean {
    // Without a known edge, 0 - 0 fell within the tolerance and a stream that had
    // not started was declared "live".
    if (this.edge <= 0) return false;
    const recommended = this.recommended;
    // Counted from the recommended position: with long segments the edge moves in
    // jumps and "go to live" showed right after going live.
    if (recommended !== null) return recommended - position <= LIVE_EDGE_TOLERANCE;
    return this.behind(position) <= LIVE_EDGE_TOLERANCE;
  }

  /** Where to seek to go live, or `null` while there is nowhere to go. */
  get seekTarget(): number | null {
    const target = this.recommended ?? this.edge - LIVE_EDGE_MARGIN;
    return target > 0 ? target : null;
  }
}
