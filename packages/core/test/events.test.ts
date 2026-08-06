import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/events.js';

interface TestEvents {
  ping: { n: number };
  pong: { s: string };
  vacio: Record<string, never>;
}

const bus = () => new EventBus<TestEvents>({ onListenerError: () => {} });

describe('EventBus', () => {
  it('entrega la carga útil a los suscriptores', () => {
    const b = bus();
    const fn = vi.fn();
    b.on('ping', fn);
    b.emit('ping', { n: 1 });
    expect(fn).toHaveBeenCalledWith({ n: 1 });
  });

  it('no mezcla tipos de evento', () => {
    const b = bus();
    const ping = vi.fn();
    b.on('ping', ping);
    b.emit('pong', { s: 'x' });
    expect(ping).not.toHaveBeenCalled();
  });

  it('la función devuelta por on() da de baja', () => {
    const b = bus();
    const fn = vi.fn();
    const un = b.on('ping', fn);
    un();
    b.emit('ping', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('once() solo recibe una vez', () => {
    const b = bus();
    const fn = vi.fn();
    b.once('ping', fn);
    b.emit('ping', { n: 1 });
    b.emit('ping', { n: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(b.listenerCount('ping')).toBe(0);
  });

  it('once() se puede cancelar antes de dispararse', () => {
    const b = bus();
    const fn = vi.fn();
    b.once('ping', fn)();
    b.emit('ping', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  // --- aislamiento de fallos ---------------------------------------------

  it('un oyente que lanza no impide que los demás reciban', () => {
    const b = bus();
    const orden: string[] = [];
    b.on('ping', () => { orden.push('a'); });
    b.on('ping', () => { throw new Error('plugin roto'); });
    b.on('ping', () => { orden.push('c'); });

    expect(() => b.emit('ping', { n: 1 })).not.toThrow();
    expect(orden).toEqual(['a', 'c']);
  });

  it('reporta el fallo con el tipo de evento, en vez de tragárselo', () => {
    const onListenerError = vi.fn();
    const b = new EventBus<TestEvents>({ onListenerError });
    const boom = new Error('plugin roto');
    b.on('ping', () => { throw boom; });
    b.emit('ping', { n: 1 });
    expect(onListenerError).toHaveBeenCalledWith({ type: 'ping', error: boom });
  });

  it('aísla también los fallos de onAny', () => {
    const b = bus();
    const fn = vi.fn();
    b.onAny(() => { throw new Error('analítica rota'); });
    b.on('ping', fn);
    expect(() => b.emit('ping', { n: 1 })).not.toThrow();
    expect(fn).toHaveBeenCalled();
  });

  // --- mutación durante la emisión ---------------------------------------

  it('darse de baja dentro de un manejador no se salta a los siguientes', () => {
    const b = bus();
    const visto: string[] = [];
    const un = b.on('ping', () => { visto.push('primero'); un(); });
    b.on('ping', () => { visto.push('segundo'); });

    b.emit('ping', { n: 1 });
    expect(visto).toEqual(['primero', 'segundo']);

    // Y en la siguiente emisión el primero ya no está.
    visto.length = 0;
    b.emit('ping', { n: 2 });
    expect(visto).toEqual(['segundo']);
  });

  it('suscribirse dentro de un manejador no afecta a la emisión en curso', () => {
    const b = bus();
    const nuevo = vi.fn();
    b.on('ping', () => { b.on('ping', nuevo); });
    b.emit('ping', { n: 1 });
    expect(nuevo).not.toHaveBeenCalled();
    b.emit('ping', { n: 2 });
    expect(nuevo).toHaveBeenCalledTimes(1);
  });

  // --- onAny: el cimiento de la analítica --------------------------------

  it('onAny recibe todos los eventos con su nombre', () => {
    const b = bus();
    const visto: Array<[string, unknown]> = [];
    b.onAny((type, payload) => { visto.push([type, payload]); });

    b.emit('ping', { n: 1 });
    b.emit('pong', { s: 'x' });

    expect(visto).toEqual([['ping', { n: 1 }], ['pong', { s: 'x' }]]);
  });

  it('onAny se puede dar de baja', () => {
    const b = bus();
    const fn = vi.fn();
    b.onAny(fn)();
    b.emit('ping', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  // --- contabilidad y limpieza -------------------------------------------

  it('cuenta oyentes por tipo y en total', () => {
    const b = bus();
    b.on('ping', () => {});
    b.on('ping', () => {});
    b.on('pong', () => {});
    b.onAny(() => {});
    expect(b.listenerCount('ping')).toBe(2);
    expect(b.listenerCount('pong')).toBe(1);
    expect(b.listenerCount()).toBe(4);
  });

  it('no deja rastro tras dar de baja al último oyente de un tipo', () => {
    const b = bus();
    b.on('ping', () => {})();
    expect(b.listenerCount()).toBe(0);
  });

  it('clear() suelta todo, incluidos los onAny', () => {
    const b = bus();
    b.on('ping', () => {});
    b.onAny(() => {});
    b.clear();
    expect(b.listenerCount()).toBe(0);
  });

  it('el mismo oyente registrado dos veces solo se guarda una', () => {
    const b = bus();
    const fn = vi.fn();
    b.on('ping', fn);
    b.on('ping', fn);
    b.emit('ping', { n: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('emitir sin oyentes no falla', () => {
    expect(() => bus().emit('vacio', {})).not.toThrow();
  });
});
