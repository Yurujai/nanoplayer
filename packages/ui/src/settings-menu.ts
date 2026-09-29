/**
 * Settings menu with stacked panels, following the WAI-ARIA menu button
 * pattern: `role="menu"` with `menuitem`/`menuitemradio`, arrow keys and a
 * roving tabindex inside, focus in on open and back to the gear on close, and
 * Escape going back one panel before closing. Panels are declared, never
 * drawn by whoever adds them, so the accessibility holds for third-party plugins.
 */
import type { Translate } from '@nanoplayer/core';
import { ICONS } from './icons.js';

export interface SettingsOption {
  value: string;
  label: string;
}

export interface SettingsPanel {
  id: string;
  /** What the main menu reads. */
  label: string;
  options: readonly SettingsOption[];
  /** Current value, to tick the option and summarise it in the main menu. */
  getValue: () => string;
  onSelect: (value: string) => void;
  /** Lower goes first. Defaults to 100. */
  priority?: number;
}

export class SettingsMenu {
  readonly #button: HTMLButtonElement;
  readonly #popup: HTMLElement;
  readonly #t: Translate;
  readonly #panels = new Map<string, SettingsPanel>();

  #open = false;
  /** `null` is the main panel. */
  #activePanel: string | null = null;
  #unsubscribe: Array<() => void> = [];

