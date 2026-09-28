// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Player } from '@nanoplayer/core';
import { KeyboardShortcuts } from '../src/keyboard-shortcuts.js';

const SEEK_KEYS = ['ArrowLeft', 'ArrowRight', 'j', 'J', 'l', 'L', 'Home', 'End',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function setup(phase: 'intro' | 'main') {
  const player = { phase, currentTime: 20, duration: 60, seek: vi.fn() } as unknown as Player
    & { seek: ReturnType<typeof vi.fn> };
  const actions = {
    togglePlay: vi.fn(), toggleMute: vi.fn(), stepVolume: vi.fn(),
    toggleFullscreen: vi.fn(), isMenuOpen: () => false, used: vi.fn(),
  };
  const shortcuts = new KeyboardShortcuts(player, actions);
  const press = (key: string) => shortcuts.handle(new KeyboardEvent('keydown', { key }));
  return { player, actions, press };
}

describe('KeyboardShortcuts', () => {
  it('no key that moves the position works during the intro', () => {
    const { player, press } = setup('intro');
    for (const key of SEEK_KEYS) press(key);
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('the same keys do seek during the content', () => {
    const { player, press } = setup('main');
    for (const key of SEEK_KEYS) press(key);
    expect(player.seek).toHaveBeenCalledTimes(SEEK_KEYS.length);
  });

  it('keys that do not seek still work during the intro', () => {
    const { actions, press } = setup('intro');
    press(' ');
    press('m');
    expect(actions.togglePlay).toHaveBeenCalled();
    expect(actions.toggleMute).toHaveBeenCalled();
  });
});
