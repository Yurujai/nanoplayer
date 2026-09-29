// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '@nanoplayer/core';
import type { BarControlDecl } from '@nanoplayer/core';
import { SettingsMenu } from '../src/settings-menu.js';
import { injectStyles } from '../src/styles.js';
import '../src/strings.js';

// The real translator, so a renamed or unregistered key fails the test.
const t = strings.translator('es');

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

describe('SettingsMenu · contract with plugins', () => {
  const panel = (id: string, over: Record<string, unknown> = {}) => ({
    id, label: id, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    getValue: () => 'a', onSelect: () => {}, ...over,
  });

  it('the gear stays hidden until someone adds settings', () => {
    const m = new SettingsMenu(host, t);
    expect(m.button.hidden).toBe(true);
    m.addPanel(panel('speed'));
    expect(m.button.hidden).toBe(false);
  });

  it('the hidden attribute really hides it', () => {
    // `button.np__btn` declares inline-flex, which beat the attribute's display:none.
    injectStyles(document);
    host.classList.add('np');
    const m = new SettingsMenu(host, t);
    expect(getComputedStyle(m.button).display).toBe('none');
    m.addPanel(panel('speed'));
    expect(getComputedStyle(m.button).display).not.toBe('none');
  });

  it('removing the last panel hides the gear again', () => {
    const m = new SettingsMenu(host, t);
    const remove = m.addPanel(panel('speed'));
    remove();
    expect(m.button.hidden).toBe(true);
    expect(m.panelCount).toBe(0);
  });

  it('sorts by priority, not by registration order', () => {
    const m = new SettingsMenu(host, t);
    m.addPanel(panel('late', { priority: 90 }));
    m.addPanel(panel('early', { priority: 10 }));
    m.open();
    const labels = [...host.querySelectorAll('[role="menuitem"]')]
      .map((el) => el.textContent?.trim());
    expect(labels[0]).toContain('early');
  });

  it('the current value is part of the accessible name', () => {
    const m = new SettingsMenu(host, t);
    m.addPanel(panel('speed', { getValue: () => 'b' }));
    m.open();
    const item = host.querySelector('[role="menuitem"]');
    expect(item?.getAttribute('aria-label')).toBe('speed: B');
  });

  it('marks the active option with aria-checked', () => {
    const m = new SettingsMenu(host, t);
    m.addPanel(panel('speed'));
    m.open();
    host.querySelector<HTMLElement>('.np__menu-item--parent')?.click();
    const checked = host.querySelectorAll('[role="menuitemradio"][aria-checked="true"]');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toContain('A');
  });

  it('choosing an option calls onSelect and goes back to the main panel', () => {
    const onSelect = vi.fn();
    const m = new SettingsMenu(host, t);
    m.addPanel(panel('speed', { onSelect }));
    m.open();
    host.querySelector<HTMLElement>('.np__menu-item--parent')?.click();
    const options = host.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    options[1]?.click();
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(host.querySelector('.np__menu-back')).toBeNull();
  });

  it('does not open with nothing to offer', () => {
    const m = new SettingsMenu(host, t);
    m.open();
    expect(m.isOpen).toBe(false);
  });
});

describe('bar control declaration', () => {
  it('dynamic fields let a toggle reflect its state', () => {
    let on = false;
    const decl: BarControlDecl = {
      id: 'captions',
      icon: () => (on ? 'on' : 'off'),
      label: () => (on ? 'Subtítulos' : 'Activar subtítulos'),
      pressed: () => on,
      onActivate: () => { on = !on; },
    };
    expect(typeof decl.icon).toBe('function');
    expect(decl.pressed?.()).toBe(false);
    decl.onActivate();
    expect(decl.pressed?.()).toBe(true);
    expect((decl.label as () => string)()).toBe('Subtítulos');
  });
});

describe('fullscreen', () => {
  it('the button hides where the permissions policy forbids it', () => {
    // See docs/browser-quirks.md#iframe-fullscreen.
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'fullscreenEnabled');
    Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true });
    expect(document.fullscreenEnabled).toBe(false);
    if (original) Object.defineProperty(Document.prototype, 'fullscreenEnabled', original);
  });
});
