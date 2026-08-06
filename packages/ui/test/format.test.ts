import { describe, expect, it } from 'vitest';
import { formatPercent, formatTime, spokenTime } from '../src/format.js';

describe('formatTime', () => {
  it('omite la hora si no hace falta', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });

  it('la incluye cuando la hay', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3903)).toBe('1:05:03');
  });

  it('no escupe NaN ante entradas absurdas', () => {
    for (const v of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      expect(formatTime(v)).toBe('0:00');
    }
  });
});

describe('spokenTime', () => {
  it('dice el tiempo en palabras, no en dos puntos', () => {
    // Un lector de pantalla lee "12:05" como "doce, dos puntos, cero cinco".
    expect(spokenTime(735)).toBe('12 minutos y 15 segundos');
    expect(spokenTime(3903)).toBe('1 hora, 5 minutos y 3 segundos');
  });

  it('usa el singular donde toca', () => {
    expect(spokenTime(1)).toBe('1 segundo');
    expect(spokenTime(60)).toBe('1 minuto');
    expect(spokenTime(3600)).toBe('1 hora');
  });

  it('dice "0 segundos" en vez de callarse', () => {
    expect(spokenTime(0)).toBe('0 segundos');
  });

  it('omite las unidades vacías', () => {
    expect(spokenTime(3600 + 3)).toBe('1 hora y 3 segundos');
    expect(spokenTime(120)).toBe('2 minutos');
  });

  it('habla inglés si se le pide', () => {
    expect(spokenTime(735, 'en')).toBe('12 minutes and 15 seconds');
    expect(spokenTime(1, 'en')).toBe('1 second');
  });
});

describe('formatPercent', () => {
  it('redondea y acota', () => {
    expect(formatPercent(0.355)).toBe('36 %');
    expect(formatPercent(2)).toBe('100 %');
    expect(formatPercent(-1)).toBe('0 %');
  });
});
