/**
 * Transcript plugin: the captions' text in a panel below the player, the
 * current phrase marked, and any phrase a way to jump there. For studying, and
 * for reading at one's own pace what the captions only flash by.
 */
import {
  plugins, strings,
  type Player, type PluginContext, type PluginImpl, type TextTrackDef, type Translate,
  type UiSlots,
} from '@nanoplayer/core';
import { parseVtt, type TranscriptCue } from './vtt.js';

export { parseVtt, type TranscriptCue } from './vtt.js';

strings.register('es', {
  'transcript.label': 'Transcripción',
  'transcript.language': 'Idioma',
  'transcript.loading': 'Cargando la transcripción…',
  'transcript.failed': 'No se ha podido cargar la transcripción.',
  'transcript.empty': 'Esta pista no tiene texto.',
});
strings.register('en', {
  'transcript.label': 'Transcript',
  'transcript.language': 'Language',
  'transcript.loading': 'Loading the transcript…',
  'transcript.failed': 'The transcript could not be loaded.',
  'transcript.empty': 'This track has no text.',
});

/** Lines of text on a page. */
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'
  + 'M5 3h10l4 4v14H5zm2 2v14h10V8h-3V5zm2 6h6v1.6H9zm0 3h6v1.6H9zm0 3h4v1.6H9z"/></svg>';

/** After the viewer scrolls the list, it is theirs for this long. */
const HANDS_OFF_MS = 4000;

const isCaption = (t: TextTrackDef) => !t.kind || t.kind === 'subtitles' || t.kind === 'captions';

function trackName(t: TextTrackDef): string {
  if (t.label) return t.label;
  try {
    return new Intl.DisplayNames([t.lang], { type: 'language' }).of(t.lang) ?? t.lang;
  } catch {
    return t.lang;
  }
}

/** The interface language's track if there is one, else the default, else the first. */
function initialTrack(tracks: TextTrackDef[], lang: string): TextTrackDef {
  const base = lang.split('-')[0];
  return tracks.find((t) => t.lang.split('-')[0] === base)
    ?? tracks.find((t) => t.default) ?? tracks[0]!;
}

function clockTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

class Transcript implements PluginImpl {
  #unsubscribe: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const tracks = (ctx.player.manifest?.textTracks ?? []).filter(isCaption);
    if (tracks.length === 0) return;
    ctx.whenUi((ui) => {
      const view = new TranscriptView(ctx.player, ctx.t, tracks, initialTrack(tracks, ctx.lang));
      const panel = ui.addPanel({
        id: 'transcript', label: ctx.t('transcript.label'), icon: ICON,
        onOpen: () => view.open(),
      });
      panel.element.appendChild(view.element);
      this.#unsubscribe.push(() => { view.destroy(); panel.remove(); });
    });
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }
}

/** The panel's content: header, language choice and the list of phrases. */
class TranscriptView {
  readonly element: HTMLElement;
  readonly #list: HTMLOListElement;
  readonly #status: HTMLElement;
  readonly #cache = new Map<string, Promise<TranscriptCue[]>>();
  #track: TextTrackDef;
  #cues: TranscriptCue[] = [];
  #buttons: HTMLButtonElement[] = [];
  #current = -1;
  #touchedAt = -Infinity;
  #unsubscribe: Array<() => void> = [];

  constructor(
    private readonly player: Player,
    private readonly t: Translate,
    tracks: TextTrackDef[],
    initial: TextTrackDef,
  ) {
    this.#track = initial;
    this.element = document.createElement('div');
    this.element.className = 'np-transcript';

    const header = document.createElement('div');
    header.className = 'np-transcript__header';
    const title = document.createElement('h2');
    title.className = 'np-transcript__title';
    title.textContent = t('transcript.label');
    header.appendChild(title);
    if (tracks.length > 1) header.appendChild(this.#languagePicker(tracks));

    this.#status = document.createElement('p');
    this.#status.className = 'np-transcript__status';
    this.#status.setAttribute('role', 'status');
    this.#list = document.createElement('ol');
    this.#list.className = 'np-transcript__list';
    this.#list.setAttribute('aria-label', t('transcript.label'));
    this.element.append(header, this.#status, this.#list);

    this.#list.addEventListener('keydown', (ev) => this.#onKey(ev));
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
      this.#list.addEventListener(type, () => { this.#touchedAt = performance.now(); }, { passive: true });
    }
    this.#unsubscribe.push(
      player.on('time', () => this.#follow()),
      player.on('seek:end', () => this.#follow()),
    );
  }

  open(): void {
    void this.#show(this.#track);
  }

  destroy(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }

  #languagePicker(tracks: TextTrackDef[]): HTMLElement {
    const label = document.createElement('label');
    label.textContent = `${this.t('transcript.language')} `;
    const select = document.createElement('select');
    for (const track of tracks) {
      const option = document.createElement('option');
      option.value = track.lang;
      option.textContent = trackName(track);
      option.selected = track === this.#track;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      const track = tracks.find((x) => x.lang === select.value);
      if (track) void this.#show(track);
    });
    label.appendChild(select);
    return label;
  }

