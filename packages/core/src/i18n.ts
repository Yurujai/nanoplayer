/**
 * Catálogo de textos.
 *
 * El núcleo **no tiene ni una cadena traducible**: aquí solo vive el mecanismo.
 * Cada paquete aporta las suyas —la interfaz las de la barra, cada plugin las
 * del suyo— igual que con los anclajes: el núcleo define el contrato y otros lo
 * rellenan.
 *
 * Antes había cinco tablas repartidas por dos paquetes, cada una con su propia
 * forma de deducir el idioma. Eso tenía dos consecuencias malas: añadir un
 * idioma obligaba a tocar seis ficheros —o sea, a forkear, que es justo lo que
 * este proyecto dice evitar— y cada plugin nuevo traía una tabla más con la que
 * desincronizarse.
 *
 * Las claves van con espacio de nombres por paquete (`ui.play`,
 * `captions.label`). Una clave que no existe **se devuelve tal cual** en vez de
 * quedarse en blanco: un hueco vacío en la interfaz no dice dónde mirar, y un
 * botón que pone `ui.play` sí.
 */

/** Un idioma entero: claves planas con puntos. */
export type Catalogue = Readonly<Record<string, string>>;

/** Catálogos por idioma, tal como los pasa quien integra. */
export type Catalogues = Readonly<Record<string, Catalogue>>;

/**
 * Traduce una clave.
 *
 * Las variables se escriben `{asi}`. Existen porque componer a mano
 * —`` `${behind}: ${tiempo}` ``— fija el orden de las palabras en español y
 * deja al traductor sin margen; hay idiomas donde el tiempo va delante.
 */
export interface Translate {
  (key: string, vars?: Readonly<Record<string, string | number>>): string;
  /** Idioma resuelto, para quien necesite pasárselo a `Intl`. */
  readonly lang: string;
}

/** Idioma al que se cae cuando no hay nada mejor. */
export const IDIOMA_BASE = 'es';

/** `es-MX` también sirve un catálogo `es`. */
function candidatos(lang: string): string[] {
  const limpio = (lang || '').trim();
  if (!limpio) return [IDIOMA_BASE];
  const corto = limpio.slice(0, 2).toLowerCase();
  const lista = [limpio.toLowerCase()];
  if (corto !== limpio.toLowerCase()) lista.push(corto);
  if (!lista.includes(IDIOMA_BASE)) lista.push(IDIOMA_BASE);
  return lista;
}

function interpolar(
  plantilla: string,
  vars?: Readonly<Record<string, string | number>>,
): string {
  if (!vars) return plantilla;
  return plantilla.replace(/\{(\w+)\}/g, (entero, nombre: string) =>
    nombre in vars ? String(vars[nombre]) : entero);
}

/**
 * Dónde se juntan los catálogos de todos los paquetes.
 *
 * Es una clase y no un objeto suelto para poder tener instancias aisladas en
 * las pruebas, igual que `PluginRegistry`.
 */
export class StringRegistry {
  readonly #catalogos = new Map<string, Record<string, string>>();

  /**
   * Aporta las cadenas de un paquete. Lo llama el propio paquete al cargarse.
   *
   * Registrar dos veces el mismo idioma **fusiona** en vez de reemplazar: los
   * paquetes se cargan en cualquier orden y ninguno debería pisar al anterior.
   */
  register(lang: string, catalogue: Catalogue): void {
    const clave = lang.toLowerCase();
    const actual = this.#catalogos.get(clave) ?? {};
    Object.assign(actual, catalogue);
    this.#catalogos.set(clave, actual);
  }

  /** Idiomas con al menos una cadena registrada. */
  get languages(): string[] {
    return [...this.#catalogos.keys()];
  }

  /** Si hay catálogo para ese idioma, aunque sea parcial. */
  has(lang: string): boolean {
    return this.#catalogos.has(lang.toLowerCase());
  }

  /**
   * Las claves registradas para un idioma. Vacío si no hay catálogo.
   *
   * Existe para poder comprobar que una traducción está completa: comparar
   * contra el idioma base es lo que evita que entre un idioma a medias y nadie
   * se entere hasta que un botón aparece sin nombre. Le sirve igual a quien
   * añada un idioma por `strings` sin tocar el proyecto.
   */
  keys(lang: string): string[] {
    const c = this.#catalogos.get(lang.toLowerCase());
    return c ? Object.keys(c) : [];
  }

  /**
   * Una función de traducción atada a un idioma.
   *
   * `overrides` manda sobre todo lo registrado, y por eso añadir un idioma o
   * cambiar una palabra es configuración y no un parche. El caso real no es
   * traducir: es que una universidad quiera «Pizarra» donde pone
   * «Diapositivas», y eso no debería acabar nunca en un PR al proyecto.
   */
  translator(lang: string, overrides?: Catalogues): Translate {
    const orden = candidatos(lang);
    const sobre = overrides
      ? new Map(Object.entries(overrides).map(([k, v]) => [k.toLowerCase(), v]))
      : null;

    const t = ((key, vars) => {
      for (const idioma of orden) {
        const propio = sobre?.get(idioma)?.[key];
        if (propio !== undefined) return interpolar(propio, vars);
        const registrado = this.#catalogos.get(idioma)?.[key];
        if (registrado !== undefined) return interpolar(registrado, vars);
      }
      return key;
    }) as (key: string, vars?: Readonly<Record<string, string | number>>) => string;

    /*
     * `lang` se resuelve al leerlo, no al crear el traductor.
     *
     * Los paquetes registran sus cadenas al importarse y nadie garantiza que
     * eso ocurra antes de construir el reproductor. Calculándolo de antemano,
     * un traductor creado pronto se quedaría con el idioma de respaldo para
     * siempre, y los tiempos hablados saldrían en un idioma distinto del de
     * los botones.
     */
    Object.defineProperty(t, 'lang', {
      get: () => orden.find((l) => this.#catalogos.has(l)) ?? orden[0] ?? IDIOMA_BASE,
      enumerable: true,
    });
    return t as Translate;
  }
}

/** Registro compartido: donde los paquetes dejan sus cadenas al cargarse. */
export const strings = new StringRegistry();
