// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BarControlDecl } from '@nanoplayer/core';
import { SettingsMenu } from '../src/settings-menu.js';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

describe('SettingsMenu · contrato con los plugins', () => {
  const panel = (id: string, over: Record<string, unknown> = {}) => ({
    id, label: id, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    getValue: () => 'a', onSelect: () => {}, ...over,
  });

  it('el engranaje no aparece si nadie ha aportado ajustes', () => {
    const m = new SettingsMenu(host);
    expect(m.button.hidden).toBe(true);
    m.addPanel(panel('speed'));
    expect(m.button.hidden).toBe(false);
  });

  it('retirar el último panel vuelve a esconder el engranaje', () => {
    const m = new SettingsMenu(host);
    const quitar = m.addPanel(panel('speed'));
    quitar();
    expect(m.button.hidden).toBe(true);
    expect(m.panelCount).toBe(0);
  });

  it('ordena por prioridad, no por orden de registro', () => {
    const m = new SettingsMenu(host);
    m.addPanel(panel('tarde', { priority: 90 }));
    m.addPanel(panel('pronto', { priority: 10 }));
    m.open();
    const etiquetas = [...host.querySelectorAll('[role="menuitem"]')]
      .map((el) => el.textContent?.trim());
    expect(etiquetas[0]).toContain('pronto');
  });

  it('el valor actual entra en el nombre accesible', () => {
    // Sin esto habría que abrir el panel solo para saber a qué velocidad va.
    const m = new SettingsMenu(host);
    m.addPanel(panel('speed', { getValue: () => 'b' }));
    m.open();
    const item = host.querySelector('[role="menuitem"]');
    expect(item?.getAttribute('aria-label')).toBe('speed: B');
  });

  it('marca la opción activa con aria-checked', () => {
    const m = new SettingsMenu(host);
    m.addPanel(panel('speed'));
    m.open();
    host.querySelector<HTMLElement>('.np__menu-item--parent')?.click();
    const marcadas = host.querySelectorAll('[role="menuitemradio"][aria-checked="true"]');
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0]?.textContent).toContain('A');
  });

  it('elegir una opción llama a onSelect y vuelve al panel principal', () => {
    const onSelect = vi.fn();
    const m = new SettingsMenu(host);
    m.addPanel(panel('speed', { onSelect }));
    m.open();
    host.querySelector<HTMLElement>('.np__menu-item--parent')?.click();
    const opciones = host.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    opciones[1]?.click();
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(host.querySelector('.np__menu-back')).toBeNull();
  });

  it('no abre si no hay nada que ofrecer', () => {
    const m = new SettingsMenu(host);
    m.open();
    expect(m.isOpen).toBe(false);
  });
});

describe('declaración de control de barra', () => {
  it('los campos dinámicos permiten reflejar el estado', () => {
    // Un conmutador necesita que icono, etiqueta y estado cambien con él; si
    // fueran valores fijos, el plugin tendría que repintar por su cuenta.
    let activo = false;
    const decl: BarControlDecl = {
      id: 'captions',
      icon: () => (activo ? 'on' : 'off'),
      label: () => (activo ? 'Subtítulos' : 'Activar subtítulos'),
      pressed: () => activo,
      onActivate: () => { activo = !activo; },
    };
    expect(typeof decl.icon).toBe('function');
    expect(decl.pressed?.()).toBe(false);
    decl.onActivate();
    expect(decl.pressed?.()).toBe(true);
    expect((decl.label as () => string)()).toBe('Subtítulos');
  });
});
