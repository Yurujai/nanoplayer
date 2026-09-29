import { describe, expect, it, vi } from 'vitest';
import type { CoreEvents } from '../src/core-events.js';
import type { MediaEngine } from '../src/engine.js';
import { EventBus } from '../src/events.js';
import { LiveBroadcast } from '../src/live-broadcast.js';
import { LIVE_EDGE_MARGIN, LiveEdge } from '../src/live-edge.js';

const withWindow = (start: number, end: number, recommended?: number) => ({
  seekable: { length: 1, start: () => start, end: () => end },
  ...(recommended !== undefined ? { liveSyncPosition: () => recommended } : {}),
}) as unknown as MediaEngine;

describe('LiveEdge', () => {
  it('window and edge come from the seekable range', () => {
    const b = new LiveEdge(() => withWindow(40, 160));
    expect(b.window).toBe(120);
    expect(b.edge).toBe(160);
    expect(b.behind(100)).toBe(60);
  });

  it('without a known edge it is not at the live edge', () => {
    expect(new LiveEdge(() => null).isAtEdge(0)).toBe(false);
  });

  it('without a recommendation, goes back with a margin and tolerates normal buffer', () => {
    const b = new LiveEdge(() => withWindow(40, 160));
    expect(b.seekTarget).toBe(160 - LIVE_EDGE_MARGIN);
    expect(b.isAtEdge(150)).toBe(true);
    expect(b.isAtEdge(100)).toBe(false);
  });

  it('with a recommendation, goes there and counts the tolerance from there', () => {
    const b = new LiveEdge(() => withWindow(40, 160, 142));
    expect(b.seekTarget).toBe(142);
    expect(b.isAtEdge(135)).toBe(true);
    expect(b.isAtEdge(120)).toBe(false);
  });
});

describe('LiveBroadcast', () => {
  it('emits on the bus only when a stream\'s status changes', () => {
    const bus = new EventBus<CoreEvents>();
    const seen: string[] = [];
    bus.on('live:status', ({ stream, status }) => seen.push(`${stream}:${status}`));
    const e = new LiveBroadcast({ bus, reconnect: () => {} });
    e.markUnavailable('cam');
    e.markUnavailable('cam');
    e.markLive('cam');
    expect(seen).toEqual(['cam:waiting', 'cam:live']);
    expect(e.overall).toBe('live');
  });

  it('retries after the delay, and cancelling prevents it', () => {
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
