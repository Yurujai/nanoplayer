/**
 * El manifiesto es el contrato del que cuelga todo lo demás: motores, layouts,
 * plugins y adaptadores. Describe QUÉ hay que reproducir, nunca CÓMO.
 *
 * Nada aquí menciona hls.js, elementos `<video>` ni layouts concretos. Si algún
 * día hace falta cambiar de motor, el manifiesto no debería enterarse.
 */

/** Una fuente concreta: una URL y su tipo MIME. */
export interface Source {
  src: string;
  /** MIME. `application/vnd.apple.mpegurl` para HLS, `video/mp4`, etc. */
  type: string;
  /** Alto en píxeles, si se conoce. Solo informativo: la calidad la elige el motor. */
  height?: number;
  label?: string;
}

/**
 * Papel del stream dentro de la composición. Los dos primeros son los casos de
 * captura docente; el resto queda abierto porque los layouts son plugins y
 * pueden inventarse los suyos.
 */
export type StreamRole = 'presenter' | 'presentation' | (string & {});

/** Un flujo de medios. Un manifiesto dual-stream tiene dos. */
export interface Stream {
  id: string;
  role: StreamRole;
  label?: string;
  /**
   * Si el flujo trae imagen o solo sonido.
   *
   * **Casi nunca hace falta ponerlo**: se deduce del tipo MIME de las fuentes,
   * y un `audio/mpeg` no deja lugar a dudas. Solo es necesario cuando el MIME
   * es ambiguo, que en la práctica es HLS con solo audio: ahí el tipo es el
   * mismo que para vídeo y no hay forma de saberlo sin descargarlo.
   */
  kind?: 'video' | 'audio';
  /**
   * Si este stream aporta el audio.
   *
   * **Exactamente uno** debe tenerlo a `true` en todo el manifiesto, y ese es
   * el maestro del reloj de sincronización. No es una convención estética:
   *   - S1 demostró que al maestro no se le puede tocar el `playbackRate` sin
   *     que se oiga, así que la corrección de deriva recae en los demás.
   *   - S2 midió que iPhone no reproduce dos audios a la vez.
   */
  audio: boolean;
  sources: Source[];
  poster?: string;
}

/**
 * Pieza que se encadena delante o detrás del contenido: una cabecera
 * institucional, una cola con créditos.
 *
 * Es mono-stream a propósito, aunque el contenido sea dual: una cabecera es un
 * único vídeo con su sonido, y no hay nada que sincronizar.
 *
 * No hay campo para decidir si se puede saltar porque no es configurable: la
 * cabecera siempre se puede saltar y la cola nunca. Eso depende del papel de la
 * pieza, no de cada manifiesto.
 */
export interface Bumper {
  sources: Source[];
}

/** Recorte de reproducción. No modifica el medio: remapea el timeline visible. */
export interface TrimAnnotation {
  kind: 'trim';
  /** Segundos desde el inicio del medio. */
  start: number;
  end: number;
}

/** Marcador navegable en la barra de progreso. */
export interface ChapterAnnotation {
  kind: 'chapter';
  start: number;
  end?: number;
  title: string;
}

/**
 * Contenido interactivo anclado a un instante. El núcleo no sabe interpretarlo:
 * solo lo entrega al plugin que declare ese `kind`.
 */
export interface InteractiveAnnotation {
  kind: 'h5p' | (string & {});
  start: number;
  end?: number;
  /** Carga útil opaca para el plugin correspondiente. */
  data: Record<string, unknown>;
}

/**
 * Datos anclados al timeline. Unifica lo que parecían features sueltas:
 * trimming, capítulos y contenido interactivo son consumidores del mismo
 * mecanismo, y añadir uno nuevo no toca el núcleo.
 */
export type Annotation = TrimAnnotation | ChapterAnnotation | InteractiveAnnotation;

/** Subtítulos y similares. */
export interface TextTrackDef {
  src: string;
  /** Código BCP 47. */
  lang: string;
  label?: string;
  kind?: 'subtitles' | 'captions' | 'descriptions' | 'chapters';
  default?: boolean;
}

export interface Manifest {
  id: string;
  title?: string;
  /**
   * Imagen previa. Es lo único que se descarga en estado `idle`: el reproductor
   * no pide medios hasta que el usuario lo pide.
   */
  poster?: string;
  /** Duración en segundos, si se conoce de antemano. */
  duration?: number;
  /** Un stream para mono, dos o más para multi-stream. */
  streams: Stream[];
  /**
   * Cabecera, antes del contenido. Opcional e independiente de `outro`: puede
   * haber una, la otra, las dos o ninguna. Se puede saltar.
   */
  intro?: Bumper;
  /** Cola, después del contenido. Opcional. **No se puede saltar.** */
  outro?: Bumper;
  annotations?: Annotation[];
  textTracks?: TextTrackDef[];
  /** Directo. Cambia los estados de la UI y desactiva lo que no aplica. */
  live?: boolean;
  /**
   * Imagen que se enseña mientras el directo no emite.
   *
   * Aparte de `poster` a propósito: el póster es lo que se ve **antes** de
   * pulsar play, y esto es lo que se ve **después**, esperando. Suelen querer
   * decir cosas distintas —una carátula del evento frente a un "empieza a las
   * 10:00"—. Si falta, se usa el póster.
   */
  liveWaitingImage?: string;
}
