// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '@nanoplayer/core';
import { ShortcutsDialog } from '../src/shortcuts-dialog.js';
import { SHORTCUT_HELP } from '../src/keyboard-shortcuts.js';
import '../src/strings.js';

const t = strings.translator('en');
let root: HTMLElement;
let opener: HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  root.tabIndex = 0;
  opener = document.createElement('button');
  root.appendChild(opener);
  document.body.appendChild(root);
});

const press = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('shortcuts dialog', () => {
  it('is a modal dialog named by its title, closed until asked for', () => {
    new ShortcutsDialog(root, t);
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.closest<HTMLElement>('.np__dialog-layer')!.hidden).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Keyboard shortcuts');
  });

  it('lists every shortcut, with arrows named for screen readers', () => {
    new ShortcutsDialog(root, t);
    const rows = root.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(SHORTCUT_HELP.length);
    expect(rows[0]!.textContent).toBe('Space / KPlay or pause');
    expect(rows[1]!.querySelector('.np__sr')!.textContent).toBe('Left arrow');
    expect(rows[1]!.querySelector('[aria-hidden="true"]')!.textContent).toBe('←');
    expect(rows[6]!.textContent).toContain('0 – 9');
  });

  it('takes focus, keeps it, and gives it back on Escape', () => {
    const dialog = new ShortcutsDialog(root, t);
    opener.focus();
    dialog.open();
    const close = root.querySelector<HTMLButtonElement>('.np__dialog-close')!;
    expect(document.activeElement).toBe(close);
    press(close, 'Tab');
    expect(document.activeElement, 'Tab stays inside').toBe(close);
    press(close, 'Escape');
    expect(dialog.isOpen).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('keys inside do not reach the player\'s shortcuts', () => {
    const dialog = new ShortcutsDialog(root, t);
    const onKey = vi.fn();
    root.addEventListener('keydown', onKey);
    dialog.open();
    press(root.querySelector('.np__dialog-close')!, 'k');
    expect(onKey).not.toHaveBeenCalled();
  });

  it('closes with its button, or a click on the dimmed player around it', () => {
    const dialog = new ShortcutsDialog(root, t);
    dialog.open();
    root.querySelector<HTMLButtonElement>('.np__dialog-close')!.click();
    expect(dialog.isOpen).toBe(false);
    dialog.open();
    root.querySelector<HTMLElement>('.np__dialog-layer')!.click();
    expect(dialog.isOpen).toBe(false);
  });
});
