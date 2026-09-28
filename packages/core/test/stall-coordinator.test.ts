import { describe, expect, it, vi } from 'vitest';
import type { MediaEngine } from '../src/engine.js';
import { StallCoordinator } from '../src/stall-coordinator.js';

const motor = () => ({ pause: vi.fn(), play: vi.fn(async () => {}) }) as unknown as MediaEngine
  & { pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn> };

const conjunto = () => {
  const cam = motor();
  const slides = motor();
  const c = new StallCoordinator(() => new Map([['cam', cam], ['slides', slides]]).entries());
  return { c, cam, slides };
};

describe('StallCoordinator', () => {
  it('antes de sonar no frena a nadie: el waiting del arranque es normal', () => {
    const { c, cam } = conjunto();
    c.stallStarted('slides');
    expect(cam.pause).not.toHaveBeenCalled();
  });

  it('sonando, frena a los demás pero no al que se atasca', () => {
    const { c, cam, slides } = conjunto();
    c.markPlaying();
    c.stallStarted('slides');
    expect(cam.pause).toHaveBeenCalled();
    expect(slides.pause, 'abortaría su propio play()').not.toHaveBeenCalled();
  });

  it('solo reanuda cuando ya no queda nadie atascado', () => {
    const { c, cam } = conjunto();
    c.markPlaying();
    c.stallStarted('slides');
    c.stallStarted('cam');
    c.stallEnded('slides');
    expect(cam.play).not.toHaveBeenCalled();
    c.stallEnded('cam');
    expect(cam.play).toHaveBeenCalled();
  });

  it('no resucita lo que el usuario pausó', () => {
    const { c, cam } = conjunto();
    c.markPlaying();
    c.stallStarted('slides');
    c.userPaused();
    c.stallEnded('slides');
    expect(cam.play).not.toHaveBeenCalled();
  });
});
