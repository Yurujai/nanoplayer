/**
 * Sign language plugin: shows or hides the interpreter, and lets each viewer
 * put it in another corner or make it bigger, remembered between visits.
 *
 * The interpreter is one more stream in the manifest, `role: "interpreter"`,
 * silent and kept in sync with the lecture like the slides. The UI already
 * draws it over the picture; this plugin only gives the viewer control of it.
 * WCAG 1.2.6 (AAA) asks for sign language in recorded video.
 */
import {
  icon, isInterpreter, plugins, strings,
  type PluginContext, type PluginImpl, type SettingsChoiceDecl, type Translate,
} from '@nanoplayer/core';

strings.register('es', {
  'signLanguage.label': 'Intérprete de lengua de signos',
  'signLanguage.position': 'Posición',
  'signLanguage.size': 'Tamaño',
  'signLanguage.corner.top-left': 'Arriba a la izquierda',
  'signLanguage.corner.top-right': 'Arriba a la derecha',
  'signLanguage.corner.bottom-left': 'Abajo a la izquierda',
  'signLanguage.corner.bottom-right': 'Abajo a la derecha',
  'signLanguage.size.small': 'Pequeño',
  'signLanguage.size.medium': 'Mediano',
  'signLanguage.size.large': 'Grande',
});
strings.register('en', {
  'signLanguage.label': 'Sign language interpreter',
  'signLanguage.position': 'Position',
  'signLanguage.size': 'Size',
  'signLanguage.corner.top-left': 'Top left',
  'signLanguage.corner.top-right': 'Top right',
  'signLanguage.corner.bottom-left': 'Bottom left',
  'signLanguage.corner.bottom-right': 'Bottom right',
  'signLanguage.size.small': 'Small',
  'signLanguage.size.medium': 'Medium',
  'signLanguage.size.large': 'Large',
});

/** Two raised hands. Filled while shown, outlined while hidden: the player's rule for toggles. */
const PALMS = 'M3.6 11.2h6.6v4.3a3.3 3.3 0 0 1-6.6 0zM13.8 12.6h6.6v4.3a3.3 3.3 0 0 1-6.6 0z';
const FINGERS = 'M4.8 11V6.6M7 11V4.6M9.1 11V6.4M15 12.4V8M17.1 12.4V6M19.2 12.4V8'
  + 'M10.2 13.2l1.7-2.4M13.8 14.6l-1.7-2.4';
const ICON_ON = icon.svg(icon.solid(PALMS), icon.line(FINGERS));
const ICON_OFF = icon.svg(icon.outline(PALMS), icon.outline(FINGERS));

export const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const;
/** Share of the player's width. Small still leaves the hands readable. */
export const SIZES = { small: '22%', medium: '28%', large: '36%' } as const;

export interface InterpreterPreference {
  visible: boolean;
  corner: (typeof CORNERS)[number];
  size: keyof typeof SIZES;
}

const DEFAULT: InterpreterPreference = { visible: true, corner: 'bottom-right', size: 'medium' };
const STORAGE_KEY = 'nanoplayer:interpreter';

/** Anything stored that is not a known value falls back to the default. */
function sanitize(raw: unknown): InterpreterPreference {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<InterpreterPreference>;
  return {
    visible: typeof p.visible === 'boolean' ? p.visible : DEFAULT.visible,
    corner: CORNERS.includes(p.corner as InterpreterPreference['corner']) ? p.corner! : DEFAULT.corner,
    size: p.size && p.size in SIZES ? p.size : DEFAULT.size,
  };
}

/**
 * One preference per viewer, shared by every player on the page and kept
 * between visits. Storage can throw (private mode): then it lasts the page.
 */
class PreferenceStore {
  #value: InterpreterPreference | null = null;
  readonly #listeners = new Set<() => void>();

  get(): InterpreterPreference {
    if (!this.#value) {
      let raw: unknown = null;
      try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'); } catch { /* default */ }
      this.#value = sanitize(raw);
    }
    return this.#value;
  }

  set(change: Partial<InterpreterPreference>): void {
    this.#value = sanitize({ ...this.get(), ...change });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#value)); } catch { /* this page only */ }
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Forgets what was read, so the next `get` reads storage again. For tests. */
  reload(): void {
    this.#value = null;
  }
}

export const interpreterPreference = new PreferenceStore();

function choice(
  id: 'position' | 'size', t: Translate,
  options: Array<{ value: string; label: string }>,
  value: () => string, select: (v: string) => void,
): SettingsChoiceDecl {
  return { id, label: t(`signLanguage.${id}`), options, getValue: value, onSelect: select };
}

class SignLanguage implements PluginImpl {
  #unsubscribe: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const { player, t } = ctx;
    if (!player.manifest?.streams.some(isInterpreter)) return;
    const root = player.container;

    // On the container: the stylesheet places the interpreter from these.
    const apply = () => {
      const p = interpreterPreference.get();
      root.dataset['interpreter'] = p.visible ? 'on' : 'off';
      root.dataset['interpreterCorner'] = p.corner;
      root.style.setProperty('--np-interpreter-width', SIZES[p.size]);
    };
    apply();
    this.#unsubscribe.push(interpreterPreference.subscribe(apply));
    this.#unsubscribe.push(() => {
      delete root.dataset['interpreter'];
      delete root.dataset['interpreterCorner'];
      root.style.removeProperty('--np-interpreter-width');
    });

    ctx.whenUi((ui) => {
      this.#unsubscribe.push(interpreterPreference.subscribe(() => ui.refresh()));
      this.#unsubscribe.push(ui.addBarControl({
        id: 'sign-language',
        priority: 32,
        icon: () => (interpreterPreference.get().visible ? ICON_ON : ICON_OFF),
        label: t('signLanguage.label'),
        pressed: () => interpreterPreference.get().visible,
        onActivate: () => interpreterPreference.set({ visible: !interpreterPreference.get().visible }),
      }));
      this.#unsubscribe.push(ui.addSettingsPanel({
        id: 'sign-language',
        label: t('signLanguage.label'),
        priority: 8,
        panels: [
          choice('position', t, CORNERS.map((c) => ({ value: c, label: t(`signLanguage.corner.${c}`) })),
            () => interpreterPreference.get().corner,
            (v) => interpreterPreference.set({ corner: v as InterpreterPreference['corner'] })),
          choice('size', t, (Object.keys(SIZES) as Array<keyof typeof SIZES>)
            .map((s) => ({ value: s, label: t(`signLanguage.size.${s}`) })),
          () => interpreterPreference.get().size,
          (v) => interpreterPreference.set({ size: v as InterpreterPreference['size'] })),
        ],
      }));
    });
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }
}

/** Self-registration: on when the manifest has an interpreter stream. */
plugins.register({
  id: 'sign-language',
  activateWhen: (m) => !!m?.streams.some(isInterpreter),
  load: () => new SignLanguage(),
});

export { SignLanguage };
