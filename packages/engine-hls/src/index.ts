/**
 * Motor HLS sobre hls.js.
 *
 * Es la segunda implementación de `MediaEngine`, y su otra función es servir de
 * prueba a la abstracción: si añadirlo obligara a tocar el núcleo, la interfaz
 * estaría mal. No lo obliga — se registra y ya.
 *
 * **hls.js se carga en diferido.** El paquete es dependencia de pares y solo se
 * descarga la primera vez que hay que reproducir HLS. Quien reproduzca MP4 no
 * paga nada, que es lo que hace compatibles el objetivo O5 —una etiqueta
 * `<script>`— con no arrastrar 150 KB por si acaso.
 *
 * Reparto de trabajo con el motor nativo, decidido con lo que midió S2:
 *
 *   - **Donde hay MSE** (Chrome, Firefox, Safari de escritorio) gana este, que
 *     además da control de calidad y estadísticas de buffer.
 *   - **Donde no lo hay** (iOS con `MediaSource` ausente) este dice que no
 *     puede, y el selector se queda con el nativo.
 *
 * Y nunca se decide por `canPlayType`: S2 midió que devuelve `"maybe"` para el
 * MIME de HLS en los cinco navegadores probados, incluido Chrome de escritorio,
 * que no lo reproduce.
 */
import {
  hasMse, isHlsType, MediaElementEngine, playerError,
  type AttachOptions, type Confidence, type EngineFactory, type MediaEngine,
  type PlayerError, type Source, type Stream,
} from '@nanoplayer/core';
import type HlsType from 'hls.js';

type Hls = HlsType;

/** Carga hls.js una sola vez y la reutiliza. */
let cargando: Promise<typeof HlsType> | null = null;
function cargarHls(): Promise<typeof HlsType> {
  cargando ??= import('hls.js').then((m) => m.default);
  return cargando;
}

export class HlsEngine extends MediaElementEngine {
  readonly name = 'hls.js';

  #hls: Hls | null = null;

