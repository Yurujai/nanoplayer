import type { Translate } from '@nanoplayer/core';
import { SHORTCUT_HELP } from './keyboard-shortcuts.js';

/** How a key is shown, and what a screen reader says for a glyph. */
const KEY_NAMES: Record<string, { text: string; spoken?: string }> = {
  ' ': { text: 'ui.keys.space' },
  ArrowLeft: { text: '←', spoken: 'ui.keys.left' },
  ArrowRight: { text: '→', spoken: 'ui.keys.right' },
  ArrowUp: { text: '↑', spoken: 'ui.keys.up' },
  ArrowDown: { text: '↓', spoken: 'ui.keys.down' },
  Home: { text: 'ui.keys.home' },
  End: { text: 'ui.keys.end' },
  Escape: { text: 'Esc' },
};

/**
 * The keyboard shortcuts, in a modal dialog over the player: named by its
 * title, focus moved in and kept there, Escape or the button closing it and
 * focus going back where it was. Inside the player, so it shows in full screen.
 */
export class ShortcutsDialog {
  readonly #layer: HTMLElement;
  readonly #dialog: HTMLElement;
  readonly #close: HTMLButtonElement;
  #returnTo: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement, private readonly t: Translate) {
    const doc = root.ownerDocument;
    this.#layer = doc.createElement('div');
    this.#layer.className = 'np__dialog-layer';
    this.#layer.hidden = true;

    this.#dialog = doc.createElement('div');
    this.#dialog.className = 'np__dialog';
    this.#dialog.setAttribute('role', 'dialog');
    this.#dialog.setAttribute('aria-modal', 'true');
    const titleId = `np-keys-${Math.random().toString(36).slice(2)}`;
    this.#dialog.setAttribute('aria-labelledby', titleId);

    const header = doc.createElement('div');
    header.className = 'np__dialog-header';
    const title = doc.createElement('h2');
    title.id = titleId;
    title.className = 'np__dialog-title';
    title.textContent = t('ui.keys.title');
    this.#close = doc.createElement('button');
    this.#close.type = 'button';
    this.#close.className = 'np__dialog-close';
    this.#close.textContent = t('ui.keys.close');
    this.#close.setAttribute('aria-label', t('ui.keys.close'));
    header.append(title, this.#close);

    this.#dialog.append(header, this.#table());
    this.#layer.appendChild(this.#dialog);
    root.appendChild(this.#layer);

    this.#close.addEventListener('click', () => this.close());
    // A click on the dimmed player around the dialog closes it, as on any modal.
    this.#layer.addEventListener('click', (ev) => { if (ev.target === this.#layer) this.close(); });
    this.#dialog.addEventListener('keydown', (ev) => this.#onKey(ev));
  }

  get isOpen(): boolean {
    return !this.#layer.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    const active = this.root.ownerDocument.activeElement;
    this.#returnTo = active instanceof HTMLElement ? active : null;
    this.#layer.hidden = false;
    this.#close.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.#layer.hidden = true;
    (this.#returnTo?.isConnected ? this.#returnTo : this.root).focus();
    this.#returnTo = null;
  }

  destroy(): void {
    this.#layer.remove();
  }

  #onKey(ev: KeyboardEvent): void {
    // The player's own shortcuts would act on the video behind the dialog.
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    } else if (ev.key === 'Tab') {
      // The close button is the only stop: Tab stays in the dialog.
      ev.preventDefault();
      this.#close.focus();
    }
  }

  #table(): HTMLElement {
    const doc = this.root.ownerDocument;
    const table = doc.createElement('table');
    table.className = 'np__keys';
    const head = doc.createElement('thead');
    head.innerHTML = '<tr><th scope="col"></th><th scope="col"></th></tr>';
    const [keysHead, actionHead] = head.querySelectorAll('th');
    keysHead!.textContent = this.t('ui.keys.key');
    actionHead!.textContent = this.t('ui.keys.action');
    const body = doc.createElement('tbody');
    for (const row of SHORTCUT_HELP) {
      const tr = doc.createElement('tr');
      const keys = doc.createElement('td');
      // "0 – 9" is a range; the rest are alternatives.
      const range = row.keys.length === 2 && row.keys[0] === '0' && row.keys[1] === '9';
      row.keys.forEach((key, i) => {
        if (i > 0) keys.append(range ? ' – ' : ' / ');
        keys.appendChild(this.#kbd(key));
      });
      const action = doc.createElement('td');
      action.textContent = this.t(row.label);
      tr.append(keys, action);
      body.appendChild(tr);
    }
    table.append(head, body);
    return table;
  }

  #kbd(key: string): HTMLElement {
    const doc = this.root.ownerDocument;
    const kbd = doc.createElement('kbd');
    const name = KEY_NAMES[key];
    if (!name) {
      kbd.textContent = key.length === 1 ? key.toUpperCase() : key;
      return kbd;
    }
    const text = name.text.startsWith('ui.') ? this.t(name.text) : name.text;
    if (!name.spoken) {
      kbd.textContent = text;
      return kbd;
    }
    // An arrow glyph is read inconsistently: the screen reader gets its name.
    const glyph = doc.createElement('span');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = text;
    const spoken = doc.createElement('span');
    spoken.className = 'np__sr';
    spoken.textContent = this.t(name.spoken);
    kbd.append(glyph, spoken);
    return kbd;
  }
}
