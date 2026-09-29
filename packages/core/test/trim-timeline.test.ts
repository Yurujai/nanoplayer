import { describe, expect, it } from 'vitest';
import { TrimTimeline } from '../src/trim-timeline.js';

describe('TrimTimeline', () => {
  const trimmed = new TrimTimeline({ start: 100, end: 160 });

  it('without a trim, both times match and there is no own duration', () => {
    const free = new TrimTimeline(null);
    expect(free.toVisible(42)).toBe(42);
    expect(free.toMedia(42)).toBe(42);
    expect(free.duration).toBeNull();
  });

  it('visible time counts from the start of the trim', () => {
    expect(trimmed.toVisible(130)).toBe(30);
    expect(trimmed.toVisible(50), 'before the trim, zero').toBe(0);
  });

  it('maps visible time to media time, within the trim', () => {
    expect(trimmed.toMedia(30)).toBe(130);
    expect(trimmed.toMedia(-5)).toBe(100);
    expect(trimmed.toMedia(999)).toBe(160);
  });

  it('the duration is the trimmed span', () => {
    expect(trimmed.duration).toBe(60);
  });
});
