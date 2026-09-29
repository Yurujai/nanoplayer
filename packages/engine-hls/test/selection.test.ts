// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { nativeEngineFactory, selectEngine, type Stream } from '@nanoplayer/core';
import { enginesWithHls, hlsEngineFactory } from '../src/index.js';

const g = globalThis as { MediaSource?: unknown; ManagedMediaSource?: unknown };
const previous = { ms: g.MediaSource, mms: g.ManagedMediaSource };

const withMse = () => { g.MediaSource = function () {}; };
const withManagedMse = () => {
  delete g.MediaSource;
  g.ManagedMediaSource = function () {};
};
const withoutMse = () => { delete g.MediaSource; delete g.ManagedMediaSource; };

afterEach(() => {
  if (previous.ms === undefined) delete g.MediaSource; else g.MediaSource = previous.ms;
  if (previous.mms === undefined) delete g.ManagedMediaSource;
  else g.ManagedMediaSource = previous.mms;
});

const HLS = { src: 'a.m3u8', type: 'application/vnd.apple.mpegurl' };
const MP4 = { src: 'a.mp4', type: 'video/mp4' };

const stream = (sources: Array<{ src: string; type: string }>): Stream => ({
  id: 'cam', role: 'presenter', audio: true, sources,
});

describe('hlsEngineFactory · what it claims it can play', () => {
  it('only HLS: not offered for MP4', () => {
    withMse();
    expect(hlsEngineFactory.canPlay(MP4)).toBe('no');
    expect(hlsEngineFactory.canPlay({ src: 'a.webm', type: 'video/webm' })).toBe('no');
  });

  it('with MSE it says yes', () => {
    withMse();
    expect(hlsEngineFactory.canPlay(HLS)).toBe('probably');
  });

  it('ManagedMediaSource counts too', () => {
    // Safari 17+'s variant, found on iOS 26 by S2: without it hls.js never runs on iPhone.
    withManagedMse();
    expect(hlsEngineFactory.canPlay(HLS)).toBe('probably');
  });

  it('without MSE it says no instead of trying and failing', () => {
    withoutMse();
    expect(hlsEngineFactory.canPlay(HLS)).toBe('no');
  });

  it('recognises MIME type variants', () => {
    withMse();
    for (const type of ['application/x-mpegURL', 'APPLICATION/VND.APPLE.MPEGURL',
                        'application/vnd.apple.mpegurl; charset=utf-8']) {
      expect(hlsEngineFactory.canPlay({ src: 'a.m3u8', type }), type).toBe('probably');
    }
  });
});

describe('split with the native engine', () => {
  it('with MSE hls.js wins', () => {
    // The native engine says `maybe` for HLS. See docs/browser-quirks.md#canplaytype-hls
    withMse();
    const chosen = selectEngine(enginesWithHls(nativeEngineFactory), stream([HLS]));
    expect(chosen?.name).toBe('hls.js');
  });

  it('without MSE the native engine wins, the only way on iOS', () => {
    withoutMse();
    const chosen = selectEngine(enginesWithHls(nativeEngineFactory), stream([HLS]));
    expect(chosen?.name).toBe('native');
  });

  it('never gets in the way of MP4', () => {
    withMse();
    const chosen = selectEngine(enginesWithHls(nativeEngineFactory), stream([MP4]));
    expect(chosen?.name).not.toBe('hls.js');
  });

  it('registering it first is enough: no conditionals outside canPlay', () => {
    withMse();
    const nativeOnly = selectEngine([nativeEngineFactory], stream([HLS]));
    const withHls = selectEngine(enginesWithHls(nativeEngineFactory), stream([HLS]));
    expect(nativeOnly?.name).toBe('native');
    expect(withHls?.name).toBe('hls.js');
  });
});
