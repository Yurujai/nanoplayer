/**
 * The drawing rules of the player's icons, shared so a plugin's icon matches
 * the bar's without copying numbers. Filled shapes with rounded corners and
 * details in a thick round stroke: over video, with light and changing
 * frames, a filled icon reads where a thin outline gets lost. Toggles show
 * their state by form, not colour: `solid` when on, `outline` when off.
 *
 * No masks: they need ids, and several players on a page would repeat them.
 * A shape with holes is drawn already rounded and cut with `cut`.
 */
export const icon = {
  /** The `<svg>`, hidden from screen readers: the button's label names it. */
  svg: (...parts: string[]): string =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${parts.join('')}</svg>`,
  /** An area; a stroke in the same colour rounds its corners. */
  solid: (d: string): string =>
    `<path d="${d}" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  /** A detail drawn as a line. */
  line: (d: string): string =>
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`,
  /** The same shape as `solid`, for a toggle that is off. */
  outline: (d: string): string =>
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  /** A pre-rounded shape with holes, cut with `evenodd`. */
  cut: (d: string): string => `<path d="${d}" fill="currentColor" fill-rule="evenodd"/>`,
} as const;
