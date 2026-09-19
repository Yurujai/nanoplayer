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

  it('habla cualquier idioma, no solo los dos que tienen catálogo', () => {
    /*
     * Esto es lo que antes no existía: la gramática estaba escrita a mano en
     * un `startsWith('es')`, así que un usuario francés recibía el
     * `aria-valuetext` en inglés. Que haya catálogo de botones o no es otra
     * cuestión: los números y las unidades salen bien igualmente.
     */
    // Se normalizan los espacios duros antes de comparar: cada idioma elige
    // los suyos —el francés pone U+00A0 tras el 1 y tras el 3, pero uno normal
    // tras el 5— y eso es dato de CLDR, no algo que este código decida. Lo que
    // se comprueba aquí son las palabras y su orden.
    const palabras = (v: string) => v.replace(/[\u00a0\u202f]/g, ' ');

    expect(palabras(spokenTime(735, 'ca'))).toBe('12 minuts i 15 segons');
    expect(palabras(spokenTime(735, 'gl'))).toBe('12 minutos e 15 segundos');
    expect(palabras(spokenTime(3903, 'fr'))).toBe('1 heure, 5 minutes et 3 secondes');
  });
});

describe('formatPercent', () => {
  // OJO: el espacio antes del signo es DURO (U+00A0), no uno normal. Lo pone
  // Intl y es lo correcto: "36" y "%" no deben partirse en dos líneas. Si
  // alguna vez este test falla enseñando dos cadenas idénticas, es esto.
  const DURO = '\u00a0';

  it('redondea y acota', () => {
    expect(formatPercent(0.355)).toBe(`36${DURO}%`);
    expect(formatPercent(2)).toBe(`100${DURO}%`);
    expect(formatPercent(-1)).toBe(`0${DURO}%`);
  });

  it('coloca el signo como mande el idioma', () => {
    // En inglés va pegado; en euskera, delante del número. Escribir esto a
    // mano era garantizar que estuviera mal en todos menos en dos idiomas.
    expect(formatPercent(0.35, 'en')).toBe('35%');
    expect(formatPercent(0.35, 'eu')).toBe(`%${DURO}35`);
  });

  it('no escupe NaN ante entradas absurdas', () => {
    expect(formatPercent(Number.NaN)).toBe(`0${DURO}%`);
  });
});
