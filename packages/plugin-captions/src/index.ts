/**
 * Plugin de subtítulos.
 *
 * Es el primer plugin real, y su función es doble: dar subtítulos y **poner a
 * prueba la API de plugins y anclajes**. Está escrito con la API pública
 * exactamente igual que lo haría alguien de fuera; si necesitara saltársela en
 * algún punto, sería señal de que la API está mal diseñada.
 *
 * Ejerce los dos anclajes a la vez, que es justo el caso que motivó separarlos:
 *
 *   - **Barra** — interruptor activado/desactivado. Binario y frecuente.
 *   - **Ajustes** — elegir idioma. Elección entre varias opciones y ocasional.
 *
 * Y usa `<track>` nativo en lugar de pintar el texto a mano. No es pereza:
 * el renderizado nativo respeta las preferencias de subtítulos del sistema
 * operativo —tamaño, color, fondo, tipografía—, que es de lo primero que
 * configura quien depende de ellos. Pintar los subtítulos por nuestra cuenta
 * las ignoraría todas.
 */
import {
  plugins,
  type Manifest, type PluginContext, type PluginImpl, type TextTrackDef,
} from '@nanoplayer/core';

const ICONO_ON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM7.5 14.5A2.5 2.5 0 0 1 7.5 9.5h1.2v1.6H7.5a.9.9 0 0 0 0 1.8h1.2v1.6H7.5zm7 0a2.5 2.5 0 0 1 0-5h1.2v1.6h-1.2a.9.9 0 0 0 0 1.8h1.2v1.6z"/></svg>';
const ICONO_OFF =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H5V6h14v12zM7.5 14.5A2.5 2.5 0 0 1 7.5 9.5h1.2v1.6H7.5a.9.9 0 0 0 0 1.8h1.2v1.6H7.5zm7 0a2.5 2.5 0 0 1 0-5h1.2v1.6h-1.2a.9.9 0 0 0 0 1.8h1.2v1.6z" opacity=".55"/></svg>';

const TEXTOS: Record<string, { captions: string; off: string; on: string }> = {
  es: { captions: 'Subtítulos', off: 'Desactivados', on: 'Activar subtítulos' },
  en: { captions: 'Subtitles', off: 'Off', on: 'Turn on subtitles' },
};

const APAGADO = '__off__';

/** Nombre legible de una pista: la etiqueta si la trae, si no el idioma. */
function etiqueta(t: TextTrackDef): string {
  if (t.label) return t.label;
  try {
    const dn = new Intl.DisplayNames([t.lang], { type: 'language' });
    return dn.of(t.lang) ?? t.lang;
  } catch {
    return t.lang;
  }
}

class Captions implements PluginImpl {
  #tracks: TextTrackDef[] = [];
  #elementos: HTMLTrackElement[] = [];
  #activa: string = APAGADO;
  #ultima: string | null = null;
  #quitar: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const m = ctx.player.manifest;
    this.#tracks = [...(m?.textTracks ?? [])];
    if (this.#tracks.length === 0) return;

    const lang = (ctx.config['lang'] as string | undefined)
      ?? (document.documentElement.lang || 'es');
    const t = TEXTOS[lang.slice(0, 2)] ?? TEXTOS['es']!;

    // Los `<track>` se añaden al vídeo del maestro cuando exista. Si aún no hay
    // motor, se espera a que enganche: el ciclo perezoso puede tenerlo suelto.
    const montar = () => this.#montarTracks(m);
    if (ctx.player.master?.element) montar();
    this.#quitar.push(ctx.bus.on('engine:attach:ok', montar));

    // Una pista marcada como `default` se activa sola: es lo que el manifiesto
    // pide, y quien la necesita no debería tener que encenderla cada vez.
    const porDefecto = this.#tracks.find((x) => x.default);
    if (porDefecto) {
      this.#activa = porDefecto.lang;
      this.#ultima = porDefecto.lang;
    }

    ctx.whenUi((ui) => {
      // --- anclaje `bar`: interruptor binario y frecuente ---
      this.#quitar.push(ui.addBarControl({
        id: 'captions',
        priority: 30,
        icon: () => (this.#activa === APAGADO ? ICONO_OFF : ICONO_ON),
        label: () => (this.#activa === APAGADO ? t.on : t.captions),
        pressed: () => this.#activa !== APAGADO,
        onActivate: () => {
          const siguiente = this.#activa === APAGADO
            ? (this.#ultima ?? this.#tracks[0]!.lang)
            : APAGADO;
          this.#seleccionar(siguiente);
          ui.refresh();
        },
      }));

      // --- anclaje `settings`: elección entre varias, uso ocasional ---
      this.#quitar.push(ui.addSettingsPanel({
        id: 'captions',
        label: t.captions,
        priority: 5,
        options: [
          { value: APAGADO, label: t.off },
          ...this.#tracks.map((x) => ({ value: x.lang, label: etiqueta(x) })),
        ],
        getValue: () => this.#activa,
        onSelect: (v) => { this.#seleccionar(v); ui.refresh(); },
      }));
    });
  }

  deactivate(): void {
    for (const off of this.#quitar) off();
    this.#quitar = [];
    for (const el of this.#elementos) el.remove();
    this.#elementos = [];
  }

  #montarTracks(m: Manifest | null): void {
    const video = m ? this.#videoMaestro(m) : null;
    if (!video || this.#elementos.length > 0) return;

    for (const t of this.#tracks) {
      const el = document.createElement('track');
      el.kind = t.kind ?? 'subtitles';
      el.srclang = t.lang;
      el.label = etiqueta(t);
      el.src = t.src;
      video.appendChild(el);
      this.#elementos.push(el);
    }
    this.#aplicar();
  }

  #videoMaestro(m: Manifest): HTMLVideoElement | null {
    const maestro = m.streams.find((s) => s.audio);
    if (!maestro) return null;
    return document.querySelector<HTMLVideoElement>(
      `[data-stream="${CSS.escape(maestro.id)}"] video`,
    );
  }

  #seleccionar(valor: string): void {
    this.#activa = valor;
    if (valor !== APAGADO) this.#ultima = valor;
    this.#aplicar();
  }

  /**
   * Aplica el estado a las pistas del elemento.
   *
   * `disabled` y no `hidden`: con `hidden` el navegador sigue procesando los
   * cues y disparando eventos, que es trabajo para nada y, en móvil, batería.
   */
  #aplicar(): void {
    for (const el of this.#elementos) {
      const t = el.track;
      if (!t) continue;
      t.mode = el.srclang === this.#activa ? 'showing' : 'disabled';
    }
  }
}

/**
 * Auto-registro. El núcleo no importa este fichero: basta con que se cargue.
 *
 * `activateWhen` hace que el caso habitual no necesite configuración ninguna:
 * si el manifiesto trae pistas de texto, los subtítulos se activan solos.
 */
plugins.register({
  id: 'captions',
  activateWhen: (m) => (m?.textTracks?.length ?? 0) > 0,
  load: () => new Captions(),
});

export { Captions };
