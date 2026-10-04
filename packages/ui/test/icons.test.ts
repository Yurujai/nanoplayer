import { describe, expect, it } from 'vitest';
import { ICONS } from '../src/icons.js';

describe('icons', () => {
  it('carry no ids, which several players on a page would repeat', () => {
    for (const [name, svg] of Object.entries(ICONS)) {
      expect(svg, name).not.toMatch(/\sid=|<mask|url\(#/);
    }
  });

  it('are hidden from screen readers and take the button\'s colour', () => {
    for (const [name, svg] of Object.entries(ICONS)) {
      expect(svg, name).toContain('aria-hidden="true"');
      expect(svg, name).toContain('currentColor');
      expect(svg, name).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
  });

  it('skipping the intro does not look like going to the next video', () => {
    expect(ICONS.skip).not.toBe(ICONS.play);
    expect(ICONS.skip).toContain('M3.5 6.6');
  });
});
