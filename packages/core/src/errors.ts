/**
 * Coded errors. The code is what consumers branch on (retry, evict, analytics);
 * the message is a diagnostic for integrators, always in English.
 */
export type ErrorCode =
  /** The manifest could not be fetched (network, 404, CORS). Retryable. */
  | 'manifest/fetch'
  /** The manifest arrived but failed validation. */
  | 'manifest/invalid'
  /** No available engine can play these sources. */
  | 'engine/unsupported'
  | 'engine/failed'
  | 'media/decode'
  /** Retryable. */
  | 'media/network'
  /** Blocked by the browser's autoplay policy: a user gesture is needed. */
  | 'media/blocked'
  /** A programming error: invalid transition, broken invariant. */
  | 'internal';

export interface PlayerError {
  code: ErrorCode;
  message: string;
  cause?: unknown;
  /** Whether offering the user a retry makes sense. */
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
