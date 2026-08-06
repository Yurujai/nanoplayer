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
 * Sobre el renderizado, que tiene truco. El navegador dibuja los subtítulos
 * nativos **dentro del elemento `<video>`**, y de ahí no hay forma de sacarlos.
 * En un layout lado a lado eso los encajona en la mitad del ancho, y en imagen
 * en imagen pueden acabar dentro del recuadro pequeño: ilegibles.
 *
 * Así que el `<track>` se deja en modo `hidden` —el navegador sigue parseando
 * el WebVTT y gestionando los tiempos, que es lo difícil— y el texto se pinta
 * en una capa del ancho del reproductor entero.
 *
 * Lo que se pierde por el camino son las preferencias de subtítulos del sistema
 * operativo, que quien depende de ellos suele tener configuradas. No es gratis,
 * y se compensa exponiendo tamaño, color y fondo como variables CSS
 * (`--np-cue-*`). Unos subtítulos que respetan las preferencias pero no se
 * pueden leer no sirven de nada.
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
  #capa: HTMLElement | null = null;
  #quitarCapa: (() => void) | null = null;
  #alCambiarCue: (() => void) | null = null;
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
      // --- anclaje `overlay`: el texto, a todo el ancho del reproductor ---
      const capa = ui.addOverlay({ id: 'captions', position: 'captions' });
      this.#capa = capa.element;
      this.#quitarCapa = capa.remove;
      this.#pintarCues();

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
    this.#desatarCue();
    for (const el of this.#elementos) el.remove();
    this.#elementos = [];
    this.#quitarCapa?.();
    this.#quitarCapa = null;
    this.#capa = null;
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
   * Aplica el estado a las pistas.
   *
   * La activa va en `hidden`, no en `showing`: así el navegador **procesa los
   * cues y dispara `cuechange` pero no los dibuja**, que es exactamente lo que
   * hace falta para pintarlos por nuestra cuenta sin reimplementar el parseo
   * de WebVTT ni la lógica de tiempos.
   *
   * Las inactivas van en `disabled` y no en `hidden`: con `hidden` el navegador
   * seguiría procesándolas para nada, que en móvil es batería.
   */
  #aplicar(): void {
    this.#desatarCue();
    let activa: TextTrack | null = null;
    for (const el of this.#elementos) {
      const t = el.track;
      if (!t) continue;
      if (el.srclang === this.#activa) { t.mode = 'hidden'; activa = t; }
      else t.mode = 'disabled';
    }
    if (activa) {
      const fn = () => this.#pintarCues();
      activa.addEventListener('cuechange', fn);
      this.#alCambiarCue = () => activa.removeEventListener('cuechange', fn);
    }
    this.#pintarCues();
  }

  #desatarCue(): void {
    this.#alCambiarCue?.();
    this.#alCambiarCue = null;
  }

  /**
   * Pinta los cues activos.
   *
   * Se usa `getCueAsHTML()` en lugar de `cue.text` para conservar el marcado de
   * WebVTT —negritas, cursivas, etiquetas de voz— en vez de escupir las
   * etiquetas en crudo. Y se inserta como nodos, nunca como HTML de una
   * cadena: los subtítulos son contenido de terceros.
   */
  #pintarCues(): void {
    const capa = this.#capa;
    if (!capa) return;
    capa.textContent = '';
    if (this.#activa === APAGADO) return;

    const track = this.#elementos.find((e) => e.srclang === this.#activa)?.track;
    const activos = track?.activeCues;
    if (!activos) return;

    for (const cue of Array.from(activos)) {
      const linea = document.createElement('div');
      linea.className = 'np__cue';
      const vtt = cue as VTTCue & { getCueAsHTML?: () => DocumentFragment };
      if (typeof vtt.getCueAsHTML === 'function') linea.appendChild(vtt.getCueAsHTML());
      else linea.textContent = vtt.text ?? '';
      capa.appendChild(linea);
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
