/**
 * Picture-in-picture plugin: a bar button that moves the video to the
 * browser's floating window, so it stays in sight while the viewer uses the
 * rest of the page or the system.
 *
 * Browsers float one `<video>`, never the whole player: with two streams it is
 * the one the layout puts first, the slides in "presentation only" and the
 * master otherwise. Called "floating window" on screen, since the in-player
 * layout already goes by "picture in picture".
 */
import {
  icon, isAudioOnlyManifest, plugins, strings,
  type Player, type PluginContext, type PluginImpl,
} from '@nanoplayer/core';

strings.register('es', {
  'pip.enter': 'Abrir en una ventana flotante',
  'pip.exit': 'Cerrar la ventana flotante',
});
strings.register('en', {
  'pip.enter': 'Open in a floating window',
  'pip.exit': 'Close the floating window',
});

/** A small window in the corner of a larger one. */
const ICON = icon.svg(
  icon.line('M4.5 5h15A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16.5v-9A2.5 2.5 0 0 1 4.5 5z'),
  icon.solid('M13 11.5h6v4.5h-6z'),
);

/** Safari before the standard API, and iPhones without it. */
type WebkitVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

/**
 * Firefox has no API, only its own overlay toggle; an iframe without
 * `allow="picture-in-picture"` turns the API off. Either way, no button.
 */
export function pipSupported(doc: Document = document): boolean {
  if (doc.pictureInPictureEnabled) return true;
  const probe = doc.createElement('video') as WebkitVideo;
  return probe.webkitSupportsPresentationMode?.('picture-in-picture') === true;
}

function isFloating(video: HTMLVideoElement): boolean {
  return video.ownerDocument.pictureInPictureElement === video
    || (video as WebkitVideo).webkitPresentationMode === 'picture-in-picture';
}

const CHANGE_EVENTS = ['enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged'];

class PictureInPicture implements PluginImpl {
  #layout = '';
  #unsubscribe: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const { player } = ctx;
    const root = player.container;
    if (!pipSupported(root.ownerDocument)) return;

    this.#unsubscribe.push(ctx.bus.on('layout:change', ({ layout }) => { this.#layout = layout; }));
    const floating = () => [...root.querySelectorAll<HTMLVideoElement>('[data-stream] video')]
      .find(isFloating) ?? null;

    ctx.whenUi((ui) => {
      // The floating window has its own close and play buttons: the label must follow them too.
      const refresh = () => ui.refresh();
      for (const type of CHANGE_EVENTS) root.addEventListener(type, refresh, true);
      this.#unsubscribe.push(() => {
        for (const type of CHANGE_EVENTS) root.removeEventListener(type, refresh, true);
      });

      this.#unsubscribe.push(ui.addBarControl({
        id: 'pip',
        priority: 40,
        icon: ICON,
        label: () => ctx.t(floating() ? 'pip.exit' : 'pip.enter'),
        onActivate: () => {
          const current = floating();
          void (current ? this.#close(current) : this.#open(player)).catch(() => {});
        },
      }));
    });
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }

  #target(player: Player): HTMLVideoElement | null {
    if (this.#layout === 'presentation') {
      const slides = player.container
        .querySelector<HTMLVideoElement>('[data-role="presentation"] video');
      if (slides) return slides;
    }
    return player.master?.element ?? null;
  }

  async #open(player: Player): Promise<void> {
    const video = this.#target(player) as WebkitVideo | null;
    if (!video) return;
    if (video.ownerDocument.pictureInPictureEnabled && video.requestPictureInPicture) {
      await video.requestPictureInPicture();
    } else {
      video.webkitSetPresentationMode?.('picture-in-picture');
    }
  }

  async #close(video: WebkitVideo): Promise<void> {
    if (video.ownerDocument.pictureInPictureElement === video) {
      await video.ownerDocument.exitPictureInPicture();
    } else {
      video.webkitSetPresentationMode?.('inline');
    }
  }
}

/** Self-registration: on for anything with a picture, where the browser can float it. */
plugins.register({
  id: 'pip',
  activateWhen: (m) => m !== null && !isAudioOnlyManifest(m),
  load: () => new PictureInPicture(),
});

export { PictureInPicture };
