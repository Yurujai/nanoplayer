// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAIN_LEAD_MS } from '../src/chain.js';
import type { EngineFactory, MediaEngine } from '../src/engine.js';
import { Player } from '../src/player.js';

type Fake = MediaEngine & {
  _set(t: number): void;
  _cb(): any;
  _muted(): boolean;
  _plays: number;
};

const DURATIONS: Record<string, number> = { intro: 5, outro: 4 };

/**
 * Fake engine. Each stream has its duration, time moves by hand, and the first
 * frame arrives a tick after `play()`, as in a browser, so the switch can be
 * checked to wait for the picture.
 */
function fakeFactory(opts: { failing?: string[] } = {}) {
  const byId = new Map<string, Fake>();
  const factory: EngineFactory = {
    name: 'fake',
    canPlay: () => 'probably',
    create() {
      let currentTime = 0, paused = true, muted = false, duration = 60;
      let cb: any = {};
      let frames: Array<() => void> = [];
      const element = {
        seeking: false,
        videoWidth: 640,
        requestVideoFrameCallback(f: () => void) { frames.push(f); return 1; },
      };
      const e = {
        name: 'fake',
        get element() { return element as unknown as HTMLVideoElement; },
        attached: true,
        async attach(container: HTMLElement, s: { id: string }, o: any) {
          if (opts.failing?.includes(s.id)) throw new Error(`cannot load ${s.id}`);
          cb = o?.callbacks ?? {};
          muted = !!o?.muted;
          duration = DURATIONS[s.id] ?? 60;
          if (o?.startAt) currentTime = o.startAt;
          container.appendChild(document.createElement('video'));
          byId.set(s.id, e as never);
        },
        detach() {},
        async play() {
          e._plays++;
          paused = false;
          cb.onPlay?.();
          cb.onPlaying?.();
          setTimeout(() => {
            if (paused) return;
            const f = frames; frames = [];
            f.forEach((x) => x());
          }, 10);
        },
        pause() { if (paused) return; paused = true; cb.onPause?.(); },
        seek(t: number) { currentTime = t; },
        get currentTime() { return currentTime; },
        get duration() { return duration; },
        get paused() { return paused; },
        get ended() { return false; },
        get buffered() { return null; },
        get seekable() { return null; },
        getPlaybackRate: () => 1,
        setPlaybackRate() {},
        setVolume() {},
        setMuted(m: boolean) { muted = m; },
        destroy() {},
        _set(t: number) { currentTime = t; cb.onTime?.(t, duration); },
        _cb: () => cb,
        _muted: () => muted,
        _plays: 0,
      };
      return e as never;
    },
  };
  return { factory, byId };
}

const bumper = (src: string) => ({ sources: [{ src, type: 'video/mp4' }] });
const content = (over: Record<string, unknown> = {}) => ({
  id: 'c', duration: 60,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
  ...over,
});

let container: HTMLElement;

const setup = (manifest: unknown, opts: { failing?: string[] } = {}) => {
  const { factory, byId } = fakeFactory(opts);
  const p = new Player({ container, manifest: manifest as never, engines: [factory] });
  const engine = (id: string) => byId.get(id)!;
  const phases: Array<{ from: string; to: string; skipped: boolean }> = [];
  p.on('chain:phase', (x) => phases.push(x));
  const ends: number[] = [];
  p.on('ended', ({ at }) => ends.push(at));
  return { p, engine, phases, ends };
};

/** Moves the piece to `before` seconds from its end and lets the watcher run. */
async function nearEnd(e: Fake, before: number) {
  e._set(e.duration - before);
  await vi.advanceTimersByTimeAsync(100);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => { vi.useRealTimers(); });

describe('chain · no intro or outro', () => {
  it('starts and stays in the content', async () => {
    const { p, phases } = setup(content());
    await p.play();
    expect(p.phase).toBe('main');
    expect(container.querySelector('[data-bumper]')).toBeNull();
    expect(phases).toEqual([]);
  });
});

