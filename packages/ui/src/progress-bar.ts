import type { Player, TimelineMarkerDecl, Translate } from '@nanoplayer/core';
import { createRange, Listeners } from './dom.js';
import { formatTime, spokenTime } from './format.js';

/**
 * Minimum DVR window worth showing a bar for, in seconds. Below it there is
 * nothing to scrub through, and a control that leads nowhere is noise.
 */
const MIN_DVR_WINDOW = 30;

interface Segment { start: number; end: number; label: string }

/**
 * The position bar and the readouts next to it: time, the current segment
 * (chapter) and, in a live stream, the live badge.
 *
 * It paints one of three things: the content, an intro/outro (the bar hides:
 * it belongs to the content, and during the outro hiding it is also what stops
 * dragging it forward), or a live stream's DVR window.
 */
export class ProgressBar {
  /** The row with the slider, the segment marks and the hover label. */
  readonly row: HTMLElement;
  readonly time: HTMLElement;
  readonly segment: HTMLElement;
  readonly #range: HTMLInputElement;
  readonly #marks: HTMLElement;
  readonly #tip: HTMLElement;
  readonly #listeners = new Listeners();
  readonly #markers = new Map<string, readonly TimelineMarkerDecl[]>();
  #segments: Segment[] = [];
  /** Duration the segments were laid out for: they are rebuilt only when it changes. */
  #segmentsFor = -1;
  #dragging = false;
  /** Seconds left in the intro or outro, from `chain:time`. */
  #bumperLeft: number | null = null;

  constructor(
    private readonly doc: Document,
    private readonly player: Player,
    private readonly t: Translate,
    /** Called when the live badge is used, so the bar stays visible. */
    private readonly onUse: () => void,
  ) {
    this.row = doc.createElement('div');
    this.row.className = 'np__row np__row--progress';
    this.#range = createRange(doc, t('ui.progress'), 0, 1, 0.001);
    // Marks and hover label are visual: a screen reader gets the segment from
    // the slider's aria-valuetext, which is where its focus is.
    this.#marks = doc.createElement('div');
    this.#marks.className = 'np__marks';
    this.#marks.setAttribute('aria-hidden', 'true');
    this.#tip = doc.createElement('div');
    this.#tip.className = 'np__tip';
    this.#tip.setAttribute('aria-hidden', 'true');
    this.#tip.hidden = true;
    this.row.append(this.#range, this.#marks, this.#tip);

    this.time = doc.createElement('span');
    this.time.className = 'np__time';
    // Already spoken through the slider's aria-valuetext; repeating it in a live
    // region would be a constant, unbearable drip.
    this.time.setAttribute('aria-hidden', 'true');

    // Not hidden from screen readers like the time: it does not change every
    // second, and it is the only way to know the chapter without going to the bar.
    this.segment = doc.createElement('span');
    this.segment.className = 'np__segment';

    // `input` while dragging, `change` on release: seeking on every pixel would
    // be a storm of seeks.
    this.#listeners.on(this.#range, 'pointerdown', () => { this.#dragging = true; });
    this.#listeners.on(this.#range, 'input', () => this.#preview());
    this.#listeners.on(this.#range, 'change', () => this.#commit());
    this.#listeners.on(this.#range, 'keydown', () => { this.#dragging = false; });
    this.#listeners.on(this.#range, 'pointermove', (ev: PointerEvent) => this.#hover(ev));
    this.#listeners.on(this.#range, 'pointerleave', () => { this.#tip.hidden = true; });
  }

  /** Marks named segments on the bar. Times come in media time, as in the manifest. */
  setMarkers(id: string, markers: readonly TimelineMarkerDecl[]): () => void {
    this.#markers.set(id, markers);
    this.#segmentsFor = -1;
    this.render();
    return () => {
      this.#markers.delete(id);
      this.#segmentsFor = -1;
      this.render();
    };
  }

  setBumperTime(current: number, duration: number): void {
    this.#bumperLeft = Number.isFinite(duration) ? Math.max(0, duration - current) : null;
    this.render();
  }

  resetBumperTime(): void {
    this.#bumperLeft = null;
  }

  render(): void {
    if (this.#dragging) return;
    if (this.player.manifest?.live) this.#renderLive();
    else if (this.player.phase !== 'main') this.#renderBumper();
    else this.#renderContent();
  }

  destroy(): void {
    this.#listeners.removeAll();
  }

  #renderContent(): void {
    const p = this.player;
    this.row.hidden = false;
    const d = p.duration || 0;
    const t = p.currentTime;
    const frac = d > 0 ? Math.min(1, t / d) : 0;
    this.#range.value = String(frac);
    this.#range.style.setProperty('--np-progress', `${frac * 100}%`);
    this.#layOutSegments(d);
    this.#describe(t);

    const buffered = p.master?.buffered;
    if (buffered && buffered.length > 0 && d > 0) {
      const end = buffered.end(buffered.length - 1);
      this.#range.style.setProperty('--np-buffered', `${Math.min(100, (end / d) * 100)}%`);
    }
  }

  #renderBumper(): void {
    this.row.hidden = true;
    this.segment.textContent = '';
    const name = this.t(this.player.phase === 'intro' ? 'ui.chain.intro' : 'ui.chain.outro');
    // The bumper's engine is not exposed; its time arrives through `chain:time`,
    // and until it does only the name is shown.
    this.time.textContent = this.#bumperLeft === null
      ? name : `${name} · ${formatTime(this.#bumperLeft)}`;
  }