  constructor(host: HTMLElement, t: Translate) {
    const doc = host.ownerDocument;
    this.#t = t;

    this.#button = doc.createElement('button');
    this.#button.type = 'button';
    this.#button.className = 'np__btn np__btn--settings';
    this.#button.innerHTML = ICONS.settings;
    this.#button.setAttribute('aria-label', this.#t('ui.settings.label'));
    this.#button.setAttribute('aria-haspopup', 'true');
    this.#button.setAttribute('aria-expanded', 'false');
    // Hidden until someone adds settings: a gear opening an empty menu is noise.
    this.#button.hidden = true;

    this.#popup = doc.createElement('div');
    this.#popup.className = 'np__menu';
    this.#popup.hidden = true;

    const wrapper = doc.createElement('div');
    wrapper.className = 'np__menu-anchor';
    wrapper.append(this.#button, this.#popup);
    host.appendChild(wrapper);

    this.#button.addEventListener('click', () => this.toggle());
    this.#popup.addEventListener('keydown', (ev) => this.#onKey(ev));

    // `pointerdown`, not `click`, so releasing over the gear does not reopen it.
    const outside = (ev: Event) => {
      if (!this.#open) return;
      if (!wrapper.contains(ev.target as Node)) this.close();
    };
    doc.addEventListener('pointerdown', outside, true);
    this.#unsubscribe.push(() => doc.removeEventListener('pointerdown', outside, true));
  }

  get button(): HTMLButtonElement {
    return this.#button;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  get panelCount(): number {
    return this.#panels.size;
  }

  addPanel(panel: SettingsPanel): () => void {
    this.#panels.set(panel.id, panel);
    this.#button.hidden = this.#panels.size === 0;
    if (this.#open) this.#render();
    return () => {
      this.#panels.delete(panel.id);
      this.#button.hidden = this.#panels.size === 0;
      if (this.#open) this.#render();
    };
  }

  toggle(): void {
    if (this.#open) this.close();
    else this.open();
  }

  open(): void {
    if (this.#open || this.#panels.size === 0) return;
    this.#open = true;
    this.#activePanel = null;
    this.#popup.hidden = false;
    this.#button.setAttribute('aria-expanded', 'true');
    this.#fitHeight();
    this.#render();
    this.#focusFirst();
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#activePanel = null;
    this.#popup.hidden = true;
    this.#button.setAttribute('aria-expanded', 'false');
    this.#button.focus();
  }

  destroy(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    this.#popup.remove();
    this.#button.remove();
  }

  /**
   * The player root has `overflow:hidden`, so a menu taller than the space
   * above the bar would be clipped and leave options unreachable.
   */
  #fitHeight(): void {
    const root = this.#button.closest('.np') as HTMLElement | null;
    if (!root) return;
    const bar = this.#button.closest('.np__bar') as HTMLElement | null;
    const barHeight = bar?.getBoundingClientRect().height ?? 0;
    const available = root.getBoundingClientRect().height - barHeight - 16;
    this.#popup.style.maxHeight = `${Math.max(140, available)}px`;
  }

  #render(): void {
    const doc = this.#popup.ownerDocument;
    this.#popup.textContent = '';

    const menu = doc.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', this.#t('ui.settings.label'));

    if (this.#activePanel === null) {
      const sorted = [...this.#panels.values()]
        .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
      for (const p of sorted) menu.appendChild(this.#panelRow(p));
    } else {
      const panel = this.#panels.get(this.#activePanel);
      if (!panel) { this.#activePanel = null; return this.#render(); }

      const back = doc.createElement('button');
      back.type = 'button';
      back.className = 'np__menu-back';
      back.setAttribute('role', 'menuitem');
      back.innerHTML = `<span class="np__menu-chevron" aria-hidden="true">‹</span>` +
        `<span>${panel.label}</span>`;
      back.setAttribute('aria-label', `${this.#t('ui.settings.back')}: ${panel.label}`);
      back.addEventListener('click', () => { this.#activePanel = null; this.#render(); this.#focusFirst(); });
      menu.appendChild(back);

      const current = panel.getValue();
      for (const option of panel.options) {
        const item = doc.createElement('button');
        item.type = 'button';
        item.className = 'np__menu-item';
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(option.value === current));
        item.innerHTML = `<span class="np__menu-tick" aria-hidden="true">` +
          `${option.value === current ? '✓' : ''}</span><span>${option.label}</span>`;
        item.addEventListener('click', () => {
          panel.onSelect(option.value);
          this.#activePanel = null;
          this.#render();
          this.#focusFirst();
        });
        menu.appendChild(item);
      }
    }

    this.#popup.appendChild(menu);
    this.#setRovingIndex(menu, 0);
  }

  #panelRow(panel: SettingsPanel): HTMLElement {
    const doc = this.#popup.ownerDocument;
    const current = panel.options.find((o) => o.value === panel.getValue());
    const item = doc.createElement('button');
    item.type = 'button';
    item.className = 'np__menu-item np__menu-item--parent';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('aria-haspopup', 'true');
    item.innerHTML = `<span>${panel.label}</span>` +
      `<span class="np__menu-value">${current?.label ?? ''}` +
      `<span class="np__menu-chevron" aria-hidden="true">›</span></span>`;
    // The current value is part of the accessible name, so it is known without opening the panel.
    item.setAttribute('aria-label', `${panel.label}: ${current?.label ?? ''}`);
    item.addEventListener('click', () => {
      this.#activePanel = panel.id;
      this.#render();
      this.#focusFirst();
    });
    return item;
  }

  #items(): HTMLElement[] {
    return [...this.#popup.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  }

  /** Only one item is tabbable; with all at tabindex 0, Tab would never leave the menu. */
  #setRovingIndex(root: HTMLElement, index: number): void {
    const items = [...root.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    items.forEach((el, i) => { el.tabIndex = i === index ? 0 : -1; });
  }

  #focusFirst(): void {
    this.#items()[0]?.focus();
  }

  #move(delta: number): void {
    const items = this.#items();
    if (items.length === 0) return;
    const current = items.findIndex((el) => el === this.#popup.ownerDocument.activeElement);
    const next = (current + delta + items.length) % items.length;
    this.#setRovingIndex(this.#popup, next);
    items[next]?.focus();
  }

  #onKey(ev: KeyboardEvent): void {
    switch (ev.key) {
      case 'ArrowDown': this.#move(1); break;
      case 'ArrowUp': this.#move(-1); break;
      case 'Home': this.#setRovingIndex(this.#popup, 0); this.#items()[0]?.focus(); break;
      case 'End': {
        const items = this.#items();
        this.#setRovingIndex(this.#popup, items.length - 1);
        items[items.length - 1]?.focus();
        break;
      }
      case 'Escape':
        if (this.#activePanel !== null) {
          this.#activePanel = null;
          this.#render();
          this.#focusFirst();
        } else {
          this.close();
        }
        break;
      case 'Tab':
        this.close();
        return;
      default:
        return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  }
}
