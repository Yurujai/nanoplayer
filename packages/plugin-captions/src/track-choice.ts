import type { TextTrackDef } from '@nanoplayer/core';

export const OFF = '__off__';

/** A track's readable name: its label, or else its language name. */
export function trackName(t: TextTrackDef): string {
  if (t.label) return t.label;
  try {
    return new Intl.DisplayNames([t.lang], { type: 'language' }).of(t.lang) ?? t.lang;
  } catch {
    return t.lang;
  }
}

/**
 * One kind of text track on the video, at most one of them on, and its cues
 * handed over as they change. The browser parses WebVTT and times the cues;
 * what to do with them is up to whoever owns this.
 */
export class TrackChoice {
  #elements: HTMLTrackElement[] = [];
  #active = OFF;
  #stopListening: (() => void) | null = null;

  constructor(
    readonly defs: readonly TextTrackDef[],
    private readonly onCues: (cues: TextTrackCue[]) => void,
  ) {
    const byDefault = defs.find((x) => x.default);
    if (byDefault) this.#active = byDefault.lang;
  }

  get active(): string {
    return this.#active;
  }

  /**
   * The video comes from this player, never from a page-wide lookup: with two
   * players sharing a stream id, that put the tracks on the other player.
   */
  mount(video: HTMLVideoElement | null): void {
    if (this.defs.length === 0) return;
    if (!video || this.#elements[0]?.parentElement === video) return;
    this.unmount();
    for (const def of this.defs) {
      const el = document.createElement('track');
      el.kind = def.kind ?? 'subtitles';
      el.srclang = def.lang;
      el.label = trackName(def);
      el.src = def.src;
      video.appendChild(el);
      this.#elements.push(el);
    }
    this.#apply();
  }

  select(lang: string): void {
    this.#active = lang;
    this.#apply();
  }

  unmount(): void {
    this.#stop();
    for (const el of this.#elements) el.remove();
    this.#elements = [];
  }

  /** The cues showing now; none while off. */
  cues(): TextTrackCue[] {
    if (this.#active === OFF) return [];
    const cues = this.#elements.find((e) => e.srclang === this.#active)?.track?.activeCues;
    return cues ? Array.from(cues) : [];
  }

  /**
   * The active track is `hidden`, not `showing`: the browser fires `cuechange`
   * without drawing. The rest are `disabled`, not `hidden`, so they are not
   * processed for nothing (battery on mobile).
   */
  #apply(): void {
    this.#stop();
    let active: TextTrack | null = null;
    for (const el of this.#elements) {
      const track = el.track;
      if (!track) continue;
      if (el.srclang === this.#active) { track.mode = 'hidden'; active = track; }
      else track.mode = 'disabled';
    }
    if (active) {
      const onChange = () => this.onCues(this.cues());
      active.addEventListener('cuechange', onChange);
      this.#stopListening = () => active.removeEventListener('cuechange', onChange);
    }
    this.onCues(this.cues());
  }

  #stop(): void {
    this.#stopListening?.();
    this.#stopListening = null;
  }
}
