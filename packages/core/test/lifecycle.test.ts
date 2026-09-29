import { describe, expect, it, vi } from 'vitest';
import type { CoreEvents } from '../src/core-events.js';
import { EventBus } from '../src/events.js';
import { Lifecycle } from '../src/lifecycle.js';
import { TRANSITIONS, canTransition, type PlayerState } from '../src/state.js';

const STATES = Object.keys(TRANSITIONS) as PlayerState[];

const fresh = () => {
  const bus = new EventBus<CoreEvents>({ onListenerError: () => {} });
  return { bus, lc: new Lifecycle(bus) };
};

/** Takes the lifecycle to a state along the legitimate path. */
const driveTo = (lc: Lifecycle, target: PlayerState) => {
  const path: Record<PlayerState, PlayerState[]> = {
    idle: [],
    resolving: ['resolving'],
    resolved: ['resolving', 'resolved'],
    attaching: ['resolving', 'resolved', 'attaching'],
    attached: ['resolving', 'resolved', 'attaching', 'attached'],
    active: ['resolving', 'resolved', 'attaching', 'attached', 'active'],
    destroyed: ['destroyed'],
  };
  for (const step of path[target]) lc.transition(step);
};

describe('transition table', () => {
  it('every reachable state is declared in the table', () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      for (const to of targets) {
        expect(STATES, `${from} → ${to}`).toContain(to);
      }
    }
  });

  it('destroyed is terminal', () => {
    expect(TRANSITIONS.destroyed).toEqual([]);
    for (const to of STATES) {
      expect(canTransition('destroyed', to)).toBe(false);
    }
  });

  it('any state can be destroyed', () => {
    for (const from of STATES) {
      if (from === 'destroyed') continue;
      expect(canTransition(from, 'destroyed'), from).toBe(true);
    }
  });

  it('active cannot release the engine without pausing first', () => {
    // On purpose: eviction takes two explicit steps instead of pulling the
    // engine from under a playback in progress.
    expect(canTransition('active', 'resolved')).toBe(false);
    expect(canTransition('active', 'attached')).toBe(true);
    expect(canTransition('attached', 'resolved')).toBe(true);
  });

  it('stages of the lazy cycle cannot be skipped', () => {
    expect(canTransition('idle', 'attached')).toBe(false);
    expect(canTransition('idle', 'active')).toBe(false);
    expect(canTransition('resolved', 'active')).toBe(false);
  });

  it('no state is declared as a transition to itself', () => {
    for (const from of STATES) {
      expect(canTransition(from, from), from).toBe(false);
    }
  });
});

describe('Lifecycle', () => {
  it('starts in idle, with no manifest or engine', () => {
    const { lc } = fresh();
    expect(lc.state).toBe('idle');
    expect(lc.hasManifest).toBe(false);
    expect(lc.hasEngine).toBe(false);
    expect(lc.resumeAt).toBe(0);
  });

  it('emits state:change with origin and target', () => {
    const { bus, lc } = fresh();
    const fn = vi.fn();
    bus.on('state:change', fn);
    lc.transition('resolving');
    expect(fn).toHaveBeenCalledWith({ from: 'idle', to: 'resolving' });
  });

  it('throws on an invalid transition, and does not change state', () => {
    const { lc } = fresh();
    expect(() => lc.transition('active')).toThrow(/Invalid transition/);
    expect(lc.state).toBe('idle');
  });

  it('the error message lists the valid transitions', () => {
    const { lc } = fresh();
    expect(() => lc.transition('attached')).toThrow(/resolving/);
  });

  it('hasManifest and hasEngine follow the state', () => {
    const { lc } = fresh();
    driveTo(lc, 'resolved');
    expect(lc.hasManifest).toBe(true);
    expect(lc.hasEngine).toBe(false);

    lc.transition('attaching');
    lc.transition('attached');
    expect(lc.hasEngine).toBe(true);
  });

  it('keeps the position when releasing the engine', () => {
    const { lc } = fresh();
    driveTo(lc, 'active');

    lc.transition('attached');       // pause
    lc.rememberPosition(137.5);
    lc.transition('resolved');       // eviction

    expect(lc.state).toBe('resolved');
    expect(lc.hasEngine).toBe(false);
    expect(lc.resumeAt).toBe(137.5);

    lc.transition('attaching');
    lc.transition('attached');
    expect(lc.resumeAt).toBe(137.5);
  });

  it('going back to idle is a reset: the position is dropped', () => {
    const { lc } = fresh();
    driveTo(lc, 'resolved');
    lc.rememberPosition(90);
    lc.transition('idle');
    expect(lc.resumeAt).toBe(0);
  });

  it('ignores nonsensical positions instead of storing them', () => {
    const { lc } = fresh();
    lc.rememberPosition(42);
    lc.rememberPosition(-1);
    lc.rememberPosition(Number.NaN);
    lc.rememberPosition(Number.POSITIVE_INFINITY);
    expect(lc.resumeAt).toBe(42);
  });

  it('destroy() emits the event and marks it destroyed', () => {
    const { bus, lc } = fresh();
    const fn = vi.fn();
    bus.on('destroy', fn);
    lc.destroy();
    expect(lc.state).toBe('destroyed');
    expect(lc.isDestroyed).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('destroy() is idempotent', () => {
    const { bus, lc } = fresh();
    const fn = vi.fn();
    bus.on('destroy', fn);
    lc.destroy();
    lc.destroy();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('destroying while playing works without intermediate steps', () => {
    const { lc } = fresh();
    driveTo(lc, 'active');
    expect(() => lc.destroy()).not.toThrow();
  });

  it('there is no way out of destroyed', () => {
    const { lc } = fresh();
    lc.destroy();
    expect(() => lc.transition('idle')).toThrow(/terminal state/);
  });

  it('the full lazy cycle emits the changes in order', () => {
    const { bus, lc } = fresh();
    const seen: string[] = [];
    bus.on('state:change', ({ to }) => { seen.push(to); });

    driveTo(lc, 'active');           // idle → … → active
    lc.transition('attached');       // pause
    lc.transition('resolved');       // eviction
    lc.transition('attaching');      // back
    lc.transition('attached');
    lc.destroy();

    expect(seen).toEqual([
      'resolving', 'resolved', 'attaching', 'attached', 'active',
      'attached', 'resolved', 'attaching', 'attached', 'destroyed',
    ]);
  });

  it('a failure while resolving goes back to idle', () => {
    const { lc } = fresh();
    lc.transition('resolving');
    expect(() => lc.transition('idle')).not.toThrow();
    expect(lc.state).toBe('idle');
  });

  it('a failure while attaching goes back to resolved, keeping the manifest', () => {
    const { lc } = fresh();
    driveTo(lc, 'attaching');
    lc.transition('resolved');
    expect(lc.hasManifest).toBe(true);
    expect(lc.hasEngine).toBe(false);
  });
});
