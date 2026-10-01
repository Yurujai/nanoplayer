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

export interface OverlayDecl {
  id: string;
  /**
   * - `captions` — bottom band, above the control bar
   * - `center`   — centred
   * - `fill`     — the whole player
   */
  position?: 'captions' | 'center' | 'fill';
}

export interface OverlayHandle {
  /** A node the plugin may fill freely. */
  element: HTMLElement;
  remove(): void;
}

/** What the UI offers plugins. Every method returns how to undo what it added. */
export interface UiSlots {
  addBarControl(control: BarControlDecl): () => void;
  addSettingsPanel(panel: SettingsPanelDecl): () => void;
  /** Named segments on the progress bar; the UI builds marks and announcements. */
  addTimelineMarkers(decl: TimelineMarkersDecl): () => void;
  /**
   * Reserves a layer over the video. Unlike `bar` and `settings`, this hands out
   * DOM: a layer is **content** (a caption, an activity), not interactive
   * controls, which must stay under the UI's control.
   */
  addOverlay(decl: OverlayDecl): OverlayHandle;
  /** Repaints after a control's state changes. */
  refresh(): void;
}
