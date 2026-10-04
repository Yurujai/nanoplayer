/**
 * Accessible control bar. Native `<button>` and `<input type="range">` so role,
 * keyboard and touch come for free; spoken `aria-valuetext`; the bar never
 * hides with focus inside; a live region for what is only visible.
 *
 * It composes the bar's components and implements the plugin slots.
 */
import { hasEngine, strings } from '@nanoplayer/core';
import type {
  BarControlDecl, Catalogues, OverlayDecl, OverlayHandle, PanelDecl, PanelHandle,
  Player, PlayerError,
  SettingsPanelDecl, TimelineMarkersDecl, TimelinePreviewDecl, Translate, UiSlots,
} from '@nanoplayer/core';
import { AutoHide } from './auto-hide.js';
import { createButton, Listeners } from './dom.js';
import { ErrorDisplay } from './error-display.js';
import { FullscreenButton } from './fullscreen-button.js';
import { ICONS } from './icons.js';
import { KeyboardShortcuts } from './keyboard-shortcuts.js';
import { applyLayout, layoutsFor, type LayoutDef, type LayoutId } from './layouts.js';
import { LiveNotices } from './live-notices.js';
import { LoadingIndicator } from './loading-indicator.js';
import { PluginControls } from './plugin-controls.js';
import { Poster } from './poster.js';
import { ProgressBar } from './progress-bar.js';
import { SettingsMenu } from './settings-menu.js';
import { injectStyles } from './styles.js';
import { VideoGestures } from './video-gestures.js';
import { VolumeControl } from './volume-control.js';

