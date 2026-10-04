/**
 * Cast plugin: plays the video on another screen, a Chromecast or an AirPlay
 * receiver, through the standard Remote Playback API: Chrome (desktop and
 * Android) and Safari (macOS and iOS) implement it, with no SDK or receiver
 * app to register. The `<video>` stays in charge while it plays remotely, so
 * the control bar keeps working as it is.
 *
 * Only the master is sent, the stream with the sound: remote playback is per
 * element, and one screen shows one video.
 */
import {
  plugins, strings,
  type PluginContext, type PluginImpl, type UiSlots,
} from '@nanoplayer/core';

strings.register('es', {
  'cast.start': 'Reproducir en otra pantalla',
  'cast.connected': 'Reproduciendo en otra pantalla',
});
strings.register('en', {
  'cast.start': 'Play on another screen',
  'cast.connected': 'Playing on another screen',
});

/** A screen with a signal: the usual cast glyph. */
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'
  + 'M3 5h18v14h-6v-2h4V7H5v3H3zm0 7a8 8 0 0 1 8 8H9a6 6 0 0 0-6-6zm0 4a4 4 0 0 1 4 4H3z"/></svg>';

/** Safari before the standard API. */
type WebkitVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

class Cast implements PluginImpl {
  #available = false;
  #connected = false;
  #video: HTMLVideoElement | null = null;
  #stopWatching: (() => void) | null = null;
  #removeNotice: (() => void) | null = null;
  #unsubscribe: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const { player } = ctx;
    let ui: UiSlots | null = null;

    const changed = () => {
      ui?.refresh();
      if (ui) this.#notice(ui, ctx.t('cast.connected'));
    };

    // A detach replaces the `<video>`: watch the new one on every attach.
    const watch = () => {
      const video = player.master?.element ?? null;
      if (video === this.#video) return;
      this.#stopWatching?.();
      this.#video = video;
      this.#available = false;
      this.#connected = false;
      if (video) this.#stopWatching = this.#watch(video, changed);
      changed();
    };
    this.#unsubscribe.push(player.on('engine:attach:ok', watch), player.on('engine:detach', watch));

    ctx.whenUi((slots) => {
      ui = slots;
      this.#unsubscribe.push(slots.addBarControl({
        id: 'cast',
        priority: 45,
        icon: ICON,
        label: () => ctx.t(this.#connected ? 'cast.connected' : 'cast.start'),
        pressed: () => this.#connected,
        // Only with a device to send to: a button that finds nothing is noise.
        available: () => this.#available || this.#connected,
        onActivate: () => this.#prompt(),
      }));
      watch();
    });
  }

  deactivate(): void {
    this.#stopWatching?.();
    this.#stopWatching = null;
    this.#removeNotice?.();
    this.#removeNotice = null;
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }

  /** The browser's own device picker; from it the viewer also disconnects. */
  #prompt(): void {
    const video = this.#video as WebkitVideo | null;
    if (!video) return;
    if (video.remote) void video.remote.prompt().catch(() => {});
    else video.webkitShowPlaybackTargetPicker?.();
  }

  #watch(video: HTMLVideoElement, changed: () => void): () => void {
    const undo: Array<() => void> = [];
    const on = (target: EventTarget, type: string, fn: (ev: Event) => void) => {
      target.addEventListener(type, fn);
      undo.push(() => target.removeEventListener(type, fn));
    };
    const remote = video.remote;

    if (remote) {
      const state = () => { this.#connected = remote.state === 'connected'; changed(); };
      on(remote, 'connect', state);
      on(remote, 'disconnect', state);
      on(remote, 'connecting', state);
      let id: number | null = null;
      remote.watchAvailability((available) => { this.#available = available; changed(); })
        .then((watchId) => { id = watchId; })
        // Not supported on this device or for this source: no button.
        .catch(() => {});
      undo.push(() => { if (id !== null) void remote.cancelWatchAvailability(id).catch(() => {}); });
    } else {
      on(video, 'webkitplaybacktargetavailabilitychanged', (ev) => {
        this.#available = (ev as Event & { availability?: string }).availability === 'available';
        changed();
      });
      on(video, 'webkitcurrentplaybacktargetiswirelesschanged', () => {
        this.#connected = !!(video as WebkitVideo).webkitCurrentPlaybackTargetIsWireless;
        changed();
      });
    }
    return () => { for (const fn of undo) fn(); };
  }

  /**
   * While it plays elsewhere the local video goes dark: a notice says where
   * the picture went, instead of a black box that looks broken.
   */
  #notice(ui: UiSlots, text: string): void {
    if (!this.#connected) {
      this.#removeNotice?.();
      this.#removeNotice = null;
      return;
    }
    if (this.#removeNotice) return;
    const overlay = ui.addOverlay({ id: 'cast', position: 'center' });
    const notice = document.createElement('p');
    notice.className = 'np__waiting-text';
    notice.setAttribute('role', 'status');
    notice.textContent = text;
    overlay.element.appendChild(notice);
    this.#removeNotice = overlay.remove;
  }
}

/** Self-registration: always on, audio too (a speaker); the button waits for a device. */
plugins.register({
  id: 'cast',
  activateWhen: (m) => m !== null,
  load: () => new Cast(),
});

export { Cast };
