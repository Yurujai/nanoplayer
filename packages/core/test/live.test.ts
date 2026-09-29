import { describe, expect, it } from 'vitest';
import { backoff, LiveTracker } from '../src/live.js';

describe('LiveTracker · the distinction that matters', () => {
  it('what never broadcast is "waiting"', () => {
    const t = new LiveTracker();
    t.markUnavailable('cam');
    expect(t.status('cam')).toBe('waiting');
  });

  it('what broadcast and dropped is "interrupted"', () => {
    // "The event has not started yet" would baffle someone who had been
    // watching for twenty minutes.
    const t = new LiveTracker();
    t.markLive('cam');
    t.markUnavailable('cam');
    expect(t.status('cam')).toBe('interrupted');
  });

  it('once it broadcast, it never goes back to "waiting"', () => {
    const t = new LiveTracker();
    t.markLive('cam');
    t.markUnavailable('cam');
    t.markLive('cam');
    t.markUnavailable('cam');
    expect(t.status('cam')).toBe('interrupted');
  });

  it('reset also forgets having broadcast', () => {
    const t = new LiveTracker();
    t.markLive('cam');
    t.reset();
    t.markUnavailable('cam');
    expect(t.status('cam')).toBe('waiting');
  });
});

describe('LiveTracker · overall status', () => {
  it('is live if any stream is, even with another missing', () => {
    const t = new LiveTracker();
    t.markLive('cam');
    t.markUnavailable('slides');
    expect(t.overall).toBe('live');
  });

  it('with none live, an interruption wins over waiting', () => {
    const t = new LiveTracker();
    t.markLive('cam'); t.markUnavailable('cam');   // interrupted
    t.markUnavailable('slides');                    // waiting
    expect(t.overall).toBe('interrupted');
  });

  it('with no registered streams it says nothing', () => {
    expect(new LiveTracker().overall).toBe('unknown');
  });

  it('lists the streams still pending', () => {
    const t = new LiveTracker();
    t.markLive('cam');
    t.markUnavailable('slides');
    expect(t.pending).toEqual(['slides']);
  });

  it('reports only real changes', () => {
    const t = new LiveTracker();
    expect(t.markUnavailable('cam')).toBe(true);
    expect(t.markUnavailable('cam'), 'unchanged').toBe(false);
    expect(t.markLive('cam')).toBe(true);
  });
});

describe('backoff', () => {
  it('grows between attempts', () => {
    // A fixed delay would mean thousands of useless requests per viewer for
    // an event starting two hours late.
    const delays = [0, 1, 2, 3].map((i) => backoff(i));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
  });

  it('is capped: otherwise it would take minutes to notice the start', () => {
    expect(backoff(50)).toBe(backoff(60));
    expect(backoff(50)).toBeLessThanOrEqual(30000);
  });

  it('the first attempt does not wait too long', () => {
    expect(backoff(0)).toBe(2000);
  });

  it('can be tuned', () => {
    expect(backoff(0, { initialMs: 500 })).toBe(500);
    expect(backoff(99, { maxMs: 5000 })).toBe(5000);
  });
});

describe('per-stream retries', () => {
  it('each stream keeps its own count', () => {
    const t = new LiveTracker();
    t.markUnavailable('cam');
    t.markUnavailable('cam');
    t.markUnavailable('slides');
    expect(t.nextDelay('cam')).toBeGreaterThan(t.nextDelay('slides'));
  });

  it('going live resets the count', () => {
    const t = new LiveTracker();
    t.markUnavailable('cam');
    t.markUnavailable('cam');
    t.markLive('cam');
    t.markUnavailable('cam');
    expect(t.nextDelay('cam')).toBe(backoff(0));
  });
});
