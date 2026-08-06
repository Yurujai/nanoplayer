/**
 * Barra de controles accesible.
 *
 * Decisiones que no son negociables y el porqué de cada una:
 *
 *   - **Botones nativos `<button>`.** Traen rol, activación por teclado y
 *     comportamiento de foco. Un `<div role="button">` obliga a reimplementarlo
 *     todo, y siempre se olvida algo.
 *   - **Deslizadores nativos `<input type="range">`** para progreso y volumen.
 *     Traen teclado, gestos táctiles y anuncio de valores. Es donde más se
 *     pierde a quien usa lector de pantalla si se reimplementa.
 *   - **`aria-valuetext` con el tiempo hablado.** Un lector de pantalla leería
 *     "735" para el valor 735; con esto dice "12 minutos y 15 segundos".
 *   - **La barra no se oculta si el foco está dentro.** Quien navega con
 *     teclado perdería de vista el control que está usando.
 *   - **Región en vivo** para lo que solo se percibe visualmente: buffering,
 *     errores, cambios de estado.
 */
import type {
  BarControlDecl, OverlayDecl, OverlayHandle, Player, SettingsPanelDecl, UiSlots,
} from '@nanoplayer/core';
import { formatPercent, formatTime, spokenTime } from './format.js';
import { ICONS } from './icons.js';
import { applyLayout, layoutsFor, type LayoutId } from './layouts.js';
import { Poster } from './poster.js';
import { SettingsMenu, type SettingsPanel } from './settings-menu.js';
import { injectStyles } from './styles.js';

export interface ControlBarOptions {
  /** Idioma de las etiquetas. De momento `es` y `en`. */
  lang?: string;
  /** Milisegundos de inactividad antes de ocultar la barra. `0` la deja fija. */
  hideAfterMs?: number;
  /** Inyectar los estilos por defecto. Desactívalo si importas el CSS aparte. */
  injectStyles?: boolean;
  /** Etiqueta accesible de la región del reproductor. */
  label?: string;
  /**
   * Mostrar el póster con botón de reproducción mientras no hay medios.
   * Activado por defecto: es la cara visible del ciclo perezoso.
   */
  poster?: boolean;
}

interface Textos {
  region: string; play: string; pause: string; replay: string;
  progress: string; volume: string; mute: string; unmute: string;
  fullscreenEnter: string; fullscreenExit: string;
  speed: string; normal: string; layout: string; more: string;
  playing: string; paused: string; buffering: string; ended: string;
  liveRegion: string;
}

const TEXTOS: Record<string, Textos> = {
  es: {
    region: 'Reproductor de vídeo', play: 'Reproducir', pause: 'Pausar',
    replay: 'Volver a reproducir', progress: 'Posición', volume: 'Volumen',
    mute: 'Silenciar', unmute: 'Activar sonido',
    fullscreenEnter: 'Pantalla completa', fullscreenExit: 'Salir de pantalla completa',
    speed: 'Velocidad', normal: 'Normal', layout: 'Disposición', more: 'Más opciones',
    playing: 'Reproduciendo', paused: 'En pausa', buffering: 'Cargando',
    ended: 'Vídeo terminado', liveRegion: 'Estado del reproductor',
  },
  en: {
    region: 'Video player', play: 'Play', pause: 'Pause',
    replay: 'Replay', progress: 'Seek', volume: 'Volume',
    mute: 'Mute', unmute: 'Unmute',
    fullscreenEnter: 'Full screen', fullscreenExit: 'Exit full screen',
    speed: 'Speed', normal: 'Normal', layout: 'Layout', more: 'More options',
    playing: 'Playing', paused: 'Paused', buffering: 'Buffering',
    ended: 'Video ended', liveRegion: 'Player status',
  },
};

