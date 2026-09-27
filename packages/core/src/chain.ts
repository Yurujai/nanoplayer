/**
 * Encadenado de cabecera, contenido y cola.
 *
 * Lo que aquí vive son las piezas que no dependen del reproductor: qué fases
 * hay, cuánto se anticipa el cambio y cómo se sabe que la pieza entrante ya
 * enseña imagen. La orquestación está en `player.ts`, que es quien tiene los
 * motores.
 *
 * Todo sale del spike S6, y conviene no perder de vista por qué:
 *
 *   - Arrancar la pieza siguiente **al terminar** la anterior deja un hueco de
 *     340–445 ms, que se ve. Arrancarla **antes** lo deja en 0 ms. La
 *     anticipación no es una optimización: es el mecanismo.
 *   - Tener el elemento cargado no basta: el `play()` de un elemento parado
 *     tarda 250 ms en Chromium y hasta 430 ms en WebKit en dar imagen. Por eso
 *     no se cambia al pedir el play, sino **al primer fotograma**.
 */
import type { MediaEngine } from './engine.js';

/** En qué pieza de la cadena está el reproductor. */
export type ChainPhase = 'intro' | 'main' | 'outro';

/**
 * Cuánto antes del final de una pieza se arranca la siguiente, en ms.
 *
 * S6 midió que 300 ms basta en WebKit y se queda corto en Chromium (21 ms de
 * hueco); con 600 ms los dos quedan en cero. Tiene que superar la latencia del
 * `play()` más el periodo de vigilancia.
 */
export const ANTICIPACION_MS = 600;

/** Cada cuánto se mira si toca anticipar. `timeupdate` llega a 4 Hz, y no basta. */
export const VIGILANCIA_MS = 50;

/**
 * Tope de espera por el primer fotograma, en ms.
 *
 * Si no llega, se cambia de todos modos: un hueco negro es mejor que una
 * cadena atascada en una pieza que ya terminó.
 */
export const ESPERA_FOTOGRAMA_MS = 3000;

type ConFotogramas = HTMLVideoElement & {
  requestVideoFrameCallback?(cb: () => void): number;
};

/**
 * Resuelve cuando la pieza entrante tiene imagen en pantalla.
 *
 * `requestVideoFrameCallback` es la única API que dice cuándo un fotograma
 * llegó a pantalla. Donde no existe —o si es solo audio, que no tiene
 * fotogramas— se espera a que el tiempo avance, que es la mejor señal que
 * queda.
 */
export function firstFrame(engine: MediaEngine): Promise<void> {
  return new Promise((resolve) => {
    let hecho = false;
    const fin = () => {
      if (hecho) return;
      hecho = true;
      clearTimeout(tope);
      resolve();
    };
    const tope = setTimeout(fin, ESPERA_FOTOGRAMA_MS);

    const el = engine.element as ConFotogramas | null;
    if (typeof el?.requestVideoFrameCallback === 'function' && el.videoWidth !== 0) {
      el.requestVideoFrameCallback(fin);
      return;
    }
    const desde = engine.currentTime;
    const mirar = () => {
      if (hecho) return;
      if (engine.currentTime !== desde) fin();
      else setTimeout(mirar, 16);
    };
    mirar();
  });
}
