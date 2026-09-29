import { create, nativeEngineFactory } from '@nanoplayer/core';
import { enginesWithHls } from '@nanoplayer/engine-hls';
import { attachControls } from '@nanoplayer/ui';

/*
 * GitHub Pages only serves static files, so the stream comes from ireplay.tv's
 * public 24/7 test channel (open CORS, EXT-X-PROGRAM-DATE-TIME; its terms ask
 * for a link, which the page carries). Both streams come from the same channel,
 * so being in sync means both halves show the same frame.
 */
const HLS = 'application/vnd.apple.mpegurl';
const SOURCES = {
  camera: 'https://ireplay.tv/test/blender.m3u8',
  slides: 'https://ireplay.tv/test/rate_2_28.m3u8',
};
const TITLE = 'Live lecture';

const player = create('#player', {
  lang: 'en',
  engines: enginesWithHls(nativeEngineFactory),
  manifest: {
    id: 'demo-live',
    title: TITLE,
    live: true,
    poster: '../media/poster.jpg',
    streams: [
      { id: 'camera', role: 'presenter', label: 'Camera', audio: true,
        sources: [{ src: SOURCES.camera, type: HLS }] },
      { id: 'slides', role: 'presentation', label: 'Slides', audio: false,
        sources: [{ src: SOURCES.slides, type: HLS }] },
    ],
  },
});
attachControls(player, { label: TITLE });

// The channel declares EXT-X-START:TIME-OFFSET=36, almost 25 minutes behind
// live. The player honours it, but a live demo must open live: jump once.
let atEdge = false;
player.on('time', () => {
  if (atEdge || player.liveEdge <= 0) return;
  atEdge = true;
  player.seekToLive();
});
