/**
 * How each viewer wants captions to look. Captions are painted in an overlay
 * (docs/browser-quirks.md#native-captions-in-video), so the operating
 * system's caption preferences do not reach them: this is their replacement.
 */

export interface CaptionStyle {
  size: string;
  color: string;
  background: string;
  opacity: string;
  font: string;
  edge: string;
}

export type CaptionStyleKey = keyof CaptionStyle;

const COLORS: Record<string, string> = {
  white: '255,255,255',
  yellow: '255,255,0',
  green: '0,255,0',
  cyan: '0,255,255',
  blue: '0,0,255',
  magenta: '255,0,255',
  red: '255,0,0',
  black: '0,0,0',
};

const FONTS: Record<string, string> = {
  sans: '',
  serif: 'Georgia,"Times New Roman",serif',
  mono: 'ui-monospace,Menlo,Consolas,"Courier New",monospace',
  casual: '"Comic Sans MS","Comic Neue","Chalkboard SE",cursive',
  'small-caps': '',
};

const EDGES: Record<string, string> = {
  none: '',
  outline: '0 0 .08em #000,0 0 .08em #000,0 0 .12em #000,0 0 .12em #000',
  shadow: '.06em .06em .12em #000,.06em .06em .2em #000',
  raised: '.04em .04em #222,.08em .08em #222',
  depressed: '-.04em -.04em #222,.04em .04em #ccc',
};

/** Allowed values, in menu order. */
export const CHOICES: { readonly [K in CaptionStyleKey]: readonly string[] } = {
  size: ['50', '75', '100', '125', '150', '200'],
  color: Object.keys(COLORS),
  background: Object.keys(COLORS),
  opacity: ['100', '75', '50', '25', '0'],
  font: Object.keys(FONTS),
  edge: Object.keys(EDGES),
};

/** Matches the stylesheet's defaults, so the default writes nothing. */
export const DEFAULT_STYLE: Readonly<CaptionStyle> = {
  size: '100',
  color: 'white',
  background: 'black',
  opacity: '75',
  font: 'sans',
  edge: 'none',
};

/**
 * The CSS variables for a style, `null` meaning "leave the stylesheet's".
 * Untouched settings write nothing, so a site's theme of `--np-cue-*` still
 * applies until the viewer changes that very setting.
 */
export function cssVariables(style: CaptionStyle): Record<string, string | null> {
  const changed = (k: CaptionStyleKey) => style[k] !== DEFAULT_STYLE[k];
  const background = changed('background') || changed('opacity')
    ? `rgba(${COLORS[style.background]},${Number(style.opacity) / 100})`
    : null;
  return {
    '--np-cue-scale': changed('size') ? String(Number(style.size) / 100) : null,
    '--np-cue-color': changed('color') ? `rgb(${COLORS[style.color]})` : null,
    '--np-cue-bg': background,
    '--np-cue-font': FONTS[style.font] || null,
    '--np-cue-variant': style.font === 'small-caps' ? 'small-caps' : null,
    '--np-cue-edge': EDGES[style.edge] || null,
  };
}

const STORAGE_KEY = 'nanoplayer:caption-style';

/** Anything stored that is not a known value falls back to the default. */
function sanitize(raw: unknown): CaptionStyle {
  const style = { ...DEFAULT_STYLE };
  if (!raw || typeof raw !== 'object') return style;
  for (const key of Object.keys(CHOICES) as CaptionStyleKey[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'string' && CHOICES[key].includes(value)) style[key] = value;
  }
  return style;
}

/**
 * One style per page, shared by every player on it and remembered between
 * visits. Storage can throw (private mode, blocked site data): then the
 * style lasts for the page only.
 */
class CaptionStyleStore {
  #style: CaptionStyle | null = null;
  readonly #listeners = new Set<() => void>();

  get(): CaptionStyle {
    if (!this.#style) {
      let raw: unknown = null;
      try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'); } catch { /* defaults */ }
      this.#style = sanitize(raw);
    }
    return this.#style;
  }

  set(key: CaptionStyleKey, value: string): void {
    if (!CHOICES[key].includes(value)) return;
    this.#save({ ...this.get(), [key]: value });
  }

  reset(): void {
    this.#save({ ...DEFAULT_STYLE });
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Forgets what was read, so the next `get` reads storage again. For tests. */
  reload(): void {
    this.#style = null;
  }

  #save(style: CaptionStyle): void {
    this.#style = style;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(style)); } catch { /* page only */ }
    for (const listener of this.#listeners) listener();
  }
}

export const captionStyle = new CaptionStyleStore();
