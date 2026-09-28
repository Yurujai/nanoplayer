/**
 * Catálogo de eventos del núcleo.
 *
 * Es deliberadamente **completo desde el primer día**, aunque el MVP no
 * implemente analítica: un destino de analítica se enchufa con `bus.onAny()` y
 * solo puede reportar lo que el núcleo emita. Un evento que falta hoy es un
 * rediseño mañana, mientras que uno que nadie escucha no cuesta nada.
 *
 * Convención de nombres: `sujeto:verbo`, y las operaciones que pueden fallar se
 * parten en `:start` / `:ok` / `:fail`. Así la analítica puede medir duraciones
 * y tasas de error sin instrumentación adicional.
 */
import type { ChainPhase } from './chain.js';
import type { Empty } from './events.js';
import type { PlayerError } from './errors.js';
import type { Manifest } from './manifest.js';
import type { PlayerState } from './state.js';

export interface CoreEvents {
  // --- ciclo de vida ------------------------------------------------------
  'state:change': { from: PlayerState; to: PlayerState };
  'destroy': Empty;
  /** Hay una interfaz montada y sus anclajes están disponibles. */
  'ui:ready': Empty;

  // --- manifiesto ---------------------------------------------------------
  'manifest:resolve:start': Empty;
  'manifest:resolve:ok': { manifest: Manifest };
  'manifest:resolve:fail': { error: PlayerError };

  // --- motor --------------------------------------------------------------
  'engine:attach:start': Empty;
  /** `resumeAt` es la posición recuperada de un desalojo previo. */
  'engine:attach:ok': { engine: string; resumeAt: number };
  'engine:attach:fail': { error: PlayerError };
  /** Desalojo. `at` es la posición conservada para el siguiente enganche. */
  'engine:detach': { at: number };

  // --- reproducción -------------------------------------------------------
  'play': { at: number };
  'pause': { at: number };
  'ended': { at: number };
  'time': { current: number; duration: number };
  'seek:start': { from: number; to: number };
  'seek:end': { at: number };
  'ratechange': { rate: number };
  'volumechange': { volume: number; muted: boolean };

  // --- cabecera y cola ----------------------------------------------------
  /**
   * Cambió la pieza que se ve. Se emite en el instante del cambio visible, no
   * al pedirlo: entre uno y otro pasa la anticipación.
   */
  'chain:phase': { from: ChainPhase; to: ChainPhase; skipped: boolean };
  /**
   * Progreso de la cabecera o la cola. Va aparte de `time` porque la barra de
   * progreso solo enseña el contenido: mezclarlos la haría saltar.
   */
  'chain:time': { phase: 'intro' | 'outro'; current: number; duration: number };
  /**
   * Una cabecera o cola no se pudo reproducir y se ha omitido. No es un
   * `error`: el contenido sigue, y una cabecera rota no debe impedir verlo.
   */
  'chain:unavailable': { phase: 'intro' | 'outro'; error: PlayerError };

  // --- multi-stream -------------------------------------------------------
  /**
   * Deriva medida entre un esclavo y el maestro. Lo emite el sincronizador.
   * Se publica porque es la señal que permitirá diagnosticar en producción lo
   * que S2 detectó en iPhone: buena mediana con excursiones puntuales severas.
   */
  /**
   * `waiting`: ahora no se puede medir —el esclavo salta o no tiene hora— y no
   * se corrige. `recover`: llevaba demasiado así y se le ha obligado a
   * recolocarse. Separarlos de `ok` es lo que permite ver un esclavo atascado.
   */
  'sync:drift': {
    stream: string; drift: number;
    action: 'ok' | 'correcting' | 'hard-seek' | 'waiting' | 'recover';
  };
  'layout:change': { layout: string };
  /**
   * La sincronización entre flujos no se puede medir, así que no se corrige.
   * Hoy ocurre con directos sin `EXT-X-PROGRAM-DATE-TIME`.
   */
  'sync:unavailable': { reason: string };

  // --- directo ------------------------------------------------------------
  /** Cambió el estado de emisión de un flujo. `retryInMs` si se va a reintentar. */
  'live:status': {
    stream: string;
    status: 'waiting' | 'live' | 'interrupted';
    retryInMs?: number;
  };

  // --- red y buffering ----------------------------------------------------
  'stall:start': { stream: string };
  'stall:end': { stream: string; durationMs: number };

  // --- errores ------------------------------------------------------------
  'error': { error: PlayerError };
}
