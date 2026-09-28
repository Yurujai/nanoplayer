/**
 * Demo de directo.
 *
 * GitHub Pages solo sirve ficheros estáticos, así que el directo es de fuera:
 * el canal público de pruebas de ireplay.tv, que emite 24/7 con ventana DVR de
 * unos 25 minutos, CORS abierto y `EXT-X-PROGRAM-DATE-TIME`, que es lo que hace
 * falta para sincronizar dos directos (S5). Sus condiciones piden enlazarlo
 * donde se use, y la página lo hace.
 *
 * Los dos flujos salen del mismo canal: la lista principal, con audio, hace de
 * cámara, y una variante de solo vídeo, de diapositivas. No es realista, pero
 * precisamente por eso la sincronización se ve a simple vista: las dos mitades
 * tienen que enseñar el mismo fotograma.
 */
import { create, nativeEngineFactory } from '@nanoplayer/core';
import { enginesWithHls } from '@nanoplayer/engine-hls';
import { attachControls } from '@nanoplayer/ui';

const HLS = 'application/vnd.apple.mpegurl';
const FUENTES = {
  camera: 'https://ireplay.tv/test/blender.m3u8',
  slides: 'https://ireplay.tv/test/rate_2_28.m3u8',
};
const TITULO = 'Live lecture';

const player = create('#player', {
  lang: 'en',
  // hls.js delante: fuera de Safari es lo único que reproduce HLS.
  engines: enginesWithHls(nativeEngineFactory),
  manifest: {
    id: 'demo-live',
    title: TITULO,
    live: true,
    poster: '../media/poster.jpg',
    streams: [
      { id: 'camera', role: 'presenter', label: 'Camera', audio: true,
        sources: [{ src: FUENTES.camera, type: HLS }] },
      { id: 'slides', role: 'presentation', label: 'Slides', audio: false,
        sources: [{ src: FUENTES.slides, type: HLS }] },
    ],
  },
});
attachControls(player, { label: TITULO });

/*
 * El canal declara `EXT-X-START:TIME-OFFSET=36`: empezar a los 36 s del
 * principio de la ventana, casi 25 minutos por detrás del directo. El
 * reproductor lo respeta, porque es lo que dice el estándar, pero una demo de
 * directo tiene que abrir en directo. Se salta al borde una sola vez, en
 * cuanto se sabe dónde está; después, retroceder es cosa de quien mira.
 */
let enBorde = false;
player.on('time', () => {
  if (enBorde || player.liveEdge <= 0) return;
  enBorde = true;
  player.seekToLive();
});
