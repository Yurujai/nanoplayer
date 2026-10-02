/**
 * Quality plugin: a settings panel to pick the picture quality, or leave it to
 * the engine. With hls.js these are the playlist's levels plus "Auto"; with
 * MP4, the sources that declare a `height`, switched keeping the position.
 * Native HLS (Safari, iOS) offers none: the browser decides there.
 */
import {
  AUTO_QUALITY, plugins, strings,
  type Player, type PluginContext, type PluginImpl, type QualityInfo, type Translate,
  type UiSlots,
} from '@nanoplayer/core';

strings.register('es', {
  'quality.label': 'Calidad',
  'quality.auto': 'Automática',
  'quality.autoPlaying': 'Automática ({quality})',
});
strings.register('en', {
  'quality.label': 'Quality',
  'quality.auto': 'Auto',
  'quality.autoPlaying': 'Auto ({quality})',
});

const megabits = (bps: number) => `${(bps / 1e6).toFixed(bps < 1e6 ? 2 : 1)} Mbps`;

/**
 * "720p" from the height; the bitrate added only when two share a height, as
 * they would read the same; the media's own name when there is nothing else.
 */
export function qualityLabels(qualities: QualityInfo[]): Map<string, string> {
  const heights = new Map<number, number>();
  for (const q of qualities) if (q.height) heights.set(q.height, (heights.get(q.height) ?? 0) + 1);
  const labels = new Map<string, string>();
  qualities.forEach((q, i) => {
    let label: string;
    if (q.height) {
      label = `${q.height}p`;
      if ((heights.get(q.height) ?? 0) > 1 && q.bitrate) label += ` · ${megabits(q.bitrate)}`;
    } else if (q.label) {
      label = q.label;
    } else if (q.bitrate) {
      label = megabits(q.bitrate);
    } else {
      label = String(i + 1);
    }
    labels.set(q.id, label);
  });
  return labels;
}

/** Tallest first, as every player lists them; then by bitrate. */
function sorted(qualities: QualityInfo[]): QualityInfo[] {
  return [...qualities].sort((a, b) =>
    (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
}

class Quality implements PluginImpl {
  #unsubscribe: Array<() => void> = [];
  #removePanel: (() => void) | null = null;
  /** Ids of the ladder on show: the panel is rebuilt only when the ladder changes. */
  #shown = '';

  activate(ctx: PluginContext): void {
    const { player } = ctx;
    let ui: UiSlots | null = null;

    const render = () => {
      const qualities = player.qualities;
      const key = qualities.map((q) => `${q.id}:${q.height}:${q.bitrate}`).join('|');
      if (key === this.#shown && this.#removePanel) return;
      this.#shown = key;
      this.#removePanel?.();
      this.#removePanel = null;
      if (!ui || qualities.length < 2) return;
      this.#removePanel = ui.addSettingsPanel(this.#panel(player, ctx.t));
    };

    this.#unsubscribe.push(
      player.on('quality:change', render),
      player.on('engine:attach:ok', render),
      player.on('engine:detach', () => {
        this.#removePanel?.();
        this.#removePanel = null;
        this.#shown = '';
      }),
    );
    ctx.whenUi((slots) => { ui = slots; render(); });
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    this.#removePanel?.();
    this.#removePanel = null;
  }

  /**
   * `options` is a getter, read on every repaint of the menu: "Auto (720p)"
   * follows what the engine picks without rebuilding the panel, which would
   * throw out a viewer browsing it.
   */
  #panel(player: Player, t: Translate) {
    return {
      id: 'quality',
      label: t('quality.label'),
      priority: 12,
      get options() {
        const qualities = player.qualities;
        const labels = qualityLabels(qualities);
        const list = sorted(qualities).map((q) => ({ value: q.id, label: labels.get(q.id)! }));
        if (!player.autoQuality) return list;
        const playing = player.quality === AUTO_QUALITY ? player.playingQuality : null;
        const auto = playing && labels.has(playing)
          ? t('quality.autoPlaying', { quality: labels.get(playing)! })
          : t('quality.auto');
        return [{ value: AUTO_QUALITY, label: auto }, ...list];
      },
      getValue: () => player.quality ?? '',
      onSelect: (id: string) => player.setQuality(id),
    };
  }
}

/** Self-registration: always on, since only the engine knows whether there is a choice. */
plugins.register({
  id: 'quality',
  activateWhen: (m) => m !== null,
  load: () => new Quality(),
});

export { Quality };
