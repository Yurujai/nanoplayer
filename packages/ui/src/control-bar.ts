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
import { hasEngine, strings } from '@nanoplayer/core';
import type {
  BarControlDecl, Catalogues, OverlayDecl, OverlayHandle, Player, PlayerError,
  SettingsPanelDecl, TimelineMarkersDecl, Translate, UiSlots,
} from '@nanoplayer/core';
import { ICONS } from './icons.js';
import { applyLayout, layoutsFor, type LayoutId } from './layouts.js';
import { Poster } from './poster.js';
import { SettingsMenu, type SettingsPanel } from './settings-menu.js';
import { createButton } from './dom.js';
import { FullscreenButton } from './fullscreen-button.js';
import { KeyboardShortcuts } from './keyboard-shortcuts.js';
import { LiveNotices } from './live-notices.js';
import { PluginControls } from './plugin-controls.js';
import { ProgressBar } from './progress-bar.js';
import { VolumeControl } from './volume-control.js';
import { injectStyles } from './styles.js';

export interface ControlBarOptions {
  /**
   * Idioma de las etiquetas. Por defecto, el que resolvió el reproductor.
   *
   * Solo hace falta para que la barra hable en un idioma distinto del resto;
   * lo normal es decirlo una vez en `create()` y no repetirlo aquí.
   */
  lang?: string;
  /** Cadenas propias, que mandan sobre las de serie. */
  strings?: Catalogues;
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

const VELOCIDADES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export class ControlBar implements UiSlots {
  readonly #player: Player;
  readonly #root: HTMLElement;
  readonly #t: Translate;
  readonly #lang: string;
  readonly #hideAfterMs: number;

  #bar!: HTMLElement;
  #escenario!: HTMLElement;
  #btnPlay!: HTMLButtonElement;
  #pantallaCompleta!: FullscreenButton;
  #btnSaltar!: HTMLButtonElement;
  #menu!: SettingsMenu;
  #poster: Poster | null = null;
  #observador: ResizeObserver | null = null;
  #volumen!: VolumeControl;
  #controlesPlugins!: PluginControls;
  #progreso!: ProgressBar;
  #vivo!: HTMLElement;
  #velocidad = 1;
  #layout: LayoutId = 'side-by-side';
  #temporizador: ReturnType<typeof setTimeout> | null = null;
  #desatar: Array<() => void> = [];
  #destruido = false;

  constructor(player: Player, options: ControlBarOptions = {}) {
    this.#player = player;
    this.#root = player.container;
    /*
     * Por defecto se hereda el traductor del reproductor: el idioma se decide
     * una vez, en `create()`, y la barra, el póster y los plugins dicen todos
     * lo mismo. Solo se construye uno propio si aquí se pide otra cosa.
     */
    this.#t = (options.lang || options.strings)
      ? strings.translator(options.lang ?? player.lang, options.strings)
      : player.t;
    this.#lang = this.#t.lang;
    this.#hideAfterMs = options.hideAfterMs ?? 2500;

    if (options.injectStyles !== false) injectStyles(this.#root.ownerDocument);
    this.#construir(options.label);
    this.#conectar();
    this.#pintar();
    if (options.poster !== false) this.#poster = new Poster(player);

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
    this.#root.setAttribute('aria-label', label ?? this.#t('ui.region'));
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
    this.#vivo.setAttribute('aria-label', this.#t('ui.status.region'));
    this.#root.appendChild(this.#vivo);

    this.#bar = doc.createElement('div');
    this.#bar.className = 'np__bar';

    this.#progreso = new ProgressBar(doc, this.#player, this.#t, () => this.#despertar());

    const filaBotones = doc.createElement('div');
    filaBotones.className = 'np__row';

    this.#btnPlay = createButton(this.#root.ownerDocument, this.#t('ui.play'), ICONS.play);
    this.#pantallaCompleta = new FullscreenButton(this.#root, this.#player, this.#t);

    this.#volumen = new VolumeControl(doc, this.#player, this.#t);

    const espaciador = doc.createElement('span');
    espaciador.className = 'np__spacer';

    filaBotones.append(this.#btnPlay, this.#volumen.element, this.#progreso.time,
      this.#progreso.segment, espaciador);
    // Los controles de los plugins, entre el espaciador y el engranaje: a la
    // derecha, que es donde se esperan las acciones.
    this.#controlesPlugins = new PluginControls(doc, () => this.#menu, this.#t);
    filaBotones.append(this.#controlesPlugins.element);
    this.#menu = new SettingsMenu(filaBotones, this.#t);
    filaBotones.append(this.#pantallaCompleta.element);

    this.#bar.append(this.#progreso.row, filaBotones);

    // Antes de la barra en el DOM, para que el Tab lo alcance primero: durante
    // la cabecera es lo que más probablemente se quiera hacer.
    this.#btnSaltar = doc.createElement('button');
    this.#btnSaltar.type = 'button';
    this.#btnSaltar.className = 'np__skip';
    this.#btnSaltar.hidden = true;
    this.#btnSaltar.setAttribute('aria-label', this.#t('ui.chain.skip'));
    const textoSaltar = doc.createElement('span');
    textoSaltar.textContent = this.#t('ui.chain.skip');
    this.#btnSaltar.append(textoSaltar);
    this.#btnSaltar.insertAdjacentHTML('beforeend', ICONS.skip);
    this.#root.appendChild(this.#btnSaltar);

    this.#root.appendChild(this.#bar);
    this.#registrarPanelesPropios();
  }

  /* ------------------------------------------------- anclajes para plugins -- */

  /** Añade un botón a la barra. Lo llama un plugin a través de `ctx.whenUi()`. */
  addBarControl(control: BarControlDecl): () => void {
    return this.#controlesPlugins.add(control);
  }

  addSettingsPanel(panel: SettingsPanelDecl): () => void {
    return this.#menu.addPanel(panel);
  }

  addTimelineMarkers(decl: TimelineMarkersDecl): () => void {
    return this.#progreso.setMarkers(decl.id, decl.markers);
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
    this.#controlesPlugins.render();
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
      label: this.#t('ui.speed'),
      priority: 10,
      options: VELOCIDADES.map((v) => ({
        value: String(v),
        label: v === 1 ? this.#t('ui.normal') : `${v}×`,
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
      const layouts = layoutsFor(streams, this.#t);
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
      label: this.#t('ui.layout.label'),
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

  /**
   * Mueve al escenario los streams que el Player haya montado, y la cabecera y
   * la cola **detrás**: comparten nivel con la imagen en imagen, y a igualdad
   * de nivel tapa la que va después en el DOM.
   */
  #recogerStreams(): void {
    const hijos = [...this.#root.children].filter((h): h is HTMLElement => h instanceof HTMLElement);
    for (const h of hijos) if (h.dataset['stream']) this.#escenario.appendChild(h);
    for (const h of hijos) if (h.dataset['bumper']) this.#escenario.appendChild(h);
  }

  /**
   * Qué decirle a quien mira cuando algo falla.
   *
   * Se deriva del **código**, nunca de `error.message`. Ese mensaje es
   * diagnóstico para quien integra —lleva el estado HTTP, el detalle de
   * hls.js, la ruta del manifiesto— y va siempre en inglés: anunciarlo por la
   * región viva le leía a un usuario con lector de pantalla cosas como
   * «hls.js cannot run in this browser: no Media Source Extensions».
   *
   * Es además lo que el propio `errors.ts` pedía desde el principio: emparejar
   * por texto «es como se rompen las cosas al traducir».
   *
   * Un código sin clave cae al genérico en lugar de enseñar `ui.error.loquesea`.
   */
  #textoError(error: PlayerError): string {
    const clave = `ui.error.${error.code}`;
    const texto = this.#t(clave);
    return texto === clave ? this.#t('ui.error.generic') : texto;
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
    this.#on(this.#btnSaltar, 'click', () => this.#saltarCabecera());

    // El Player monta los streams en el contenedor, y puede hacerlo después de
    // que exista la barra: con el ciclo perezoso, `attach()` llega más tarde.
    this.#desatar.push(p.on('engine:attach:ok', () => {
      this.#recogerStreams();
      this.#pintar();
    }));
    const avisos = new LiveNotices({
      root: this.#root, stage: this.#escenario, player: p, t: this.#t,
      announce: (m) => this.#anunciar(m),
      collectStreams: () => this.#recogerStreams(),
    });
    this.#desatar.push(p.on('live:status', ({ stream, status }) => {
      avisos.update(stream, status);
      this.#progreso.render();
    }));
    this.#desatar.push(p.on('state:change', () => this.#pintar()));
    this.#desatar.push(p.on('time', () => this.#progreso.render()));
    this.#desatar.push(p.on('play', () => {
      this.#anunciar(this.#t(p.phase === 'intro' ? 'ui.chain.intro' : 'ui.status.playing'));
      this.#pintar();
    }));
    this.#desatar.push(p.on('chain:phase', ({ to, skipped }) => {
      this.#progreso.resetBumperTime();
      if (to === 'outro') this.#anunciar(this.#t('ui.chain.outro'));
      else if (skipped) this.#anunciar(this.#t('ui.chain.skipped'));
      this.#pintar();
    }));
    this.#desatar.push(p.on('chain:time', ({ current, duration }) => {
      this.#progreso.setBumperTime(current, duration);
    }));
    this.#desatar.push(p.on('pause', () => { this.#anunciar(this.#t('ui.status.paused')); this.#pintar(); }));
    this.#desatar.push(p.on('ended', () => { this.#anunciar(this.#t('ui.status.ended')); this.#pintar(); }));
    this.#desatar.push(p.on('stall:start', () => this.#anunciar(this.#t('ui.status.buffering'))));
    this.#desatar.push(p.on('error', ({ error }) => this.#anunciar(this.#textoError(error))));

    const atajos = new KeyboardShortcuts(p, {
      togglePlay: () => this.#alternarReproduccion(),
      toggleMute: () => this.#volumen.toggleMute(),
      stepVolume: (direction) => this.#volumen.step(direction),
      toggleFullscreen: () => this.#pantallaCompleta.toggle(),
      isMenuOpen: () => this.#menu.isOpen,
      used: () => this.#despertar(),
    });
    this.#on(this.#root, 'keydown', (ev: KeyboardEvent) => atajos.handle(ev));
    this.#on(this.#root, 'pointermove', () => this.#despertar());
    this.#on(this.#root, 'pointerleave', () => this.#dormir());
    this.#on(this.#root, 'focusin', () => this.#despertar());

    // Al cambiar el ancho cambia cuántos controles caben.
    if (typeof ResizeObserver !== 'undefined') {
      this.#observador = new ResizeObserver(() => this.#controlesPlugins.render());
      this.#observador.observe(this.#root);
    }

    this.#despertar();
  }

  /* ----------------------------------------------------------------- acciones */

  #alternarReproduccion(): void {
    if (this.#player.paused) void this.#player.play().catch(() => {});
    else this.#player.pause();
  }

  #saltarCabecera(): void {
    // El botón va a desaparecer: sin esto el foco caería al <body> y quien
    // navega con teclado tendría que volver a entrar en el reproductor.
    if (this.#root.ownerDocument.activeElement === this.#btnSaltar) this.#root.focus();
    this.#player.skipIntro();
  }

  /* ------------------------------------------------------------------ pintado */

  #pintar(): void {
    const p = this.#player;
    const reproduciendo = !p.paused && p.state === 'active';
    this.#btnPlay.innerHTML = reproduciendo ? ICONS.pause : ICONS.play;
    this.#btnPlay.setAttribute('aria-label', reproduciendo ? this.#t('ui.pause') : this.#t('ui.play'));
    this.#progreso.render();
    this.#pantallaCompleta.render();
    this.#pintarCadena();
    if (reproduciendo) this.#programarOcultado();
    else this.#despertar();
  }

  /** El botón de saltar: solo con la cabecera en pantalla. */
  #pintarCadena(): void {
    const p = this.#player;
    const conMedios = hasEngine(p.state);
    this.#btnSaltar.hidden = !(conMedios && p.canSkip);
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
    this.#volumen.destroy();
    this.#pantallaCompleta.destroy();
    this.#progreso.destroy();
    this.#bar.remove();
    this.#btnSaltar.remove();
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
