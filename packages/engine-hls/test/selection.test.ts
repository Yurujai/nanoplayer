// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { nativeEngineFactory, selectEngine, type Stream } from '@nanoplayer/core';
import { enginesWithHls, hlsEngineFactory } from '../src/index.js';

const g = globalThis as { MediaSource?: unknown; ManagedMediaSource?: unknown };
const previo = { ms: g.MediaSource, mms: g.ManagedMediaSource };

const conMse = () => { g.MediaSource = function () {}; };
const conManagedMse = () => {
  delete g.MediaSource;
  g.ManagedMediaSource = function () {};
};
const sinMse = () => { delete g.MediaSource; delete g.ManagedMediaSource; };

afterEach(() => {
  if (previo.ms === undefined) delete g.MediaSource; else g.MediaSource = previo.ms;
  if (previo.mms === undefined) delete g.ManagedMediaSource;
  else g.ManagedMediaSource = previo.mms;
});

const HLS = { src: 'a.m3u8', type: 'application/vnd.apple.mpegurl' };
const MP4 = { src: 'a.mp4', type: 'video/mp4' };

const stream = (sources: Array<{ src: string; type: string }>): Stream => ({
  id: 'cam', role: 'presenter', audio: true, sources,
});

describe('hlsEngineFactory · qué dice que puede reproducir', () => {
  it('solo HLS: no se ofrece para MP4', () => {
    conMse();
    expect(hlsEngineFactory.canPlay(MP4)).toBe('no');
    expect(hlsEngineFactory.canPlay({ src: 'a.webm', type: 'video/webm' })).toBe('no');
  });

  it('con MSE afirma que sí', () => {
    conMse();
    expect(hlsEngineFactory.canPlay(HLS)).toBe('probably');
  });

  it('ManagedMediaSource también vale', () => {
    // Es la variante que introdujo Safari 17 y que S2 encontró en iOS 26. Sin
    // reconocerla, en iPhone no habría forma de usar hls.js.
    conManagedMse();
    expect(hlsEngineFactory.canPlay(HLS)).toBe('probably');
  });

  it('sin MSE dice que no, en vez de intentarlo y fallar', () => {
    sinMse();
    expect(hlsEngineFactory.canPlay(HLS)).toBe('no');
  });

  it('reconoce las variantes del tipo MIME', () => {
    conMse();
    for (const type of ['application/x-mpegURL', 'APPLICATION/VND.APPLE.MPEGURL',
                        'application/vnd.apple.mpegurl; charset=utf-8']) {
      expect(hlsEngineFactory.canPlay({ src: 'a.m3u8', type }), type).toBe('probably');
    }
  });
});

describe('reparto con el motor nativo', () => {
  it('con MSE gana hls.js', () => {
    // El nativo se rebaja a `maybe` para HLS porque `canPlayType` miente; este
    // afirma `probably`. El reparto sale solo de ahí.
    conMse();
    const elegido = selectEngine(enginesWithHls(nativeEngineFactory), stream([HLS]));
    expect(elegido?.name).toBe('hls.js');
  });

  it('sin MSE gana el nativo, que es la única vía en iOS', () => {
    sinMse();
    const elegido = selectEngine(enginesWithHls(nativeEngineFactory), stream([HLS]));
    expect(elegido?.name).toBe('native');
  });

  it('para MP4 nunca se mete por medio', () => {
    conMse();
    const elegido = selectEngine(enginesWithHls(nativeEngineFactory), stream([MP4]));
    expect(elegido?.name).not.toBe('hls.js');
  });

  it('el reparto no necesita condicionales fuera de canPlay', () => {
    // Toda la decisión vive en canPlay: registrar el motor delante basta.
    conMse();
    const soloNativo = selectEngine([nativeEngineFactory], stream([HLS]));
    const conHls = selectEngine(enginesWithHls(nativeEngineFactory), stream([HLS]));
    expect(soloNativo?.name).toBe('native');
    expect(conHls?.name).toBe('hls.js');
  });
});
