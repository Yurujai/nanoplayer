// --- manifiesto -------------------------------------------------------------
export type {
  Annotation, Bumper, ChapterAnnotation, InteractiveAnnotation, Manifest,
  Source, Stream, StreamRole, TextTrackDef, TrimAnnotation,
} from './manifest.js';
export { parseManifest, validateManifest } from './validate.js';
export {
  isAudioOnly, isAudioOnlyManifest, masterStream, slaveStreams, trimOf,
} from './manifest-queries.js';
export type { ValidationIssue, ValidationResult } from './validate.js';

// --- cabecera y cola --------------------------------------------------------
export { ANTICIPACION_MS, firstFrame } from './chain.js';
export type { BumperPhase, ChainPhase } from './chain.js';

// --- textos -----------------------------------------------------------------
export { IDIOMA_BASE, StringRegistry, strings } from './i18n.js';
export type { Catalogue, Catalogues, Translate } from './i18n.js';

// --- errores ----------------------------------------------------------------
export { playerError } from './errors.js';
export type { ErrorCode, PlayerError } from './errors.js';

// --- eventos ----------------------------------------------------------------
export { EventBus } from './events.js';
export type {
  AnyListener, Empty, EventBusOptions, EventMap, Listener,
  ListenerErrorInfo, Unsubscribe,
} from './events.js';
export type { CoreEvents } from './core-events.js';

// --- ciclo de vida ----------------------------------------------------------
export { Lifecycle } from './lifecycle.js';
export {
  assertTransition, canTransition, hasEngine, TRANSITIONS, WITH_ENGINE, WITH_MANIFEST,
} from './state.js';
export type { PlayerState } from './state.js';

// --- motor ------------------------------------------------------------------
export { confidenceFor, hasMse, isHlsType, selectEngine } from './engine.js';
export type {
  AttachOptions, Confidence, EngineCallbacks, EngineFactory, MediaEngine,
} from './engine.js';
export { MediaElementEngine, mediaElementError } from './media-element-engine.js';
export type { MediaElementEngineOptions } from './media-element-engine.js';
export { NativeEngine, nativeEngineFactory } from './native-engine.js';

// --- sincronización ---------------------------------------------------------
export { defaultScheduler, detectProfile, SYNC_PROFILES, Synchronizer } from './sync.js';
export type {
  Scheduler, SyncAction, SyncProfile, SyncProfileName, SyncSample, SynchronizerOptions,
} from './sync.js';

// --- reproductor ------------------------------------------------------------
export { createPlayer, Player } from './player.js';
export type { ManifestResolver, PlayerOptions } from './player.js';

// --- multi-instancia --------------------------------------------------------
export { createBatchResolver, PlayerRegistry } from './registry.js';
export type { BatchResolverOptions, RegistryOptions } from './registry.js';

// --- directo ----------------------------------------------------------------
export { backoff, LiveTracker } from './live.js';
export type { LiveStatus, RetryPolicy } from './live.js';

// --- anclajes de interfaz ---------------------------------------------------
export type {
  BarControlDecl, OverlayDecl, OverlayHandle,
  SettingsOptionDecl, SettingsPanelDecl, TimelineMarkerDecl, TimelineMarkersDecl, UiSlots,
} from './slots.js';

// --- plugins ----------------------------------------------------------------
export { plugins, PluginRegistry, topoSort } from './plugins.js';
export type {
  ActivationResult, PluginConfig, PluginContext, PluginImpl, PluginManifest,
} from './plugins.js';

// --- punto de entrada -------------------------------------------------------
export { create, NanoPlayer, registry, VERSION } from './nanoplayer.js';
export type { CreateConfig } from './nanoplayer.js';
