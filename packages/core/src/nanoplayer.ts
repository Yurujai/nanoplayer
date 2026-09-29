/**
 * Public entry point, so the simple case is simple:
 *
 * ```html
 * <div id="player"></div>
 * <script src="nanoplayer.min.js"></script>
 * <script>
 *   NanoPlayer.create('#player', { manifest: '/api/video/123' });
 * </script>
 * ```
 *
 * A player created this way joins the page's shared registry, so exclusive
 * playback works without configuration.
 */
import type { EngineFactory } from './engine.js';
import type { Catalogues } from './i18n.js';
import type { Manifest } from './manifest.js';
import { Player, type ManifestResolver, type PlayerOptions } from './player.js';
import { PluginRegistry, plugins, type PluginConfig } from './plugins.js';
import { PlayerRegistry } from './registry.js';
import type { SyncProfile } from './sync.js';

/** Must match package.json (a test checks it). */
export const VERSION = '0.0.0';

export interface CreateConfig {
  /** A loaded manifest, or a URL to fetch it from. */
  manifest: Manifest | Record<string, unknown> | string;
  /**
   * Which plugins to activate. `false` turns off one that would activate by
   * itself; an object turns it on with configuration. Usually nothing: plugins
   * activate themselves from what the manifest contains.
   */
  plugins?: Record<string, PluginConfig>;
  engines?: readonly EngineFactory[];
  manifestResolver?: ManifestResolver;
  /** Poster image, available without resolving the manifest. */
  poster?: string;
  muted?: boolean;
  volume?: number;
  syncProfile?: SyncProfile;
  /** Registry to coordinate with. The page's shared one by default; `false` isolates the player. */
  registry?: PlayerRegistry | false;
  /** Start playing as soon as possible, subject to the browser's autoplay policy. */
  autoplay?: boolean;
  /** UI language. Defaults to the document's. The bar and plugins inherit it. */
  lang?: string;
  /**
   * Own strings per language, overriding the built-in ones: adding a language
   * or changing a word is configuration, not a fork.
   *
   * ```js
   * create('#p', { manifest, lang: 'eu', strings: {
   *   eu: { 'ui.play': 'Erreproduzitu', 'ui.pause': 'Pausatu' },
   * } });
   * ```
   */
  strings?: Catalogues;
}

/** The page's shared registry: exclusive playback, no resource budget by default. */
export const registry = new PlayerRegistry({ exclusive: true });

function resolveElement(target: string | HTMLElement): HTMLElement {
  if (typeof target !== 'string') return target;
  const el = document.querySelector<HTMLElement>(target);
  if (!el) throw new Error(`No element found for "${target}"`);
  return el;
}

/**
 * Creates a player. **It downloads nothing**, not even the manifest, until
 * `resolve()`, `attach()` or `play()` is called.
 */
export function create(
  target: string | HTMLElement,
  config: CreateConfig,
): Player {
  const container = resolveElement(target);

  const options: PlayerOptions = {
    container,
    manifest: config.manifest,
    ...(config.engines ? { engines: config.engines } : {}),
    ...(config.manifestResolver ? { manifestResolver: config.manifestResolver } : {}),
    ...(config.poster ? { poster: config.poster } : {}),
    ...(config.muted !== undefined ? { muted: config.muted } : {}),
    ...(config.volume !== undefined ? { volume: config.volume } : {}),
    ...(config.syncProfile ? { syncProfile: config.syncProfile } : {}),
    ...(config.lang ? { lang: config.lang } : {}),
    ...(config.strings ? { strings: config.strings } : {}),
  };

  const player = new Player(options);

  const reg = config.registry === false ? null : (config.registry ?? registry);
  reg?.register(player);

  // Plugins activate once there is a manifest: their conditions depend on it.
  player.on('manifest:resolve:ok', ({ manifest }) => {
    void plugins.activate(player, config.plugins ?? {}, manifest);
  });

  if (config.autoplay) {
    // An autoplay block already travels on the bus as `media/blocked`.
    void player.play().catch(() => {});
  }

  return player;
}

/**
 * The global for the `<script>` case. No `export default`: mixing it with named
 * exports would make IIFE users write `NanoPlayer.default.create(...)`.
 */
export const NanoPlayer = {
  VERSION,
  create,
  registry,
  plugins,
  Player,
  PlayerRegistry,
  PluginRegistry,
} as const;

// Named too, so the IIFE global has them at the top level.
export { plugins, Player, PlayerRegistry, PluginRegistry };
