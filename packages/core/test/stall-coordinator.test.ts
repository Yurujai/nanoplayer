import { describe, expect, it, vi } from 'vitest';
import type { MediaEngine } from '../src/engine.js';
import { StallCoordinator } from '../src/stall-coordinator.js';

const engine = () => ({ pause: vi.fn(), play: vi.fn(async () => {}) }) as unknown as MediaEngine
  & { pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn> };

const setup = () => {
  const cam = engine();
  const slides = engine();
  const c = new StallCoordinator(() => new Map([['cam', cam], ['slides', slides]]).entries());
  return { c, cam, slides };
};

describe('StallCoordinator', () => {
  it('holds nobody back before playing: waiting at start-up is normal', () => {
    const { c, cam } = setup();
    c.stallStarted('slides');
    expect(cam.pause).not.toHaveBeenCalled();
  });

  it('while playing, holds the others back but not the stalled one', () => {
    const { c, cam, slides } = setup();
    c.markPlaying();
    c.stallStarted('slides');
    expect(cam.pause).toHaveBeenCalled();
    expect(slides.pause, 'it would abort its own play()').not.toHaveBeenCalled();
  });

  it('resumes only when nobody is stalled any more', () => {
    const { c, cam } = setup();
    c.markPlaying();
    c.stallStarted('slides');
    c.stallStarted('cam');
    c.stallEnded('slides');
    expect(cam.play).not.toHaveBeenCalled();
    c.stallEnded('cam');
    expect(cam.play).toHaveBeenCalled();
  });

  it('does not resume what the user paused', () => {
    const { c, cam } = setup();
    c.markPlaying();
    c.stallStarted('slides');
    c.userPaused();
    c.stallEnded('slides');
    expect(cam.play).not.toHaveBeenCalled();
  });
});