describe('chain · intro', () => {
  it('the intro plays while the content waits behind, muted and stopped', async () => {
    const { p, engine } = setup(content({ intro: bumper('intro.mp4') }));
    await p.play();
    expect(p.phase).toBe('intro');
    expect(container.dataset['phase']).toBe('intro');
    expect(engine('intro').paused).toBe(false);
    expect(engine('intro')._muted()).toBe(false);
    expect(engine('cam').paused).toBe(true);
    expect(engine('cam')._muted()).toBe(true);
    expect(p.state).toBe('active');
    expect(p.paused).toBe(false);
  });

  it('unlocks content and outro at start-up, without leaving them playing', async () => {
    const { p, engine } = setup(content({ intro: bumper('intro.mp4'), outro: bumper('outro.mp4') }));
    await p.play();
    for (const id of ['cam', 'outro']) {
      expect(engine(id)._plays, id).toBe(1);
      expect(engine(id).paused, id).toBe(true);
    }
  });

  it('does not switch before the lead window', async () => {
    const { p, engine } = setup(content({ intro: bumper('intro.mp4') }));
    await p.play();
    await nearEnd(engine('intro'), 1.5);
    expect(p.phase).toBe('intro');
    expect(engine('cam').paused).toBe(true);
  });

  it('starts the content before the end and switches on its first frame', async () => {
    const { p, engine, phases } = setup(content({ intro: bumper('intro.mp4') }));
    await p.play();
    engine('intro')._set(5 - CHAIN_LEAD_MS / 1000 + 0.1);
    await vi.advanceTimersByTimeAsync(50);
    // Started, but not yet shown: its first frame is missing.
    expect(engine('cam').paused).toBe(false);
    expect(engine('cam')._muted()).toBe(true);
    expect(p.phase).toBe('intro');

    await vi.advanceTimersByTimeAsync(20);
    expect(p.phase).toBe('main');
    expect(container.dataset['phase']).toBe('main');
    expect(engine('cam')._muted()).toBe(false);
    expect(engine('intro').paused).toBe(true);
    expect(phases).toEqual([{ from: 'intro', to: 'main', skipped: false }]);
    expect(p.state).toBe('active');
  });

  it('emits no pause or play on the switch: to the viewer it never stopped', async () => {
    const { p, engine } = setup(content({ intro: bumper('intro.mp4') }));
    await p.play();
    const seen: string[] = [];
    p.on('play', () => seen.push('play'));
    p.on('pause', () => seen.push('pause'));
    await nearEnd(engine('intro'), 0.3);
    expect(p.phase).toBe('main');
    expect(seen).toEqual([]);
  });

  it('intro progress goes through chain:time, not time', async () => {
    const { p, engine } = setup(content({ intro: bumper('intro.mp4') }));
    const time = vi.fn(), chain = vi.fn();
    p.on('time', time);
    p.on('chain:time', chain);
    await p.play();
    engine('intro')._set(2);
    expect(chain).toHaveBeenCalledWith({ phase: 'intro', current: 2, duration: 5 });
    expect(time).not.toHaveBeenCalled();
    expect(p.currentTime).toBe(0);
  });

  it('if the watcher misses it, the intro\'s end forces the switch', async () => {
    const { p, engine } = setup(content({ intro: bumper('intro.mp4') }));
    await p.play();
    engine('intro')._cb().onEnded();
    await vi.advanceTimersByTimeAsync(20);
    expect(p.phase).toBe('main');
  });
});