export interface ControlBarOptions {
  /** Label language. Defaults to the player's; only needed to differ from it. */
  lang?: string;
  /** Own strings, overriding the built-in ones. */
  strings?: Catalogues;
  /** Idle milliseconds before hiding the bar. `0` keeps it visible. */
  hideAfterMs?: number;
  /** Inject the default styles. Turn off when importing the CSS file. */
  injectStyles?: boolean;
  /** Accessible label of the player region. */
  label?: string;
  /** Show the poster and play button while there is no media. On by default. */
  poster?: boolean;
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export class ControlBar implements UiSlots {
  readonly #player: Player;
  readonly #root: HTMLElement;
  readonly #t: Translate;
  readonly #listeners = new Listeners();

  #bar!: HTMLElement;
  #stage!: HTMLElement;
  #playButton!: HTMLButtonElement;
  #skipButton!: HTMLButtonElement;
  #liveRegion!: HTMLElement;
  #menu!: SettingsMenu;
  #fullscreen!: FullscreenButton;
  #volume!: VolumeControl;
  #pluginControls!: PluginControls;
  #progress!: ProgressBar;
  #loading!: LoadingIndicator;
  #error!: ErrorDisplay;
  #gestures!: VideoGestures;
  #autoHide: AutoHide;
  #poster: Poster | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #panels: HTMLElement[] = [];
  #speed = 1;
  #layout: LayoutId = 'side-by-side';
  #destroyed = false;

  constructor(player: Player, options: ControlBarOptions = {}) {
    this.#player = player;
    this.#root = player.container;
    this.#t = (options.lang || options.strings)
      ? strings.translator(options.lang ?? player.lang, options.strings)
      : player.t;
    this.#autoHide = new AutoHide(this.#root, options.hideAfterMs ?? 2500,
      () => !this.#player.paused && !this.#menu.isOpen);

    if (options.injectStyles !== false) injectStyles(this.#root.ownerDocument);
    this.#build(options.label);
    this.#connect();
    this.#render();
    if (options.poster !== false) this.#poster = new Poster(player);

    // Last: a plugin may add controls as soon as it hears of the UI.
    player.setUi(this);
  }

  get element(): HTMLElement {
    return this.#bar;
  }

  get settings(): SettingsMenu {
    return this.#menu;
  }

  #build(label?: string): void {
    const doc = this.#root.ownerDocument;
    this.#root.classList.add('np');
    // A named region for landmark navigation; tabindex so shortcuts reach it
    // (WebKit does not tab to buttons, see docs/browser-quirks.md#webkit-tab).
    this.#root.setAttribute('role', 'region');
    this.#root.setAttribute('aria-label', label ?? this.#t('ui.region'));
    if (!this.#root.hasAttribute('tabindex')) this.#root.tabIndex = 0;

    this.#stage = doc.createElement('div');
    this.#stage.className = 'np__stage';
    this.#root.appendChild(this.#stage);
    this.#collectStreams();

    this.#liveRegion = doc.createElement('div');
    this.#liveRegion.className = 'np__sr';
    this.#liveRegion.setAttribute('role', 'status');
    this.#liveRegion.setAttribute('aria-live', 'polite');
    this.#liveRegion.setAttribute('aria-label', this.#t('ui.status.region'));
    this.#root.appendChild(this.#liveRegion);

    this.#loading = new LoadingIndicator(doc, this.#player);
    this.#error = new ErrorDisplay(doc, this.#player, this.#t, (e) => this.#errorText(e));
    this.#root.append(this.#loading.element, this.#error.element);

    this.#bar = doc.createElement('div');
    this.#bar.className = 'np__bar';
    this.#progress = new ProgressBar(doc, this.#player, this.#t, () => this.#wake());
    this.#playButton = createButton(doc, this.#t('ui.play'), ICONS.play);
    this.#volume = new VolumeControl(doc, this.#player, this.#t);
    this.#fullscreen = new FullscreenButton(this.#root, this.#player, this.#t);

    const spacer = doc.createElement('span');
    spacer.className = 'np__spacer';
    const row = doc.createElement('div');
    row.className = 'np__row';
    row.append(this.#playButton, this.#volume.element, this.#progress.time,
      this.#progress.segment, spacer);
    this.#pluginControls = new PluginControls(doc, () => this.#menu, this.#t);
    row.append(this.#pluginControls.element);
    this.#menu = new SettingsMenu(row, this.#t);
    row.append(this.#fullscreen.element);
    this.#bar.append(this.#progress.row, row);

    // Before the bar in the DOM, so Tab reaches it first during the intro.
    this.#skipButton = doc.createElement('button');
    this.#skipButton.type = 'button';
    this.#skipButton.className = 'np__skip';
    this.#skipButton.hidden = true;
    this.#skipButton.setAttribute('aria-label', this.#t('ui.chain.skip'));
    const skipText = doc.createElement('span');
    skipText.textContent = this.#t('ui.chain.skip');
    this.#skipButton.append(skipText);
    this.#skipButton.insertAdjacentHTML('beforeend', ICONS.skip);
    this.#root.appendChild(this.#skipButton);

    this.#root.appendChild(this.#bar);
    this.#addOwnPanels();
  }

  addBarControl(control: BarControlDecl): () => void {
    return this.#pluginControls.add(control);
  }

  addSettingsPanel(panel: SettingsPanelDecl): () => void {
    return this.#menu.addPanel(panel);
  }

  addTimelineMarkers(decl: TimelineMarkersDecl): () => void {
    return this.#progress.setMarkers(decl.id, decl.markers);
  }

  addTimelinePreview(decl: TimelinePreviewDecl): () => void {
    return this.#progress.setPreview(decl);
  }

  /**
   * A layer over the video as wide as the player. Browsers draw native
   * captions inside `<video>`, which squeezes them in side-by-side layouts
   * (see docs/browser-quirks.md#native-captions-in-video).
   */
  addOverlay(decl: OverlayDecl): OverlayHandle {
    const el = this.#root.ownerDocument.createElement('div');
    el.className = `np__overlay np__overlay--${decl.position ?? 'fill'}`;
    el.dataset['overlay'] = decl.id;
    this.#root.insertBefore(el, this.#bar);
    return { element: el, remove: () => el.remove() };
  }

  /**
   * After the player in the DOM, and after earlier panels, so reading order
   * puts it below the video. Shown by a toggle button in the bar; focus stays
   * on the button, as with any toggle.
   */
  addPanel(decl: PanelDecl): PanelHandle {
    const section = this.#root.ownerDocument.createElement('section');
    section.className = 'np-panel';
    section.dataset['panel'] = decl.id;
    section.setAttribute('aria-label', decl.label);
    section.hidden = !decl.open;
    (this.#panels[this.#panels.length - 1] ?? this.#root).after(section);
    this.#panels.push(section);

    const removeButton = this.#pluginControls.add({
      id: `panel-${decl.id}`,
      icon: decl.icon,
      label: decl.label,
      priority: 35,
      pressed: () => !section.hidden,
      onActivate: () => {
        section.hidden = !section.hidden;
        if (!section.hidden) decl.onOpen?.();
      },
    });
    // Next turn: the plugin does not hold the handle yet.
    if (decl.open && decl.onOpen) queueMicrotask(decl.onOpen);

    return {
      element: section,
      get isOpen() { return !section.hidden; },
      remove: () => {
        removeButton();
        section.remove();
        this.#panels = this.#panels.filter((p) => p !== section);
      },
    };
  }

  refresh(): void {
    this.#pluginControls.render();
  }

  /** Registered through the same slot plugins use: if the UI needed a shortcut, the API would be wrong. */
  #addOwnPanels(): void {
    this.#menu.addPanel({
      id: 'speed',
      label: this.#t('ui.speed'),
      priority: 10,
      options: SPEEDS.map((v) => ({
        value: String(v),
        label: v === 1 ? this.#t('ui.normal') : `${v}×`,
      })),
      getValue: () => String(this.#speed),
      onSelect: (v) => {
        this.#speed = Number(v);
        this.#player.setPlaybackRate(this.#speed);
      },
    });

    const addLayouts = () => {
      const layouts = layoutsFor(this.#player.manifest?.streams.length ?? 1, this.#t);
      if (layouts.length > 0) this.#addLayoutPanel(layouts);
    };
    if (this.#player.manifest) addLayouts();
    else this.#listeners.add(this.#player.on('manifest:resolve:ok', addLayouts));
  }

  #addLayoutPanel(layouts: LayoutDef[]): void {
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
   * Moves the player's stream boxes into the stage, intro and outro last: they
   * share a z-index with picture-in-picture, and the later one in the DOM wins.
   */
  #collectStreams(): void {
    const children = [...this.#root.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
    for (const c of children) if (c.dataset['stream']) this.#stage.appendChild(c);
    for (const c of children) if (c.dataset['bumper']) this.#stage.appendChild(c);
  }

  /**
   * What the viewer hears when something fails: derived from the code, never
   * from `error.message`, which is English diagnostics for integrators.
   */
  #errorText(error: PlayerError): string {
    const key = `ui.error.${error.code}`;
    const text = this.#t(key);
    return text === key ? this.#t('ui.error.generic') : text;
  }

  #connect(): void {
    const p = this.#player;
    const l = this.#listeners;

    l.on(this.#playButton, 'click', () => this.#togglePlay());
    l.on(this.#skipButton, 'click', () => this.#skipIntro());

    l.add(p.on('engine:attach:ok', () => {
      this.#collectStreams();
      this.#render();
    }));
    const notices = new LiveNotices({
      root: this.#root, stage: this.#stage, player: p, t: this.#t,
      announce: (m) => this.#announce(m),
      collectStreams: () => this.#collectStreams(),
    });
    l.add(p.on('live:status', ({ stream, status }) => {
      notices.update(stream, status);
      this.#progress.render();
    }));
    l.add(p.on('state:change', () => this.#render()));
    l.add(p.on('time', () => this.#progress.render()));
    l.add(p.on('play', () => {
      this.#announce(this.#t(p.phase === 'intro' ? 'ui.chain.intro' : 'ui.status.playing'));
      this.#render();
    }));
    l.add(p.on('chain:phase', ({ to, skipped }) => {
      this.#progress.resetBumperTime();
      if (to === 'outro') this.#announce(this.#t('ui.chain.outro'));
      else if (skipped) this.#announce(this.#t('ui.chain.skipped'));
      this.#render();
    }));
    l.add(p.on('chain:time', ({ current, duration }) => this.#progress.setBumperTime(current, duration)));
    l.add(p.on('pause', () => { this.#announce(this.#t('ui.status.paused')); this.#render(); }));
    l.add(p.on('ended', () => { this.#announce(this.#t('ui.status.ended')); this.#render(); }));
    l.add(p.on('stall:start', () => this.#announce(this.#t('ui.status.buffering'))));
    l.add(p.on('error', ({ error }) => this.#announce(this.#errorText(error))));

    const shortcuts = new KeyboardShortcuts(p, {
      togglePlay: () => this.#togglePlay(),
      toggleMute: () => this.#volume.toggleMute(),
      stepVolume: (direction) => this.#volume.step(direction),
      toggleFullscreen: () => this.#fullscreen.toggle(),
      isMenuOpen: () => this.#menu.isOpen,
      used: () => this.#wake(),
    });
    l.on(this.#root, 'keydown', (ev: KeyboardEvent) => shortcuts.handle(ev));

    this.#gestures = new VideoGestures(this.#stage, this.#root, p, {
      togglePlay: () => this.#togglePlay(),
      toggleFullscreen: () => this.#fullscreen.toggle(),
      toggleControls: () => {
        if (this.#root.classList.contains('np--inactive')) this.#wake();
        else this.#autoHide.sleep();
      },
      isMenuOpen: () => this.#menu.isOpen,
    });
    // Touch has no hover: a finger lifting fires `pointerleave`, and hiding
    // there undid the tap that toggles them (test: "taps show and hide the controls").
    l.on(this.#root, 'pointermove', (ev: PointerEvent) => {
      if (ev.pointerType !== 'touch') this.#wake();
    });
    l.on(this.#root, 'pointerleave', (ev: PointerEvent) => {
      if (ev.pointerType !== 'touch') this.#autoHide.sleep();
    });
    // A tap or click focuses the player itself; showing the controls then
    // undid the tap that toggles them. Only keyboard focus there wakes them.
    l.on(this.#root, 'focusin', (ev: FocusEvent) => {
      if (ev.target !== this.#root || this.#root.matches(':focus-visible')) this.#wake();
    });

    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(() => this.#pluginControls.render());
      this.#resizeObserver.observe(this.#root);
    }

    this.#wake();
  }

  #togglePlay(): void {
    if (this.#player.paused) void this.#player.play().catch(() => {});
    else this.#player.pause();
  }

  #skipIntro(): void {
    // The button is about to hide: keep focus in the player instead of dropping
    // it to <body> (test: "clicking it skips, hides it and keeps focus in the player").
    if (this.#root.ownerDocument.activeElement === this.#skipButton) this.#root.focus();
    this.#player.skipIntro();
  }

  #render(): void {
    const p = this.#player;
    const playing = !p.paused && p.state === 'active';
    this.#playButton.innerHTML = playing ? ICONS.pause : ICONS.play;
    this.#playButton.setAttribute('aria-label', playing ? this.#t('ui.pause') : this.#t('ui.play'));
    this.#progress.render();
    this.#fullscreen.render();
    this.#skipButton.hidden = !(hasEngine(p.state) && p.canSkip);
    if (playing) this.#autoHide.schedule();
    else this.#wake();
  }

  #announce(message: string): void {
    this.#liveRegion.textContent = message;
  }

  #wake(): void {
    this.#autoHide.wake(!this.#player.paused);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#autoHide.destroy();
    this.#listeners.removeAll();
    this.#poster?.destroy();
    this.#poster = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#player.setUi(null);
    this.#menu.destroy();
    this.#volume.destroy();
    this.#fullscreen.destroy();
    this.#progress.destroy();
    this.#loading.destroy();
    this.#error.destroy();
    this.#gestures.destroy();
    for (const panel of this.#panels) panel.remove();
    this.#panels = [];
    this.#bar.remove();
    this.#skipButton.remove();
    this.#liveRegion.remove();
    this.#root.classList.remove('np');
    this.#root.removeAttribute('role');
    this.#root.removeAttribute('aria-label');
  }
}

export function attachControls(player: Player, options?: ControlBarOptions): ControlBar {
  return new ControlBar(player, options);
}
