import { describe, expect, it } from 'vitest';
import { StringRegistry, strings } from '../src/i18n.js';

const registry = () => new StringRegistry();

describe('StringRegistry', () => {
  it('returns the string for the requested language', () => {
    const r = registry();
    r.register('es', { 'ui.play': 'Reproducir' });
    r.register('en', { 'ui.play': 'Play' });
    expect(r.translator('es')('ui.play')).toBe('Reproducir');
    expect(r.translator('en')('ui.play')).toBe('Play');
  });

  it('a regional language falls back to the short one', () => {
    const r = registry();
    r.register('es', { 'ui.play': 'Reproducir' });
    expect(r.translator('es-MX')('ui.play')).toBe('Reproducir');
    expect(r.translator('EN-gb')).toBeTypeOf('function');
  });

  it('falls back to the base language when there is no catalogue', () => {
    const r = registry();
    r.register('es', { 'ui.play': 'Reproducir' });
    expect(r.translator('fr')('ui.play')).toBe('Reproducir');
  });

  it('returns the key if missing, instead of a blank', () => {
    // A blank in the UI does not say where to look; `ui.missing` does.
    const r = registry();
    expect(r.translator('es')('ui.missing')).toBe('ui.missing');
  });

  it('merges catalogues instead of replacing them', () => {
    // Packages load in any order and none may overwrite another.
    const r = registry();
    r.register('es', { 'ui.play': 'Reproducir' });
    r.register('es', { 'captions.label': 'Subtítulos' });
    const t = r.translator('es');
    expect(t('ui.play')).toBe('Reproducir');
    expect(t('captions.label')).toBe('Subtítulos');
  });

  it('own strings override registered ones', () => {
    const r = registry();
    r.register('es', { 'ui.layout.presentation': 'Diapositivas' });
    const t = r.translator('es', { es: { 'ui.layout.presentation': 'Pizarra' } });
    expect(t('ui.layout.presentation')).toBe('Pizarra');
  });

  it('allows adding a whole language without touching the code', () => {
    const r = registry();
    r.register('es', { 'ui.play': 'Reproducir', 'ui.pause': 'Pausar' });
    const t = r.translator('eu', { eu: { 'ui.play': 'Erreproduzitu' } });
    expect(t('ui.play')).toBe('Erreproduzitu');
    // What the new language lacks falls back to the base.
    expect(t('ui.pause')).toBe('Pausar');
  });

  it('interpolates variables', () => {
    const r = registry();
    r.register('es', { 'ui.live.behind': 'Retrasado: {time}' });
    expect(r.translator('es')('ui.live.behind', { time: '3 segundos' }))
      .toBe('Retrasado: 3 segundos');
  });

  it('leaves a variable that is not passed untouched', () => {
    const r = registry();
    r.register('es', { k: 'hola {who}' });
    expect(r.translator('es')('k', {})).toBe('hola {who}');
  });

  it('resolves the language when read, not when the translator is created', () => {
    // Packages register on import, maybe after the player is built: a `lang`
    // computed early would stick to the fallback and spoken times would disagree.
    const r = registry();
    r.register('es', { 'ui.play': 'Reproducir' });
    const t = r.translator('en');
    expect(t.lang).toBe('es');
    expect(t('ui.play')).toBe('Reproducir');

    r.register('en', { 'ui.play': 'Play' });
    expect(t.lang).toBe('en');
    expect(t('ui.play')).toBe('Play');
  });

  it('with no requested language, uses the base', () => {
    const r = registry();
    r.register('es', { 'ui.play': 'Reproducir' });
    expect(r.translator('')('ui.play')).toBe('Reproducir');
  });

  it('keeps track of registered languages', () => {
    const r = registry();
    r.register('es', { a: '1' });
    r.register('EN', { a: '1' });
    expect(r.languages.sort()).toEqual(['en', 'es']);
    expect(r.has('en')).toBe(true);
    expect(r.has('fr')).toBe(false);
  });
});

describe('shared registry', () => {
  it('exists so packages can leave their strings there', () => {
    expect(strings).toBeInstanceOf(StringRegistry);
  });
});
