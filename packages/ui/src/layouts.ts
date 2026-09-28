/**
 * Disposición de los streams.
 *
 * Vive aquí y no en el núcleo porque es puramente visual: el núcleo sabe qué
 * streams hay y qué papel cumple cada uno, y la interfaz decide cómo colocarlos.
 *
 * De momento se resuelve entero con CSS, apoyándose en el `data-role` que el
 * `Player` pone en cada caja. En la Fase 3 esto pasará a ser un plugin del
 * anclaje `settings`, y esta función será su implementación.
 *
 * Nota para móvil: S2 midió que en iPhone **no existe** el fullscreen de
 * contenedor, así que a pantalla completa solo cabe un stream. El degradado
 * usará estos mismos layouts, forzando `presenter` o `presentation`.
 */

import type { Translate } from '@nanoplayer/core';

export type LayoutId = 'side-by-side' | 'presenter' | 'presentation' | 'pip';

export interface LayoutDef {
  id: LayoutId;
  label: string;
}

/** Todas las disposiciones reparten dos flujos: con uno no hay nada que elegir. */
const FLUJOS_MINIMOS = 2;

/**
 * Los layouts que tienen sentido con ese número de flujos, ya etiquetados.
 *
 * Recibe el traductor en vez del idioma: así no hay una segunda forma de
 * resolver el catálogo conviviendo con la del reproductor.
 */
export function layoutsFor(streamCount: number, t: Translate): LayoutDef[] {
  if (streamCount < FLUJOS_MINIMOS) return [];
  return (['side-by-side', 'pip', 'presenter', 'presentation'] as const)
    .map((id) => ({ id, label: t(`ui.layout.${id}`) }));
}

const CLASES: readonly string[] = [
  'np--layout-side-by-side', 'np--layout-presenter',
  'np--layout-presentation', 'np--layout-pip',
];

export function applyLayout(root: HTMLElement, layout: LayoutId): void {
  root.classList.remove(...CLASES);
  root.classList.add(`np--layout-${layout}`);
}
