/**
 * The whole player in one file, batteries included, for a single `<script>` tag.
 * Unlike the core's headless `create()`, controls come already attached.
 *
 * ```html
 * <div id="player"></div>
 * <script src="nanoplayer.min.js"></script>
 * <script>
 *   NanoPlayer.create('#player', { manifest: '/api/video/123' });
 * </script>
 * ```
 *
 * It bundles the core: loading `@nanoplayer/core` separately on the same page
 * would create a second plugin registry and a second exclusive-playback policy.
 */
import {
  create as createHeadless, plugins, registry, Player, PlayerRegistry, PluginRegistry,
  VERSION, type CreateConfig,
} from '@nanoplayer/core';
import { attachControls, type ControlBarOptions } from '@nanoplayer/ui';
import '@nanoplayer/plugin-captions';
import '@nanoplayer/plugin-chapters';

export interface Config extends CreateConfig {
  /** Control bar, on by default. `false` leaves it out; an object configures it. */
  controls?: boolean | ControlBarOptions;
}

/** Creates a player with controls. Still downloads nothing until play. */
export function create(target: string | HTMLElement, config: Config): Player {
  const player = createHeadless(target, config);
  if (config.controls !== false) {
    attachControls(player, typeof config.controls === 'object' ? config.controls : {});
  }
  return player;
}

/** The global for the `<script>` case: its `create` is the one with controls. */
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

// Hand-written, not `export *`: Vitest and Rollup disagree on whether an explicit
// `create` beats the core's star-exported one. Guarded by test/create.test.ts.
export {
  // manifest
  isAudioOnly, isAudioOnlyManifest, masterStream, parseManifest, slaveStreams,
  trimOf, validateManifest,
  // strings
  BASE_LANGUAGE, StringRegistry, strings,
  // errors and events
  playerError, EventBus,
  // lifecycle
  Lifecycle, assertTransition, canTransition, hasEngine, TRANSITIONS, WITH_ENGINE, WITH_MANIFEST,
  // engines
  confidenceFor, hasMse, isHlsType, selectEngine,
  MediaElementEngine, mediaElementError, NativeEngine, nativeEngineFactory,
  // sync
  defaultScheduler, detectProfile, SYNC_PROFILES, Synchronizer,
  // player and registry
  createPlayer, createBatchResolver,
  // live
  backoff, LiveTracker,
  // intro and outro
  CHAIN_LEAD_MS, CHAIN_WATCH_MS, FIRST_FRAME_TIMEOUT_MS, firstFrame,
  // plugins
  topoSort,
} from '@nanoplayer/core';

export type {
  Annotation, Bumper, BumperPhase, ChainPhase, TrimRange, ChapterAnnotation, InteractiveAnnotation, Manifest,
  Source, Stream,
  StreamRole, TextTrackDef, TrimAnnotation, ValidationIssue, ValidationResult,
  Catalogue, Catalogues, Translate, ErrorCode, PlayerError,
  AnyListener, Empty, EventBusOptions, EventMap, Listener, ListenerErrorInfo,
  Unsubscribe, CoreEvents, PlayerState,
  AttachOptions, Confidence, EngineCallbacks, EngineFactory, MediaEngine,
  MediaElementEngineOptions,
  Scheduler, SyncAction, SyncProfile, SyncProfileName, SyncSample, SynchronizerOptions,
  ManifestResolver, PlayerOptions, BatchResolverOptions, RegistryOptions,
  LiveStatus, RetryPolicy,
  BarControlDecl, OverlayDecl, OverlayHandle, SettingsOptionDecl, SettingsPanelDecl,
  TimelineMarkerDecl, TimelineMarkersDecl, UiSlots, ActivationResult, PluginConfig, PluginContext, PluginImpl, PluginManifest,
  CreateConfig,
} from '@nanoplayer/core';

export {
  ControlBar, Poster, SettingsMenu, applyLayout, layoutsFor,
  formatPercent, formatTime, spokenTime, CSS, injectStyles, ICONS,
} from '@nanoplayer/ui';

export type {
  ControlBarOptions, SettingsOption, SettingsPanel, LayoutDef, LayoutId,
} from '@nanoplayer/ui';

export {
  Player, PlayerRegistry, PluginRegistry, plugins, registry, VERSION, attachControls,
};
