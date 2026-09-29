import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/events.js';

interface TestEvents {
  ping: { n: number };
  pong: { s: string };
  empty: Record<string, never>;
}

const bus = () => new EventBus<TestEvents>({ onListenerError: () => {} });

describe('EventBus', () => {
  it('delivers the payload to subscribers', () => {
    const b = bus();
    const fn = vi.fn();
    b.on('ping', fn);
    b.emit('ping', { n: 1 });
    expect(fn).toHaveBeenCalledWith({ n: 1 });
  });

  it('does not mix event types', () => {
    const b = bus();
    const ping = vi.fn();
    b.on('ping', ping);
    b.emit('pong', { s: 'x' });
    expect(ping).not.toHaveBeenCalled();
  });

  it('the function returned by on() unsubscribes', () => {
    const b = bus();
    const fn = vi.fn();
    const un = b.on('ping', fn);
    un();
    b.emit('ping', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('once() receives only once', () => {
    const b = bus();
    const fn = vi.fn();
    b.once('ping', fn);
    b.emit('ping', { n: 1 });
    b.emit('ping', { n: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(b.listenerCount('ping')).toBe(0);
  });

  it('once() can be cancelled before it fires', () => {
    const b = bus();
    const fn = vi.fn();
    b.once('ping', fn)();
    b.emit('ping', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('a throwing listener does not stop the others', () => {
    const b = bus();
    const order: string[] = [];
    b.on('ping', () => { order.push('a'); });
    b.on('ping', () => { throw new Error('broken plugin'); });
    b.on('ping', () => { order.push('c'); });

    expect(() => b.emit('ping', { n: 1 })).not.toThrow();
    expect(order).toEqual(['a', 'c']);
  });

  it('reports the failure with the event type instead of swallowing it', () => {
    const onListenerError = vi.fn();
    const b = new EventBus<TestEvents>({ onListenerError });
    const boom = new Error('broken plugin');
    b.on('ping', () => { throw boom; });
    b.emit('ping', { n: 1 });
    expect(onListenerError).toHaveBeenCalledWith({ type: 'ping', error: boom });
  });

  it('isolates onAny failures too', () => {
    const b = bus();
    const fn = vi.fn();
    b.onAny(() => { throw new Error('broken analytics'); });
    b.on('ping', fn);
    expect(() => b.emit('ping', { n: 1 })).not.toThrow();
    expect(fn).toHaveBeenCalled();
  });

  it('unsubscribing inside a handler does not skip the next ones', () => {
    const b = bus();
    const seen: string[] = [];
    const un = b.on('ping', () => { seen.push('first'); un(); });
    b.on('ping', () => { seen.push('second'); });

    b.emit('ping', { n: 1 });
    expect(seen).toEqual(['first', 'second']);

    seen.length = 0;
    b.emit('ping', { n: 2 });
    expect(seen).toEqual(['second']);
  });

  it('subscribing inside a handler does not affect the emit in progress', () => {
    const b = bus();
    const added = vi.fn();
    b.on('ping', () => { b.on('ping', added); });
    b.emit('ping', { n: 1 });
    expect(added).not.toHaveBeenCalled();
    b.emit('ping', { n: 2 });
    expect(added).toHaveBeenCalledTimes(1);
  });

  it('onAny receives every event with its name', () => {
    const b = bus();
    const seen: Array<[string, unknown]> = [];
    b.onAny((type, payload) => { seen.push([type, payload]); });

    b.emit('ping', { n: 1 });
    b.emit('pong', { s: 'x' });

    expect(seen).toEqual([['ping', { n: 1 }], ['pong', { s: 'x' }]]);
  });

  it('onAny can be unsubscribed', () => {
    const b = bus();
    const fn = vi.fn();
    b.onAny(fn)();
    b.emit('ping', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('counts listeners per type and in total', () => {
    const b = bus();
    b.on('ping', () => {});
    b.on('ping', () => {});
    b.on('pong', () => {});
    b.onAny(() => {});
    expect(b.listenerCount('ping')).toBe(2);
    expect(b.listenerCount('pong')).toBe(1);
    expect(b.listenerCount()).toBe(4);
  });

  it('leaves no trace after the last listener of a type unsubscribes', () => {
    const b = bus();
    b.on('ping', () => {})();
    expect(b.listenerCount()).toBe(0);
  });

  it('clear() drops everything, onAny included', () => {
    const b = bus();
    b.on('ping', () => {});
    b.onAny(() => {});
    b.clear();
    expect(b.listenerCount()).toBe(0);
  });

  it('the same listener registered twice is kept once', () => {
    const b = bus();
    const fn = vi.fn();
    b.on('ping', fn);
    b.on('ping', fn);
    b.emit('ping', { n: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('emitting with no listeners does not fail', () => {
    expect(() => bus().emit('empty', {})).not.toThrow();
  });
});
