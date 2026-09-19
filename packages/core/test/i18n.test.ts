import { describe, expect, it } from 'vitest';
import { StringRegistry, strings } from '../src/i18n.js';

const registro = () => new StringRegistry();

describe('StringRegistry', () => {
  it('devuelve la cadena del idioma pedido', () => {
    const r = registro();
    r.register('es', { 'ui.play': 'Reproducir' });
    r.register('en', { 'ui.play': 'Play' });
    expect(r.translator('es')('ui.play')).toBe('Reproducir');
    expect(r.translator('en')('ui.play')).toBe('Play');
  });

  it('un catálogo regional cae al idioma corto', () => {
    const r = registro();
    r.register('es', { 'ui.play': 'Reproducir' });
    expect(r.translator('es-MX')('ui.play')).toBe('Reproducir');
    expect(r.translator('EN-gb')).toBeTypeOf('function');
  });

  it('cae al idioma base cuando no hay catálogo', () => {
    const r = registro();
    r.register('es', { 'ui.play': 'Reproducir' });
    expect(r.translator('fr')('ui.play')).toBe('Reproducir');
  });

  it('devuelve la clave si no existe, en vez de quedarse en blanco', () => {
    // Un hueco vacío en la interfaz no dice dónde mirar; `ui.falta` sí.
    const r = registro();
    expect(r.translator('es')('ui.falta')).toBe('ui.falta');
  });

  it('fusiona los catálogos en vez de reemplazarlos', () => {
    // Los paquetes se cargan en cualquier orden y ninguno debe pisar al otro.
    const r = registro();
    r.register('es', { 'ui.play': 'Reproducir' });
    r.register('es', { 'captions.label': 'Subtítulos' });
    const t = r.translator('es');
    expect(t('ui.play')).toBe('Reproducir');
    expect(t('captions.label')).toBe('Subtítulos');
  });

  it('las cadenas propias mandan sobre las registradas', () => {
    const r = registro();
    r.register('es', { 'ui.layout.presentation': 'Diapositivas' });
    const t = r.translator('es', { es: { 'ui.layout.presentation': 'Pizarra' } });
    expect(t('ui.layout.presentation')).toBe('Pizarra');
  });

  it('permite añadir un idioma entero sin tocar el código', () => {
    // El caso que justifica todo esto: euskera sin forkear nada.
    const r = registro();
    r.register('es', { 'ui.play': 'Reproducir', 'ui.pause': 'Pausar' });
    const t = r.translator('eu', { eu: { 'ui.play': 'Erreproduzitu' } });
    expect(t('ui.play')).toBe('Erreproduzitu');
    // Lo que el idioma nuevo no cubra sigue cayendo al base, no se rompe.
    expect(t('ui.pause')).toBe('Pausar');
  });

  it('interpola variables', () => {
    const r = registro();
    r.register('es', { 'ui.live.behind': 'Retrasado: {tiempo}' });
    expect(r.translator('es')('ui.live.behind', { tiempo: '3 segundos' }))
      .toBe('Retrasado: 3 segundos');
  });

  it('deja intacta una variable que no se le pasa', () => {
    const r = registro();
    r.register('es', { k: 'hola {quien}' });
    expect(r.translator('es')('k', {})).toBe('hola {quien}');
  });

  it('resuelve el idioma al leerlo, no al crear el traductor', () => {
    /*
     * Los paquetes registran sus cadenas al importarse, y nadie garantiza que
     * eso ocurra antes de construir el reproductor. Si `lang` se calculara de
     * antemano, un traductor creado pronto se quedaría con el idioma de
     * respaldo para siempre y los tiempos hablados saldrían en otro idioma
     * distinto del de los botones.
     */
    const r = registro();
    r.register('es', { 'ui.play': 'Reproducir' });
    const t = r.translator('en');
    // Todavía no hay catálogo inglés: se habla en el idioma base.
    expect(t.lang).toBe('es');
    expect(t('ui.play')).toBe('Reproducir');

    r.register('en', { 'ui.play': 'Play' });
    expect(t.lang).toBe('en');
    expect(t('ui.play')).toBe('Play');
  });

  it('sin idioma pedido usa el base', () => {
    const r = registro();
    r.register('es', { 'ui.play': 'Reproducir' });
    expect(r.translator('')('ui.play')).toBe('Reproducir');
  });

  it('lleva la cuenta de los idiomas registrados', () => {
    const r = registro();
    r.register('es', { a: '1' });
    r.register('EN', { a: '1' });
    expect(r.languages.sort()).toEqual(['en', 'es']);
    expect(r.has('en')).toBe(true);
    expect(r.has('fr')).toBe(false);
  });
});

describe('registro compartido', () => {
  it('existe para que los paquetes dejen ahí sus cadenas', () => {
    expect(strings).toBeInstanceOf(StringRegistry);
  });
});