describe('chain · skipping', () => {
  it('skipping the intro switches to the content without waiting for its end', async () => {
    const { p, engine, phases } = setup(content({ intro: bumper('intro.mp4') }));
    await p.play();
    expect(p.canSkip).toBe(true);
    p.skipIntro();
    await vi.advanceTimersByTimeAsync(20);
    expect(p.phase).toBe('main');
    expect(engine('cam').paused).toBe(false);
    expect(phases).toEqual([{ from: 'intro', to: 'main', skipped: true }]);
  });

  it('skipping it before playing does not even attach it', async () => {
    const { p } = setup(content({ intro: bumper('intro.mp4') }));
    await p.resolve();
    p.skipIntro();
    await p.play();
    expect(p.phase).toBe('main');
    expect(container.querySelector('[data-bumper="intro"]')).toBeNull();
  });

  it('skipping it while paused starts the content and the state shows it', async () => {
    const { p } = setup(content({ intro: bumper('intro.mp4') }));
    await p.play();
    p.pause();
    expect(p.state).toBe('attached');
    const play = vi.fn();
    p.on('play', play);
    p.skipIntro();
    await vi.advanceTimersByTimeAsync(20);
    expect(p.state).toBe('active');
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('there is nothing to skip in the content or the outro', async () => {
    const { p, engine } = setup(content({ outro: bumper('outro.mp4') }));
    await p.play();
    expect(p.canSkip).toBe(false);
    p.skipIntro();
    expect(p.phase).toBe('main');
    await nearEnd(engine('cam'), 0.3);
    expect(p.phase).toBe('outro');
    expect(p.canSkip).toBe(false);
  });
});

describe('chain · outro', () => {
  it('enters before the content ends, and ended arrives when it finishes', async () => {
    const { p, engine, phases, ends } = setup(content({ outro: bumper('outro.mp4') }));
    await p.play();
    await nearEnd(engine('cam'), 0.3);
    expect(p.phase).toBe('outro');
    expect(phases).toEqual([{ from: 'main', to: 'outro', skipped: false }]);
    expect(engine('outro')._muted()).toBe(false);
    expect(engine('cam').paused).toBe(true);
    expect(ends).toEqual([]);
    expect(p.currentTime).toBe(60);

    engine('outro').pause();
    engine('outro')._cb().onEnded();
    expect(ends).toEqual([60]);
  });

  it('with a trim, the lead counts from the trim\'s end', async () => {
    const { p, engine, ends } = setup(content({
      outro: bumper('outro.mp4'),
      annotations: [{ kind: 'trim', start: 10, end: 40 }],
    }));
    await p.play();
    engine('cam')._set(39.8);
    await vi.advanceTimersByTimeAsync(100);
    expect(p.phase).toBe('outro');
    expect(ends).toEqual([]);
  });

  it('at the trim\'s end it stops there while the outro enters', async () => {
    const { p, engine } = setup(content({
      outro: bumper('outro.mp4'),
      annotations: [{ kind: 'trim', start: 10, end: 40 }],
    }));
    await p.play();
    engine('cam')._set(40);
    expect(engine('cam').paused).toBe(true);
    expect(p.state).toBe('active');
    await vi.advanceTimersByTimeAsync(20);
    expect(p.phase).toBe('outro');
  });

  it('the outro cannot be left forward', async () => {
    const { p, engine } = setup(content({ outro: bumper('outro.mp4') }));
    await p.play();
    await nearEnd(engine('cam'), 0.3);
    p.seek(60);
    p.seek(999);
    expect(p.phase).toBe('outro');
    expect(engine('outro').paused).toBe(false);
  });

  it('seeking back returns to the content, and the outro plays again at the end', async () => {
    const { p, engine, phases } = setup(content({ outro: bumper('outro.mp4') }));
    await p.play();
    await nearEnd(engine('cam'), 0.3);
    p.seek(30);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.phase).toBe('main');
    expect(engine('outro').paused).toBe(true);
    expect(engine('cam').paused).toBe(false);
    expect(engine('cam')._muted()).toBe(false);
    expect(p.currentTime).toBe(30);

    await nearEnd(engine('cam'), 0.3);
    expect(p.phase).toBe('outro');
    expect(phases.map((f) => f.to)).toEqual(['outro', 'main', 'outro']);
  });

  it('play after the whole chain returns to the content, without the intro', async () => {
    const { p, engine } = setup(content({ intro: bumper('intro.mp4'), outro: bumper('outro.mp4') }));
    await p.play();
    await nearEnd(engine('intro'), 0.3);
    await nearEnd(engine('cam'), 0.3);
    engine('outro').pause();
    engine('outro')._cb().onEnded();

    await p.play();
    expect(p.phase).toBe('main');
    expect(p.currentTime).toBe(0);
    expect(engine('cam').paused).toBe(false);
  });
});

describe('chain · cancelling', () => {
  it('pausing during the switch cancels it and stops the incoming piece', async () => {
    const { p, engine } = setup(content({ intro: bumper('intro.mp4') }));
    await p.play();
    engine('intro')._set(4.6);
    await vi.advanceTimersByTimeAsync(50);
    expect(engine('cam').paused).toBe(false);
    p.pause();
    await vi.advanceTimersByTimeAsync(50);
    expect(p.phase).toBe('intro');
    expect(engine('cam').paused).toBe(true);
    expect(p.state).toBe('attached');

    // On resume, the watcher fires it again.
    await p.play();
    await vi.advanceTimersByTimeAsync(100);
    expect(p.phase).toBe('main');
  });

  it('seeking back while the outro enters defers it', async () => {
    const { p, engine } = setup(content({ outro: bumper('outro.mp4') }));
    await p.play();
    engine('cam')._set(59.6);
    await vi.advanceTimersByTimeAsync(50);
    expect(engine('outro').paused).toBe(false);
    p.seek(20);
    await vi.advanceTimersByTimeAsync(50);
    expect(p.phase).toBe('main');
    expect(engine('outro').paused).toBe(true);
    expect(engine('cam').paused).toBe(false);
  });
});

describe('chain · sound', () => {
  it('muting during the intro carries over to the content', async () => {
    const { p, engine } = setup(content({ intro: bumper('intro.mp4') }));
    await p.play();
    p.setMuted(true);
    expect(engine('intro')._muted()).toBe(true);
    await nearEnd(engine('intro'), 0.3);
    expect(p.phase).toBe('main');
    expect(engine('cam')._muted()).toBe(true);
  });
});

describe('chain · failing pieces', () => {
  it('an intro that fails to load is skipped and the content plays', async () => {
    const { p, engine } = setup(content({ intro: bumper('intro.mp4') }), { failing: ['intro'] });
    const lost = vi.fn();
    p.on('chain:unavailable', lost);
    await p.play();
    expect(p.phase).toBe('main');
    expect(engine('cam').paused).toBe(false);
    expect(lost).toHaveBeenCalledWith(expect.objectContaining({ phase: 'intro' }));
  });

  it('without the outro, the content ends as usual', async () => {
    const { p, engine, ends } = setup(content({ outro: bumper('outro.mp4') }), { failing: ['outro'] });
    await p.play();
    await nearEnd(engine('cam'), 0.3);
    expect(p.phase).toBe('main');
    engine('cam')._cb().onEnded();
    expect(ends).toHaveLength(1);
  });
});

describe('chain · eviction', () => {
  it('detaching during the intro replays it from the start on return', async () => {
    const { p, engine } = setup(content({ intro: bumper('intro.mp4') }));
    await p.play();
    engine('intro')._set(3);
    p.detach();
    expect(container.querySelector('[data-bumper]')).toBeNull();
    await p.play();
    expect(p.phase).toBe('intro');
    expect(engine('intro').currentTime).toBe(0);
  });
});