  protected async prepare(el: HTMLVideoElement, stream: Stream, _options: AttachOptions): Promise<void> {
    const fuente = stream.sources.find((s) => isHlsType(s.type));
    if (!fuente) {
      throw playerError('engine/unsupported', `Stream "${stream.id}" has no HLS source`);
    }

    const Hls = await cargarHls();
    if (!Hls.isSupported()) {
      throw playerError('engine/unsupported',
        'hls.js cannot run in this browser: no Media Source Extensions');
    }

    this.#hls = new Hls({
      enableWorker: true,
      // Empezar por una calidad baja acorta el tiempo hasta el primer
      // fotograma; el algoritmo sube en cuanto mide ancho de banda.
      startLevel: -1,
      backBufferLength: 90,
    });
    this.#escucharHls(this.#hls, Hls);
    this.#hls.attachMedia(el);
    this.#hls.loadSource(fuente.src);

    await this.#esperarManifiesto(this.#hls, Hls);
  }

  /**
   * `hls.destroy()` es obligatorio y no opcional: sin él la instancia sigue
   * pidiendo segmentos por la red aunque el elemento haya desaparecido del DOM.
   * Es la misma lección que S2 dejó con los decodificadores, agravada porque
   * aquí además se consume ancho de banda. Va antes de soltar el elemento.
   */
  protected override release(): void {
    this.#hls?.destroy();
    this.#hls = null;
  }

  /**
   * Los errores del elemento no se notifican: con MSE los detecta hls.js, que
   * además los intenta recuperar (`recoverMediaError`). Avisar aquí haría que
   * la interfaz enseñara un error del que el motor se estaba recuperando.
   */
  protected override onElementError(): void {}

  /**
   * Espera a que hls.js haya parseado la lista.
   *
   * Se espera a `MANIFEST_PARSED` y no a `loadeddata` del elemento: con MSE el
   * elemento no tiene datos hasta que hls.js le ha ido metiendo segmentos, así
   * que esperar al elemento sería esperar de más y por el camino equivocado.
   */
  #esperarManifiesto(hls: Hls, Hls: typeof HlsType): Promise<void> {
    return new Promise((resolve, reject) => {
      const ok = () => { limpiar(); resolve(); };
      const fallo = (_e: unknown, data: { fatal?: boolean; details?: string }) => {
        if (!data?.fatal) return;
        limpiar();
        reject(playerError('media/network',
          `hls.js could not load the playlist: ${data.details ?? 'unknown error'}`));
      };
      const limpiar = () => {
        hls.off(Hls.Events.MANIFEST_PARSED, ok);
        hls.off(Hls.Events.ERROR, fallo as never);
        clearTimeout(t);
      };
      const t = setTimeout(() => {
        limpiar();
        reject(playerError('media/network', 'Timed out loading the HLS playlist'));
      }, 20000);
      hls.on(Hls.Events.MANIFEST_PARSED, ok);
      hls.on(Hls.Events.ERROR, fallo as never);
    });
  }

  /**
   * Recuperación ante errores.
   *
   * Es la razón práctica de usar hls.js y no el soporte nativo donde se puede
   * elegir: un corte de red o un fallo de decodificación se pueden reintentar
   * en lugar de dejar el reproductor muerto. Solo se avisa al consumidor cuando
   * ya no queda nada que intentar.
   */
  #escucharHls(hls: Hls, Hls: typeof HlsType): void {
    const onError = (_e: unknown, data: {
      fatal?: boolean; type?: string; details?: string;
    }) => {
      if (!data?.fatal) return;
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          return;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          return;
        default:
          this.callbacks.onError?.(this.#traducir(data));
      }
    };
    hls.on(Hls.Events.ERROR, onError as never);
    this.onDetach(() => hls.off(Hls.Events.ERROR, onError as never));
  }

  #traducir(data: { type?: string; details?: string }): PlayerError {
    const detalle = data.details ?? 'unknown error';
    if (data.type === 'networkError') {
      return playerError('media/network', `HLS network error: ${detalle}`);
    }
    if (data.type === 'mediaError') {
      return playerError('media/decode', `HLS decoding error: ${detalle}`);
    }
    return playerError('engine/failed', `hls.js failure: ${detalle}`);
  }

  override seek(seconds: number): void {
    super.seek(seconds);
    const el = this.element;
    if (!el || !Number.isFinite(seconds) || seconds < 0) return;
    /*
     * Si el destino cae fuera de lo cargado, se le dice a hls.js que cargue
     * desde ahí, en vez de fiarse de que se entere solo.
     *
     * En Chromium se entera: el elemento baja a `readyState` 1, avisa con
     * `waiting` y hls.js pide los segmentos nuevos en una décima. En WebKit
     * no: el elemento sigue diciendo `readyState` 4, hls.js se queda en reposo
     * apuntando al final de lo que ya tenía, y el vídeo queda en `seeking`
     * para siempre. Medido con un directo de 25 minutos de ventana: cualquier
     * salto largo —retroceder, o volver al directo— congelaba los flujos.
     * `startLoad` con la posición es la forma documentada de reubicarlo, y en
     * Chromium solo adelanta lo que iba a hacer de todos modos.
     */
    if (!this.#cargado(el, seconds)) this.#hls?.startLoad(seconds);
  }

  /** Si `t` cae dentro de lo que el elemento ya tiene cargado. */
  #cargado(el: HTMLVideoElement, t: number): boolean {
    const b = el.buffered;
    for (let i = 0; i < b.length; i++) {
      if (t >= b.start(i) && t < b.end(i)) return true;
    }
    return false;
  }

  /**
   * Hora absoluta de la posición actual, según `EXT-X-PROGRAM-DATE-TIME`.
   *
   * hls.js la calcula por nosotros en `playingDate`. Devuelve `null` si la
   * lista no trae la etiqueta, que es la señal de que la sincronización de
   * directos no se puede medir y por tanto no se debe intentar.
   */
  getProgramTime(): number | null {
    const d = this.#hls?.playingDate;
    return d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : null;
  }

  /** La que calcula hls.js a partir de la duración de los segmentos. */
  liveSyncPosition(): number | null {
    const p = this.#hls?.liveSyncPosition;
    return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null;
  }
}

export const hlsEngineFactory: EngineFactory = {
  name: 'hls.js',

  /**
   * Solo HLS, y solo donde hay MSE.
   *
   * Devolver `no` sin MSE es lo que hace que el selector se quede con el motor
   * nativo en iOS sin `ManagedMediaSource`, sin que nadie tenga que
   * programar esa excepción en ningún sitio.
   */
  canPlay(source: Source): Confidence {
    if (!source.type || !isHlsType(source.type)) return 'no';
    return hasMse() ? 'probably' : 'no';
  },

  create(): MediaEngine {
    return new HlsEngine();
  },
};

/**
 * Motores por orden de preferencia, con hls.js delante.
 *
 * Para HLS con MSE presente, este responde `probably` y el nativo `maybe`, así
 * que gana. Sin MSE responde `no` y gana el nativo. Toda la lógica de reparto
 * vive en `canPlay`, no en condicionales repartidos.
 */
export function enginesWithHls(
  native: EngineFactory,
): readonly EngineFactory[] {
  return [hlsEngineFactory, native];
}
