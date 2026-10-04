/**
 * xAPI plugin: tells the LMS what was watched and whether the lecture was
 * completed, following the xAPI Video Profile, so any LRS reads it without
 * knowing this player. It only listens to the core bus.
 *
 * Off unless configured, since it needs somewhere to report to:
 *
 *   plugins: { xapi: { endpoint: 'https://lrs.example/xapi', auth: 'Basic …', actor } }
 *   plugins: { xapi: { send: (statement) => myLms.record(statement) } }
 */
import { plugins, type PluginContext, type PluginImpl } from '@nanoplayer/core';
import { PlayedSegments } from './segments.js';

export { PlayedSegments } from './segments.js';

/** A type, not an interface, so it fits `plugins: { xapi: config }` as it is. */
export type XapiConfig = {
  /** Gets every statement: the LMS's own channel (cmi5, a backend). Wins over `endpoint`. */
  send?: (statement: Statement) => void | Promise<void>;
  /** The LRS base URL; statements go to `<endpoint>/statements`. */
  endpoint?: string;
  /** The `Authorization` header for the LRS, e.g. `Basic …`. */
  auth?: string;
  /** Who is watching, as xAPI expects it. The LMS knows; the player does not. */
  actor?: Record<string, unknown>;
  /** Defaults to a URN built from the manifest's `id`. */
  activityId?: string;
  registration?: string;
  /** Share watched, 0 to 1, that counts as completed. Defaults to 0.9. */
  completionThreshold?: number;
};

export type Statement = Record<string, unknown>;

const VERBS = {
  initialized: 'http://adlnet.gov/expapi/verbs/initialized',
  played: 'https://w3id.org/xapi/video/verbs/played',
  paused: 'https://w3id.org/xapi/video/verbs/paused',
  seeked: 'https://w3id.org/xapi/video/verbs/seeked',
  completed: 'http://adlnet.gov/expapi/verbs/completed',
  terminated: 'http://adlnet.gov/expapi/verbs/terminated',
} as const;
type Verb = keyof typeof VERBS;

const PROFILE = 'https://w3id.org/xapi/video';
const ACTIVITY_TYPE = 'https://w3id.org/xapi/video/activity-type/video';
const ext = (name: string) => `https://w3id.org/xapi/video/extensions/${name}`;
const DEFAULT_THRESHOLD = 0.9;

const round = (n: number) => Math.round(n * 1000) / 1000;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** ISO 8601, as xAPI wants durations, in seconds: `PT62.5S`. */
const isoDuration = (seconds: number) => `PT${round(seconds)}S`;

/** Statements over HTTP to an LRS. `keepalive` so the last one survives closing the tab. */
function lrsSender(endpoint: string, auth?: string) {
  const url = `${endpoint.replace(/\/+$/, '')}/statements`;
  return (statement: Statement) => fetch(url, {
    method: 'POST',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      'X-Experience-API-Version': '1.0.3',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(statement),
  }).then(() => undefined);
}

class Xapi implements PluginImpl {
  #unsubscribe: Array<() => void> = [];
  #terminate: (() => void) | null = null;

  activate(ctx: PluginContext): void {
    const config = ctx.config as XapiConfig;
    const send = config.send ?? (config.endpoint ? lrsSender(config.endpoint, config.auth) : null);
    const player = ctx.player;
    const manifest = player.manifest;
    if (!send || !manifest) return;

    const threshold = config.completionThreshold ?? DEFAULT_THRESHOLD;
    const activityId = config.activityId ?? `urn:nanoplayer:video:${encodeURIComponent(manifest.id)}`;
    const session = uuid();
    const segments = new PlayedSegments();
    let initialized = false;
    let completed = false;
    let terminated = false;

    const emit = (verb: Verb, result: Record<string, unknown> = {}, extensions: Record<string, unknown> = {}) => {
      const statement: Statement = {
        id: uuid(),
        ...(config.actor ? { actor: config.actor } : {}),
        verb: { id: VERBS[verb], display: { 'en-US': verb } },
        object: {
          objectType: 'Activity',
          id: activityId,
          definition: {
            type: ACTIVITY_TYPE,
            ...(manifest.title ? { name: { [ctx.lang]: manifest.title } } : {}),
          },
        },
        result: { ...result, extensions },
        context: {
          ...(config.registration ? { registration: config.registration } : {}),
          language: ctx.lang,
          contextActivities: { category: [{ id: PROFILE }] },
          extensions: {
            [ext('session-id')]: session,
            [ext('length')]: round(player.duration || 0),
            [ext('completion-threshold')]: threshold,
          },
        },
        timestamp: new Date().toISOString(),
      };
      try {
        const sent = send(statement);
        if (sent instanceof Promise) sent.catch(() => {});
      } catch { /* the LRS failing must never stop the lecture */ }
    };

    const now = () => player.currentTime;
    /** Intro and outro are not the lecture: they neither count nor report. */
    const inContent = () => player.phase === 'main';
    const progress = () => round(segments.progress(player.duration, now()));
    const state = () => ({
      [ext('time')]: round(now()),
      [ext('progress')]: progress(),
      [ext('played-segments')]: segments.format(now()),
    });

    const checkCompletion = () => {
      if (completed || segments.progress(player.duration, now()) < threshold) return;
      completed = true;
      emit('completed', { completion: true, duration: isoDuration(player.duration) }, state());
    };

    this.#unsubscribe.push(
      player.on('play', () => {
        if (!inContent()) return;
        if (!initialized) {
          initialized = true;
          emit('initialized');
        }
        segments.start(now());
        emit('played', {}, { [ext('time')]: round(now()) });
      }),
      player.on('pause', () => {
        if (!initialized || !segments.playing) return;
        segments.end(now());
        emit('paused', {}, state());
        checkCompletion();
      }),
      player.on('seek:start', ({ from, to }) => {
        if (!initialized || !inContent()) return;
        const wasPlaying = segments.playing;
        segments.end(from);
        if (wasPlaying) segments.start(to);
        emit('seeked', {}, { [ext('time-from')]: round(from), [ext('time-to')]: round(to) });
      }),
      player.on('time', () => { if (initialized && inContent()) checkCompletion(); }),
      player.on('ended', () => {
        if (!initialized) return;
        segments.end(player.duration);
        checkCompletion();
      }),
    );

    // Closing the tab fires no player event: the last chance to say it ended.
    this.#terminate = () => {
      if (!initialized || terminated) return;
      terminated = true;
      segments.end(now());
      emit('terminated', {}, state());
    };
    const onHide = () => this.#terminate?.();
    window.addEventListener('pagehide', onHide);
    this.#unsubscribe.push(() => window.removeEventListener('pagehide', onHide));
  }

  deactivate(): void {
    this.#terminate?.();
    this.#terminate = null;
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }
}

/** Never on by itself: it only activates with configuration saying where to report. */
plugins.register({
  id: 'xapi',
  load: () => new Xapi(),
});

export { Xapi };
