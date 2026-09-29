/**
 * The pieces of intro/content/outro chaining that do not depend on the player.
 * Measured in S6: starting the next piece when the previous one ends leaves a
 * 340–445 ms black gap; starting it early and switching on its first frame
 * leaves none. see docs/browser-quirks.md#first-frame-latency
 */
import type { MediaEngine } from './engine.js';

export type ChainPhase = 'intro' | 'main' | 'outro';

/** The pieces that are not the content. */
export type BumperPhase = Exclude<ChainPhase, 'main'>;

/**
 * How long before a piece ends the next one starts, in ms. S6: 300 ms is
 * enough in WebKit and 21 ms short in Chromium; 600 ms leaves no gap in either.
 */
export const CHAIN_LEAD_MS = 600;

/** How often the end of a piece is checked; `timeupdate` at ~4 Hz is too coarse. */
export const CHAIN_WATCH_MS = 50;

/** If no first frame arrives, switch anyway: a gap beats a stuck chain. */
export const FIRST_FRAME_TIMEOUT_MS = 3000;

type WithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?(cb: () => void): number;
};

/**
 * Resolves when the engine shows a frame on screen. Where
 * `requestVideoFrameCallback` is missing, or for audio only, it waits for time
 * to advance instead.
 */
export function firstFrame(engine: MediaEngine): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, FIRST_FRAME_TIMEOUT_MS);

    const el = engine.element as WithFrameCallback | null;
    if (typeof el?.requestVideoFrameCallback === 'function' && el.videoWidth !== 0) {
      el.requestVideoFrameCallback(finish);
      return;
    }
    const from = engine.currentTime;
    const check = () => {
      if (done) return;
      if (engine.currentTime !== from) finish();
      else setTimeout(check, 16);
    };
    check();
  });
}