const SALTO_CORTO = 5;
const SALTO_LARGO = 10;
const PASO_VOLUMEN = 0.05;
const VELOCIDADES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export class ControlBar implements UiSlots {
  readonly #player: Player;
  readonly #root: HTMLElement;
  readonly #t: Textos;
  readonly #lang: string;
  readonly #hideAfterMs: number;

  #bar!: HTMLElement;
  #escenario!: HTMLElement;
  #btnPlay!: HTMLButtonElement;
  #btnMute!: HTMLButtonElement;
  #btnFs!: HTMLButtonElement;
  #menu!: SettingsMenu;
  #poster: Poster | null = null;
  #zonaControles!: HTMLElement;
  readonly #controles: BarControlDecl[] = [];
  readonly #botonesPlugin = new Map<string, HTMLButtonElement>();
  #quitarDesborde: (() => void) | null = null;
  #observador: ResizeObserver | null = null;
  #progreso!: HTMLInputElement;
  #volumen!: HTMLInputElement;
  #tiempo!: HTMLElement;
  #vivo!: HTMLElement;

  #velocidad = 1;
  #layout: LayoutId = 'side-by-side';
  #arrastrando = false;
  #volumenPrevio = 1;
  #temporizador: ReturnType<typeof setTimeout> | null = null;
  #desatar: Array<() => void> = [];
  #destruido = false;

  constructor(player: Player, options: ControlBarOptions = {}) {
    this.#player = player;
    this.#root = player.container;
    this.#lang = options.lang ?? (document.documentElement.lang || 'es');
    this.#t = TEXTOS[this.#lang.slice(0, 2)] ?? TEXTOS['es']!;
    this.#hideAfterMs = options.hideAfterMs ?? 2500;

    if (options.injectStyles !== false) injectStyles(this.#root.ownerDocument);
    this.#construir(options.label);
    this.#conectar();
    this.#pintar();
    if (options.poster !== false) this.#poster = new Poster(player, this.#lang);

    // Anunciarse al final: un plugin puede añadir controles en cuanto lo sepa,
    // y para entonces la barra tiene que estar completa.
    player.setUi(this);
  }

  get element(): HTMLElement {
    return this.#bar;
  }

  /** El menú de ajustes, para registrar paneles desde fuera. */
  get settings(): SettingsMenu {
    return this.#menu;
  }

  /* ------------------------------------------------------------ construcción */

  #construir(label?: string): void {
    const doc = this.#root.ownerDocument;
    this.#root.classList.add('np');

    // Región con nombre: quien navega por landmarks encuentra el reproductor,
    // y `tabindex` permite que los atajos de teclado lleguen al contenedor.
    this.#root.setAttribute('role', 'region');
    this.#root.setAttribute('aria-label', label ?? this.#t.region);
    if (!this.#root.hasAttribute('tabindex')) this.#root.tabIndex = 0;

    // El Player monta los streams directamente en el contenedor; se recogen en
    // un escenario propio para poder colocarlos sin pelearse con la barra.
    this.#escenario = doc.createElement('div');
    this.#escenario.className = 'np__stage';
    this.#root.appendChild(this.#escenario);
    this.#recogerStreams();

    this.#vivo = doc.createElement('div');
    this.#vivo.className = 'np__sr';
    this.#vivo.setAttribute('role', 'status');
    this.#vivo.setAttribute('aria-live', 'polite');
    this.#vivo.setAttribute('aria-label', this.#t.liveRegion);
    this.#root.appendChild(this.#vivo);

    this.#bar = doc.createElement('div');
    this.#bar.className = 'np__bar';

    const filaProgreso = doc.createElement('div');
    filaProgreso.className = 'np__row';
    this.#progreso = this.#rango(this.#t.progress, 0, 1, 0.001);
    filaProgreso.appendChild(this.#progreso);

    const filaBotones = doc.createElement('div');
    filaBotones.className = 'np__row';

    this.#btnPlay = this.#boton(this.#t.play, ICONS.play);
    this.#btnMute = this.#boton(this.#t.mute, ICONS.volumeHigh);
    this.#btnFs = this.#boton(this.#t.fullscreenEnter, ICONS.fullscreenEnter);

    const volumen = doc.createElement('div');
    volumen.className = 'np__volume';
    this.#volumen = this.#rango(this.#t.volume, 0, 1, 0.01);
    this.#volumen.value = '1';
    volumen.append(this.#btnMute, this.#volumen);

    this.#tiempo = doc.createElement('span');
    this.#tiempo.className = 'np__time';
    // El tiempo ya se anuncia por `aria-valuetext` del deslizador; repetirlo
    // en una región viva sería un goteo constante e insoportable.
    this.#tiempo.setAttribute('aria-hidden', 'true');

    const espaciador = doc.createElement('span');
    espaciador.className = 'np__spacer';

    // Los controles que aporten los plugins caen aquí, entre el espaciador y
    // el engranaje: a la derecha, que es donde se esperan las acciones.
    this.#zonaControles = doc.createElement('span');
    this.#zonaControles.className = 'np__plugins';

    filaBotones.append(this.#btnPlay, volumen, this.#tiempo, espaciador, this.#zonaControles);
    this.#menu = new SettingsMenu(filaBotones, this.#lang);
    filaBotones.append(this.#btnFs);

    this.#bar.append(filaProgreso, filaBotones);
    this.#root.appendChild(this.#bar);
    this.#registrarPanelesPropios();
  }

  /* ------------------------------------------------- anclajes para plugins -- */

  /** Añade un botón a la barra. Lo llama un plugin a través de `ctx.whenUi()`. */
  addBarControl(control: BarControlDecl): () => void {
    this.#controles.push(control);
    this.#pintarControles();
    return () => {
      const i = this.#controles.indexOf(control);
      if (i >= 0) this.#controles.splice(i, 1);
      this.#botonesPlugin.get(control.id)?.remove();
      this.#botonesPlugin.delete(control.id);
      this.#pintarControles();
    };
  }

  addSettingsPanel(panel: SettingsPanelDecl): () => void {
    return this.#menu.addPanel(panel);
  }

  /**
   * Reserva una capa sobre el vídeo, del ancho del reproductor entero.
   *
   * Ese ancho es justamente el motivo de que exista: el navegador dibuja los
   * subtítulos nativos **dentro del elemento `<video>`**, así que en un layout
   * lado a lado quedan encajonados en la mitad, y en imagen en imagen podrían
   * caer dentro del recuadro pequeño.
   */
  addOverlay(decl: OverlayDecl): OverlayHandle {
    const el = this.#root.ownerDocument.createElement('div');
    el.className = `np__overlay np__overlay--${decl.position ?? 'fill'}`;
    el.dataset['overlay'] = decl.id;
    // Antes de la barra en el DOM: los controles siempre por encima.
    this.#root.insertBefore(el, this.#bar);
    return { element: el, remove: () => el.remove() };
  }

  /** Repinta los controles cuando un plugin cambia su estado. */
  refresh(): void {
    this.#pintarControles();
  }

  /**
   * Coloca los controles de plugins, y desborda al menú lo que no cabe.
   *
   * La barra es un recurso escaso: en móvil entran cuatro o cinco controles, y
   * si cada plugin puede añadir botón, tres plugins la dejan inservible. Lo que
   * no cabe **no desaparece**: se agrupa en un panel "Más opciones" del menú de
   * ajustes, donde sigue siendo alcanzable por teclado y por lector de pantalla.
   */
  #pintarControles(): void {
    const disponibles = this.#controles
      .filter((c) => c.available?.() ?? true)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    // Ancho libre de la fila, descontando lo fijo. Con `--np-control-size` de
    // 2.5rem, cada botón ocupa unos 40 px.
    const anchoBoton = this.#zonaControles.getBoundingClientRect().height || 40;
    const anchoFila = this.#bar.getBoundingClientRect().width;
    const reservado = 4 * anchoBoton + 90;   // play, volumen, tiempo, ajustes, fullscreen
    const caben = Math.max(0, Math.floor((anchoFila - reservado) / anchoBoton));

    const enBarra = disponibles.slice(0, caben);
    const desbordados = disponibles.slice(caben);

    this.#zonaControles.textContent = '';
    this.#botonesPlugin.clear();
    for (const c of enBarra) {
      const b = this.#boton(this.#texto(c.label), this.#texto(c.icon));
      b.dataset['control'] = c.id;
      if (c.pressed) b.setAttribute('aria-pressed', String(c.pressed()));
      b.addEventListener('click', () => { c.onActivate(); this.#pintarControles(); });
      this.#zonaControles.appendChild(b);
      this.#botonesPlugin.set(c.id, b);
    }

    this.#quitarDesborde?.();
    this.#quitarDesborde = null;
    if (desbordados.length > 0) {
      this.#quitarDesborde = this.#menu.addPanel({
        id: '__overflow',
        label: this.#t.more,
        priority: 900,
        options: desbordados.map((c) => ({ value: c.id, label: this.#texto(c.label) })),
        getValue: () => '',
        onSelect: (id) => {
          this.#controles.find((c) => c.id === id)?.onActivate();
          this.#pintarControles();
        },
      });
    }
  }

  #texto(v: string | (() => string)): string {
    return typeof v === 'function' ? v() : v;
  }

  /**
   * Paneles que aporta la propia interfaz.
   *
   * Se registran por la misma vía que usará un plugin, a propósito: si el caso
   * propio necesitara un atajo que un plugin no tiene, la API estaría mal.
   */
  #registrarPanelesPropios(): void {
    this.#menu.addPanel({
      id: 'speed',
      label: this.#t.speed,
      priority: 10,
      options: VELOCIDADES.map((v) => ({
        value: String(v),
        label: v === 1 ? this.#t.normal : `${v}×`,
      })),
      getValue: () => String(this.#velocidad),
      onSelect: (v) => {
        this.#velocidad = Number(v);
        this.#player.setPlaybackRate(this.#velocidad);
      },
    });

    // Solo tiene sentido con más de un stream: ofrecer "lado a lado" en un
    // mono-stream sería un ajuste que no hace nada. Y el manifiesto puede no
    // estar todavía, porque la barra puede montarse antes de resolverlo.
    const registrarLayouts = () => {
      const streams = this.#player.manifest?.streams.length ?? 1;
      const layouts = layoutsFor(streams, this.#lang);
      if (layouts.length === 0) return;
      this.#registrarLayouts(layouts);
    };
    if (this.#player.manifest) registrarLayouts();
    else this.#desatar.push(this.#player.on('manifest:resolve:ok', registrarLayouts));
  }

  #registrarLayouts(layouts: ReturnType<typeof layoutsFor>): void {

    applyLayout(this.#root, this.#layout);
    this.#menu.addPanel({
      id: 'layout',
      label: this.#t.layout,
      priority: 20,
      options: layouts.map((l) => ({ value: l.id, label: l.label })),
      getValue: () => this.#layout,
      onSelect: (v) => {
        this.#layout = v as LayoutId;
        applyLayout(this.#root, this.#layout);
        this.#player.bus.emit('layout:change', { layout: this.#layout });
      },
    });
  }

  /** Mueve al escenario los streams que el Player haya montado. */
  #recogerStreams(): void {
    for (const hijo of [...this.#root.children]) {
      if (hijo instanceof HTMLElement && hijo.dataset['stream']) {
        this.#escenario.appendChild(hijo);
      }
    }
  }

  #boton(etiqueta: string, icono: string): HTMLButtonElement {
    const b = this.#root.ownerDocument.createElement('button');
    b.type = 'button';
    b.className = 'np__btn';
    b.setAttribute('aria-label', etiqueta);
    b.innerHTML = icono;
    return b;
  }

  #rango(etiqueta: string, min: number, max: number, step: number): HTMLInputElement {
    const r = this.#root.ownerDocument.createElement('input');
    r.type = 'range';
    r.className = 'np__range';
    r.min = String(min);
    r.max = String(max);
    r.step = String(step);
    r.value = '0';
    r.setAttribute('aria-label', etiqueta);
    return r;
  }

  /* ------------------------------------------------------------- conexiones */

  #on<K extends keyof HTMLElementEventMap>(
    el: EventTarget, type: K | string, fn: (ev: never) => void,
  ): void {
    el.addEventListener(type, fn as EventListener);
    this.#desatar.push(() => el.removeEventListener(type, fn as EventListener));
  }

  #conectar(): void {
    const p = this.#player;

    this.#on(this.#btnPlay, 'click', () => this.#alternarReproduccion());
    this.#on(this.#btnMute, 'click', () => this.#alternarSilencio());
    this.#on(this.#btnFs, 'click', () => this.#alternarPantallaCompleta());

    // `input` mientras se arrastra, `change` al soltar: buscar en cada píxel
    // provocaría una tormenta de saltos.
    this.#on(this.#progreso, 'pointerdown', () => { this.#arrastrando = true; });
    this.#on(this.#progreso, 'input', () => this.#previsualizarBusqueda());
    this.#on(this.#progreso, 'change', () => this.#confirmarBusqueda());
    this.#on(this.#progreso, 'keydown', () => { this.#arrastrando = false; });

    this.#on(this.#volumen, 'input', () => {
      const v = Number(this.#volumen.value);
      p.setVolume(v);
      if (v > 0) this.#volumenPrevio = v;
      p.setMuted(v === 0);
      this.#pintarVolumen(v, v === 0);
    });

    // El Player monta los streams en el contenedor, y puede hacerlo después de
    // que exista la barra: con el ciclo perezoso, `attach()` llega más tarde.
    this.#desatar.push(p.on('engine:attach:ok', () => {
      this.#recogerStreams();
      this.#pintar();
    }));
    this.#desatar.push(p.on('state:change', () => this.#pintar()));
    this.#desatar.push(p.on('time', () => this.#pintarProgreso()));
    this.#desatar.push(p.on('play', () => { this.#anunciar(this.#t.playing); this.#pintar(); }));
    this.#desatar.push(p.on('pause', () => { this.#anunciar(this.#t.paused); this.#pintar(); }));
    this.#desatar.push(p.on('ended', () => { this.#anunciar(this.#t.ended); this.#pintar(); }));
    this.#desatar.push(p.on('stall:start', () => this.#anunciar(this.#t.buffering)));
    this.#desatar.push(p.on('error', ({ error }) => this.#anunciar(error.message)));

    this.#on(this.#root, 'keydown', (ev: KeyboardEvent) => this.#atajos(ev));
    this.#on(this.#root, 'pointermove', () => this.#despertar());
    this.#on(this.#root, 'pointerleave', () => this.#dormir());
    this.#on(this.#root, 'focusin', () => this.#despertar());

    const doc = this.#root.ownerDocument;
    this.#on(doc, 'fullscreenchange', () => this.#pintarPantallaCompleta());
    this.#on(doc, 'webkitfullscreenchange', () => this.#pintarPantallaCompleta());

    // Al cambiar el ancho cambia cuántos controles caben.
    if (typeof ResizeObserver !== 'undefined') {
      this.#observador = new ResizeObserver(() => this.#pintarControles());
      this.#observador.observe(this.#root);
    }

    this.#despertar();
  }

  /* ----------------------------------------------------------------- acciones */

  #alternarReproduccion(): void {
    if (this.#player.paused) void this.#player.play().catch(() => {});
    else this.#player.pause();
  }

  #alternarSilencio(): void {
    const silenciado = Number(this.#volumen.value) === 0;
    const v = silenciado ? (this.#volumenPrevio || 1) : 0;
    if (!silenciado) this.#volumenPrevio = Number(this.#volumen.value) || 1;
    this.#volumen.value = String(v);
    this.#player.setVolume(v);
    this.#player.setMuted(v === 0);
    this.#pintarVolumen(v, v === 0);
  }

  /**
   * Pantalla completa.
   *
   * Si no hay API de contenedor se recurre a llevar el vídeo maestro al
   * reproductor del sistema. **En iPhone es la única vía**: S2 midió que allí
   * `requestFullscreen` sobre un contenedor no existe, y esa ruta hace
   * desaparecer el segundo stream. Es limitación de iOS, no de WebKit — en
   * Safari de escritorio sí funciona.
   */
  #alternarPantallaCompleta(): void {
    const doc = this.#root.ownerDocument as Document & {
      webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void;
    };
    const root = this.#root as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      return;
    }
    const pedir = root.requestFullscreen ?? root.webkitRequestFullscreen;
    if (pedir) {
      void pedir.call(root).catch(() => {});
      return;
    }
    const video = this.#player.master?.element as (HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
    }) | null;
    video?.webkitEnterFullscreen?.();
  }

  #previsualizarBusqueda(): void {
    const t = Number(this.#progreso.value) * (this.#player.duration || 0);
    this.#tiempo.textContent = `${formatTime(t)} / ${formatTime(this.#player.duration)}`;
    this.#progreso.setAttribute('aria-valuetext', spokenTime(t, this.#lang));
    this.#progreso.style.setProperty('--np-progress', `${Number(this.#progreso.value) * 100}%`);
  }

  #confirmarBusqueda(): void {
    this.#arrastrando = false;
    this.#player.seek(Number(this.#progreso.value) * (this.#player.duration || 0));
  }

  /* ------------------------------------------------------------------ teclado */

  /**
   * Atajos de teclado.
   *
   * Se ceden las teclas que el elemento enfocado ya usa: las flechas sobre un
   * deslizador son suyas, y el espacio sobre un botón lo activa. Robárselas
   * rompería el comportamiento nativo que precisamente se buscaba tener.
   */
  #atajos(ev: KeyboardEvent): void {
    const destino = ev.target as HTMLElement | null;
    const esControl = destino instanceof HTMLInputElement
      || destino instanceof HTMLButtonElement
      || destino instanceof HTMLSelectElement
      || destino instanceof HTMLTextAreaElement;
    const propiasDelControl = new Set([
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Home', 'End', ' ', 'Enter', 'PageUp', 'PageDown',
    ]);
    if (esControl && propiasDelControl.has(ev.key)) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    // Con el menú abierto, las teclas son suyas.
    if (this.#menu.isOpen) return;

    const p = this.#player;
    const d = p.duration || 0;
    const saltar = (delta: number) => p.seek(Math.min(d, Math.max(0, p.currentTime + delta)));
    const volumen = (delta: number) => {
      const v = Math.min(1, Math.max(0, Number(this.#volumen.value) + delta));
      this.#volumen.value = String(v);
      this.#volumen.dispatchEvent(new Event('input'));
    };

    switch (ev.key) {
      case ' ': case 'k': case 'K': this.#alternarReproduccion(); break;
      case 'ArrowLeft': saltar(-SALTO_CORTO); break;
      case 'ArrowRight': saltar(SALTO_CORTO); break;
      case 'j': case 'J': saltar(-SALTO_LARGO); break;
      case 'l': case 'L': saltar(SALTO_LARGO); break;
      case 'ArrowUp': volumen(PASO_VOLUMEN); break;
      case 'ArrowDown': volumen(-PASO_VOLUMEN); break;
      case 'm': case 'M': this.#alternarSilencio(); break;
      case 'f': case 'F': this.#alternarPantallaCompleta(); break;
      case 'Home': p.seek(0); break;
      case 'End': p.seek(d); break;
      default:
        if (/^[0-9]$/.test(ev.key)) p.seek((Number(ev.key) / 10) * d);
        else return;
    }
    ev.preventDefault();
    this.#despertar();
  }

  /* ------------------------------------------------------------------ pintado */

  #pintar(): void {
    const p = this.#player;
    const reproduciendo = !p.paused && p.state === 'active';
    this.#btnPlay.innerHTML = reproduciendo ? ICONS.pause : ICONS.play;
    this.#btnPlay.setAttribute('aria-label', reproduciendo ? this.#t.pause : this.#t.play);
    this.#pintarProgreso();
    this.#pintarPantallaCompleta();
    if (reproduciendo) this.#programarOcultado();
    else this.#despertar();
  }

  #pintarProgreso(): void {
    if (this.#arrastrando) return;
    const p = this.#player;
    const d = p.duration || 0;
    const t = p.currentTime;
    const frac = d > 0 ? Math.min(1, t / d) : 0;

    this.#progreso.value = String(frac);
    this.#progreso.style.setProperty('--np-progress', `${frac * 100}%`);
    // El tiempo hablado es lo que convierte "735" en "12 minutos y 15 segundos".
    this.#progreso.setAttribute('aria-valuetext', spokenTime(t, this.#lang));
    this.#tiempo.textContent = `${formatTime(t)} / ${formatTime(d)}`;

    const buffered = p.master?.buffered;
    if (buffered && buffered.length > 0 && d > 0) {
      const fin = buffered.end(buffered.length - 1);
      this.#progreso.style.setProperty('--np-buffered', `${Math.min(100, (fin / d) * 100)}%`);
    }
  }

  #pintarVolumen(v: number, silenciado: boolean): void {
    const icono = silenciado || v === 0 ? ICONS.volumeMuted
      : v < 0.5 ? ICONS.volumeLow : ICONS.volumeHigh;
    this.#btnMute.innerHTML = icono;
    this.#btnMute.setAttribute('aria-label', silenciado ? this.#t.unmute : this.#t.mute);
    this.#volumen.setAttribute('aria-valuetext', formatPercent(v));
    this.#volumen.style.setProperty('--np-progress', `${v * 100}%`);
  }

  /**
   * ¿Se puede usar la pantalla completa aquí?
   *
   * Dentro de un `<iframe>` sin `allow="fullscreen"` la llamada se rechaza con
   * "Disallowed by permissions policy". Enseñar el botón igualmente deja un
   * control que no hace nada, y quien lo pulse no entenderá por qué.
   *
   * En iPhone tampoco existe fullscreen de contenedor —lo midió S2— pero ahí sí
   * queda la vía del vídeo suelto, así que el botón sigue teniendo sentido.
   */
  #hayPantallaCompleta(): boolean {
    const doc = this.#root.ownerDocument as Document & {
      webkitFullscreenEnabled?: boolean;
    };
    if (doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled) return true;
    // Recurso de iOS: llevar el vídeo al reproductor del sistema.
    return 'webkitEnterFullscreen' in this.#root.ownerDocument.createElement('video');
  }

  #pintarPantallaCompleta(): void {
    const doc = this.#root.ownerDocument as Document & { webkitFullscreenElement?: Element };
    this.#btnFs.hidden = !this.#hayPantallaCompleta();
    const dentro = !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
    this.#btnFs.innerHTML = dentro ? ICONS.fullscreenExit : ICONS.fullscreenEnter;
    this.#btnFs.setAttribute('aria-label',
      dentro ? this.#t.fullscreenExit : this.#t.fullscreenEnter);
  }

  #anunciar(mensaje: string): void {
    this.#vivo.textContent = mensaje;
  }

  /* -------------------------------------------------------- ocultado por inactividad */

  #despertar(): void {
    this.#root.classList.remove('np--inactive');
    if (this.#temporizador) clearTimeout(this.#temporizador);
    this.#temporizador = null;
    if (!this.#player.paused) this.#programarOcultado();
  }

  #programarOcultado(): void {
    if (this.#hideAfterMs <= 0) return;
    if (this.#temporizador) clearTimeout(this.#temporizador);
    this.#temporizador = setTimeout(() => this.#dormir(), this.#hideAfterMs);
  }

  #dormir(): void {
    // Nunca esconder la barra con el reproductor parado ni con el foco dentro:
    // en el primer caso no hay nada que ver detrás, en el segundo se perdería
    // de vista el control que se está usando.
    if (this.#player.paused) return;
    if (this.#menu.isOpen) return;
    if (this.#root.contains(this.#root.ownerDocument.activeElement)) return;
    this.#root.classList.add('np--inactive');
  }

  destroy(): void {
    if (this.#destruido) return;
    this.#destruido = true;
    if (this.#temporizador) clearTimeout(this.#temporizador);
    for (const off of this.#desatar) off();
    this.#desatar = [];
    this.#poster?.destroy();
    this.#poster = null;
    this.#observador?.disconnect();
    this.#observador = null;
    this.#player.setUi(null);
    this.#menu.destroy();
    this.#bar.remove();
    this.#vivo.remove();
    this.#root.classList.remove('np', 'np--inactive');
    this.#root.removeAttribute('role');
    this.#root.removeAttribute('aria-label');
  }
}

/** Añade la barra de controles a un reproductor. */
export function attachControls(player: Player, options?: ControlBarOptions): ControlBar {
  return new ControlBar(player, options);
}
