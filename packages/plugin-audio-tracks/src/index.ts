/**
 * Audio tracks plugin: a settings panel to choose between the content's audio
 * renditions, which is how audio description usually arrives (WCAG 1.2.5), and
 * also audio in another language. Putting the description in is the content's
 * job; letting the viewer pick it is the player's.
 *
 * The tracks come from the media, not the manifest, so the panel only appears
 * once the engine reports more than one.
 */
import {
  plugins, strings,
  type AudioTrackInfo, type PluginContext, type PluginImpl, type Translate, type UiSlots,
} from '@nanoplayer/core';

strings.register('es', {
  'audio.label': 'Audio',
  'audio.describes': 'audiodescripción',
  'audio.track': 'Pista {n}',
});
strings.register('en', {
  'audio.label': 'Audio',
  'audio.describes': 'audio description',
  'audio.track': 'Track {n}',
});

/** In its own language, as the captions plugin names its tracks: "English", "español". */
function languageName(lang: string): string {
  if (!lang) return '';
  try {
    return new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}

/**
 * The media's label, or else the language, and always saying which one is
 * described unless the label already does: a playlist naming both renditions
 * "Español" left two identical options.
 */
export function trackLabel(track: AudioTrackInfo, index: number, t: Translate): string {
  const name = track.label || languageName(track.lang) || t('audio.track', { n: String(index + 1) });
  const describes = t('audio.describes');
  if (!track.describes || name.toLowerCase().includes(describes.toLowerCase())) return name;
  return `${name} (${describes})`;
}

class AudioTracks implements PluginImpl {
  #unsubscribe: Array<() => void> = [];
  #removePanel: (() => void) | null = null;
  /** The viewer's choice, kept for when an eviction or reattach brings the default back. */
  #wanted: string | null = null;

  activate(ctx: PluginContext): void {
    const { player } = ctx;
    let ui: UiSlots | null = null;

    const render = (tracks: AudioTrackInfo[]) => {
      this.#removePanel?.();
      this.#removePanel = null;
      // One track is nothing to choose from.
      if (!ui || tracks.length < 2) return;
      this.#removePanel = ui.addSettingsPanel({
        id: 'audio',
        label: ctx.t('audio.label'),
        priority: 7,
        options: tracks.map((track, i) => ({ value: track.id, label: trackLabel(track, i, ctx.t) })),
        getValue: () => player.audioTrack ?? '',
        onSelect: (id) => {
          this.#wanted = id;
          player.setAudioTrack(id);
        },
      });
    };

    this.#unsubscribe.push(player.on('audio:tracks', ({ tracks, active }) => {
      if (this.#wanted !== null && this.#wanted !== active && tracks.some((x) => x.id === this.#wanted)) {
        player.setAudioTrack(this.#wanted);
      }
      render(tracks);
    }));

    ctx.whenUi((slots) => {
      ui = slots;
      render(player.audioTracks);
    });
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    this.#removePanel?.();
    this.#removePanel = null;
  }
}

/** Self-registration: always on, since only the media knows whether it has several tracks. */
plugins.register({
  id: 'audio-tracks',
  activateWhen: (m) => m !== null,
  load: () => new AudioTracks(),
});

export { AudioTracks };
