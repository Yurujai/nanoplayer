/**
 * UI slots: how a plugin contributes interface. The contract lives in the core
 * and the UI layer implements it, so a plugin depends on `@nanoplayer/core`
 * only. **The plugin declares; the UI builds**: plugins never inject DOM into
 * the bar, or tab order and accessibility guarantees would go with the first
 * third-party plugin.
 *
 * | Slot       | What goes there                              |
 * |------------|----------------------------------------------|
 * | `bar`      | Binary, frequent, with visible state          |
 * | `settings` | A choice among options, occasional            |
 * | `timeline` | Named segments on the progress bar            |
 * | `panel`    | A region beside the video: a transcript       |
 */

export interface BarControlDecl {
  id: string;
  /** Inline SVG. May depend on the current state. */
  icon: string | (() => string);
  /** Accessible name. May depend on the current state. */
  label: string | (() => string);
  onActivate: () => void;
  /** Toggle state: when set, the button exposes `aria-pressed`. */
  pressed?: () => boolean;
  /** Whether the control applies right now: a button that can do nothing is noise. */
  available?: () => boolean;
  /** Lower goes first, and wins when not everything fits: the rest overflows to settings. */
  priority?: number;
}

export interface SettingsOptionDecl {
  value: string;
  label: string;
}

/** A list of options with one ticked. */
export interface SettingsChoiceDecl {
  id: string;
  label: string;
  options: readonly SettingsOptionDecl[];
  getValue: () => string;
  onSelect: (value: string) => void;
  priority?: number;
}

/** Related choices under one entry, so they do not crowd the main menu. */
export interface SettingsGroupDecl {
  id: string;
  label: string;
  panels: readonly SettingsChoiceDecl[];
  /** When set, the group ends with a reset item. */
  onReset?: () => void;
  priority?: number;
}

export type SettingsPanelDecl = SettingsChoiceDecl | SettingsGroupDecl;

/**
 * A named segment on the progress bar: a chapter, an activity. Times are in
 * **media time**, like the manifest annotations; the UI remaps them to the trim.
 */
export interface TimelineMarkerDecl {
  start: number;
  /** Without it, the segment runs to the next one or to the end. */
  end?: number;
  /** Shown and announced: accessible text. */
  label: string;
}

export interface TimelineMarkersDecl {
  id: string;
  markers: readonly TimelineMarkerDecl[];
}

/** A region of an image, in its own pixels; without a size, the whole image. */
export interface TimelineImage {
  url: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** A picture for each point of the bar, shown while hovering it. */
export interface TimelinePreviewDecl {
  id: string;
  /** For a time in **media time**, as markers; `null` while there is none yet. */
  imageAt(mediaTime: number): TimelineImage | null;
}

export interface OverlayDecl {
  id: string;
  /**
   * - `captions` — bottom band, above the control bar
   * - `center`   — centred
   * - `fill`     — the whole player
   */
  position?: 'captions' | 'center' | 'fill';
  /**
   * An activity rather than a layer: it covers the whole player, bar
   * included, and takes clicks. Its owner then answers for its accessibility,
   * focus included, as with a panel.
   */
  interactive?: boolean;
}

export interface OverlayHandle {
  /** A node the plugin may fill freely. */
  element: HTMLElement;
  remove(): void;
}

export interface PanelDecl {
  id: string;
  /** Names both the region and the bar button that shows it. */
  label: string;
  /** Inline SVG for that button; a function gets whether the panel is open, for its toggle state. */
  icon: string | ((open: boolean) => string);
  /** Called on every opening: content can be loaded only when wanted. */
  onOpen?: () => void;
  /** Starts open. Closed by default: it takes room on the page. */
  open?: boolean;
}

export interface PanelHandle {
  /** A node the plugin fills and is responsible for, interactive content included. */
  element: HTMLElement;
  readonly isOpen: boolean;
  remove(): void;
}

/** What the UI offers plugins. Every method returns how to undo what it added. */
export interface UiSlots {
  addBarControl(control: BarControlDecl): () => void;
  addSettingsPanel(panel: SettingsPanelDecl): () => void;
  /** Named segments on the progress bar; the UI builds marks and announcements. */
  addTimelineMarkers(decl: TimelineMarkersDecl): () => void;
  /** Pictures over the hover time of the progress bar. */
  addTimelinePreview(decl: TimelinePreviewDecl): () => void;
  /**
   * Reserves a layer over the video. Unlike `bar` and `settings`, this hands out
   * DOM: a layer is **content** (a caption, a notice), not player controls,
   * which must stay under the UI's control. An `interactive` one is an
   * activity that replaces the video for a while.
   */
  addOverlay(decl: OverlayDecl): OverlayHandle;
  /**
   * A region below the player, shown and hidden by a bar button the UI adds.
   * It is outside the video box, so it can hold what an overlay cannot: text
   * to read at length, and controls of its own.
   */
  addPanel(decl: PanelDecl): PanelHandle;
  /** Repaints after a control's state changes. */
  refresh(): void;
}
