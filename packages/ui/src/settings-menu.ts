/**
 * Menú de ajustes por paneles apilados, con la ergonomía del de YouTube.
 *
 * La forma de declararlo ya es la que usarán los plugins: se registra un panel
 * describiendo *qué* ofrece —opciones, valor actual, qué hacer al elegir— y el
 * menú lo construye. El plugin nunca pinta DOM propio, y por eso las garantías
 * de accesibilidad siguen valiendo cuando alguien instale uno de terceros.
 *
 * Sigue el patrón WAI-ARIA de botón de menú, que no es decorativo:
 *
 *   - `role="menu"` con `menuitem` y `menuitemradio`, así el lector de pantalla
 *     anuncia "menú" y "opción seleccionada" en lugar de leer una lista de
 *     botones sueltos.
 *   - **Navegación con flechas y `tabindex` móvil**: dentro de un menú, Tab
 *     sale; son las flechas las que recorren. Es lo que espera quien usa
 *     lector de pantalla.
 *   - **El foco entra al abrir y vuelve al engranaje al cerrar.** Sin esto, al
 *     cerrar el menú el foco se va al principio del documento y hay que
 *     recorrerlo entero para volver.
 *   - `Escape` retrocede un panel, o cierra si ya está en el principal.
 */
import { ICONS } from './icons.js';

export interface SettingsOption {
  value: string;
  label: string;
}

export interface SettingsPanel {
  id: string;
  /** Lo que se lee en el menú principal. */
  label: string;
  options: readonly SettingsOption[];
  /** Valor actual, para marcar la opción y resumirla en el menú principal. */
  getValue: () => string;
  onSelect: (value: string) => void;
  /** Menor va antes. Por defecto 100. */
  priority?: number;
}

interface Textos {
  settings: string; back: string; close: string;
}

const TEXTOS: Record<string, Textos> = {
  es: { settings: 'Ajustes', back: 'Volver', close: 'Cerrar ajustes' },
  en: { settings: 'Settings', back: 'Back', close: 'Close settings' },
};

export class SettingsMenu {
  readonly #boton: HTMLButtonElement;
  readonly #popup: HTMLElement;
  readonly #t: Textos;
  readonly #paneles = new Map<string, SettingsPanel>();

  #abierto = false;
  #panelActivo: string | null = null;   // null = panel principal
  #desatar: Array<() => void> = [];

