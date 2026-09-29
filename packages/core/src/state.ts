/**
 * Lazy lifecycle states. Each one states what it costs, and a player never
 * moves to the next until it has to: creating one downloads nothing.
 */
export type PlayerState =
  /** Poster only. No network. */
  | 'idle'
  /** Fetching the manifest. Transient; prevents duplicate requests. */
  | 'resolving'
  /** Manifest in memory. */
  | 'resolved'
  /** Creating engines and media elements. Transient. */
  | 'attaching'
  /** Engines live and buffering. */
  | 'attached'
  | 'active'
  /** Terminal. */
  | 'destroyed';

/**
 * Reachable states from each state. `active` cannot go straight to `resolved`:
 * evicting a player takes an explicit pause first, so nothing tears the engine
 * out from under playback.
 */
export const TRANSITIONS = {
  idle: ['resolving', 'destroyed'],
  resolving: ['resolved', 'idle', 'destroyed'],
  resolved: ['attaching', 'idle', 'destroyed'],
  attaching: ['attached', 'resolved', 'destroyed'],
  attached: ['active', 'resolved', 'destroyed'],
  active: ['attached', 'destroyed'],
  destroyed: [],
} as const satisfies Record<PlayerState, readonly PlayerState[]>;

export const WITH_MANIFEST: readonly PlayerState[] = [
  'resolved', 'attaching', 'attached', 'active',
];

/** States holding browser media resources. see docs/browser-quirks.md#decoder-limit */
export const WITH_ENGINE: readonly PlayerState[] = ['attached', 'active'];

export function hasEngine(state: PlayerState): boolean {
  return WITH_ENGINE.includes(state);
}

export function canTransition(from: PlayerState, to: PlayerState): boolean {
  return (TRANSITIONS[from] as readonly PlayerState[]).includes(to);
}

/** An impossible transition is always a programming error: fail loudly. */
export function assertTransition(from: PlayerState, to: PlayerState): void {
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from];
    const detail = allowed.length ? allowed.join(', ') : '(none: terminal state)';
    throw new Error(
      `Invalid transition: "${from}" → "${to}". From "${from}" only these are allowed: ${detail}`,
    );
  }
}
