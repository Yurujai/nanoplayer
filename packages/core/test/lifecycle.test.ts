import { describe, expect, it, vi } from 'vitest';
import type { CoreEvents } from '../src/core-events.js';
import { EventBus } from '../src/events.js';
import { Lifecycle } from '../src/lifecycle.js';
import { TRANSITIONS, canTransition, type PlayerState } from '../src/state.js';

const ESTADOS = Object.keys(TRANSITIONS) as PlayerState[];

const nuevo = () => {
  const bus = new EventBus<CoreEvents>({ onListenerError: () => {} });
  return { bus, lc: new Lifecycle(bus) };
};

/** Lleva el ciclo de vida hasta un estado por el camino legítimo. */
const llevarA = (lc: Lifecycle, destino: PlayerState) => {
  const ruta: Record<PlayerState, PlayerState[]> = {
    idle: [],
    resolving: ['resolving'],
    resolved: ['resolving', 'resolved'],
    attaching: ['resolving', 'resolved', 'attaching'],
    attached: ['resolving', 'resolved', 'attaching', 'attached'],
    active: ['resolving', 'resolved', 'attaching', 'attached', 'active'],
    destroyed: ['destroyed'],
  };
  for (const paso of ruta[destino]) lc.transition(paso);
};

describe('tabla de transiciones', () => {
  it('todo estado alcanzable está declarado en la tabla', () => {
    for (const [from, destinos] of Object.entries(TRANSITIONS)) {
      for (const to of destinos) {
        expect(ESTADOS, `${from} → ${to}`).toContain(to);
      }
    }
  });

  it('destroyed es terminal', () => {
    expect(TRANSITIONS.destroyed).toEqual([]);
    for (const to of ESTADOS) {
      expect(canTransition('destroyed', to)).toBe(false);
    }
  });

  it('cualquier estado puede ser destruido', () => {
    for (const from of ESTADOS) {
      if (from === 'destroyed') continue;
      expect(canTransition(from, 'destroyed'), from).toBe(true);
    }
  });

  it('active no puede soltar el motor sin pausar antes', () => {
    // Deliberado: obliga a desalojar en dos pasos explícitos en lugar de
    // arrancarle el motor a una reproducción en curso.
    expect(canTransition('active', 'resolved')).toBe(false);
    expect(canTransition('active', 'attached')).toBe(true);
    expect(canTransition('attached', 'resolved')).toBe(true);
  });

  it('no se puede saltar etapas del ciclo perezoso', () => {
    expect(canTransition('idle', 'attached')).toBe(false);
    expect(canTransition('idle', 'active')).toBe(false);
    expect(canTransition('resolved', 'active')).toBe(false);
  });

  it('ningún estado se declara como transición hacia sí mismo', () => {
    for (const from of ESTADOS) {
      expect(canTransition(from, from), from).toBe(false);
    }
  });
});

describe('Lifecycle', () => {
  it('empieza en idle, sin manifiesto ni motor', () => {
    const { lc } = nuevo();
    expect(lc.state).toBe('idle');
    expect(lc.hasManifest).toBe(false);
    expect(lc.hasEngine).toBe(false);
    expect(lc.resumeAt).toBe(0);
  });

  it('emite state:change con origen y destino', () => {
    const { bus, lc } = nuevo();
    const fn = vi.fn();
    bus.on('state:change', fn);
    lc.transition('resolving');
    expect(fn).toHaveBeenCalledWith({ from: 'idle', to: 'resolving' });
  });

  it('lanza ante una transición inválida, y no cambia de estado', () => {
    const { lc } = nuevo();
    expect(() => lc.transition('active')).toThrow(/Transición inválida/);
    expect(lc.state).toBe('idle');
  });

  it('el mensaje de error dice qué transiciones sí valen', () => {
    const { lc } = nuevo();
    expect(() => lc.transition('attached')).toThrow(/resolving/);
  });

  it('hasManifest y hasEngine siguen al estado', () => {
    const { lc } = nuevo();
    llevarA(lc, 'resolved');
    expect(lc.hasManifest).toBe(true);
    expect(lc.hasEngine).toBe(false);

    lc.transition('attaching');
    lc.transition('attached');
    expect(lc.hasEngine).toBe(true);
  });

  // --- lo que hace tolerable el desalojo ----------------------------------

  it('conserva la posición al soltar el motor', () => {
    const { lc } = nuevo();
    llevarA(lc, 'active');

    lc.transition('attached');       // pausa
    lc.rememberPosition(137.5);
    lc.transition('resolved');       // desalojo

    expect(lc.state).toBe('resolved');
    expect(lc.hasEngine).toBe(false);
    expect(lc.resumeAt).toBe(137.5);

    // Y al volver a enganchar sigue ahí.
    lc.transition('attaching');
    lc.transition('attached');
    expect(lc.resumeAt).toBe(137.5);
  });

  it('volver a idle es un reinicio: descarta la posición', () => {
    const { lc } = nuevo();
    llevarA(lc, 'resolved');
    lc.rememberPosition(90);
    lc.transition('idle');
    expect(lc.resumeAt).toBe(0);
  });

  it('ignora posiciones absurdas en vez de guardarlas', () => {
    const { lc } = nuevo();
    lc.rememberPosition(42);
    lc.rememberPosition(-1);
    lc.rememberPosition(Number.NaN);
    lc.rememberPosition(Number.POSITIVE_INFINITY);
    expect(lc.resumeAt).toBe(42);
  });

  // --- destrucción --------------------------------------------------------

  it('destroy() emite el evento y marca destruido', () => {
    const { bus, lc } = nuevo();
    const fn = vi.fn();
    bus.on('destroy', fn);
    lc.destroy();
    expect(lc.state).toBe('destroyed');
    expect(lc.isDestroyed).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('destroy() es idempotente', () => {
    const { bus, lc } = nuevo();
    const fn = vi.fn();
    bus.on('destroy', fn);
    lc.destroy();
    lc.destroy();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('destruir desde reproduciendo funciona sin pasos intermedios', () => {
    const { lc } = nuevo();
    llevarA(lc, 'active');
    expect(() => lc.destroy()).not.toThrow();
  });

  it('no se sale de destroyed', () => {
    const { lc } = nuevo();
    lc.destroy();
    expect(() => lc.transition('idle')).toThrow(/estado terminal/);
  });

  // --- recorrido completo -------------------------------------------------

  it('el ciclo perezoso completo emite los cambios en orden', () => {
    const { bus, lc } = nuevo();
    const vistos: string[] = [];
    bus.on('state:change', ({ to }) => { vistos.push(to); });

    llevarA(lc, 'active');           // idle → … → active
    lc.transition('attached');       // pausa
    lc.transition('resolved');       // desalojo
    lc.transition('attaching');      // vuelve
    lc.transition('attached');
    lc.destroy();

    expect(vistos).toEqual([
      'resolving', 'resolved', 'attaching', 'attached', 'active',
      'attached', 'resolved', 'attaching', 'attached', 'destroyed',
    ]);
  });

  it('el fallo al resolver devuelve a idle', () => {
    const { lc } = nuevo();
    lc.transition('resolving');
    expect(() => lc.transition('idle')).not.toThrow();
    expect(lc.state).toBe('idle');
  });

  it('el fallo al enganchar devuelve a resolved, conservando el manifiesto', () => {
    const { lc } = nuevo();
    llevarA(lc, 'attaching');
    lc.transition('resolved');
    expect(lc.hasManifest).toBe(true);
    expect(lc.hasEngine).toBe(false);
  });
});
