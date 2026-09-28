import { describe, expect, it } from 'vitest';
import { TrimTimeline } from '../src/trim-timeline.js';

describe('TrimTimeline', () => {
  const recorte = new TrimTimeline({ start: 100, end: 160 });

  it('sin recorte, los dos tiempos coinciden y no hay duración propia', () => {
    const libre = new TrimTimeline(null);
    expect(libre.toVisible(42)).toBe(42);
    expect(libre.toMedia(42)).toBe(42);
    expect(libre.duration).toBeNull();
  });

  it('el tiempo que se enseña cuenta desde el principio del recorte', () => {
    expect(recorte.toVisible(130)).toBe(30);
    expect(recorte.toVisible(50), 'antes del recorte, cero').toBe(0);
  });

  it('del tiempo que se enseña al del medio, sin salirse del recorte', () => {
    expect(recorte.toMedia(30)).toBe(130);
    expect(recorte.toMedia(-5)).toBe(100);
    expect(recorte.toMedia(999)).toBe(160);
  });

  it('la duración es la del tramo recortado', () => {
    expect(recorte.duration).toBe(60);
  });
});
