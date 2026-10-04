/**
 * Time links plugin: a lecture opens at the minute a link names, and "Copy
 * link to this moment" in the settings menu makes such a link. Teaching cites
 * by the minute ("see 23:10"), and an LMS links that way.
 *
 *   https://campus.example/lecture-3#t=23:10
 *   https://campus.example/lecture-3?t=1390
 *
 * With several players on a page, `v` names the manifest the time is for:
 * `#t=23:10&v=lecture-3`. Without it, the time goes to the first player.
 */
import {
  plugins, strings, type Player, type PluginContext, type PluginImpl, type UiSlots,
} from '@nanoplayer/core';

strings.register('es', {
  'timeLinks.copy': 'Copiar enlace a este momento',
  'timeLinks.copied': 'Enlace copiado: {time}',
  'timeLinks.failed': 'No se ha podido copiar. El enlace es {url}',
});
strings.register('en', {
  'timeLinks.copy': 'Copy link to this moment',
  'timeLinks.copied': 'Link copied: {time}',
  'timeLinks.failed': 'Could not copy it. The link is {url}',
});

const NOTICE_MS = 5000;
const FAILED_NOTICE_MS = 12000;

/**
 * Seconds from "750", "750s", "12:30", "1:02:30" or "1h2m30s"; `null` if it
 * is none of those.
 */
export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (/^\d+(\.\d+)?s?$/.test(v)) return parseFloat(v);
  if (/^\d+(:\d{1,2}){1,2}$/.test(v)) {
    return v.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
  }
  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(v);
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  }
  return null;
}

/** "12:30", or "1:02:30" past the hour: how the link and the notice show a time. */
export function clockTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** `t` and `v` from the hash first, then the query. */
export function readLink(
  location: { hash: string; search: string },
): { time: number | null; video: string | null } {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  return {
    time: parseTime(hash.get('t') ?? query.get('t')),
    video: hash.get('v') ?? query.get('v'),
  };
}

/**
 * This page at `seconds`, for the manifest `video`. In the hash, which neither
 * reloads nor reaches the server, unless the hash is already a route of the
 * page's own (`#/course/3`): then in the query, so the route survives.
 */
export function linkTo(href: string, seconds: number, video: string): string {
  const url = new URL(href);
  const time = clockTime(seconds);
  const hash = url.hash.replace(/^#/, '');
  if (hash === '' || (!hash.includes('/') && hash.includes('='))) {
    const params = new URLSearchParams(hash);
    params.set('t', time);
    params.set('v', video);
    url.hash = params.toString().replace(/%3A/g, ':');
  } else {
    url.searchParams.set('t', time);
    url.searchParams.set('v', video);
  }
  return url.href;
}

/** The first player on the page takes a time without `v`. */
let bareTimeTaken = false;

/** Clipboard first; the old way where it is refused (an iframe without permission). */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { return document.execCommand('copy'); } catch { return false; } finally { area.remove(); }
  }
}

class TimeLinks implements PluginImpl {
  #unsubscribe: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const { player, t } = ctx;
    const id = player.manifest?.id;
    if (!id) return;

    let mine = false;
    const forMe = (video: string | null) => {
      if (video !== null) return video === id;
      if (!bareTimeTaken) { bareTimeTaken = true; mine = true; }
      return mine;
    };

    // Before the media loads: the player starts there, and remembering where
    // the viewer left off gives way to it.
    const opening = readLink(location);
    if (opening.time !== null && forMe(opening.video)) player.seek(opening.time);

    // A link to a time on the same page ("see 12:30") jumps and plays: the click was the intent.
    const onHash = () => {
      const link = readLink(location);
      if (link.time === null || !forMe(link.video)) return;
      player.seek(link.time);
      void player.play().catch(() => {});
    };
    window.addEventListener('hashchange', onHash);
    this.#unsubscribe.push(() => window.removeEventListener('hashchange', onHash));

    ctx.whenUi((ui) => {
      this.#unsubscribe.push(ui.addSettingsPanel({
        id: 'copy-link',
        label: t('timeLinks.copy'),
        priority: 55,
        onActivate: () => { void this.#copy(ui, player, id, t); },
      }));
    });
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }

  async #copy(ui: UiSlots, player: Player, id: string, t: PluginContext['t']): Promise<void> {
    const seconds = Math.floor(player.currentTime);
    const url = linkTo(location.href, seconds, id);
    const copied = await copy(url);
    this.#notice(ui, copied
      ? t('timeLinks.copied', { time: clockTime(seconds) })
      : t('timeLinks.failed', { url }), copied ? NOTICE_MS : FAILED_NOTICE_MS);
  }

  /** Shown and announced: a copy gives no other sign that it happened. */
  #notice(ui: UiSlots, text: string, ms: number): void {
    const overlay = ui.addOverlay({ id: 'time-links', position: 'fill' });
    const notice = document.createElement('p');
    notice.className = 'np__notice';
    notice.setAttribute('role', 'status');
    notice.textContent = text;
    overlay.element.appendChild(notice);
    setTimeout(() => overlay.remove(), ms);
  }
}

/** Self-registration: on for recorded video; a live stream has no minute to link to. */
plugins.register({
  id: 'time-links',
  activateWhen: (m) => m !== null && !m.live,
  load: () => new TimeLinks(),
});

export { TimeLinks };