  /**
   * The bar spans **the DVR window** —what the server still keeps—, not a
   * duration, which a live stream does not have. Painting the window as a
   * duration once showed "0:01 / 0:02", which looked like a two-second video.
   */
  #renderLive(): void {
    const p = this.player;
    const window = p.dvrWindow;
    const useful = window >= MIN_DVR_WINDOW;
    this.row.hidden = !useful;
    if (useful) {
      const behind = p.behindLive;
      const frac = Math.max(0, Math.min(1, 1 - behind / window));
      this.#range.value = String(frac);
      this.#range.style.setProperty('--np-progress', `${frac * 100}%`);
      this.#range.setAttribute('aria-label', this.t('ui.live.window'));
      this.#range.setAttribute('aria-valuetext', p.atLiveEdge
        ? this.t('ui.live.badge')
        : this.t('ui.live.behindBy', { time: spokenTime(behind, this.t.lang) }));
    }
    // `live: true` does not mean someone is broadcasting: before the event
    // starts there must be no LIVE badge over an empty screen, nor a "−0:00"
    // behind an edge that does not exist.
    const onAir = p.liveStatus === 'live';
    this.time.textContent = !onAir || p.atLiveEdge ? '' : `−${formatTime(p.behindLive)}`;
    this.#renderBadge(onAir);
  }

  /**
   * The live badge is **a button, not a label**: lit, it says "you are at the
   * edge"; unlit, "you are behind", and pressing it takes you back. A fixed
   * "LIVE" while showing something from five minutes ago breeds distrust.
   */
  #renderBadge(visible: boolean): void {
    let badge = this.time.parentElement?.querySelector<HTMLButtonElement>('.np__live') ?? null;
    if (!visible) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = this.doc.createElement('button');
      badge.type = 'button';
      badge.className = 'np__live';
      badge.addEventListener('click', () => {
        this.player.seekToLive();
        this.onUse();
      });
      this.time.before(badge);
    }
    const atEdge = this.player.atLiveEdge;
    badge.textContent = atEdge ? this.t('ui.live.badge') : this.t('ui.live.goTo');
    badge.classList.toggle('np__live--behind', !atEdge);
    badge.disabled = atEdge;
    badge.setAttribute('aria-label', atEdge
      ? this.t('ui.live.badge')
      : this.t('ui.live.goToBehindBy', { time: spokenTime(this.player.behindLive, this.t.lang) }));
  }

  /** Time, segment and spoken position for `t`: "12 minutes and 15 seconds, First law". */
  #describe(t: number): void {
    const label = this.#segmentAt(t);
    const spoken = spokenTime(t, this.t.lang);
    this.#range.setAttribute('aria-valuetext', label ? `${spoken}, ${label}` : spoken);
    this.time.textContent = `${formatTime(t)} / ${formatTime(this.player.duration)}`;
    this.segment.textContent = label ?? '';
  }

  #preview(): void {
    this.#describe(Number(this.#range.value) * (this.player.duration || 0));
    this.#range.style.setProperty('--np-progress', `${Number(this.#range.value) * 100}%`);
  }

  #commit(): void {
    this.#dragging = false;
    const p = this.player;
    const frac = Number(this.#range.value);
    if (p.manifest?.live) {
      // In a live stream 100 % is the edge.
      p.seek(Math.max(0, p.liveEdge - (1 - frac) * p.dvrWindow));
      return;
    }
    p.seek(frac * (p.duration || 0));
  }

  #hover(ev: PointerEvent): void {
    const d = this.player.duration || 0;
    if (this.#markers.size === 0 || !(d > 0) || this.player.manifest?.live) return;
    const box = this.#range.getBoundingClientRect();
    if (box.width <= 0) return;
    const frac = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
    const t = frac * d;
    const label = this.#segmentAt(t);
    this.#tip.textContent = label ? `${formatTime(t)} · ${label}` : formatTime(t);
    // Clamped so it does not overflow the player's sides.
    this.#tip.style.left = `${Math.min(92, Math.max(8, frac * 100))}%`;
    this.#tip.hidden = false;
  }

  #segmentAt(t: number): string | null {
    this.#layOutSegments(this.player.duration || 0);
    return this.#segments.find((s) => t >= s.start && t < s.end)?.label ?? null;
  }

  /**
   * Segments in visible time, without those the trim leaves out. A segment
   * with no end runs to the next one from the same plugin, or to the end: that
   * is how chapters are written by hand.
   */
  #layOutSegments(duration: number): void {
    if (duration === this.#segmentsFor) return;
    this.#segmentsFor = duration;
    const p = this.player;
    const limit = duration || Infinity;
    this.#segments = [];
    for (const list of this.#markers.values()) {
      const sorted = [...list].sort((a, b) => a.start - b.start);
      sorted.forEach((m, i) => {
        const end = m.end ?? sorted[i + 1]?.start ?? Infinity;
        const start = p.toVisibleTime(m.start);
        const visibleEnd = Math.min(limit, p.toVisibleTime(end));
        if (visibleEnd > start) this.#segments.push({ start, end: visibleEnd, label: m.label });
      });
    }
    this.#marks.textContent = '';
    if (!(duration > 0)) return;
    for (const { start } of this.#segments) {
      if (start <= 0) continue;
      const mark = this.doc.createElement('span');
      mark.className = 'np__mark';
      mark.style.left = `${(start / duration) * 100}%`;
      this.#marks.appendChild(mark);
    }
  }
}
