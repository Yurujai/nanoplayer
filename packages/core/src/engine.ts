/**
 * Contrato del motor de reproducción.
 *
 * **Un motor gobierna un stream, no un reproductor.** Un dual-stream son dos
 * motores coordinados por el sincronizador, no un motor con dos elementos
 * dentro. Así el modelo maestro/esclavo de S1 se expresa donde debe —en el
 * sincronizador— y el motor solo tiene que saber reproducir una cosa bien.
 *
 * El motor **no conoce el bus de eventos del núcleo**: se comunica por
 * callbacks. Eso lo hace probable en aislamiento y permite reutilizarlo sin
 * arrastrar el catálogo de eventos entero.
 */
import type { PlayerError } from './errors.js';
import type { Source, Stream } from './manifest.js';

/** Confianza en poder reproducir algo, con la misma escala que `canPlayType`. */
export type Confidence = 'probably' | 'maybe' | 'no';

export interface EngineCallbacks {
  /** Progreso de reproducción. */
  onTime?(current: number, duration: number): void;
  /** La reproducción se ha **solicitado**. Aún puede no haber empezado. */
  onPlay?(): void;
  /**
   * La reproducción **está sonando de verdad**.
   *
   * No es lo mismo que `onPlay`: entre uno y otro el navegador puede estar
   * llenando el buffer. Con HLS ese hueco siempre existe, porque enganchar
   * termina al parsear la lista, antes de tener un solo segmento.
   */
  onPlaying?(): void;
  onPause?(): void;
  onEnded?(): void;
  /** Se quedó sin buffer. */
  onStallStart?(): void;
  /** Volvió de un stall, con lo que duró. */
  onStallEnd?(durationMs: number): void;
  onSeeked?(at: number): void;
  onError?(error: PlayerError): void;
}

export interface AttachOptions {
  /** Posición desde la que continuar, recuperada de un desalojo previo. */
  startAt?: number;
  muted?: boolean;
  /** Necesario para reproducir en línea en iPhone: sin esto salta a pantalla completa. */
  playsInline?: boolean;
  callbacks?: EngineCallbacks;
}

export interface MediaEngine {
  readonly name: string;
  /** El elemento multimedia, o `null` mientras no esté enganchado. */
  readonly element: HTMLVideoElement | null;
  readonly attached: boolean;

  /**
   * Crea el elemento, lo mete en `container` y espera a que sea utilizable.
   *
   * Resuelve cuando `readyState >= 2` (`HAVE_CURRENT_DATA`) y **no** al llegar
   * a `canplay`: S2 midió que en iOS esperar a `canplay` puede no llegar nunca,
   * porque el sistema no bufferea hasta que se intenta reproducir.
   */
  attach(container: HTMLElement, stream: Stream, options?: AttachOptions): Promise<void>;

  /**
   * Suelta el elemento y **todos** los recursos del navegador asociados.
   *
   * Quitar el elemento del DOM no basta: hay que vaciar la fuente y llamar a
   * `load()`. S2 lo demostró de la peor forma — una limpieza parcial dejaba
   * decodificadores retenidos y falseó una medición entera.
   */
  detach(): void;

  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;

  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly buffered: TimeRanges | null;

  /**
   * Hora absoluta de la posición actual, en milisegundos desde epoch, o `null`
   * si no se puede saber.
   *
   * Solo existe cuando el flujo trae `EXT-X-PROGRAM-DATE-TIME`. Es lo que
   * permite sincronizar dos directos independientes: **en directo,
   * `currentTime` no es comparable entre flujos** — su origen lo fija el
   * instante en que cada reproductor empezó a cargar, no el contenido. S5 midió
   * dos flujos sincronizados a 28 ms cuyos `currentTime` diferían en 20
   * segundos por haberse cargado con esa separación.
   *
   * Basta con esto para corregir: el desfase entre hora y posición es constante
   * en cada flujo, así que buscar una hora concreta es
   * `currentTime + (destino - getProgramTime()) / 1000`.
   */
  getProgramTime?(): number | null;

  getPlaybackRate(): number;
  /** Cambiar la velocidad del stream con audio se oye: solo para los esclavos. */
  setPlaybackRate(rate: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;

  /** Suelta todo y deja el motor inservible. */
  destroy(): void;
}

export interface EngineFactory {
  readonly name: string;
  /** Con qué confianza este motor reproduce esa fuente. */
  canPlay(source: Source): Confidence;
  create(): MediaEngine;
}

const ORDEN: Record<Confidence, number> = { probably: 2, maybe: 1, no: 0 };

/** La mejor confianza del motor sobre cualquiera de las fuentes del stream. */
export function confidenceFor(factory: EngineFactory, stream: Stream): Confidence {
  let mejor: Confidence = 'no';
  for (const source of stream.sources) {
    const c = factory.canPlay(source);
    if (ORDEN[c] > ORDEN[mejor]) mejor = c;
  }
  return mejor;
}

/**
 * Elige el motor más confiado para un stream, o `null` si ninguno sirve.
 *
 * A igualdad de confianza gana el que se registró antes, así que el orden de
 * registro expresa la preferencia: es lo que permitirá anteponer un motor
 * basado en MSE al nativo sin cambiar esta función.
 */
export function selectEngine(
  factories: readonly EngineFactory[],
  stream: Stream,
): EngineFactory | null {
  let elegido: EngineFactory | null = null;
  let mejor = 0;
  for (const f of factories) {
    const c = ORDEN[confidenceFor(f, stream)];
    if (c > mejor) {
      mejor = c;
      elegido = f;
    }
  }
  return elegido;
}

export type { Source, Stream };
