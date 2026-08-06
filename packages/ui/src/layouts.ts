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

export type LayoutId = 'side-by-side' | 'presenter' | 'presentation' | 'pip';

export interface LayoutDef {
  id: LayoutId;
  label: string;
  /** Cuántos streams hacen falta como mínimo. */
  minStreams: number;
}

const ETIQUETAS: Record<string, Record<LayoutId, string>> = {
  es: {
    'side-by-side': 'Lado a lado',
    presenter: 'Solo ponente',
    presentation: 'Solo presentación',
    pip: 'Imagen en imagen',
  },
  en: {
    'side-by-side': 'Side by side',
    presenter: 'Presenter only',
    presentation: 'Presentation only',
    pip: 'Picture in picture',
  },
};

export function layoutsFor(streamCount: number, lang = 'es'): LayoutDef[] {
  const t = ETIQUETAS[lang.slice(0, 2)] ?? ETIQUETAS['es']!;
  const todos: LayoutDef[] = [
    { id: 'side-by-side', label: t['side-by-side'], minStreams: 2 },
    { id: 'pip', label: t.pip, minStreams: 2 },
    { id: 'presenter', label: t.presenter, minStreams: 2 },
    { id: 'presentation', label: t.presentation, minStreams: 2 },
  ];
  return todos.filter((l) => streamCount >= l.minStreams);
}

const CLASES: readonly string[] = [
  'np--layout-side-by-side', 'np--layout-presenter',
  'np--layout-presentation', 'np--layout-pip',
];

export function applyLayout(root: HTMLElement, layout: LayoutId): void {
  root.classList.remove(...CLASES);
  root.classList.add(`np--layout-${layout}`);
}
