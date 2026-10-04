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
import type { PlayerError } from './errors.js';
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
  /**
   * Start playing on creation, which gives up the lazy lifecycle: the media
   * downloads at once. Browsers block autoplay with sound until the viewer
   * interacts with the site, so:
   *
   * - `true` tries with sound; refused, the play button stays.
   * - `'muted'` starts muted, which browsers allow.
   * - `'any'` tries with sound and, refused, retries muted.
   */
  autoplay?: boolean | 'muted' | 'any';
  /** Start over at the end. The intro is not replayed: it introduces, once. */
  loop?: boolean;
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

  if (config.loop) {
    player.on('ended', () => {
      player.seek(0);
      void player.play().catch(() => {});
    });
  }

  if (config.autoplay) void autoplay(player, config.autoplay);

  return player;
}

/** A refusal already travels on the bus as `media/blocked`; the UI shows play again. */
async function autoplay(player: Player, mode: true | 'muted' | 'any'): Promise<void> {
  if (mode === 'muted') player.setMuted(true);
  try {
    await player.play();
  } catch (error) {
    if (mode !== 'any' || (error as Partial<PlayerError>).code !== 'media/blocked') return;
    player.setMuted(true);
    await player.play().catch(() => {});
  }
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
