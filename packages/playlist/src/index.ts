/**
 * Playlists: several lectures in a row, with previous, next and a list to pick
 * from, and the next one starting when one ends.
 *
 * A controller, not a plugin: a player belongs to one manifest (its plugins,
 * layouts and lifecycle are built from it), so each item gets a fresh player
 * in the same container and the previous one is destroyed.
 *
 *   const list = createPlaylist('#player', {
 *     items: ['/api/video/1', '/api/video/2'],
 *     create: (el, manifest) => { const p = create(el, { manifest }); attachControls(p); return p; },
 *   });
 */
import { strings, type Manifest, type Player, type UiSlots } from '@nanoplayer/core';

strings.register('es', {
  'playlist.label': 'Lista de reproducción',
  'playlist.next': 'Siguiente vídeo',
  'playlist.previous': 'Vídeo anterior',
  'playlist.item': 'Vídeo {n}',
});
strings.register('en', {
  'playlist.label': 'Playlist',
  'playlist.next': 'Next video',
  'playlist.previous': 'Previous video',
  'playlist.item': 'Video {n}',
});

type ManifestSource = Manifest | Record<string, unknown> | string;

/** A manifest or its URL, with a title for the list when the manifest is not loaded yet. */
export type PlaylistItem = ManifestSource | { manifest: ManifestSource; title?: string };

export interface PlaylistOptions {
  items: readonly PlaylistItem[];
  /** Builds each item's player: with controls, so previous and next have a bar to go in. */
  create: (container: HTMLElement, manifest: ManifestSource) => Player;
  /** Index to start on. */
  start?: number;
  /** Start the next one when one ends. On by default. */
  autoAdvance?: boolean;
  /** After the last, the first. */
  loop?: boolean;
}

const icon = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const ICON_NEXT = icon('M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z');
const ICON_PREVIOUS = icon('M6 6h2v12H6zm3.5 6 8.5 6V6z');

function isWrapped(item: PlaylistItem): item is { manifest: ManifestSource; title?: string } {
  return typeof item === 'object' && item !== null && 'manifest' in item;
}

export class Playlist {
  readonly #container: HTMLElement;
  readonly #options: PlaylistOptions;
  #index = -1;
  #player: Player | null = null;
  #listeners = new Set<(index: number) => void>();

  constructor(container: HTMLElement, options: PlaylistOptions) {
    if (options.items.length === 0) throw new Error('A playlist needs at least one item');
    this.#container = container;
    this.#options = options;
    this.#show(Math.min(options.items.length - 1, Math.max(0, options.start ?? 0)), false);
  }

  get player(): Player {
    return this.#player!;
  }

  get index(): number {
    return this.#index;
  }

  get length(): number {
    return this.#options.items.length;
  }

  get hasNext(): boolean {
    return this.#index < this.length - 1 || !!this.#options.loop;
  }

  get hasPrevious(): boolean {
    return this.#index > 0 || !!this.#options.loop;
  }

  next(): void {
    if (this.hasNext) this.#show((this.#index + 1) % this.length, true);
  }

  previous(): void {
    if (this.hasPrevious) this.#show((this.#index - 1 + this.length) % this.length, true);
  }

  /** Jumps to an item and plays it: whoever picks one wants to watch it. */
  go(index: number): void {
    if (index >= 0 && index < this.length && index !== this.#index) this.#show(index, true);
  }

  /** Called with the new index on every change. */
  onChange(listener: (index: number) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  destroy(): void {
    this.#player?.destroy();
    this.#player = null;
    this.#listeners.clear();
  }

  /** The title for the list: the manifest's, the item's, or its number. */
  title(index: number, t: (key: string, vars?: Record<string, string | number>) => string): string {
    const item = this.#options.items[index]!;
    if (index === this.#index && this.#player?.manifest?.title) return this.#player.manifest.title;
    if (isWrapped(item) && item.title) return item.title;
    const manifest = isWrapped(item) ? item.manifest : item;
    if (typeof manifest === 'object' && typeof manifest['title'] === 'string') return manifest['title'];
    return t('playlist.item', { n: index + 1 });
  }

  #show(index: number, play: boolean): void {
    // The bar the viewer was using is about to go: keep their place in the new one.
    const hadFocus = this.#container.contains(this.#container.ownerDocument.activeElement);
    this.#player?.destroy();
    this.#index = index;
    const item = this.#options.items[index]!;
    const player = this.#options.create(this.#container, isWrapped(item) ? item.manifest : item);
    this.#player = player;

    if (this.#options.autoAdvance !== false) {
      player.on('ended', () => { if (this.#player === player && this.hasNext) this.next(); });
    }
    if (player.ui) this.#addControls(player, player.ui);
    if (hadFocus) {
      const next = this.#container.querySelector<HTMLElement>('[data-control="playlist-next"]');
      (next ?? this.#container).focus();
    }
    if (play) void player.play().catch(() => {});
    for (const listener of this.#listeners) listener(index);
  }

  #addControls(player: Player, ui: UiSlots): void {
    const t = player.t;
    ui.addBarControl({
      id: 'playlist-previous',
      priority: 1,
      icon: ICON_PREVIOUS,
      label: t('playlist.previous'),
      available: () => this.hasPrevious,
      onActivate: () => this.previous(),
    });
    ui.addBarControl({
      id: 'playlist-next',
      priority: 2,
      icon: ICON_NEXT,
      label: t('playlist.next'),
      available: () => this.hasNext,
      onActivate: () => this.next(),
    });
    const playlist = this;
    ui.addSettingsPanel({
      id: 'playlist',
      label: t('playlist.label'),
      priority: 3,
      // A getter: the current item's title arrives with its manifest.
      get options() {
        return Array.from({ length: playlist.length }, (_, i) => ({
          value: String(i), label: `${i + 1}. ${playlist.title(i, t)}`,
        }));
      },
      getValue: () => String(this.#index),
      onSelect: (value) => this.go(Number(value)),
    });
  }
}

function resolveElement(target: string | HTMLElement): HTMLElement {
  if (typeof target !== 'string') return target;
  const el = document.querySelector<HTMLElement>(target);
  if (!el) throw new Error(`No element found for "${target}"`);
  return el;
}

export function createPlaylist(target: string | HTMLElement, options: PlaylistOptions): Playlist {
  return new Playlist(resolveElement(target), options);
}
