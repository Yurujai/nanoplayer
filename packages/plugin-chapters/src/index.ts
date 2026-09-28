/**
 * Plugin de capítulos.
 *
 * Consume las anotaciones `chapter` del manifiesto, igual que el recorte
 * consume las `trim`: el dato ya estaba en el contrato y aquí solo se decide
 * cómo enseñarlo. Por dos anclajes, cada uno con lo que le toca:
 *
 *   - **Barra de progreso** (`timeline`) — dónde empieza cada capítulo, cuál
 *     suena ahora y, al lector de pantalla, en qué capítulo cae cada punto.
 *   - **Ajustes** — la lista, para saltar a uno. Es una elección entre varias
 *     opciones y ocasional, que es justo lo que va en ese menú.
 *
 * El plugin no pinta nada: declara las marcas y la interfaz las construye.
 * Eso deja el mismo anclaje listo para las actividades H5P.
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

/** Los capítulos del manifiesto, en orden. */
function capitulosDe(m: Manifest | null): ChapterAnnotation[] {
  return (m?.annotations ?? [])
    .filter((a): a is ChapterAnnotation => a.kind === 'chapter')
    .sort((a, b) => a.start - b.start);
}

class Chapters implements PluginImpl {
  #quitar: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const player = ctx.player;
    const todos = capitulosDe(player.manifest);
    if (todos.length === 0) return;

    // Con recorte, un capítulo que queda entero fuera no se puede alcanzar:
    // ofrecerlo en la lista sería una opción que no lleva a ninguna parte.
    const recorte = player.trim;
    const capitulos = todos.filter((c, i) => {
      if (!recorte) return true;
      const fin = c.end ?? todos[i + 1]?.start ?? Infinity;
      return fin > recorte.start && c.start < recorte.end;
    });

    /** El capítulo en curso: el último que ha empezado. */
    const actual = (): number => {
      const medio = player.toMediaTime(player.currentTime);
      let indice = 0;
      capitulos.forEach((c, i) => { if (c.start <= medio) indice = i; });
      return indice;
    };

    ctx.whenUi((ui) => {
      this.#quitar.push(ui.addTimelineMarkers({
        id: 'chapters',
        markers: todos.map((c) => ({
          start: c.start, label: c.title, ...(c.end !== undefined ? { end: c.end } : {}),
        })),
      }));
      // Con un solo capítulo no hay adónde saltar: el panel sería ruido.
      if (capitulos.length < 2) return;
      this.#quitar.push(ui.addSettingsPanel({
        id: 'chapters',
        label: ctx.t('chapters.label'),
        priority: 15,
        options: capitulos.map((c, i) => ({ value: String(i), label: c.title })),
        getValue: () => String(actual()),
        onSelect: (v) => {
          const c = capitulos[Number(v)];
          if (c) player.seek(player.toVisibleTime(c.start));
        },
      }));
    });
  }

  deactivate(): void {
    for (const quitar of this.#quitar) quitar();
    this.#quitar = [];
  }
}

/**
 * Auto-registro. Como con los subtítulos, el caso habitual no pide nada: si
 * el manifiesto trae capítulos, se activa solo.
 */
plugins.register({
  id: 'chapters',
  activateWhen: (m) => capitulosDe(m).length > 0,
  load: () => new Chapters(),
});

export { Chapters };