  constructor(host: HTMLElement, lang = 'es') {
    const doc = host.ownerDocument;
    this.#t = TEXTOS[lang.slice(0, 2)] ?? TEXTOS['es']!;

    this.#boton = doc.createElement('button');
    this.#boton.type = 'button';
    this.#boton.className = 'np__btn np__btn--settings';
    this.#boton.innerHTML = ICONS.settings;
    this.#boton.setAttribute('aria-label', this.#t.settings);
    this.#boton.setAttribute('aria-haspopup', 'true');
    this.#boton.setAttribute('aria-expanded', 'false');
    // Oculto hasta que alguien aporte ajustes: un engranaje que abre un menú
    // vacío es ruido, y en la barra el sitio es escaso.
    this.#boton.hidden = true;

    this.#popup = doc.createElement('div');
    this.#popup.className = 'np__menu';
    this.#popup.hidden = true;

    const envoltorio = doc.createElement('div');
    envoltorio.className = 'np__menu-anchor';
    envoltorio.append(this.#boton, this.#popup);
    host.appendChild(envoltorio);

    this.#boton.addEventListener('click', () => this.toggle());
    this.#popup.addEventListener('keydown', (ev) => this.#teclado(ev));

    // Cerrar al pulsar fuera. En `pointerdown` y no en `click` para que no se
    // reabra al soltar sobre el propio engranaje.
    const fuera = (ev: Event) => {
      if (!this.#abierto) return;
      if (!envoltorio.contains(ev.target as Node)) this.close();
    };
    doc.addEventListener('pointerdown', fuera, true);
    this.#desatar.push(() => doc.removeEventListener('pointerdown', fuera, true));
  }

  get button(): HTMLButtonElement {
    return this.#boton;
  }

  get isOpen(): boolean {
    return this.#abierto;
  }

  get panelCount(): number {
    return this.#paneles.size;
  }

  /** Registra un panel. Es lo que llamará un plugin para aportar ajustes. */
  addPanel(panel: SettingsPanel): () => void {
    this.#paneles.set(panel.id, panel);
    this.#boton.hidden = this.#paneles.size === 0;
    if (this.#abierto) this.#pintar();
    return () => {
      this.#paneles.delete(panel.id);
      this.#boton.hidden = this.#paneles.size === 0;
      if (this.#abierto) this.#pintar();
    };
  }

  toggle(): void {
    this.#abierto ? this.close() : this.open();
  }

  open(): void {
    if (this.#abierto || this.#paneles.size === 0) return;
    this.#abierto = true;
    this.#panelActivo = null;
    this.#popup.hidden = false;
    this.#boton.setAttribute('aria-expanded', 'true');
    this.#ajustarAltura();
    this.#pintar();
    this.#enfocarPrimero();
  }

  close(): void {
    if (!this.#abierto) return;
    this.#abierto = false;
    this.#panelActivo = null;
    this.#popup.hidden = true;
    this.#boton.setAttribute('aria-expanded', 'false');
    // Devolver el foco: sin esto se va al principio del documento y hay que
    // recorrerlo entero para volver al reproductor.
    this.#boton.focus();
  }

  destroy(): void {
    for (const off of this.#desatar) off();
    this.#desatar = [];
    this.#popup.remove();
    this.#boton.remove();
  }

  /**
   * Acota la altura al hueco que hay sobre la barra.
   *
   * El contenedor del reproductor lleva `overflow:hidden` —hace falta para
   * redondear las esquinas del vídeo— así que un menú más alto que el
   * reproductor se recorta y deja opciones inalcanzables. En un reproductor
   * embebido de poca altura, eso se come el menú entero.
   */
  #ajustarAltura(): void {
    const raiz = this.#boton.closest('.np') as HTMLElement | null;
    if (!raiz) return;
    const barra = this.#boton.closest('.np__bar') as HTMLElement | null;
    const alturaBarra = barra?.getBoundingClientRect().height ?? 0;
    const disponible = raiz.getBoundingClientRect().height - alturaBarra - 16;
    // Un suelo razonable: por debajo de esto el menú no sirve de nada y es
    // mejor que desborde a que muestre una sola fila.
    this.#popup.style.maxHeight = `${Math.max(140, disponible)}px`;
  }

  /* ------------------------------------------------------------------ pintado */

  #pintar(): void {
    const doc = this.#popup.ownerDocument;
    this.#popup.textContent = '';

    const menu = doc.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', this.#t.settings);

    if (this.#panelActivo === null) {
      const ordenados = [...this.#paneles.values()]
        .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
      for (const p of ordenados) menu.appendChild(this.#filaPanel(p));
    } else {
      const panel = this.#paneles.get(this.#panelActivo);
      if (!panel) { this.#panelActivo = null; return this.#pintar(); }

      const cabecera = doc.createElement('button');
      cabecera.type = 'button';
      cabecera.className = 'np__menu-back';
      cabecera.setAttribute('role', 'menuitem');
      cabecera.innerHTML = `<span class="np__menu-chevron" aria-hidden="true">‹</span>` +
        `<span>${panel.label}</span>`;
      cabecera.setAttribute('aria-label', `${this.#t.back}: ${panel.label}`);
      cabecera.addEventListener('click', () => { this.#panelActivo = null; this.#pintar(); this.#enfocarPrimero(); });
      menu.appendChild(cabecera);

      const actual = panel.getValue();
      for (const op of panel.options) {
        const item = doc.createElement('button');
        item.type = 'button';
        item.className = 'np__menu-item';
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(op.value === actual));
        item.innerHTML = `<span class="np__menu-tick" aria-hidden="true">` +
          `${op.value === actual ? '✓' : ''}</span><span>${op.label}</span>`;
        item.addEventListener('click', () => {
          panel.onSelect(op.value);
          this.#panelActivo = null;
          this.#pintar();
          this.#enfocarPrimero();
        });
        menu.appendChild(item);
      }
    }

    this.#popup.appendChild(menu);
    this.#tabindexMovil(menu, 0);
  }

  #filaPanel(panel: SettingsPanel): HTMLElement {
    const doc = this.#popup.ownerDocument;
    const actual = panel.options.find((o) => o.value === panel.getValue());
    const item = doc.createElement('button');
    item.type = 'button';
    item.className = 'np__menu-item np__menu-item--parent';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('aria-haspopup', 'true');
    item.innerHTML = `<span>${panel.label}</span>` +
      `<span class="np__menu-value">${actual?.label ?? ''}` +
      `<span class="np__menu-chevron" aria-hidden="true">›</span></span>`;
    // El valor actual entra en el nombre accesible: sin esto habría que abrir
    // el panel para saber a qué velocidad se está reproduciendo.
    item.setAttribute('aria-label', `${panel.label}: ${actual?.label ?? ''}`);
    item.addEventListener('click', () => {
      this.#panelActivo = panel.id;
      this.#pintar();
      this.#enfocarPrimero();
    });
    return item;
  }

  /* ------------------------------------------------------------------ teclado */

  #items(): HTMLElement[] {
    return [...this.#popup.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  }

  /**
   * Tabindex móvil: solo un elemento del menú es tabulable, y las flechas mueven
   * el foco entre ellos. Es el patrón que espera un lector de pantalla dentro de
   * un `role="menu"`; con todos a `tabindex=0`, Tab recorrería el menú y no
   * saldría de él, que es justo lo contrario de lo que debe pasar.
   */
  #tabindexMovil(raiz: HTMLElement, indice: number): void {
    const items = [...raiz.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    items.forEach((el, i) => { el.tabIndex = i === indice ? 0 : -1; });
  }

  #enfocarPrimero(): void {
    const items = this.#items();
    items[0]?.focus();
  }

  #mover(delta: number): void {
    const items = this.#items();
    if (items.length === 0) return;
    const actual = items.findIndex((el) => el === this.#popup.ownerDocument.activeElement);
    const siguiente = (actual + delta + items.length) % items.length;
    this.#tabindexMovil(this.#popup, siguiente);
    items[siguiente]?.focus();
  }

  #teclado(ev: KeyboardEvent): void {
    switch (ev.key) {
      case 'ArrowDown': this.#mover(1); break;
      case 'ArrowUp': this.#mover(-1); break;
      case 'Home': this.#tabindexMovil(this.#popup, 0); this.#items()[0]?.focus(); break;
      case 'End': {
        const items = this.#items();
        this.#tabindexMovil(this.#popup, items.length - 1);
        items[items.length - 1]?.focus();
        break;
      }
      case 'Escape':
        // Retrocede un nivel antes de cerrar: cerrar del todo desde un
        // subpanel obligaría a volver a navegar hasta él.
        if (this.#panelActivo !== null) {
          this.#panelActivo = null;
          this.#pintar();
          this.#enfocarPrimero();
        } else {
          this.close();
        }
        break;
      case 'Tab':
        // Dentro de un menú, Tab sale.
        this.close();
        return;
      default:
        return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  }
}