  /** Fetched once per track, when first shown: a closed panel costs nothing. */
  async #show(track: TextTrackDef): Promise<void> {
    this.#track = track;
    let cues = this.#cache.get(track.src);
    if (!cues) {
      cues = fetch(track.src)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(parseVtt);
      this.#cache.set(track.src, cues);
      cues.catch(() => this.#cache.delete(track.src));
    }
    this.#status.hidden = false;
    this.#status.textContent = this.t('transcript.loading');
    try {
      const loaded = await cues;
      if (this.#track !== track) return;
      this.#render(this.#reachable(loaded));
    } catch {
      if (this.#track !== track) return;
      this.#list.textContent = '';
      this.#status.textContent = this.t('transcript.failed');
    }
  }

  /** In visible time; what a trim leaves out cannot be jumped to, so it is not listed. */
  #reachable(cues: TranscriptCue[]): TranscriptCue[] {
    const trim = this.player.trim;
    return cues
      .filter((c) => !trim || (c.end > trim.start && c.start < trim.end))
      .map((c) => ({
        ...c,
        start: Math.max(0, this.player.toVisibleTime(c.start)),
        end: this.player.toVisibleTime(c.end),
      }));
  }

  #render(cues: TranscriptCue[]): void {
    this.#cues = cues;
    this.#current = -1;
    this.#list.textContent = '';
    this.#status.textContent = cues.length === 0 ? this.t('transcript.empty') : '';
    this.#status.hidden = cues.length > 0;
    this.#buttons = cues.map((cue, i) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'np-transcript__cue';
      button.tabIndex = i === 0 ? 0 : -1;
      const time = document.createElement('span');
      time.className = 'np-transcript__time';
      time.textContent = clockTime(cue.start);
      const text = document.createElement('span');
      text.textContent = cue.text;
      button.append(time, text);
      button.addEventListener('click', () => this.player.seek(cue.start));
      item.appendChild(button);
      this.#list.appendChild(item);
      return button;
    });
    this.#follow();
  }

  /** The phrase under way, or the last one started during a silence. */
  #indexAt(t: number): number {
    let lo = 0;
    let hi = this.#cues.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.#cues[mid]!.start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }

  #follow(): void {
    if (this.#cues.length === 0) return;
    const index = this.#indexAt(this.player.currentTime + 0.05);
    if (index === this.#current) return;
    this.#buttons[this.#current]?.removeAttribute('aria-current');
    this.#current = index;
    const button = this.#buttons[index];
    if (!button) return;
    button.setAttribute('aria-current', 'true');
    // Tab lands on the phrase being said, unless the viewer is moving in the list.
    if (!this.#list.contains(document.activeElement)) this.#rove(index);
    this.#scrollTo(button);
  }

  /**
   * Keeps the phrase in view by scrolling the list only, never the page; and
   * not while the viewer is reading elsewhere in it.
   */
  #scrollTo(button: HTMLElement): void {
    const list = this.#list;
    if (list.contains(document.activeElement)) return;
    if (performance.now() - this.#touchedAt < HANDS_OFF_MS) return;
    const item = button.parentElement!;
    const top = item.offsetTop;
    if (top < list.scrollTop || top + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 3);
    }
  }

  /** One tab stop for the whole list: hundreds of phrases must not be hundreds of Tabs. */
  #rove(index: number): void {
    this.#buttons.forEach((b, i) => { b.tabIndex = i === index ? 0 : -1; });
  }

  #onKey(ev: KeyboardEvent): void {
    const from = this.#buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (from < 0) return;
    const last = this.#buttons.length - 1;
    const to = ev.key === 'ArrowDown' ? Math.min(last, from + 1)
      : ev.key === 'ArrowUp' ? Math.max(0, from - 1)
        : ev.key === 'Home' ? 0
          : ev.key === 'End' ? last
            : -1;
    if (to < 0) return;
    ev.preventDefault();
    this.#rove(to);
    this.#buttons[to]!.focus();
  }
}

/** Self-registration: on when the manifest has captions or subtitles to read. */
plugins.register({
  id: 'transcript',
  activateWhen: (m) => (m?.textTracks ?? []).some(isCaption),
  load: () => new Transcript(),
});

export { Transcript };
