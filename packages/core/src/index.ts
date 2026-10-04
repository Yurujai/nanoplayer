// --- manifest ---------------------------------------------------------------
export type {
  Annotation, Bumper, ChapterAnnotation, InteractiveAnnotation, Manifest,
  Source, Stream, StreamRole, TextTrackDef, TrimAnnotation,
} from './manifest.js';
export { parseManifest, validateManifest } from './validate.js';
export {
  isAudioOnly, isAudioOnlyManifest, masterStream, slaveStreams, trimOf,
} from './manifest-queries.js';
export type { ValidationIssue, ValidationResult } from './validate.js';
export type { TrimRange } from './trim-timeline.js';

// --- intro and outro --------------------------------------------------------
export { CHAIN_LEAD_MS, CHAIN_WATCH_MS, FIRST_FRAME_TIMEOUT_MS, firstFrame } from './chain.js';
export type { BumperPhase, ChainPhase } from './chain.js';

// --- strings ----------------------------------------------------------------
export { BASE_LANGUAGE, StringRegistry, strings } from './i18n.js';
export type { Catalogue, Catalogues, Translate } from './i18n.js';

// --- errors -----------------------------------------------------------------
export { playerError } from './errors.js';
export type { ErrorCode, PlayerError } from './errors.js';

// --- events -----------------------------------------------------------------
export { EventBus } from './events.js';
export type {
  AnyListener, Empty, EventBusOptions, EventMap, Listener,
  ListenerErrorInfo, Unsubscribe,
} from './events.js';
export type { CoreEvents } from './core-events.js';

// --- lifecycle --------------------------------------------------------------
export { Lifecycle } from './lifecycle.js';
export {
  assertTransition, canTransition, hasEngine, TRANSITIONS, WITH_ENGINE, WITH_MANIFEST,
} from './state.js';
export type { PlayerState } from './state.js';

// --- engines ----------------------------------------------------------------
export { AUTO_QUALITY, confidenceFor, hasMse, isHlsType, selectEngine } from './engine.js';
export type {
  AttachOptions, AudioTrackInfo, Confidence, EngineCallbacks, EngineFactory, MediaEngine,
  QualityInfo,
} from './engine.js';
export { MediaElementEngine, mediaElementError } from './media-element-engine.js';
export type { MediaElementEngineOptions } from './media-element-engine.js';
export { NativeEngine, nativeEngineFactory } from './native-engine.js';

// --- sync -------------------------------------------------------------------
export { defaultScheduler, detectProfile, SYNC_PROFILES, Synchronizer } from './sync.js';
export type {
  Scheduler, SyncAction, SyncProfile, SyncProfileName, SyncSample, SynchronizerOptions,
} from './sync.js';

// --- player -----------------------------------------------------------------
export { createPlayer, Player } from './player.js';
export type { ManifestResolver, PlayerOptions } from './player.js';

// --- many players -----------------------------------------------------------
export { createBatchResolver, PlayerRegistry } from './registry.js';
export type { BatchResolverOptions, RegistryOptions } from './registry.js';

// --- live -------------------------------------------------------------------
export { backoff, LiveTracker } from './live.js';
export type { LiveStatus, RetryPolicy } from './live.js';

// --- icons ------------------------------------------------------------------
export { icon } from './icon.js';

// --- WebVTT -----------------------------------------------------------------
export { parseVtt } from './vtt.js';
export type { VttCue } from './vtt.js';

// --- UI slots ---------------------------------------------------------------
export type {
  BarControlDecl, OverlayDecl, OverlayHandle, PanelDecl, PanelHandle,
  SettingsActionDecl, SettingsChoiceDecl, SettingsGroupDecl, SettingsOptionDecl, SettingsPanelDecl,
  TimelineImage, TimelineMarkerDecl, TimelineMarkersDecl, TimelinePreviewDecl, UiSlots,
} from './slots.js';

// --- plugins ----------------------------------------------------------------
export { plugins, PluginRegistry, topoSort } from './plugins.js';
export type {
  ActivationResult, PluginConfig, PluginContext, PluginImpl, PluginManifest,
} from './plugins.js';

// --- entry point ------------------------------------------------------------
export { create, NanoPlayer, registry, VERSION } from './nanoplayer.js';
export type { CreateConfig } from './nanoplayer.js';
