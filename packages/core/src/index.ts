// --- manifiesto -------------------------------------------------------------
export type {
  Annotation, ChapterAnnotation, InteractiveAnnotation, Manifest,
  Source, Stream, StreamRole, TextTrackDef, TrimAnnotation,
} from './manifest.js';
export {
  masterStream, parseManifest, slaveStreams, trimOf, validateManifest,
} from './validate.js';
export type { ValidationIssue, ValidationResult } from './validate.js';

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
  assertTransition, canTransition, TRANSITIONS, WITH_ENGINE, WITH_MANIFEST,
} from './state.js';
export type { PlayerState } from './state.js';

// --- motor ------------------------------------------------------------------
export { confidenceFor, selectEngine } from './engine.js';
export type {
  AttachOptions, Confidence, EngineCallbacks, EngineFactory, MediaEngine,
} from './engine.js';
export { NativeEngine, nativeEngineFactory } from './native-engine.js';
