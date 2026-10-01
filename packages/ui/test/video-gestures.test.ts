// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Player as RealPlayer, type Manifest, type Player } from '@nanoplayer/core';
import { AutoHide } from '../src/auto-hide.js';
import { attachControls } from '../src/control-bar.js';
import { VideoGestures } from '../src/video-gestures.js';

let root: HTMLElement;
let stage: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  stage = document.createElement('div');
  root.appendChild(stage);
  document.body.appendChild(root);
  stage.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 100 }) as DOMRect;
});

function setup(phase: 'intro' | 'main' = 'main', menuOpen = false) {
  const player = { phase, currentTime: 30, duration: 60, seek: vi.fn() } as unknown as Player
    & { seek: ReturnType<typeof vi.fn> };
  const actions = {
    togglePlay: vi.fn(), toggleFullscreen: vi.fn(), toggleControls: vi.fn(),
    isMenuOpen: () => menuOpen,
  };
  let clock = 0;
  const gestures = new VideoGestures(stage, root, player, actions, () => clock);
  const tap = (x: number, pointerType = 'touch', after = 100) => {
    clock += after;
    stage.dispatchEvent(new PointerEvent('pointerdown', { pointerType, bubbles: true }));
    stage.dispatchEvent(new MouseEvent('click', { clientX: x, bubbles: true }));
  };
  const hint = () => root.querySelector<HTMLElement>('.np__seek-hint')!;
  return { player, actions, gestures, tap, hint };
}

describe('VideoGestures · mouse', () => {
  it('a click plays or pauses', () => {
    const { actions, tap } = setup();
    tap(50, 'mouse');
    expect(actions.togglePlay).toHaveBeenCalledOnce();
  });

  it('a double click toggles full screen', () => {
    const { actions } = setup();
    stage.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
    stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(actions.toggleFullscreen).toHaveBeenCalledOnce();
  });

  it('a click that only closes the settings menu does not pause', () => {
    const { actions, tap } = setup('main', true);
    tap(50, 'mouse');
    expect(actions.togglePlay).not.toHaveBeenCalled();
  });
});

describe('VideoGestures · touch', () => {
  it('a tap shows or hides the controls instead of pausing', () => {
    const { actions, tap } = setup();
    tap(50);
    expect(actions.toggleControls).toHaveBeenCalledOnce();
    expect(actions.togglePlay).not.toHaveBeenCalled();
  });

  it('a double tap on the right half seeks forward, on the left half back', () => {
    const { player, tap } = setup();
    tap(150); tap(150);
    expect(player.seek).toHaveBeenLastCalledWith(40);
    tap(20, 'touch', 1000); tap(20);
    expect(player.seek).toHaveBeenLastCalledWith(20);
  });

  it('each further quick tap adds ten seconds more, and the hint says the total', () => {
    const { player, tap, hint } = setup();
    tap(150); tap(150); tap(150);
    expect(player.seek).toHaveBeenCalledTimes(2);
    expect(hint().hidden).toBe(false);
    expect(hint().textContent).toBe('+20 s');
    expect(hint().getAttribute('aria-hidden')).toBe('true');
  });

  it('two slow taps are two taps, not a seek', () => {
    const { player, actions, tap } = setup();
    tap(150); tap(150, 'touch', 500);
    expect(player.seek).not.toHaveBeenCalled();
    expect(actions.toggleControls).toHaveBeenCalledTimes(2);
  });

  it('does not seek during the intro, like the seeking keys', () => {
    const { player, tap } = setup('intro');
    tap(150); tap(150);
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('a touch double tap is never a full screen double click', () => {
    const { actions } = setup();
    stage.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(actions.toggleFullscreen).not.toHaveBeenCalled();
  });
});

describe('AutoHide · focus', () => {
  it('the player itself holding focus, after a click on the video, does not keep the bar up', () => {
    root.tabIndex = 0;
    root.focus();
    new AutoHide(root, 1000, () => true).sleep();
    expect(root.classList.contains('np--inactive')).toBe(true);
  });

  it('a control inside holding focus does', () => {
    const button = document.createElement('button');
    root.appendChild(button);
    button.focus();
    new AutoHide(root, 1000, () => true).sleep();
    expect(root.classList.contains('np--inactive')).toBe(false);
  });
});

describe('control bar · touch', () => {
  const manifest: Manifest = {
    id: 'x',
    streams: [{ id: 'a', role: 'presenter', audio: true, sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
  };

  it('taps show and hide the controls; the finger lifting must not hide them first', () => {
    // `pointerleave` on lift, and the focus the tap gives the player, both
    // changed them before the click, so the tap undid itself.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const player = new RealPlayer({ container: host, manifest });
    vi.spyOn(player, 'paused', 'get').mockReturnValue(false);
    attachControls(player, { poster: false });
    const stageEl = host.querySelector<HTMLElement>('.np__stage')!;
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const tap = () => {
      clock += 1000;
      stageEl.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      host.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'touch' }));
      // The order Chrome gives: the tap focuses the player before the click.
      host.focus();
      stageEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    // Pointer focus is not keyboard focus; happy-dom says it always is.
    const matches = host.matches.bind(host);
    vi.spyOn(host, 'matches').mockImplementation((q) => q !== ':focus-visible' && matches(q));
    host.classList.add('np--inactive');
    tap();
    expect(host.classList.contains('np--inactive'), 'shown').toBe(false);
    tap();
    expect(host.classList.contains('np--inactive'), 'hidden').toBe(true);
  });
});
