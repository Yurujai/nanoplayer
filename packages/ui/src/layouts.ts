/**
 * How the streams are laid out. Purely visual, so it lives in the UI: CSS does
 * the work from the `data-role` the player puts on each stream box.
 */
import type { Translate } from '@nanoplayer/core';

export type LayoutId = 'side-by-side' | 'presenter' | 'presentation' | 'pip';

export interface LayoutDef {
  id: LayoutId;
  label: string;
}

/** Every layout arranges two streams: with one there is nothing to choose. */
const MIN_STREAMS = 2;

export function layoutsFor(streamCount: number, t: Translate): LayoutDef[] {
  if (streamCount < MIN_STREAMS) return [];
  return (['side-by-side', 'pip', 'presenter', 'presentation'] as const)
    .map((id) => ({ id, label: t(`ui.layout.${id}`) }));
}

const LAYOUT_CLASSES: readonly string[] = [
  'np--layout-side-by-side', 'np--layout-presenter',
  'np--layout-presentation', 'np--layout-pip',
];

export function applyLayout(root: HTMLElement, layout: LayoutId): void {
  root.classList.remove(...LAYOUT_CLASSES);
  root.classList.add(`np--layout-${layout}`);
}
