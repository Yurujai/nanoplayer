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
  playerError,
  type AttachOptions, type Confidence, type EngineCallbacks,
  type EngineFactory, type MediaEngine, type PlayerError,
  type Source, type Stream,
} from '@nanoplayer/core';
import type HlsType from 'hls.js';

type Hls = HlsType;

const HLS_TYPES = new Set([
  'application/vnd.apple.mpegurl', 'application/x-mpegurl',
  'audio/mpegurl', 'audio/x-mpegurl', 'video/x-mpegurl',
]);

const esHls = (type: string) => HLS_TYPES.has(type.split(';')[0]!.trim().toLowerCase());

/**
 * ¿Hay Media Source Extensions?
 *
 * `ManagedMediaSource` cuenta: es la variante que Safari 17 introdujo y que S2
 * encontró disponible en iOS 26. Sin ella, en iPhone no habría forma de usar
 * hls.js en absoluto.
 */
function hayMse(): boolean {
  const g = globalThis as { MediaSource?: unknown; ManagedMediaSource?: unknown };
  return g.MediaSource !== undefined || g.ManagedMediaSource !== undefined;
}

/** Carga hls.js una sola vez y la reutiliza. */
let cargando: Promise<typeof HlsType> | null = null;
function cargarHls(): Promise<typeof HlsType> {
  cargando ??= import('hls.js').then((m) => m.default);
  return cargando;
}

export class HlsEngine implements MediaEngine {
  readonly name = 'hls.js';

