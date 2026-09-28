import type { BarControlDecl, Translate } from '@nanoplayer/core';
import { createButton } from './dom.js';
import type { SettingsMenu } from './settings-menu.js';

const text = (v: string | (() => string)) => (typeof v === 'function' ? v() : v);

/**
 * The buttons plugins add to the bar, and the overflow into the settings menu.
 *
 * The bar is scarce: on a phone four or five controls fit, and three plugins
 * with a button each would make it unusable. What does not fit **does not
 * disappear**: it goes to a "More options" panel, still reachable by keyboard
 * and screen reader.
 */
export class PluginControls {
  /** Where the buttons go: between the spacer and the settings gear. */
  readonly element: HTMLElement;
  readonly #controls: BarControlDecl[] = [];
  readonly #buttons = new Map<string, HTMLButtonElement>();
  #removeOverflow: (() => void) | null = null;

  constructor(
    private readonly doc: Document,
    /** A getter: the menu is created after this, to sit to its right in the row. */
    private readonly menu: () => SettingsMenu,
    private readonly t: Translate,
  ) {
    this.element = doc.createElement('span');
    this.element.className = 'np__plugins';
  }

  add(control: BarControlDecl): () => void {
    this.#controls.push(control);
    this.render();
    return () => {
      const i = this.#controls.indexOf(control);
      if (i >= 0) this.#controls.splice(i, 1);
      this.#buttons.get(control.id)?.remove();
      this.#buttons.delete(control.id);
      this.render();
    };
  }

  render(): void {
    const available = this.#controls
      .filter((c) => c.available?.() ?? true)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    const fit = this.#howManyFit();

    this.element.textContent = '';
    this.#buttons.clear();
    for (const c of available.slice(0, fit)) {
      const b = createButton(this.doc, text(c.label), text(c.icon));
      b.dataset['control'] = c.id;
      if (c.pressed) b.setAttribute('aria-pressed', String(c.pressed()));
      b.addEventListener('click', () => { c.onActivate(); this.render(); });
      this.element.appendChild(b);
      this.#buttons.set(c.id, b);
    }

    this.#removeOverflow?.();
    this.#removeOverflow = null;
    const overflow = available.slice(fit);
    if (overflow.length === 0) return;
    this.#removeOverflow = this.menu().addPanel({
      id: '__overflow',
      label: this.t('ui.more'),
      priority: 900,
      options: overflow.map((c) => ({ value: c.id, label: text(c.label) })),
      getValue: () => '',
      onSelect: (id) => {
        this.#controls.find((c) => c.id === id)?.onActivate();
        this.render();
      },
    });
  }

  /** Free width in the row, measured from what the other controls really take. */
  #howManyFit(): number {
    const row = this.element.parentElement;
    if (!row) return 0;
    const buttonWidth = this.element.getBoundingClientRect().height || 40;
    let taken = 0;
    for (const child of row.children) {
      if (child === this.element || child.classList.contains('np__spacer')) continue;
      taken += child.getBoundingClientRect().width;
    }
    return Math.max(0, Math.floor((row.getBoundingClientRect().width - taken) / buttonWidth));
  }
}
