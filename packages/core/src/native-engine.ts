/**
 * Motor sobre el elemento `<video>` nativo.
 *
 * Cubre MP4 progresivo y HLS donde el navegador lo soporta de fábrica (Safari
 * e iOS). HLS sobre MSE con hls.js es otro motor, que se registra aparte.
 */
import {
  hasMse, isHlsType,
  type AttachOptions, type Confidence, type EngineFactory, type MediaEngine,
} from './engine.js';
import type { Source, Stream } from './manifest.js';
import { MediaElementEngine, mediaElementError } from './media-element-engine.js';

export class NativeEngine extends MediaElementEngine {
  readonly name = 'native';

  protected prepare(el: HTMLVideoElement, stream: Stream, _options: AttachOptions): Promise<void> {
    el.preload = 'auto';
    for (const source of stream.sources) {
      const s = document.createElement('source');
      s.src = source.src;
      s.type = source.type;
      el.appendChild(s);
    }
    return this.#esperarUtilizable(el).catch((pe) => {
      this.callbacks.onError?.(pe);
      throw pe;
    });
  }

  /**
   * Espera a `readyState >= 2` (`HAVE_CURRENT_DATA`), **o a que el navegador
   * diga que no piensa descargar más** (`suspend`).
   *
   * No a `canplay`: S2 midió que en iOS ese evento puede no llegar nunca porque
   * el sistema no bufferea hasta que se intenta reproducir.
   *
   * Y tampoco solo a `loadeddata`, por la misma razón llevada más lejos: en un
   * iPhone 17 Pro con Safari 26.5 no llega ni ese. iOS no descarga un byte
   * hasta el primer `play()`, así que el enganche se quedaba esperando para
   * siempre, el `play()` que venía detrás no llegaba nunca y el botón de play
   * no hacía nada. `suspend` es la forma estándar en que el navegador avisa de
   * que ha dejado de descargar a propósito: el elemento está tan listo como va
   * a estar hasta que alguien le pida reproducir.
   *
   * Sin efectos sobre la reproducción a propósito. Una versión de la sonda
   * lanzaba un `play()` para forzar la carga, y su promesa pausaba el vídeo por
   * detrás al resolverse tarde. Provocar la carga y controlar la reproducción
   * no pueden vivir en la misma función.
   */
  #esperarUtilizable(el: HTMLVideoElement): Promise<void> {
    if (el.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ok = () => { limpiar(); resolve(); };
      const fallo = () => { limpiar(); reject(mediaElementError(el)); };
      const limpiar = () => {
        el.removeEventListener('loadeddata', ok);
        el.removeEventListener('suspend', ok);
        el.removeEventListener('error', fallo);
      };
      el.addEventListener('loadeddata', ok);
      el.addEventListener('suspend', ok);
      el.addEventListener('error', fallo);
      if (el.networkState === 0 /* NETWORK_EMPTY */) el.load();
    });
  }

  /**
   * Hora absoluta de la posición actual.
   *
   * En HLS nativo lo aporta `getStartDate()`, una API de WebKit que devuelve la
   * hora del `EXT-X-PROGRAM-DATE-TIME` del inicio del flujo. Existe justamente
   * en los navegadores donde HLS se reproduce de forma nativa —Safari e iOS—,
   * que son los que no pueden usar hls.js.
   */
  getProgramTime(): number | null {
    const el = this.element as (HTMLVideoElement & { getStartDate?: () => Date }) | null;
    if (!el?.getStartDate) return null;
    const inicio = el.getStartDate();
    const t = inicio instanceof Date ? inicio.getTime() : Number.NaN;
    if (!Number.isFinite(t)) return null;
    return t + el.currentTime * 1000;
  }
}

export const nativeEngineFactory: EngineFactory = {
  name: 'native',

  /**
   * Confianza en reproducir una fuente.
   *
   * El caso HLS merece explicación, porque es la trampa clásica: **medido en
   * S2, `canPlayType('application/vnd.apple.mpegurl')` devolvió `"maybe"` en
   * los cinco navegadores probados** — Chrome sobre Ubuntu y sobre Mac, Safari
   * de escritorio, y Safari y Chrome de iPhone. Chrome de escritorio no
   * reproduce HLS nativo y aun así responde `"maybe"`. O sea que la API no
   * sirve para decidir, por mucho que medio internet la use para eso.
   *
   * La señal que sí discrimina es la ausencia de MSE: donde no hay Media Source
   * Extensions (iOS), hls.js no puede funcionar y el soporte nativo es la única
   * vía, así que se afirma con confianza. Donde sí hay MSE se rebaja a `maybe`,
   * para que un motor basado en hls.js —que da control de calidad y estadísticas
   * de buffer— gane cuando se registre.
   */
  canPlay(source: Source): Confidence {
    if (!source.type) return 'no';
    if (isHlsType(source.type)) return hasMse() ? 'maybe' : 'probably';
    if (typeof document === 'undefined') return 'no';
    const sonda = document.createElement('video');
    const r = sonda.canPlayType(source.type);
    return r === '' ? 'no' : (r as Confidence);
  },

  create(): MediaEngine {
    return new NativeEngine();
  },
};
