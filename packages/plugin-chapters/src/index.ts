/**
 * Chapters plugin: consumes the manifest's `chapter` annotations through two
 * slots, marks on the progress bar (`timeline`) and a list in the settings
 * menu to jump to one. It declares; the UI builds.
 */
import {
  plugins, strings,
  type ChapterAnnotation, type Manifest, type PluginContext, type PluginImpl,
} from '@nanoplayer/core';

strings.register('es', {
  'chapters.label': 'Capítulos',
});
strings.register('en', {
  'chapters.label': 'Chapters',
});

function chaptersOf(m: Manifest | null): ChapterAnnotation[] {
  return (m?.annotations ?? [])
    .filter((a): a is ChapterAnnotation => a.kind === 'chapter')
    .sort((a, b) => a.start - b.start);
}

class Chapters implements PluginImpl {
  #unsubscribe: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const player = ctx.player;
    const all = chaptersOf(player.manifest);
    if (all.length === 0) return;

    // A chapter the trim leaves entirely out cannot be reached: listing it would lead nowhere.
    const trim = player.trim;
    const reachable = all.filter((c, i) => {
      if (!trim) return true;
      const end = c.end ?? all[i + 1]?.start ?? Infinity;
      return end > trim.start && c.start < trim.end;
    });

    /** The current chapter: the last one that has started. */
    const current = (): number => {
      const media = player.toMediaTime(player.currentTime);
      let index = 0;
      reachable.forEach((c, i) => { if (c.start <= media) index = i; });
      return index;
    };

    ctx.whenUi((ui) => {
      this.#unsubscribe.push(ui.addTimelineMarkers({
        id: 'chapters',
        markers: all.map((c) => ({
          start: c.start, label: c.title, ...(c.end !== undefined ? { end: c.end } : {}),
        })),
      }));
      // With a single chapter there is nowhere to jump: the panel would be noise.
      if (reachable.length < 2) return;
      this.#unsubscribe.push(ui.addSettingsPanel({
        id: 'chapters',
        label: ctx.t('chapters.label'),
        priority: 15,
        options: reachable.map((c, i) => ({ value: String(i), label: c.title })),
        getValue: () => String(current()),
        onSelect: (v) => {
          const c = reachable[Number(v)];
          if (c) player.seek(player.toVisibleTime(c.start));
        },
      }));
    });
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }
}

/** Self-registration: it switches on by itself when the manifest has chapters. */
plugins.register({
  id: 'chapters',
  activateWhen: (m) => chaptersOf(m).length > 0,
  load: () => new Chapters(),
});

export { Chapters };
