/**
 * Resume plugin: back on a lecture, playback continues where it was left,
 * saved by the manifest's `id`. Long lectures are watched over several sittings.
 *
 * It saves in `localStorage` by default; an LMS passes its own store, so the
 * position follows the student to another device:
 *
 *   create('#player', { manifest, plugins: { resume: { store: myLmsStore } } });
 */
import {
  plugins, strings,
  type PluginContext, type PluginImpl, type UiSlots,
} from '@nanoplayer/core';

strings.register('es', {
  'resume.notice': 'Continuando desde {time}',
});
strings.register('en', {
  'resume.notice': 'Resuming from {time}',
});

export interface SavedPosition {
  /** Visible time in seconds, trim included. */
  time: number;
  /** Duration when saved: before play the player does not know it yet. */
  duration: number;
}

/** Where positions live. Any method may be async, as an LMS call would be. */
export interface PositionStore {
  load(id: string): SavedPosition | null | Promise<SavedPosition | null>;
  save(id: string, position: SavedPosition): void | Promise<void>;
  clear(id: string): void | Promise<void>;
}

/** Shorter than this is not worth resuming: the viewer barely started. */
const MIN_RESUME = 10;
/**
 * Closer than this to the end counts as finished: resuming would land on the
 * credits. A share on short videos, or 20 s of a 40 s clip would count as the end.
 */
const FINISHED_WITHIN = 20;
const FINISHED_SHARE = 0.05;
const finished = (time: number, duration: number) =>
  duration > 0 && duration - time < Math.min(FINISHED_WITHIN, duration * FINISHED_SHARE);
const SAVE_EVERY = 5;
const NOTICE_MS = 5000;

const STORAGE_KEY = 'nanoplayer:positions';
/** One key for all, pruned, so a site with thousands of lectures does not fill the quota. */
const KEEP = 100;

type Entries = Record<string, SavedPosition & { savedAt: number }>;

/**
 * The default store. Storage can throw (private mode, blocked site data):
 * then nothing is remembered, and playback is not affected.
 */
export const localPositionStore: PositionStore = {
  load(id) {
    const entry = readEntries()[id];
    return entry ? { time: entry.time, duration: entry.duration } : null;
  },
  save(id, position) {
    const entries = readEntries();
    entries[id] = { ...position, savedAt: Date.now() };
    const ids = Object.keys(entries).sort((a, b) => entries[b]!.savedAt - entries[a]!.savedAt);
    for (const old of ids.slice(KEEP)) delete entries[old];
    writeEntries(entries);
  },
  clear(id) {
    const entries = readEntries();
    delete entries[id];
    writeEntries(entries);
  },
};

function readEntries(): Entries {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? (raw as Entries) : {};
  } catch {
    return {};
  }
}

function writeEntries(entries: Entries): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* not remembered */ }
}

/** Worth resuming: far enough in, and not at the end. */
export function shouldResume(saved: SavedPosition | null): saved is SavedPosition {
  if (!saved || !Number.isFinite(saved.time) || saved.time < MIN_RESUME) return false;
  return !finished(saved.time, saved.duration);
}

/** "12:30", or "1:02:30" past the hour. */
export function clockTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function isStore(value: unknown): value is PositionStore {
  const v = value as Partial<PositionStore> | null;
  return !!v && typeof v.load === 'function' && typeof v.save === 'function'
    && typeof v.clear === 'function';
}

/** A store's failure, sync or async, never reaches playback. */
function quietly(run: () => unknown): void {
  try {
    const result = run();
    if (result instanceof Promise) result.catch(() => {});
  } catch { /* ignored */ }
}

class Resume implements PluginImpl {
  #unsubscribe: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const { player } = ctx;
    const id = player.manifest?.id;
    if (!id) return;
    const store = isStore(ctx.config['store']) ? ctx.config['store'] : localPositionStore;

    let started = false;
    let resumedFrom: number | null = null;
    let lastSaved = -Infinity;
    let ui: UiSlots | null = null;
    ctx.whenUi((slots) => { ui = slots; });

    const save = () => {
      const time = player.currentTime;
      const duration = player.duration;
      if (!(duration > 0) || player.phase !== 'main') return;
      lastSaved = time;
      if (finished(time, duration)) quietly(() => store.clear(id));
      else quietly(() => store.save(id, { time, duration }));
    };

    // The store may answer after the viewer already pressed play or seeked:
    // then their choice stands.
    void Promise.resolve()
      .then(() => store.load(id))
      .then((saved) => {
        if (started || !shouldResume(saved)) return;
        resumedFrom = saved.time;
        player.seek(saved.time);
      })
      .catch(() => {});

    this.#unsubscribe.push(
      player.on('play', () => {
        if (!started && resumedFrom !== null && ui) {
          this.#notice(ui, ctx.t('resume.notice', { time: clockTime(resumedFrom) }));
        }
        started = true;
      }),
      player.on('time', ({ current }) => {
        if (Math.abs(current - lastSaved) >= SAVE_EVERY) save();
      }),
      player.on('pause', save),
      player.on('seek:end', save),
      // Finished: next time it starts from the beginning.
      player.on('ended', () => { lastSaved = player.duration; quietly(() => store.clear(id)); }),
    );

    // Closing the tab fires neither pause nor time: this is the last chance.
    const onHide = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', save);
    this.#unsubscribe.push(() => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', save);
    });
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }

  /**
   * Shown and announced, never a dialog: playback is already under way, and
   * starting over is the progress bar or the Home key.
   */
  #notice(ui: UiSlots, text: string): void {
    const overlay = ui.addOverlay({ id: 'resume', position: 'fill' });
    const notice = document.createElement('p');
    notice.className = 'np__notice';
    notice.setAttribute('role', 'status');
    notice.textContent = text;
    overlay.element.appendChild(notice);
    setTimeout(() => overlay.remove(), NOTICE_MS);
  }
}

/** Self-registration: on for recorded video; live has no position to come back to. */
plugins.register({
  id: 'resume',
  activateWhen: (m) => m !== null && !m.live,
  load: () => new Resume(),
});

export { Resume };
