import { describe, expect, it, vi } from 'vitest';
import type { CoreEvents } from '../src/core-events.js';
import type { MediaEngine } from '../src/engine.js';
import { EventBus } from '../src/events.js';
import { LiveBroadcast } from '../src/live-broadcast.js';
import { LIVE_EDGE_MARGIN, LiveEdge } from '../src/live-edge.js';

const conVentana = (inicio: number, fin: number, recomendada?: number) => ({
  seekable: { length: 1, start: () => inicio, end: () => fin },
  ...(recomendada !== undefined ? { liveSyncPosition: () => recomendada } : {}),
}) as unknown as MediaEngine;

describe('LiveEdge', () => {
  it('la ventana y el borde salen del tramo alcanzable', () => {
    const b = new LiveEdge(() => conVentana(40, 160));
    expect(b.window).toBe(120);
    expect(b.edge).toBe(160);
    expect(b.behind(100)).toBe(60);
  });

  it('sin borde conocido no se está en directo', () => {
    expect(new LiveEdge(() => null).isAtEdge(0)).toBe(false);
  });

  it('sin recomendación, vuelve con margen y tolera el búfer normal', () => {
    const b = new LiveEdge(() => conVentana(40, 160));
    expect(b.seekTarget).toBe(160 - LIVE_EDGE_MARGIN);
    expect(b.isAtEdge(150)).toBe(true);
    expect(b.isAtEdge(100)).toBe(false);
  });

  it('con recomendación, vuelve ahí y cuenta la tolerancia desde ahí', () => {
    const b = new LiveEdge(() => conVentana(40, 160, 142));
    expect(b.seekTarget).toBe(142);
    expect(b.isAtEdge(135)).toBe(true);
    expect(b.isAtEdge(120)).toBe(false);
  });
});

describe('LiveBroadcast', () => {
  it('avisa por el bus solo cuando cambia el estado de un flujo', () => {
    const bus = new EventBus<CoreEvents>();
    const vistos: string[] = [];
    bus.on('live:status', ({ stream, status }) => vistos.push(`${stream}:${status}`));
    const e = new LiveBroadcast({ bus, reconnect: () => {} });
    e.markUnavailable('cam');
    e.markUnavailable('cam');
    e.markLive('cam');
    expect(vistos).toEqual(['cam:waiting', 'cam:live']);
    expect(e.overall).toBe('live');
  });

  it('reintenta tras la espera, y cancelar lo evita', () => {
    vi.useFakeTimers();
    const reconnect = vi.fn();
    const e = new LiveBroadcast({ bus: new EventBus<CoreEvents>(), retry: { initialMs: 1000 }, reconnect });
    e.markUnavailable('cam');
    e.retryLater('cam');
    vi.advanceTimersByTime(1000);
    expect(reconnect).toHaveBeenCalledWith('cam');

    e.retryLater('cam');
    e.cancelRetries();
    vi.advanceTimersByTime(60_000);
    expect(reconnect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
