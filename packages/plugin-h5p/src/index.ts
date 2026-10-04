/**
 * H5P plugin: interactive activities anchored to a time. Playing through one
 * pauses the video and opens the activity over it; "Continue" goes on.
 *
 * The activity is the H5P content's **embed URL**, the one Moodle, H5P.com or
 * WordPress give for each piece of content, shown in an iframe: running H5P
 * itself would mean shipping its library and unpacking content packages.
 *
 *   { "kind": "h5p", "start": 300, "data": { "src": "https://lms/h5p/embed.php?url=…", "title": "Check" } }
 */
import {
  plugins, strings,
  type InteractiveAnnotation, type Manifest, type Player, type PluginContext, type PluginImpl,
  type UiSlots,
} from '@nanoplayer/core';

strings.register('es', {
  'h5p.activity': 'Actividad',
  'h5p.continue': 'Continuar el vídeo',
});
strings.register('en', {
  'h5p.activity': 'Activity',
  'h5p.continue': 'Continue the video',
});

export interface Activity {
  /** Media time, as in the manifest. */
  start: number;
  src: string;
  title: string;
}

/** Longer than this between two time updates is a seek, not playback going through. */
const MAX_STEP = 2;

/** Only web pages: a `javascript:` or `data:` URL in a manifest must not run. */
function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, document.baseURI);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function activitiesOf(m: Manifest | null, fallbackTitle: string): Activity[] {
  return (m?.annotations ?? [])
    .filter((a): a is InteractiveAnnotation => a.kind === 'h5p')
    .flatMap((a) => {
      const src = safeUrl(a.data?.['src']);
      const title = typeof a.data?.['title'] === 'string' && a.data['title'] ? a.data['title'] : fallbackTitle;
      return src ? [{ start: a.start, src, title }] : [];
    })
    .sort((a, b) => a.start - b.start);
}

class H5p implements PluginImpl {
  #unsubscribe: Array<() => void> = [];
  #close: (() => void) | null = null;

  activate(ctx: PluginContext): void {
    const { player, t } = ctx;
    const activities = activitiesOf(player.manifest, t('h5p.activity'));
    if (activities.length === 0) return;
    let ui: UiSlots | null = null;
    /** Media time at the last update; `null` after a seek, so jumping over one opens nothing. */
    let last: number | null = null;

    ctx.whenUi((slots) => {
      ui = slots;
      this.#unsubscribe.push(slots.addTimelineMarkers({
        id: 'h5p',
        markers: activities.map((a) => ({ start: a.start, end: a.start + 1, label: a.title })),
      }));
    });

    this.#unsubscribe.push(
      player.on('time', () => {
        const now = player.toMediaTime(player.currentTime);
        const from = last;
        last = now;
        if (from === null || !ui || this.#close || player.paused || player.phase !== 'main') return;
        if (now <= from || now - from > MAX_STEP) return;
        const due = activities.find((a) => a.start > from && a.start <= now);
        if (due) this.#open(ui, player, due, t('h5p.continue'));
      }),
      player.on('seek:end', () => { last = null; }),
    );
  }

  deactivate(): void {
    this.#close?.();
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }

  /**
   * A dialog over the whole player: named by the activity's title, focus moved
   * into it, the player's shortcuts held back while it is open, and Escape or
   * the button going back to the video and to where focus was.
   */
  #open(ui: UiSlots, player: Player, activity: Activity, continueLabel: string): void {
    player.pause();
    const returnTo = document.activeElement as HTMLElement | null;
    const overlay = ui.addOverlay({ id: 'h5p', position: 'fill', interactive: true });

    const dialog = document.createElement('div');
    dialog.className = 'np-h5p';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;
    const titleId = `np-h5p-${Math.random().toString(36).slice(2)}`;
    dialog.setAttribute('aria-labelledby', titleId);

    const header = document.createElement('div');
    header.className = 'np-h5p__header';
    const title = document.createElement('h2');
    title.className = 'np-h5p__title';
    title.id = titleId;
    title.textContent = activity.title;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'np-h5p__continue';
    button.textContent = continueLabel;
    header.append(title, button);

    const frame = document.createElement('iframe');
    frame.className = 'np-h5p__frame';
    frame.title = activity.title;
    frame.src = activity.src;
    frame.allow = 'fullscreen';
    // Scripts and its own origin, which H5P needs; never navigating the page.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');

    dialog.append(header, frame);
    overlay.element.appendChild(dialog);

    const close = (resume: boolean) => {
      overlay.remove();
      this.#close = null;
      (returnTo?.isConnected ? returnTo : player.container).focus();
      if (resume) void player.play().catch(() => {});
    };
    button.addEventListener('click', () => close(true));
    dialog.addEventListener('keydown', (ev) => {
      // The player's shortcuts would act on the video behind the activity.
      ev.stopPropagation();
      if (ev.key === 'Escape') close(true);
    });
    this.#close = () => close(false);
    dialog.focus();
  }
}

/** Self-registration: on when the manifest has H5P activities. */
plugins.register({
  id: 'h5p',
  activateWhen: (m) => (m?.annotations ?? []).some((a) => a.kind === 'h5p'),
  load: () => new H5p(),
});

export { H5p };
