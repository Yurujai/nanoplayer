/**
 * Punto de entrada público.
 *
 * Diseñado para que el caso sencillo sea de verdad sencillo:
 *
 * ```html
 * <div id="player"></div>
 * <script src="nanoplayer.js"></script>
 * <script>
 *   NanoPlayer.create('#player', { manifest: '/api/video/123' });
 * </script>
 * ```
 *
 * Y para que lo que hace bien lo haga **sin pedir permiso**. Un reproductor
 * creado así ya entra en el registro compartido de la página, así que la
 * reproducción exclusiva y el presupuesto de recursos funcionan sin escribir
 * una línea de configuración. Que el comportamiento correcto sea el de por
 * defecto es justamente la diferencia entre esto y tener que envolverlo en
 * JavaScript propio.
 */
import type { EngineFactory } from './engine.js';
import type { Manifest } from './manifest.js';
import { Player, type ManifestResolver, type PlayerOptions } from './player.js';
import { PluginRegistry, plugins, type PluginConfig } from './plugins.js';
import { PlayerRegistry } from './registry.js';
import type { SyncProfile } from './sync.js';

/** Debe coincidir con la versión de package.json (hay un test que lo vigila). */
export const VERSION = '0.0.0';

export interface CreateConfig {
  /** Manifiesto ya cargado, o una URL de la que traerlo. */
  manifest: Manifest | Record<string, unknown> | string;
  /**
   * Qué plugins se activan. `false` apaga uno que vendría activo por defecto;
   * un objeto lo enciende con configuración.
   *
   * Lo habitual es no escribir nada: los plugins que declaran su condición se
   * activan solos según lo que traiga el manifiesto.
   */
  plugins?: Record<string, PluginConfig>;
  engines?: readonly EngineFactory[];
  manifestResolver?: ManifestResolver;
  muted?: boolean;
  volume?: number;
  syncProfile?: SyncProfile;
  /**
   * Registro con el que coordinarse. Por defecto, el compartido de la página.
   * `false` deja el reproductor aislado.
   */
  registry?: PlayerRegistry | false;
  /** Empezar a reproducir en cuanto se pueda. Sujeto a la política del navegador. */
  autoplay?: boolean;
}

/**
 * Registro compartido de la página.
 *
 * Existe para que la coordinación entre instancias sea el comportamiento por
 * defecto. Sin presupuesto configurado —desalojar por sorpresa sería una
 * sorpresa desagradable— pero con reproducción exclusiva, que es lo que casi
 * todo el mundo espera y casi nadie implementa.
 */
export const registry = new PlayerRegistry({ exclusive: true });

function resolverElemento(target: string | HTMLElement): HTMLElement {
  if (typeof target !== 'string') return target;
  const el = document.querySelector<HTMLElement>(target);
  if (!el) throw new Error(`No se encontró ningún elemento para "${target}"`);
  return el;
}

/**
 * Crea un reproductor.
 *
 * **No descarga nada.** Ni el manifiesto: hasta que no se llama a `resolve()`,
 * `attach()` o `play()`, la red se queda quieta. Una página con 32 llamadas a
 * `create()` hace cero peticiones.
 */
export function create(
  target: string | HTMLElement,
  config: CreateConfig,
): Player {
  const container = resolverElemento(target);

  const opciones: PlayerOptions = {
    container,
    manifest: config.manifest,
    ...(config.engines ? { engines: config.engines } : {}),
    ...(config.manifestResolver ? { manifestResolver: config.manifestResolver } : {}),
    ...(config.muted !== undefined ? { muted: config.muted } : {}),
    ...(config.volume !== undefined ? { volume: config.volume } : {}),
    ...(config.syncProfile ? { syncProfile: config.syncProfile } : {}),
  };

  const player = new Player(opciones);

  const reg = config.registry === false ? null : (config.registry ?? registry);
  reg?.register(player);

  // Los plugins se activan cuando hay manifiesto, porque su condición depende
  // de él: subtítulos si hay pistas, H5P si hay anotaciones de ese tipo.
  player.on('manifest:resolve:ok', ({ manifest }) => {
    void plugins.activate(player, config.plugins ?? {}, manifest);
  });

  if (config.autoplay) {
    void player.play().catch(() => {
      // El bloqueo por política de autoplay ya viaja por el bus como
      // `media/blocked`; aquí solo se evita la promesa sin capturar.
    });
  }

  return player;
}

/**
 * Superficie global para el caso `<script>`.
 *
 * Sin `export default`: mezclarlo con los nombrados obliga al consumidor del
 * bundle IIFE a escribir `NanoPlayer.default.create(...)`, que es exactamente
 * la clase de fricción que este punto de entrada existe para evitar.
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

// Reexportados como nombrados para que en el bundle IIFE la global los tenga
// en el primer nivel: `NanoPlayer.plugins`, no `NanoPlayer.NanoPlayer.plugins`.
export { plugins, Player, PlayerRegistry, PluginRegistry };