  #el: HTMLVideoElement | null = null;
  #hls: Hls | null = null;
  #cb: EngineCallbacks = {};
  #desatar: Array<() => void> = [];
  #stallDesde: number | null = null;
  #destruido = false;
  readonly #ahora: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.#ahora = options.now ?? (() => performance.now());
  }

  get element(): HTMLVideoElement | null { return this.#el; }
  get attached(): boolean { return this.#el !== null; }

  async attach(
    container: HTMLElement,
    stream: Stream,
    options: AttachOptions = {},
  ): Promise<void> {
    if (this.#destruido) throw new Error('El motor fue destruido');
    if (this.#el) throw new Error('El motor ya está enganchado: llama a detach() antes');

    const fuente = stream.sources.find((s) => esHls(s.type));
    if (!fuente) {
      throw playerError('engine/unsupported',
        `El stream "${stream.id}" no tiene ninguna fuente HLS`);
    }

    const el = document.createElement('video');
    this.#el = el;
    this.#cb = options.callbacks ?? {};
    // Obligatorio en iPhone: sin esto, reproducir arrebata la pantalla completa
    // al sistema y el segundo stream desaparece.
    if (options.playsInline !== false) {
      el.playsInline = true;
      el.setAttribute('playsinline', '');
    }
    if (options.muted) el.muted = true;
    this.#escuchar(el);
    container.appendChild(el);

    const Hls = await cargarHls();
    if (!Hls.isSupported()) {
      throw playerError('engine/unsupported',
        'hls.js no puede funcionar en este navegador: no hay Media Source Extensions');
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

    if (options.startAt !== undefined && options.startAt > 0) {
      try { el.currentTime = options.startAt; } catch { /* fuera de rango */ }
    }
  }

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
          `hls.js no pudo cargar la lista: ${data.details ?? 'error desconocido'}`));
      };
      const limpiar = () => {
        hls.off(Hls.Events.MANIFEST_PARSED, ok);
        hls.off(Hls.Events.ERROR, fallo as never);
        clearTimeout(t);
      };
      const t = setTimeout(() => {
        limpiar();
        reject(playerError('media/network', 'Tiempo agotado al cargar la lista HLS'));
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
          this.#cb.onError?.(this.#traducir(data));
      }
    };
    hls.on(Hls.Events.ERROR, onError as never);
    this.#desatar.push(() => hls.off(Hls.Events.ERROR, onError as never));
  }

  #traducir(data: { type?: string; details?: string }): PlayerError {
    const detalle = data.details ?? 'error desconocido';
    if (data.type === 'networkError') {
      return playerError('media/network', `Error de red en HLS: ${detalle}`);
    }
    if (data.type === 'mediaError') {
      return playerError('media/decode', `Error de decodificación en HLS: ${detalle}`);
    }
    return playerError('engine/failed', `Fallo de hls.js: ${detalle}`);
  }

  #escuchar(el: HTMLVideoElement): void {
    const on = <K extends keyof HTMLMediaElementEventMap>(
      type: K, fn: (ev: HTMLMediaElementEventMap[K]) => void,
    ) => {
      el.addEventListener(type, fn as EventListener);
      this.#desatar.push(() => el.removeEventListener(type, fn as EventListener));
    };

    on('timeupdate', () => {
      this.#cb.onTime?.(el.currentTime, Number.isFinite(el.duration) ? el.duration : 0);
    });
    on('play', () => this.#cb.onPlay?.());
    on('pause', () => this.#cb.onPause?.());
    on('ended', () => this.#cb.onEnded?.());
    on('seeked', () => this.#cb.onSeeked?.(el.currentTime));

    on('waiting', () => {
      if (this.#stallDesde !== null) return;
      this.#stallDesde = this.#ahora();
      this.#cb.onStallStart?.();
    });
    on('playing', () => this.#cb.onPlaying?.());
    const finStall = () => {
      if (this.#stallDesde === null) return;
      const dur = this.#ahora() - this.#stallDesde;
      this.#stallDesde = null;
      this.#cb.onStallEnd?.(dur);
    };
    on('playing', finStall);
    on('canplay', finStall);
  }

  /**
   * Suelta el motor.
   *
   * `hls.destroy()` es obligatorio y no opcional: sin él la instancia sigue
   * pidiendo segmentos por la red aunque el elemento haya desaparecido del DOM.
   * Es la misma lección que S2 dejó con los decodificadores, agravada porque
   * aquí además se consume ancho de banda.
   */
  detach(): void {
    const el = this.#el;
    if (!el) return;

    for (const off of this.#desatar) off();
    this.#desatar = [];
    this.#stallDesde = null;

    try { this.#hls?.destroy(); } catch { /* ya podía estar destruida */ }
    this.#hls = null;

    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
    } catch { /* el elemento ya podía estar inservible */ }
    el.remove();

    this.#el = null;
    this.#cb = {};
  }

  async play(): Promise<void> {
    const el = this.#requerir();
    try {
      await el.play();
    } catch (error) {
      const err = error as { name?: string; message?: string };
      const pe = err.name === 'NotAllowedError'
        ? playerError('media/blocked',
            'El navegador bloqueó la reproducción: hace falta una interacción del usuario', error)
        : playerError('media/decode', err.message ?? 'No se pudo iniciar la reproducción', error);
      this.#cb.onError?.(pe);
      throw pe;
    }
  }

  pause(): void { this.#el?.pause(); }

  seek(seconds: number): void {
    const el = this.#requerir();
    if (!Number.isFinite(seconds) || seconds < 0) return;
    el.currentTime = seconds;
  }

  get currentTime(): number { return this.#el?.currentTime ?? 0; }

  get duration(): number {
    const d = this.#el?.duration;
    return d !== undefined && Number.isFinite(d) ? d : 0;
  }

  get paused(): boolean { return this.#el?.paused ?? true; }
  get ended(): boolean { return this.#el?.ended ?? false; }
  get buffered(): TimeRanges | null { return this.#el?.buffered ?? null; }
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

  getPlaybackRate(): number { return this.#el?.playbackRate ?? 1; }

  setPlaybackRate(rate: number): void {
    const el = this.#el;
    if (!el || !Number.isFinite(rate) || rate <= 0) return;
    el.playbackRate = rate;
  }

  setVolume(volume: number): void {
    const el = this.#el;
    if (!el || !Number.isFinite(volume)) return;
    el.volume = Math.min(1, Math.max(0, volume));
  }

  setMuted(muted: boolean): void {
    if (this.#el) this.#el.muted = muted;
  }

  destroy(): void {
    this.detach();
    this.#destruido = true;
  }

  #requerir(): HTMLVideoElement {
    if (!this.#el) throw new Error('El motor no está enganchado');
    return this.#el;
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
    if (!source.type || !esHls(source.type)) return 'no';
    return hayMse() ? 'probably' : 'no';
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
