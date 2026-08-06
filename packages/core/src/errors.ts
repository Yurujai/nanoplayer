/**
 * Errores con código.
 *
 * El código importa más que el mensaje: la UI decide con él si ofrece
 * reintentar, el registro decide si desaloja la instancia, y la analítica futura
 * agrupa por él. Un `Error` con solo texto obliga a cada consumidor a hacer
 * coincidencias de cadenas, que es como se rompen las cosas al traducir.
 */

export type ErrorCode =
  /** No se pudo obtener el manifiesto (red, 404, CORS). Reintentable. */
  | 'manifest/fetch'
  /** El manifiesto llegó pero no pasa la validación. No reintentable. */
  | 'manifest/invalid'
  /** Ningún motor disponible sabe reproducir estas fuentes. */
  | 'engine/unsupported'
  /** El motor falló al arrancar. */
  | 'engine/failed'
  /** El medio falló al decodificar. */
  | 'media/decode'
  /** El medio se cortó por red. Reintentable. */
  | 'media/network'
  /** El navegador bloqueó la reproducción por política de autoplay. */
  | 'media/blocked'
  /** Fallo de programación: transición inválida, invariante roto. */
  | 'internal';

export interface PlayerError {
  code: ErrorCode;
  message: string;
  /** Error original, si lo hubo. */
  cause?: unknown;
  /** Si tiene sentido ofrecer un reintento al usuario. */
  retryable: boolean;
}

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'manifest/fetch',
  'media/network',
  'engine/failed',
]);

export function playerError(
  code: ErrorCode,
  message: string,
  cause?: unknown,
): PlayerError {
  return {
    code,
    message,
    retryable: RETRYABLE.has(code),
    ...(cause !== undefined ? { cause } : {}),
  };
}
