import { create, type Manifest, type Player } from '@nanoplayer/core';
import { attachControls, type ControlBar } from '@nanoplayer/ui';
import '@nanoplayer/plugin-captions';
import '@nanoplayer/plugin-chapters';
import '@nanoplayer/plugin-pip';
import '@nanoplayer/plugin-audio-tracks';
import '@nanoplayer/plugin-media-session';
import '@nanoplayer/plugin-quality';
import '@nanoplayer/plugin-resume';
import '@nanoplayer/plugin-transcript';

// The page lives under /video/ and the media at the site root.
const MEDIA = '../media/';
const TITLE = 'Introduction to thermodynamics';

function manifestFor(dual: boolean, withBumpers: boolean): Manifest {
  return {
    id: `demo-${dual ? 'dual' : 'single'}${withBumpers ? '-bumpers' : ''}`,
    title: TITLE,
    duration: 40,
    poster: `${MEDIA}poster.jpg`,
    streams: [
      { id: 'speaker', role: 'presenter', label: 'Speaker', audio: true,
        sources: [{ src: `${MEDIA}presenter.mp4`, type: 'video/mp4', height: 540 }] },
      ...(dual ? [
        { id: 'slides', role: 'presentation', label: 'Slides', audio: false,
          sources: [{ src: `${MEDIA}slides.mp4`, type: 'video/mp4', height: 540 }] },
      ] : []),
    ],
    ...(withBumpers ? {
      intro: { sources: [{ src: `${MEDIA}intro.mp4`, type: 'video/mp4' }] },
      outro: { sources: [{ src: `${MEDIA}outro.mp4`, type: 'video/mp4' }] },
    } : {}),
    textTracks: [
      { src: `${MEDIA}en.vtt`, lang: 'en', label: 'English', kind: 'subtitles' },
      { src: `${MEDIA}es.vtt`, lang: 'es', label: 'Español', kind: 'subtitles' },
      { src: `${MEDIA}en-descriptions.vtt`, lang: 'en', label: 'English', kind: 'descriptions' },
    ],
    annotations: [
      { kind: 'chapter', start: 0, end: 12, title: 'Welcome' },
      { kind: 'chapter', start: 12, end: 28, title: 'The first law' },
      { kind: 'chapter', start: 28, title: 'Wrap-up' },
    ],
  };
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

let player: Player | null = null;
let controls: ControlBar | null = null;

/**
 * Switching options recreates the player, as an integrator would. If the old
 * one had started, the new one resumes where it was and does not replay the
 * intro: turning bumpers on mid-lecture should not send anyone back to the start.
 */
async function mount(): Promise<void> {
  const dual = $<HTMLInputElement>('#mode-dual').checked;
  const withBumpers = $<HTMLInputElement>('#bumpers').checked;
  const from = player && player.state !== 'idle' ? player.currentTime : 0;
  const wasPlaying = !!player && !player.paused;

  controls?.destroy();
  player?.destroy();
  // A clean container: the old one keeps the control bar's classes and attributes.
  const container = document.createElement('div');
  container.id = 'player';
  container.className = 'player';
  $('#player').replaceWith(container);

  player = create(container, { manifest: manifestFor(dual, withBumpers), lang: 'en' });
  controls = attachControls(player, { label: TITLE });

  if (from > 0 || wasPlaying) {
    await player.resolve();
    player.skipIntro();
    player.seek(from);
    if (wasPlaying) await player.play().catch(() => {});
  }
}

for (const sel of ['#mode-single', '#mode-dual', '#bumpers']) {
  $(sel).addEventListener('change', () => { void mount(); });
}
void mount();
