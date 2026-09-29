/**
 * String catalogue. The core has no translatable strings, only the mechanism:
 * each package registers its own under a namespace (`ui.play`,
 * `captions.label`). A missing key is returned as is, so a button reading
 * `ui.play` says where to look where a blank one would not.
 */

/** One language: flat dotted keys. */
export type Catalogue = Readonly<Record<string, string>>;

/** Catalogues by language, as an integrator passes them. */
export type Catalogues = Readonly<Record<string, Catalogue>>;

/**
 * Translates a key. Variables are written `{like_this}`, so each language can
 * put words in its own order.
 */
export interface Translate {
  (key: string, vars?: Readonly<Record<string, string | number>>): string;
  /** The resolved language, to pass to `Intl`. */
  readonly lang: string;
}

/** The language to fall back to. */
export const BASE_LANGUAGE = 'es';

/** `es-MX` is also served by an `es` catalogue. */
function candidates(lang: string): string[] {
  const clean = (lang || '').trim();
  if (!clean) return [BASE_LANGUAGE];
  const short = clean.slice(0, 2).toLowerCase();
  const list = [clean.toLowerCase()];
  if (short !== clean.toLowerCase()) list.push(short);
  if (!list.includes(BASE_LANGUAGE)) list.push(BASE_LANGUAGE);
  return list;
}

function interpolate(
  template: string,
  vars?: Readonly<Record<string, string | number>>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole);
}

/** Where every package's catalogue meets. A class so tests can isolate instances. */
export class StringRegistry {
  readonly #catalogues = new Map<string, Record<string, string>>();

  /** Registering a language twice merges: packages load in any order. */
  register(lang: string, catalogue: Catalogue): void {
    const key = lang.toLowerCase();
    const current = this.#catalogues.get(key) ?? {};
    Object.assign(current, catalogue);
    this.#catalogues.set(key, current);
  }

  get languages(): string[] {
    return [...this.#catalogues.keys()];
  }

  has(lang: string): boolean {
    return this.#catalogues.has(lang.toLowerCase());
  }

  /** Keys registered for a language, to check a translation is complete. */
  keys(lang: string): string[] {
    const c = this.#catalogues.get(lang.toLowerCase());
    return c ? Object.keys(c) : [];
  }

  /**
   * A translate function bound to a language. `overrides` win over everything
   * registered, so adding a language or changing one word is configuration.
   */
  translator(lang: string, overrides?: Catalogues): Translate {
    const order = candidates(lang);
    const own = overrides
      ? new Map(Object.entries(overrides).map(([k, v]) => [k.toLowerCase(), v]))
      : null;

    const t = ((key, vars) => {
      for (const language of order) {
        const overridden = own?.get(language)?.[key];
        if (overridden !== undefined) return interpolate(overridden, vars);
        const registered = this.#catalogues.get(language)?.[key];
        if (registered !== undefined) return interpolate(registered, vars);
      }
      return key;
    }) as (key: string, vars?: Readonly<Record<string, string | number>>) => string;

    // Resolved on read: packages may register after the translator is created,
    // and a precomputed value would stick to the fallback language.
    Object.defineProperty(t, 'lang', {
      get: () => order.find((l) => this.#catalogues.has(l)) ?? order[0] ?? BASE_LANGUAGE,
      enumerable: true,
    });
    return t as Translate;
  }
}

/** The shared registry packages register their strings in. */
export const strings = new StringRegistry();
