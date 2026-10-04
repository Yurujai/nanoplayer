/**
 * Analytics plugin: player events to any analytics destination, in batches.
 * The core bus already emits everything from the start; this picks what is
 * worth counting, adds what can only be derived (milestones, time watched)
 * and sends it.
 *
 * Off unless configured, as it needs somewhere to send to:
 *
 *   plugins: { analytics: { endpoint: 'https://stats.example/collect' } }
 *   plugins: { analytics: { send: (events) => events.forEach((e) => gtag('event', e.type, e)) } }
 *
 * It carries no personal data: a random id per session, the video's `id`, and
 * whatever the integrator adds in `context`.
 */
import { plugins, type CoreEvents, type PluginContext, type PluginImpl } from '@nanoplayer/core';

export interface AnalyticsEvent {
  type: string;
  /** ISO 8601. */
  time: string;
  session: string;
  video: string;
  /** Visible time, seconds. */
  position: number;
  duration: number;
  data: Record<string, unknown>;
  context?: Record<string, unknown>;
}

/** A type, not an interface, so it fits `plugins: { analytics: config }` as it is. */
export type AnalyticsConfig = {
  /** Gets each batch. Wins over `endpoint`. */
  send?: (events: AnalyticsEvent[]) => void | Promise<void>;
  /** Batches are POSTed here as a JSON array. */
  endpoint?: string;
  /** Bus events to send, or `'all'`. Milestones and the session summary always go. */
  events?: readonly string[] | 'all';
  /** Share of sessions reported, 0 to 1: high-traffic sites need not count every one. */
  sample?: number;
  /** Added to every event: a course, a group. */
  context?: Record<string, unknown>;
  /** Seconds between batches. Defaults to 10. */
  flushEvery?: number;
};

/** What answers "how was it watched" without the per-frame noise of `time` or sync. */
export const DEFAULT_EVENTS: readonly (keyof CoreEvents)[] = [
  'play', 'pause', 'ended', 'seek:end', 'ratechange', 'error', 'stall:end',
  'quality:change', 'audio:tracks', 'chain:phase', 'live:status', 'engine:attach:ok',
  'manifest:resolve:fail',
];

const MILESTONES = [25, 50, 75];
const BATCH_SIZE = 20;
const DEFAULT_FLUSH_SECONDS = 10;
/** Longer than this between two time updates is a seek or a stall, not watching. */
const MAX_STEP = 2;

const round = (n: number) => Math.round(n * 100) / 100;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Payloads as plain JSON: an error's `cause` can be anything, and a whole
 * manifest is not worth sending when its `id` says which.
 */
function plain(payload: unknown): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(payload ?? {}, (key, value) => {
      if (key === 'cause') return undefined;
      if (key === 'manifest' && value && typeof value === 'object') return (value as { id?: unknown }).id;
      return value;
    })) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** POSTed as JSON; `sendBeacon` when the page is going away, as fetch may not finish. */
function endpointSender(endpoint: string) {
  return (events: AnalyticsEvent[], leaving: boolean) => {
    const body = JSON.stringify(events);
    const beacon = () => typeof navigator !== 'undefined'
      && navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'application/json' }));
    if (leaving && beacon()) return;
    void fetch(endpoint, {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body,
    }).catch(() => {});
  };
}

class Analytics implements PluginImpl {
  #unsubscribe: Array<() => void> = [];
  #end: (() => void) | null = null;

  activate(ctx: PluginContext): void {
    const config = ctx.config as AnalyticsConfig;
    const { player } = ctx;
    const video = player.manifest?.id;
    const custom = config.send;
    const transport = custom
      ? (events: AnalyticsEvent[]) => {
        try {
          const sent = custom(events);
          if (sent instanceof Promise) sent.catch(() => {});
        } catch { /* a failing destination never stops playback */ }
      }
      : config.endpoint ? endpointSender(config.endpoint) : null;
    if (!transport || !video) return;
    if (Math.random() >= (config.sample ?? 1)) return;

    const session = uuid();
    const wanted = config.events === 'all' ? null : new Set<string>(config.events ?? DEFAULT_EVENTS);
    let queue: AnalyticsEvent[] = [];
    let watched = 0;
    let last: number | null = null;
    const reached = new Set<number>();
    let ended = false;

    const flush = (leaving = false) => {
      if (queue.length === 0) return;
      const batch = queue;
      queue = [];
      transport(batch, leaving);
    };
    const record = (type: string, data: unknown) => {
      queue.push({
        type,
        time: new Date().toISOString(),
        session,
        video,
        position: round(player.currentTime),
        duration: round(player.duration || 0),
        data: plain(data),
        ...(config.context ? { context: config.context } : {}),
      });
      if (queue.length >= BATCH_SIZE) flush();
    };

    this.#unsubscribe.push(ctx.bus.onAny((type, payload) => {
      if (!wanted || wanted.has(type)) record(type, payload);
    }));

    // Derived: real watching time, and how far into the lecture it got.
    this.#unsubscribe.push(
      player.on('time', ({ current, duration }) => {
        if (player.phase !== 'main') return;
        const from = last;
        last = current;
        if (from === null || player.paused) return;
        const step = current - from;
        if (step <= 0 || step > MAX_STEP) return;
        watched += step;
        // Crossed while playing: a seek past 50 % has not watched it.
        if (!(duration > 0)) return;
        for (const percent of MILESTONES) {
          const at = (percent / 100) * duration;
          if (!reached.has(percent) && from < at && current >= at) {
            reached.add(percent);
            record('milestone', { percent });
          }
        }
      }),
      // Where watching starts again: the first second after play or a seek counts too.
      player.on('play', () => { last = player.currentTime; }),
      player.on('seek:end', ({ at }) => { last = at; }),
      player.on('ended', () => {
        if (!ended) record('milestone', { percent: 100 });
        ended = true;
      }),
    );

    const timer = setInterval(() => flush(), (config.flushEvery ?? DEFAULT_FLUSH_SECONDS) * 1000);
    let summarised = false;
    this.#end = () => {
      if (!summarised) {
        summarised = true;
        record('session:end', { watched: round(watched), milestones: [...reached].sort((a, b) => a - b) });
      }
      flush(true);
    };
    // Hidden is the last moment that is sure to come on mobile; pagehide may not.
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); };
    const onLeave = () => this.#end?.();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onLeave);
    this.#unsubscribe.push(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onLeave);
    });
  }

  deactivate(): void {
    this.#end?.();
    this.#end = null;
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }
}

/** Never on by itself: it only activates with configuration saying where to send. */
plugins.register({
  id: 'analytics',
  load: () => new Analytics(),
});

export { Analytics };
