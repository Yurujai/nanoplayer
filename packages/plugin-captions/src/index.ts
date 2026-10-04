/**
 * Captions plugin, written only against the public plugin API.
 *
 * Browsers draw native captions inside the `<video>` element, which squeezes
 * them in side-by-side and picture-in-picture layouts (see
 * docs/browser-quirks.md#native-captions-in-video). So the `<track>` stays in
 * `hidden` mode —the browser still parses WebVTT and handles timing— and the
 * text is drawn in a player-wide overlay. The OS caption preferences lost on
 * the way are made up for with a caption style panel and the `--np-cue-*` CSS
 * variables.
 *
 * Description tracks travel the same way but are read out, not drawn.
 */
import {
  icon, plugins, strings,
  type PluginContext, type PluginImpl, type SettingsChoiceDecl, type TextTrackDef,
  type Translate, type UiSlots,
} from '@nanoplayer/core';
import { CHOICES, captionStyle, cssVariables, type CaptionStyleKey } from './style.js';
import { OFF, TrackChoice, trackName } from './track-choice.js';

/*
 * A caption box: text lines in a frame. On and off differ by fill versus
 * outline, the player's rule for toggles, so the state does not depend on
 * telling shades apart.
 */
const BOX = 'M5.5 5h13A3.5 3.5 0 0 1 22 8.5v7a3.5 3.5 0 0 1-3.5 3.5h-13A3.5 3.5 0 0 1 2 15.5v-7A3.5 3.5 0 0 1 5.5 5z';
const LINES = 'M6.5 10.5h3M12 10.5h5.5M6.5 14h6M15 14h2.5';
/** The text lines as rounded holes, one per line. */
const HOLES = [
  'M6.5 9.55H9.5A0.95 0.95 0 0 1 9.5 11.45H6.5A0.95 0.95 0 0 1 6.5 9.55Z',
  'M12 9.55H17.5A0.95 0.95 0 0 1 17.5 11.45H12A0.95 0.95 0 0 1 12 9.55Z',
  'M6.5 13.05H12.5A0.95 0.95 0 0 1 12.5 14.95H6.5A0.95 0.95 0 0 1 6.5 13.05Z',
  'M15 13.05H17.5A0.95 0.95 0 0 1 17.5 14.95H15A0.95 0.95 0 0 1 15 13.05Z',
].join('');

const ICON_ON = icon.svg(icon.cut(BOX + HOLES));
const ICON_OFF = icon.svg(icon.outline(BOX), icon.outline(LINES));

strings.register('es', {
  'captions.label': 'Subtítulos',
  'captions.off': 'Desactivados',
  'captions.on': 'Activar subtítulos',
  'captions.descriptions': 'Descripciones (lector de pantalla)',
  'captions.style': 'Estilo de subtítulos',
  'captions.style.size': 'Tamaño',
  'captions.style.color': 'Color del texto',
  'captions.style.background': 'Color del fondo',
  'captions.style.opacity': 'Opacidad del fondo',
  'captions.style.font': 'Fuente',
  'captions.style.edge': 'Borde del texto',
  'captions.color.white': 'Blanco',
  'captions.color.yellow': 'Amarillo',
  'captions.color.green': 'Verde',
  'captions.color.cyan': 'Cian',
  'captions.color.blue': 'Azul',
  'captions.color.magenta': 'Magenta',
  'captions.color.red': 'Rojo',
  'captions.color.black': 'Negro',
  'captions.font.sans': 'Sin serifa',
  'captions.font.serif': 'Con serifa',
  'captions.font.mono': 'Monoespaciada',
  'captions.font.casual': 'Informal',
  'captions.font.small-caps': 'Versalitas',
  'captions.edge.none': 'Ninguno',
  'captions.edge.outline': 'Contorno',
  'captions.edge.shadow': 'Sombra',
  'captions.edge.raised': 'En relieve',
  'captions.edge.depressed': 'Hundido',
});
strings.register('en', {
  'captions.label': 'Subtitles',
  'captions.off': 'Off',
  'captions.on': 'Turn on subtitles',
  'captions.descriptions': 'Descriptions (screen reader)',
  'captions.style': 'Caption style',
  'captions.style.size': 'Size',
  'captions.style.color': 'Text color',
  'captions.style.background': 'Background color',
  'captions.style.opacity': 'Background opacity',
  'captions.style.font': 'Font',
  'captions.style.edge': 'Text edge',
  'captions.color.white': 'White',
  'captions.color.yellow': 'Yellow',
  'captions.color.green': 'Green',
  'captions.color.cyan': 'Cyan',
  'captions.color.blue': 'Blue',
  'captions.color.magenta': 'Magenta',
  'captions.color.red': 'Red',
  'captions.color.black': 'Black',
  'captions.font.sans': 'Sans serif',
  'captions.font.serif': 'Serif',
  'captions.font.mono': 'Monospace',
  'captions.font.casual': 'Casual',
  'captions.font.small-caps': 'Small caps',
  'captions.edge.none': 'None',
  'captions.edge.outline': 'Outline',
  'captions.edge.shadow': 'Drop shadow',
  'captions.edge.raised': 'Raised',
  'captions.edge.depressed': 'Depressed',
});


