import { describe, expect, it } from 'vitest';
import { formatPercent, formatTime, spokenTime } from '../src/format.js';

describe('formatTime', () => {
  it('omits hours when not needed', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });

  it('includes them when there are any', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3903)).toBe('1:05:03');
  });

  it('never prints NaN for absurd input', () => {
    for (const v of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      expect(formatTime(v)).toBe('0:00');
    }
  });
});

describe('spokenTime', () => {
  it('says the time in words, not with colons', () => {
    expect(spokenTime(735)).toBe('12 minutos y 15 segundos');
    expect(spokenTime(3903)).toBe('1 hora, 5 minutos y 3 segundos');
  });

  it('uses the singular where it belongs', () => {
    expect(spokenTime(1)).toBe('1 segundo');
    expect(spokenTime(60)).toBe('1 minuto');
    expect(spokenTime(3600)).toBe('1 hora');
  });

  it('says "0 seconds" instead of saying nothing', () => {
    expect(spokenTime(0)).toBe('0 segundos');
  });

  it('omits empty units', () => {
    expect(spokenTime(3600 + 3)).toBe('1 hora y 3 segundos');
    expect(spokenTime(120)).toBe('2 minutos');
  });

  it('speaks English when asked', () => {
    expect(spokenTime(735, 'en')).toBe('12 minutes and 15 seconds');
    expect(spokenTime(1, 'en')).toBe('1 second');
  });

  it('speaks any language, not just the two with a catalogue', () => {
    // Non-breaking spaces are CLDR data per language; compare the words only.
    const words = (v: string) => v.replace(/[  ]/g, ' ');

    expect(words(spokenTime(735, 'ca'))).toBe('12 minuts i 15 segons');
    expect(words(spokenTime(735, 'gl'))).toBe('12 minutos e 15 segundos');
    expect(words(spokenTime(3903, 'fr'))).toBe('1 heure, 5 minutes et 3 secondes');
  });
});

describe('formatPercent', () => {
  // The space before the sign is non-breaking (U+00A0): if this fails showing
  // two identical-looking strings, that is why.
  const NBSP = ' ';

  it('rounds and clamps', () => {
    expect(formatPercent(0.355)).toBe(`36${NBSP}%`);
    expect(formatPercent(2)).toBe(`100${NBSP}%`);
    expect(formatPercent(-1)).toBe(`0${NBSP}%`);
  });

  it('places the sign as the language says', () => {
    expect(formatPercent(0.35, 'en')).toBe('35%');
    expect(formatPercent(0.35, 'eu')).toBe(`%${NBSP}35`);
  });

  it('never prints NaN for absurd input', () => {
    expect(formatPercent(Number.NaN)).toBe(`0${NBSP}%`);
  });
});
