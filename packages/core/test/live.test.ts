import { describe, expect, it } from 'vitest';
import { backoff, LiveTracker } from '../src/live.js';

describe('LiveTracker · la distinción que importa', () => {
  it('lo que nunca emitió está "esperando"', () => {
    const t = new LiveTracker();
    t.markUnavailable('cam');
    expect(t.status('cam')).toBe('waiting');
  });

  it('lo que emitió y se cayó está "interrumpido"', () => {
    /*
     * Es la razón de ser de esta clase. Decirle "el evento aún no ha empezado"
     * a quien llevaba veinte minutos viéndolo sería desconcertante, así que
     * hay que recordar si llegó a emitir.
     */
    const t = new LiveTracker();
    t.markLive('cam');
    t.markUnavailable('cam');
    expect(t.status('cam')).toBe('interrupted');
  });

  it('una vez que emitió, ya nunca vuelve a "esperando"', () => {
    const t = new LiveTracker();
    t.markLive('cam');
    t.markUnavailable('cam');
    t.markLive('cam');
    t.markUnavailable('cam');
    expect(t.status('cam')).toBe('interrupted');
  });

  it('reset borra también el recuerdo de haber emitido', () => {
    const t = new LiveTracker();
    t.markLive('cam');
    t.reset();
    t.markUnavailable('cam');
    expect(t.status('cam')).toBe('waiting');
  });
});

describe('LiveTracker · estado del conjunto', () => {
  it('emite si alguno emite, aunque falte el otro', () => {
    // Bloquear los dos porque falta uno sería peor que enseñar el que hay.
    const t = new LiveTracker();
    t.markLive('cam');
    t.markUnavailable('slides');
    expect(t.overall).toBe('live');
  });

  it('con ninguno emitiendo, una interrupción manda sobre una espera', () => {
    const t = new LiveTracker();
    t.markLive('cam'); t.markUnavailable('cam');   // interrumpido
    t.markUnavailable('slides');                    // esperando
    expect(t.overall).toBe('interrupted');
  });

  it('sin flujos registrados no dice nada', () => {
    expect(new LiveTracker().overall).toBe('unknown');
  });

  it('lista los que faltan por emitir', () => {
    const t = new LiveTracker();
    t.markLive('cam');
    t.markUnavailable('slides');
    expect(t.pending).toEqual(['slides']);
  });

  it('solo informa de cambios reales', () => {
    const t = new LiveTracker();
    expect(t.markUnavailable('cam')).toBe(true);
    expect(t.markUnavailable('cam'), 'sigue igual').toBe(false);
    expect(t.markLive('cam')).toBe(true);
  });
});

describe('backoff', () => {
  it('crece entre intentos', () => {
    // Un evento que empieza dos horas tarde serían miles de peticiones
    // inútiles por espectador si la espera fuera fija.
    const esperas = [0, 1, 2, 3].map((i) => backoff(i));
    for (let i = 1; i < esperas.length; i++) {
      expect(esperas[i]!).toBeGreaterThan(esperas[i - 1]!);
    }
  });

  it('tiene tope: si no, tardaría minutos en enterarse de que ya empezó', () => {
    expect(backoff(50)).toBe(backoff(60));
    expect(backoff(50)).toBeLessThanOrEqual(30000);
  });

  it('el primer intento no espera de más', () => {
    expect(backoff(0)).toBe(2000);
  });

  it('se puede ajustar', () => {
    expect(backoff(0, { initialMs: 500 })).toBe(500);
    expect(backoff(99, { maxMs: 5000 })).toBe(5000);
  });
});

describe('reintentos por flujo', () => {
  it('cada flujo lleva su propia cuenta', () => {
    const t = new LiveTracker();
    t.markUnavailable('cam');
    t.markUnavailable('cam');
    t.markUnavailable('slides');
    expect(t.nextDelay('cam')).toBeGreaterThan(t.nextDelay('slides'));
  });

  it('conseguir emitir reinicia la cuenta', () => {
    const t = new LiveTracker();
    t.markUnavailable('cam');
    t.markUnavailable('cam');
    t.markLive('cam');
    t.markUnavailable('cam');
    expect(t.nextDelay('cam')).toBe(backoff(0));
  });
});
