// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { IDIOMA_BASE, strings } from '@nanoplayer/core';
// Importar el bundle arrastra el catálogo entero: el de la interfaz y el de
// cada plugin que venga incluido. Por eso el test vive aquí y no en `ui`: es
// el único sitio donde están todas las cadenas que se reparten.
import '../src/index.js';

/** Las variables que una plantilla espera: `'Retrasado: {tiempo}'` → `['tiempo']`. */
const variables = (plantilla: string): string[] =>
  [...plantilla.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

const base = IDIOMA_BASE;
const clavesBase = strings.keys(base).sort();
/** Todos los idiomas de serie menos el base: contra él se compara. */
const traducciones = strings.languages.filter((l) => l !== base);

describe('catálogo · está montado', () => {
  it('el idioma base tiene cadenas', () => {
    expect(clavesBase.length).toBeGreaterThan(0);
  });

  it('hay al menos una traducción que comprobar', () => {
    // Si esto falla, el resto de tests pasaría en vacío sin comprobar nada.
    expect(traducciones.length).toBeGreaterThan(0);
  });
});

describe.each(traducciones)('catálogo · idioma "%s"', (lang) => {
  const claves = strings.keys(lang).sort();

  it('no le falta ninguna clave del idioma base', () => {
    /*
     * Es el fallo que este test existe para evitar: una traducción a medias
     * entra, cae al idioma base sin avisar, y el resultado es un reproductor
     * medio en un idioma y medio en otro. Nadie lo nota hasta que lo usa
     * alguien que no habla el base.
     */
    const faltan = clavesBase.filter((k) => !claves.includes(k));
    expect(faltan, `faltan en "${lang}": ${faltan.join(', ')}`).toEqual([]);
  });

  it('no trae claves que el idioma base no tenga', () => {
    // Casi siempre es una errata en la clave, y el síntoma sería que la cadena
    // buena no se usa nunca mientras la de al lado parece estar traducida.
    const sobran = claves.filter((k) => !clavesBase.includes(k));
    expect(sobran, `sobran en "${lang}": ${sobran.join(', ')}`).toEqual([]);
  });

  it('ninguna cadena está vacía', () => {
    const t = strings.translator(lang);
    const vacias = claves.filter((k) => t(k).trim() === '');
    expect(vacias, `vacías en "${lang}": ${vacias.join(', ')}`).toEqual([]);
  });

  it('conserva las variables de cada plantilla', () => {
    /*
     * El fallo silencioso de verdad. Si `ui.live.behindBy` es
     * «Retrasado: {tiempo}» en el base y alguien lo traduce como «Behind live»
     * a secas, no falta la clave ni está vacía: simplemente el tiempo deja de
     * aparecer, y solo se nota mirando la interfaz con ese idioma puesto.
     */
    const tBase = strings.translator(base);
    const t = strings.translator(lang);
    const rotas = clavesBase
      .map((k) => ({ k, base: variables(tBase(k)), trad: variables(t(k)) }))
      .filter((x) => x.base.join(',') !== x.trad.join(','))
      .map((x) => `${x.k} (espera {${x.base.join('} {')}})`);
    expect(rotas, `variables distintas en "${lang}": ${rotas.join('; ')}`).toEqual([]);
  });
});
