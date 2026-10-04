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

  describe('groups', () => {
    const group = (over: Record<string, unknown> = {}) => ({
      id: 'style', label: 'Style', panels: [panel('size'), panel('color')], ...over,
    });
    const press = (key: string) => host.querySelector('.np__menu')!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    it('opens one level deeper and lists its panels with their values', () => {
      const m = new SettingsMenu(host, t);
      m.addPanel(group());
      m.open();
      expect(host.querySelector('[role="menuitem"]')?.getAttribute('aria-label')).toBe('Style');
      host.querySelector<HTMLElement>('[data-panel="style"]')?.click();
      const rows = [...host.querySelectorAll('.np__menu-item--parent')]
        .map((el) => el.getAttribute('aria-label'));
      expect(rows).toEqual(['size: A', 'color: A']);
    });

    it('choosing an option goes back to the group, focused on that setting', () => {
      const onSelect = vi.fn();
      const m = new SettingsMenu(host, t);
      m.addPanel(group({ panels: [panel('size'), panel('color', { onSelect })] }));
      m.open();
      host.querySelector<HTMLElement>('[data-panel="style"]')?.click();
      host.querySelector<HTMLElement>('[data-panel="color"]')?.click();
      host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[1]?.click();
      expect(onSelect).toHaveBeenCalledWith('b');
      expect(document.activeElement?.getAttribute('data-panel')).toBe('color');
    });

    it('Escape climbs one level at a time', () => {
      const m = new SettingsMenu(host, t);
      m.addPanel(group());
      m.open();
      host.querySelector<HTMLElement>('[data-panel="style"]')?.click();
      host.querySelector<HTMLElement>('[data-panel="size"]')?.click();
      press('Escape');
      expect(document.activeElement?.getAttribute('data-panel')).toBe('size');
      press('Escape');
      expect(document.activeElement?.getAttribute('data-panel')).toBe('style');
      press('Escape');
      expect(m.isOpen).toBe(false);
    });

    it('ends with a reset item when the group has one', () => {
      const onReset = vi.fn();
      const m = new SettingsMenu(host, t);
      m.addPanel(group({ onReset }));
      m.open();
      host.querySelector<HTMLElement>('[data-panel="style"]')?.click();
      const items = host.querySelectorAll<HTMLElement>('[role="menuitem"]');
      const reset = items[items.length - 1]!;
      expect(reset.textContent).toBe('Restablecer');
      reset.click();
      expect(onReset).toHaveBeenCalled();
      expect(document.activeElement?.textContent).toBe('Restablecer');
    });
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

describe('panel slot', () => {
  const MANIFEST = {
    id: 'x',
    streams: [{ id: 'a', role: 'presenter', audio: true, sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
  };

  async function withBar() {
    const { Player } = await import('@nanoplayer/core');
    const { attachControls } = await import('../src/control-bar.js');
    const player = new Player({ container: host, manifest: MANIFEST });
    const bar = attachControls(player, { poster: false });
    // happy-dom lays out nothing: without width every bar button overflows to the menu.
    const row = host.querySelector<HTMLElement>('.np__row:not(.np__row--progress)')!;
    row.getBoundingClientRect = () => ({ width: 800, height: 40 }) as DOMRect;
    return { player, bar };
  }

  it('is a named region below the player, closed, with a toggle in the bar', async () => {
    const { bar } = await withBar();
    const onOpen = vi.fn();
    const panel = bar.addPanel({ id: 'transcript', label: 'Transcript', icon: '<svg></svg>', onOpen });
    bar.refresh();
    expect(panel.element.previousElementSibling, 'right after the player').toBe(host);
    expect(panel.element.tagName).toBe('SECTION');
    expect(panel.element.getAttribute('aria-label')).toBe('Transcript');
    expect(panel.isOpen).toBe(false);

    const toggle = host.querySelector<HTMLButtonElement>('[data-control="panel-transcript"]')!;
    expect(toggle.getAttribute('aria-label')).toBe('Transcript');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();
    expect(panel.isOpen).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-control="panel-transcript"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('goes away with its button', async () => {
    const { bar } = await withBar();
    const panel = bar.addPanel({ id: 'notes', label: 'Notes', icon: '<svg></svg>' });
    panel.remove();
    expect(document.querySelector('[data-panel="notes"]')).toBeNull();
    expect(host.querySelector('[data-control="panel-notes"]')).toBeNull();
  });
});

describe('control bar · shape', () => {
  const MANIFEST = {
    id: 'x',
    streams: [{ id: 'a', role: 'presenter', audio: true, sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
  };

  it('a fixed aspect ratio shapes the player', async () => {
    const { Player } = await import('@nanoplayer/core');
    const { attachControls } = await import('../src/control-bar.js');
    attachControls(new Player({ container: host, manifest: MANIFEST }), { aspectRatio: '4:3' });
    expect(host.style.aspectRatio).toBe('4 / 3');
    expect(host.classList.contains('np--ratio')).toBe(true);
  });

  it('ignores a ratio it cannot read', async () => {
    const { Player } = await import('@nanoplayer/core');
    const { attachControls } = await import('../src/control-bar.js');
    attachControls(new Player({ container: host, manifest: MANIFEST }), { aspectRatio: 'wide' });
    expect(host.style.aspectRatio).toBe('');
    expect(host.classList.contains('np--ratio')).toBe(false);
  });
});
