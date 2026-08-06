/**
 * Anclajes: por dónde un plugin aporta interfaz.
 *
 * El contrato vive en el núcleo y lo implementa la capa de interfaz. Así un
 * plugin se escribe dependiendo solo de `@nanoplayer/core`, y sigue funcionando
 * con una interfaz distinta de la de serie.
 *
 * **El plugin declara; la interfaz construye.** Nunca se le entrega un nodo del
 * DOM para que pinte lo que quiera. No es purismo: si los plugins inyectan DOM
 * libremente en la barra, el orden de tabulación se vuelve impredecible y las
 * garantías de accesibilidad se evaporan en cuanto alguien instale uno de
 * terceros. Construyendo la interfaz a partir de una declaración, el contrato
 * se mantiene.
 *
 * Dónde va cada cosa se decide por **frecuencia y forma de la interacción**,
 * nunca por qué plugin la implementa:
 *
 * | Anclaje    | Qué va                                   |
 * |------------|------------------------------------------|
 * | `bar`      | Binario, frecuente, con estado visible    |
 * | `settings` | Elección entre varias opciones, ocasional |
 *
 * Un mismo plugin puede aportar en varios. Los subtítulos son el caso claro:
 * interruptor en la barra *y* panel en ajustes para elegir idioma.
 */

/** Un botón de la barra de controles. */
export interface BarControlDecl {
  id: string;
  /** SVG en línea. Puede depender del estado actual. */
  icon: string | (() => string);
  /** Nombre accesible. Puede depender del estado actual. */
  label: string | (() => string);
  onActivate: () => void;
  /**
   * Estado de conmutador. Si se define, el botón expone `aria-pressed`, que es
   * lo que hace que un lector anuncie "activado" en vez de leer solo el nombre.
   */
  pressed?: () => boolean;
  /**
   * Si el control aplica ahora mismo. Un botón que no puede hacer nada es
   * ruido, y en la barra el sitio es escaso: Chromecast solo si hay
   * dispositivo, subtítulos solo si el manifiesto trae pistas.
   */
  available?: () => boolean;
  /**
   * Menor va antes, y **manda cuando no cabe todo**. La barra admite cuatro o
   * cinco controles en móvil; lo que no entra se desborda al menú de ajustes
   * en lugar de apretujarse.
   */
  priority?: number;
}

export interface SettingsOptionDecl {
  value: string;
  label: string;
}

/** Un panel del menú de ajustes. */
export interface SettingsPanelDecl {
  id: string;
  label: string;
  options: readonly SettingsOptionDecl[];
  getValue: () => string;
  onSelect: (value: string) => void;
  priority?: number;
}

/** Una capa de contenido sobre el vídeo. */
export interface OverlayDecl {
  id: string;
  /**
   * Dónde se coloca:
   *   - `captions` — franja inferior, por encima de la barra de controles
   *   - `center`   — centrado
   *   - `fill`     — ocupa el reproductor entero
   */
  position?: 'captions' | 'center' | 'fill';
}

export interface OverlayHandle {
  /** Nodo que el plugin puede rellenar libremente. */
  element: HTMLElement;
  remove(): void;
}

/**
 * Lo que la interfaz ofrece a los plugins.
 *
 * Cada método devuelve la forma de retirar lo añadido, de modo que desactivar
 * un plugin deje la interfaz como estaba.
 */
export interface UiSlots {
  addBarControl(control: BarControlDecl): () => void;
  addSettingsPanel(panel: SettingsPanelDecl): () => void;
  /**
   * Reserva una capa sobre el vídeo y devuelve el nodo para rellenarlo.
   *
   * Aquí sí se entrega DOM, al contrario que en `bar` y `settings`, y la
   * distinción es deliberada: lo que va en esas dos son **controles
   * interactivos**, donde el orden de tabulación y las semánticas ARIA son
   * responsabilidad de la interfaz. Una capa es **contenido** —el texto de un
   * subtítulo, una actividad H5P—, y ahí el plugin sí sabe mejor qué pintar.
   *
   * Un plugin que meta controles interactivos dentro de una capa se sale del
   * contrato y se lleva por delante las garantías de accesibilidad.
   */
  addOverlay(decl: OverlayDecl): OverlayHandle;
  /** Fuerza un repintado cuando cambia el estado de un control. */
  refresh(): void;
}
