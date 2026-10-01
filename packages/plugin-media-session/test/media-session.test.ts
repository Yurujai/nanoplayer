// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, type EngineFactory, type Manifest, type Player } from '@nanoplayer/core';

/** The browser's session: it keeps the handlers it is given, as the system's buttons. */
function fakeSession() {
  const handlers = new Map<string, MediaSessionActionHandler>();
  return {
    metadata: null as MediaMetadata | null,
    playbackState: 'none' as MediaSessionPlaybackState,
    position: null as MediaPositionState | null,
    handlers,
    setActionHandler(action: string, handler: MediaSessionActionHandler | null) {
      if (handler) handlers.set(action, handler); else handlers.delete(action);
    },
    setPositionState(state: MediaPositionState) { this.position = state; },
    run(action: string, details: Partial<MediaSessionActionDetails> = {}) {
      handlers.get(action)?.({ action, ...details } as MediaSessionActionDetails);
    },
  };
}

let session: ReturnType<typeof fakeSession>;

beforeEach(() => {
  document.body.innerHTML = '';
  session = fakeSession();
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
  vi.stubGlobal('MediaMetadata', class { constructor(init: MediaMetadataInit) { Object.assign(this, init); } });
});
afterEach(() => {
  delete (navigator as { mediaSession?: unknown }).mediaSession;
  vi.unstubAllGlobals();
});

await import('../src/index.js');

const engines: EngineFactory[] = [{
  name: 'fake',
  canPlay: () => 'probably',
  create: () => ({
    element: null,
    async attach() {},
    destroy() {},
    pause() {},
    setVolume() {},
    setMuted() {},
    getPlaybackRate: () => 1,
  }) as never,
}];

const lecture: Manifest = {
  id: 'lecture',
  title: 'Thermodynamics',
  poster: 'https://example.org/poster.jpg',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
  annotations: [
    { kind: 'chapter', start: 0, title: 'Welcome' },
    { kind: 'chapter', start: 60, title: 'The first law' },
    { kind: 'chapter', start: 120, title: 'Entropy' },
  ],
};

async function mount(manifest: Manifest = lecture) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const player = create(host, { manifest, engines, registry: false });
  await player.resolve();
  await new Promise((r) => setTimeout(r, 0));
  await player.attach();
  let now = 0;
  vi.spyOn(player, 'currentTime', 'get').mockImplementation(() => now);
  vi.spyOn(player, 'duration', 'get').mockReturnValue(180);
  const seek = vi.spyOn(player, 'seek').mockImplementation((t) => { now = t; });
  const at = (t: number) => { now = t; player.bus.emit('time', { current: t, duration: 180 }); };
  const play = () => player.bus.emit('play', { at: now });
  return { player, seek, at, play };
}

describe('media session plugin', () => {
  it('takes the session when it plays, with title, chapter and poster', async () => {
    const { at, play } = await mount();
    play();
    at(70);
    expect(session.playbackState).toBe('playing');
    expect(session.metadata).toMatchObject({
      title: 'Thermodynamics', artist: 'The first law',
      artwork: [{ src: 'https://example.org/poster.jpg' }],
    });
    expect(session.position).toEqual({ duration: 180, position: 70, playbackRate: 1 });
  });

  it('play and pause from the system drive the player', async () => {
    const { player, play } = await mount();
    const playSpy = vi.spyOn(player, 'play').mockResolvedValue();
    const pause = vi.spyOn(player, 'pause').mockImplementation(() => {});
    play();
    session.run('pause');
    session.run('play');
    expect(pause).toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalled();
  });

  it('seeks by the offset the system asks for, ten seconds otherwise', async () => {
    const { seek, at, play } = await mount();
    play();
    at(50);
    session.run('seekforward');
    expect(seek).toHaveBeenLastCalledWith(60);
    session.run('seekbackward', { seekOffset: 30 });
    expect(seek).toHaveBeenLastCalledWith(30);
    session.run('seekto', { seekTime: 100 });
    expect(seek).toHaveBeenLastCalledWith(100);
  });

  it('next and previous move between chapters; previous restarts one already under way', async () => {
    const { seek, at, play } = await mount();
    play();
    at(70);
    session.run('nexttrack');
    expect(seek).toHaveBeenLastCalledWith(120);
    at(130);
    session.run('previoustrack');
    expect(seek, 'ten seconds in: back to its start').toHaveBeenLastCalledWith(120);
    at(121);
    session.run('previoustrack');
    expect(seek, 'just started: the chapter before').toHaveBeenLastCalledWith(60);
  });

  it('without chapters there are no next and previous buttons', async () => {
    const { play } = await mount({ ...lecture, annotations: [] });
    play();
    expect(session.handlers.has('nexttrack')).toBe(false);
    expect(session.handlers.has('previoustrack')).toBe(false);
  });

  it('during the intro nothing seeks, and next skips it', async () => {
    const { player, play } = await mount();
    vi.spyOn(player, 'phase', 'get').mockReturnValue('intro');
    const skip = vi.spyOn(player, 'skipIntro').mockImplementation(() => {});
    play();
    expect(session.handlers.has('seekforward')).toBe(false);
    expect(session.handlers.has('seekto')).toBe(false);
    session.run('nexttrack');
    expect(skip).toHaveBeenCalled();
  });

  it('live has play and pause only, and no position', async () => {
    const { play } = await mount({ ...lecture, live: true, annotations: [] });
    play();
    expect([...session.handlers.keys()].sort()).toEqual(['pause', 'play', 'stop']);
    expect(session.position).toBeNull();
  });

  it('the session follows whichever player started last', async () => {
    const first = await mount();
    const second = await mount({ ...lecture, title: 'Entropy, revisited' });
    first.play();
    second.play();
    expect(session.metadata).toMatchObject({ title: 'Entropy, revisited' });
    first.player.bus.emit('pause', { at: 0 });
    expect(session.playbackState, 'a pause elsewhere is not ours').toBe('playing');
    session.run('seekforward');
    expect(second.seek).toHaveBeenCalled();
    expect(first.seek).not.toHaveBeenCalled();
  });

  it('gives the session back when its player goes', async () => {
    const { player, play } = await mount();
    play();
    player.destroy();
    expect(session.handlers.size).toBe(0);
    expect(session.metadata).toBeNull();
  });
});
