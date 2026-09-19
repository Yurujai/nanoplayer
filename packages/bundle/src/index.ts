/**
 * El reproductor entero en un solo fichero, con pilas incluidas.
 *
 * Existe por el objetivo O5: instalar con una etiqueta `<script>` y tres
 * líneas. Los paquetes sueltos no sirven para eso —`@nanoplayer/ui` solo se
 * construye como ESM, y una etiqueta clásica no puede cargarlo—, así que quien
 * pegaba la etiqueta obtenía un reproductor **sin un solo control**.
 *
 * ```html
 * <div id="player"></div>
 * <script src="nanoplayer.min.js"></script>
 * <script>
 *   NanoPlayer.create('#player', { manifest: '/api/video/123' });
 * </script>
 * ```
 *
 * La diferencia con `create()` del núcleo es que **aquí los controles vienen
 * puestos**. El núcleo es deliberadamente *headless* porque hay quien quiere su
 * propia interfaz; este paquete es para quien no.
 *
 * > **Una cosa o la otra, no las dos.** Este bundle lleva el núcleo dentro. Si
 * > en la misma página se carga además `@nanoplayer/core` por su cuenta, habrá
 * > dos registros de plugins y dos políticas de reproducción exclusiva, y
 * > ninguno de los dos verá al otro.
 */
import {
  create as crearNucleo, plugins, registry, Player, PlayerRegistry, PluginRegistry,
  VERSION, type CreateConfig,
} from '@nanoplayer/core';
import { attachControls, type ControlBarOptions } from '@nanoplayer/ui';
// Importarlo basta: se auto-registra y aporta sus cadenas al catálogo.
import '@nanoplayer/plugin-captions';

export interface Config extends CreateConfig {
  /**
   * Barra de controles. Puesta por defecto, que es el sentido de este paquete.
   *
   * `false` la deja fuera —para montar una propia— y un objeto la configura.
   */
  controls?: boolean | ControlBarOptions;
}

/**
 * Crea un reproductor **con controles**.
 *
 * Sigue sin descargar nada: el ciclo perezoso del núcleo no cambia porque la
 * interfaz esté montada. Con el póster a la vista no hay ningún `<video>` en el
 * DOM ni un byte de vídeo pedido.
 */
export function create(target: string | HTMLElement, config: Config): Player {
  const player = crearNucleo(target, config);
  if (config.controls !== false) {
    attachControls(player, typeof config.controls === 'object' ? config.controls : {});
  }
  return player;
}

/**
 * Superficie global para el caso `<script>`.
 *
 * Se redefine en vez de reexportar la del núcleo porque su `create` es el
 * *headless*: en este paquete, `NanoPlayer.create` tiene que ser el que trae
 * los controles puestos.
 */
export const NanoPlayer = {
  VERSION,
  create,
  attachControls,
  registry,
  plugins,
  Player,
  PlayerRegistry,
  PluginRegistry,
} as const;

/*
 * Todo lo demás del núcleo y de la interfaz.
 *
 * Reexportado a mano y NO con `export *`. La especificación dice que un export
 * explícito gana a uno de estrella con el mismo nombre, y de eso dependía que
 * `create` fuera el de aquí y no el headless del núcleo.
 *
 * El problema es que **las herramientas no se ponen de acuerdo**: Rollup lo
 * implementa bien y el bundle construido salía correcto, pero la
 * transformación de Vitest devuelve el del `export *`, así que los tests de
 * este paquete fallaban contra un artefacto que estaba bien. Con la promesa
 * principal en juego, no compensa apoyarse en ese rincón de la norma ni fiar a
 * que cada herramienta lo resuelva igual.
 *
 * De paso, una lista explícita deja ver de un vistazo qué tiene la global.
 *
 * `create` y `NanoPlayer` se quedan fuera a propósito: son los de arriba.
 */
export {
  // manifiesto
  isAudioOnly, isAudioOnlyManifest, masterStream, parseManifest, slaveStreams,
  trimOf, validateManifest,
  // textos
  IDIOMA_BASE, StringRegistry, strings,
  // errores y eventos
  playerError, EventBus,
  // ciclo de vida
  Lifecycle, assertTransition, canTransition, TRANSITIONS, WITH_ENGINE, WITH_MANIFEST,
  // motores
  confidenceFor, selectEngine, NativeEngine, nativeEngineFactory,
  // sincronización
  defaultScheduler, detectProfile, SYNC_PROFILES, Synchronizer,
  // reproductor y registro
  createPlayer, createBatchResolver,
  // directo
  backoff, LiveTracker,
  // plugins
  topoSort,
} from '@nanoplayer/core';

export type {
  Annotation, ChapterAnnotation, InteractiveAnnotation, Manifest, Source, Stream,
  StreamRole, TextTrackDef, TrimAnnotation, ValidationIssue, ValidationResult,
  Catalogue, Catalogues, Translate, ErrorCode, PlayerError,
  AnyListener, Empty, EventBusOptions, EventMap, Listener, ListenerErrorInfo,
  Unsubscribe, CoreEvents, PlayerState,
  AttachOptions, Confidence, EngineCallbacks, EngineFactory, MediaEngine,
  Scheduler, SyncAction, SyncProfile, SyncProfileName, SyncSample, SynchronizerOptions,
  ManifestResolver, PlayerOptions, BatchResolverOptions, RegistryOptions,
  LiveStatus, RetryPolicy,
  BarControlDecl, OverlayDecl, OverlayHandle, SettingsOptionDecl, SettingsPanelDecl,
  UiSlots, ActivationResult, PluginConfig, PluginContext, PluginImpl, PluginManifest,
  CreateConfig,
} from '@nanoplayer/core';

export {
  ControlBar, Poster, SettingsMenu, applyLayout, layoutsFor,
  formatPercent, formatTime, spokenTime, CSS, injectStyles, ICONS,
} from '@nanoplayer/ui';

export type {
  ControlBarOptions, SettingsOption, SettingsPanel, LayoutDef, LayoutId,
} from '@nanoplayer/ui';

// `Player`, `PlayerRegistry`, `PluginRegistry`, `plugins`, `registry`, `VERSION`
// y `attachControls` ya están importados arriba para componer `NanoPlayer`; se
// reexportan desde ahí para no traerlos dos veces.
export {
  Player, PlayerRegistry, PluginRegistry, plugins, registry, VERSION, attachControls,
};
