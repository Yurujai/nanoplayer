/**
 * Demo de directo.
 *
 * **Todavía no hay un directo enlazado.** GitHub Pages solo sirve ficheros
 * estáticos, así que las URLs de abajo no existen: al pulsar play el
 * reproductor enseña la espera de «aún no ha empezado» y reintenta, que es lo
 * que haría ante un directo que no emite. La página lo avisa arriba.
 *
 * Para enlazar uno basta con cambiar `FUENTES`: las dos listas tienen que
 * traer `EXT-X-PROGRAM-DATE-TIME`, o no se podrá medir la sincronización (S5).
 */
import { create, nativeEngineFactory } from '@nanoplayer/core';
import { enginesWithHls } from '@nanoplayer/engine-hls';
import { attachControls } from '@nanoplayer/ui';

const HLS = 'application/vnd.apple.mpegurl';
const FUENTES = {
  camera: '../media/live/camera.m3u8',
  slides: '../media/live/slides.m3u8',
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