/** Sizes and opacities read as percentages; the rest have a name in the catalogue. */
const STYLE_LABELS: Record<CaptionStyleKey, string | null> = {
  size: null,
  color: 'captions.color',
  background: 'captions.color',
  opacity: null,
  font: 'captions.font',
  edge: 'captions.edge',
};

function stylePanel(key: CaptionStyleKey, t: Translate): SettingsChoiceDecl {
  const prefix = STYLE_LABELS[key];
  return {
    id: key,
    label: t(`captions.style.${key}`),
    options: CHOICES[key].map((value) => ({
      value,
      label: prefix ? t(`${prefix}.${value}`) : `${value}%`,
    })),
    getValue: () => captionStyle.get()[key],
    onSelect: (value) => captionStyle.set(key, value),
  };
}

/** Subtitles and captions; tracks without a kind are subtitles, as in HTML. */
const isCaption = (t: TextTrackDef) => !t.kind || t.kind === 'subtitles' || t.kind === 'captions';
const isDescription = (t: TextTrackDef) => t.kind === 'descriptions';

class Captions implements PluginImpl {
  #captions: TrackChoice | null = null;
  #descriptions: TrackChoice | null = null;
  #layer: HTMLElement | null = null;
  #announcer: HTMLElement | null = null;
  #removeLayers: Array<() => void> = [];
  #last: string | null = null;
  /** The intro and outro are not the lecture: its cues do not belong over them. */
  #inContent: () => boolean = () => true;
  #unsubscribe: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const defs = ctx.player.manifest?.textTracks ?? [];
    const captions = new TrackChoice(defs.filter(isCaption), (cues) => this.#renderCues(cues));
    const descriptions = new TrackChoice(defs.filter(isDescription), (cues) => this.#announce(cues));
    if (captions.defs.length === 0 && descriptions.defs.length === 0) return;
    this.#captions = captions;
    this.#descriptions = descriptions;
    if (captions.active !== OFF) this.#last = captions.active;
    // The content waits behind the intro at its first frame, its first cue
    // active, and that caption was drawn over the intro.
    this.#inContent = () => ctx.player.phase === 'main';
    this.#unsubscribe.push(ctx.bus.on('chain:phase', () => this.#renderCues(captions.cues())));
    const t = ctx.t;

    // Engines attach lazily, and a detach replaces the `<video>`: mount on every attach.
    const mount = () => {
      const video = ctx.player.master?.element ?? null;
      captions.mount(video);
      descriptions.mount(video);
    };
    mount();
    this.#unsubscribe.push(ctx.bus.on('engine:attach:ok', mount));

    ctx.whenUi((ui) => {
      if (captions.defs.length > 0) this.#addCaptions(ui, captions, t);
      if (descriptions.defs.length > 0) this.#addDescriptions(ui, descriptions, t);
    });
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    this.#captions?.unmount();
    this.#descriptions?.unmount();
    for (const remove of this.#removeLayers) remove();
    this.#removeLayers = [];
    this.#layer = null;
    this.#announcer = null;
  }

  #addCaptions(ui: UiSlots, captions: TrackChoice, t: Translate): void {
    const overlay = ui.addOverlay({ id: 'captions', position: 'captions' });
    this.#layer = overlay.element;
    this.#removeLayers.push(overlay.remove);
    this.#applyStyle();
    this.#unsubscribe.push(captionStyle.subscribe(() => this.#applyStyle()));
    this.#renderCues(captions.cues());

    const select = (lang: string) => {
      captions.select(lang);
      if (lang !== OFF) this.#last = lang;
      ui.refresh();
    };

    this.#unsubscribe.push(ui.addBarControl({
      id: 'captions',
      priority: 30,
      icon: () => (captions.active === OFF ? ICON_OFF : ICON_ON),
      label: () => t(captions.active === OFF ? 'captions.on' : 'captions.label'),
      pressed: () => captions.active !== OFF,
      onActivate: () => select(captions.active === OFF ? (this.#last ?? captions.defs[0]!.lang) : OFF),
    }));

    this.#unsubscribe.push(ui.addSettingsPanel({
      id: 'captions',
      label: t('captions.label'),
      priority: 5,
      options: [
        { value: OFF, label: t('captions.off') },
        ...captions.defs.map((x) => ({ value: x.lang, label: trackName(x) })),
      ],
      getValue: () => captions.active,
      onSelect: select,
    }));

    this.#unsubscribe.push(ui.addSettingsPanel({
      id: 'caption-style',
      label: t('captions.style'),
      priority: 50,
      panels: (Object.keys(CHOICES) as CaptionStyleKey[]).map((key) => stylePanel(key, t)),
      onReset: () => captionStyle.reset(),
    }));
  }

  /**
   * Text descriptions are for screen readers: read out through a live region,
   * not drawn. Sighted viewers have the picture they describe.
   */
  #addDescriptions(ui: UiSlots, descriptions: TrackChoice, t: Translate): void {
    const overlay = ui.addOverlay({ id: 'descriptions', position: 'fill' });
    this.#removeLayers.push(overlay.remove);
    const region = document.createElement('div');
    region.className = 'np__sr';
    region.setAttribute('aria-live', 'polite');
    overlay.element.appendChild(region);
    this.#announcer = region;

    this.#unsubscribe.push(ui.addSettingsPanel({
      id: 'descriptions',
      label: t('captions.descriptions'),
      priority: 6,
      options: [
        { value: OFF, label: t('captions.off') },
        ...descriptions.defs.map((x) => ({ value: x.lang, label: trackName(x) })),
      ],
      getValue: () => descriptions.active,
      onSelect: (lang) => descriptions.select(lang),
    }));
  }

  /** Inline custom properties, not a generated stylesheet, so a strict CSP allows it. */
  #applyStyle(): void {
    const layer = this.#layer;
    if (!layer) return;
    for (const [name, value] of Object.entries(cssVariables(captionStyle.get()))) {
      if (value === null) layer.style.removeProperty(name);
      else layer.style.setProperty(name, value);
    }
  }

  /**
   * `getCueAsHTML()` keeps the WebVTT markup (bold, italics, voices), inserted
   * as nodes, never as an HTML string: captions are third-party content.
   */
  #renderCues(cues: TextTrackCue[]): void {
    const layer = this.#layer;
    if (!layer) return;
    layer.textContent = '';
    if (!this.#inContent()) return;
    for (const cue of cues) {
      const line = document.createElement('div');
      line.className = 'np__cue';
      const vtt = cue as VTTCue & { getCueAsHTML?: () => DocumentFragment };
      if (typeof vtt.getCueAsHTML === 'function') line.appendChild(vtt.getCueAsHTML());
      else line.textContent = vtt.text ?? '';
      layer.appendChild(line);
    }
  }

  /** An emptied region is not read, so a cue ending says nothing. */
  #announce(cues: TextTrackCue[]): void {
    if (!this.#announcer || !this.#inContent()) return;
    this.#announcer.textContent = cues
      .map((cue) => {
        const vtt = cue as VTTCue & { getCueAsHTML?: () => DocumentFragment };
        return vtt.getCueAsHTML?.().textContent ?? vtt.text ?? '';
      })
      .join(' ');
  }
}

/** Self-registration: it switches on by itself when the manifest has captions or descriptions. */
plugins.register({
  id: 'captions',
  activateWhen: (m) => (m?.textTracks ?? []).some((x) => isCaption(x) || isDescription(x)),
  load: () => new Captions(),
});

export { Captions };
