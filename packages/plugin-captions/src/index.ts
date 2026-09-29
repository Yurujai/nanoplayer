/**
 * Captions plugin, written only against the public plugin API.
 *
 * Browsers draw native captions inside the `<video>` element, which squeezes
 * them in side-by-side and picture-in-picture layouts (see
 * docs/browser-quirks.md#native-captions-in-video). So the `<track>` stays in
 * `hidden` mode —the browser still parses WebVTT and handles timing— and the
 * text is drawn in a player-wide overlay. The OS caption preferences lost on
 * the way are made up for with the `--np-cue-*` CSS variables.
 */
import {
  plugins, strings,
  type Manifest, type PluginContext, type PluginImpl, type TextTrackDef,
} from '@nanoplayer/core';

/*
 * The top half of the box is empty on purpose: it stands for the picture, with
 * the text below. On and off differ by fill versus outline, not by opacity, so
 * the difference does not depend on telling shades apart.
 */
const BOX =
  'M4 4.5h16a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 17V7A2.5 2.5 0 0 1 4 4.5z';
const HOLE =
  'M4.1 6.2h15.8c.5 0 .9.4.9.9v9.8c0 .5-.4.9-.9.9H4.1a.9.9 0 0 1-.9-.9V7.1c0-.5.4-.9.9-.9z';
const TEXT =
  'M5.2 11.2h3.9v1.8H5.2zM10.8 11.2h8v1.8h-8z'
  + 'M5.2 14.4h7.6v1.8H5.2zM14.5 14.4h4.3v1.8h-4.3z';

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">`
  + `<path fill-rule="evenodd" d="${d}"/></svg>`;

const ICON_ON = svg(BOX + TEXT);
const ICON_OFF = svg(BOX + HOLE + TEXT);

strings.register('es', {
  'captions.label': 'Subtítulos',
  'captions.off': 'Desactivados',
  'captions.on': 'Activar subtítulos',
});
strings.register('en', {
  'captions.label': 'Subtitles',
  'captions.off': 'Off',
  'captions.on': 'Turn on subtitles',
});

const OFF = '__off__';

/** A track's readable name: its label, or else its language name. */
function trackName(t: TextTrackDef): string {
  if (t.label) return t.label;
  try {
    return new Intl.DisplayNames([t.lang], { type: 'language' }).of(t.lang) ?? t.lang;
  } catch {
    return t.lang;
  }
}

class Captions implements PluginImpl {
  #tracks: TextTrackDef[] = [];
  #elements: HTMLTrackElement[] = [];
  #layer: HTMLElement | null = null;
  #removeLayer: (() => void) | null = null;
  #stopCueListener: (() => void) | null = null;
  #active: string = OFF;
  #last: string | null = null;
  #unsubscribe: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const m = ctx.player.manifest;
    this.#tracks = [...(m?.textTracks ?? [])];
    if (this.#tracks.length === 0) return;
    const t = ctx.t;

    // The master's `<video>` may not exist yet: engines attach lazily.
    const mount = () => this.#mountTracks(m);
    if (ctx.player.master?.element) mount();
    this.#unsubscribe.push(ctx.bus.on('engine:attach:ok', mount));

    const byDefault = this.#tracks.find((x) => x.default);
    if (byDefault) {
      this.#active = byDefault.lang;
      this.#last = byDefault.lang;
    }

    ctx.whenUi((ui) => {
      const overlay = ui.addOverlay({ id: 'captions', position: 'captions' });
      this.#layer = overlay.element;
      this.#removeLayer = overlay.remove;
      this.#renderCues();

      this.#unsubscribe.push(ui.addBarControl({
        id: 'captions',
        priority: 30,
        icon: () => (this.#active === OFF ? ICON_OFF : ICON_ON),
        label: () => t(this.#active === OFF ? 'captions.on' : 'captions.label'),
        pressed: () => this.#active !== OFF,
        onActivate: () => {
          this.#select(this.#active === OFF ? (this.#last ?? this.#tracks[0]!.lang) : OFF);
          ui.refresh();
        },
      }));

      this.#unsubscribe.push(ui.addSettingsPanel({
        id: 'captions',
        label: t('captions.label'),
        priority: 5,
        options: [
          { value: OFF, label: t('captions.off') },
          ...this.#tracks.map((x) => ({ value: x.lang, label: trackName(x) })),
        ],
        getValue: () => this.#active,
        onSelect: (v) => { this.#select(v); ui.refresh(); },
      }));
    });
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    this.#detachCueListener();
    for (const el of this.#elements) el.remove();
    this.#elements = [];
    this.#removeLayer?.();
    this.#removeLayer = null;
    this.#layer = null;
  }

  #mountTracks(m: Manifest | null): void {
    const video = m ? this.#masterVideo(m) : null;
    if (!video || this.#elements.length > 0) return;

    for (const t of this.#tracks) {
      const el = document.createElement('track');
      el.kind = t.kind ?? 'subtitles';
      el.srclang = t.lang;
      el.label = trackName(t);
      el.src = t.src;
      video.appendChild(el);
      this.#elements.push(el);
    }
    this.#apply();
  }

  #masterVideo(m: Manifest): HTMLVideoElement | null {
    const master = m.streams.find((s) => s.audio);
    if (!master) return null;
    return document.querySelector<HTMLVideoElement>(`[data-stream="${CSS.escape(master.id)}"] video`);
  }

  #select(value: string): void {
    this.#active = value;
    if (value !== OFF) this.#last = value;
    this.#apply();
  }

  /**
   * The active track is `hidden`, not `showing`: the browser fires `cuechange`
   * without drawing. The rest are `disabled`, not `hidden`, so they are not
   * processed for nothing (battery on mobile).
   */
  #apply(): void {
    this.#detachCueListener();
    let active: TextTrack | null = null;
    for (const el of this.#elements) {
      const track = el.track;
      if (!track) continue;
      if (el.srclang === this.#active) { track.mode = 'hidden'; active = track; }
      else track.mode = 'disabled';
    }
    if (active) {
      const onChange = () => this.#renderCues();
      active.addEventListener('cuechange', onChange);
      this.#stopCueListener = () => active.removeEventListener('cuechange', onChange);
    }
    this.#renderCues();
  }

  #detachCueListener(): void {
    this.#stopCueListener?.();
    this.#stopCueListener = null;
  }

  /**
   * `getCueAsHTML()` keeps the WebVTT markup (bold, italics, voices), inserted
   * as nodes, never as an HTML string: captions are third-party content.
   */
  #renderCues(): void {
    const layer = this.#layer;
    if (!layer) return;
    layer.textContent = '';
    if (this.#active === OFF) return;

    const cues = this.#elements.find((e) => e.srclang === this.#active)?.track?.activeCues;
    if (!cues) return;

    for (const cue of Array.from(cues)) {
      const line = document.createElement('div');
      line.className = 'np__cue';
      const vtt = cue as VTTCue & { getCueAsHTML?: () => DocumentFragment };
      if (typeof vtt.getCueAsHTML === 'function') line.appendChild(vtt.getCueAsHTML());
      else line.textContent = vtt.text ?? '';
      layer.appendChild(line);
    }
  }
}

/** Self-registration: it switches on by itself when the manifest has text tracks. */
plugins.register({
  id: 'captions',
  activateWhen: (m) => (m?.textTracks?.length ?? 0) > 0,
  load: () => new Captions(),
});

export { Captions };
