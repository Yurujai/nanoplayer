import { create, type Manifest } from '@nanoplayer/core';
import { attachControls } from '@nanoplayer/ui';
import { createPlaylist } from '@nanoplayer/playlist';
import '@nanoplayer/plugin-captions';
import '@nanoplayer/plugin-chapters';
import '@nanoplayer/plugin-pip';
import '@nanoplayer/plugin-media-session';
import '@nanoplayer/plugin-transcript';
import '@nanoplayer/plugin-thumbnails';

// The page lives under /playlist/ and the media at the site root.
const MEDIA = '../media/';

const speaker = { id: 'speaker', role: 'presenter', label: 'Speaker', audio: true,
  sources: [{ src: `${MEDIA}presenter.mp4`, type: 'video/mp4' }] };
const slides = { id: 'slides', role: 'presentation', label: 'Slides', audio: false,
  sources: [{ src: `${MEDIA}slides.mp4`, type: 'video/mp4' }] };
const captions = [
  { src: `${MEDIA}en.vtt`, lang: 'en', label: 'English', kind: 'subtitles' as const },
  { src: `${MEDIA}es.vtt`, lang: 'es', label: 'Español', kind: 'subtitles' as const },
];

/** What each lecture shows, for the list beside the player. */
const LECTURES: Array<{ manifest: Manifest; summary: string }> = [
  {
    summary: 'One video',
    manifest: { id: 'playlist-1', title: 'Welcome', duration: 40, poster: `${MEDIA}poster.jpg`,
      streams: [speaker], thumbnails: `${MEDIA}thumbs.vtt` },
  },
  {
    summary: 'Speaker and slides, chapters, captions',
    manifest: { id: 'playlist-2', title: 'The first law', duration: 40, poster: `${MEDIA}poster.jpg`,
      streams: [speaker, slides], textTracks: captions, thumbnails: `${MEDIA}thumbs.vtt`,
      annotations: [
        { kind: 'chapter', start: 0, end: 12, title: 'Energy' },
        { kind: 'chapter', start: 12, end: 28, title: 'Work and heat' },
        { kind: 'chapter', start: 28, title: 'Summary' },
      ] },
  },
  {
    summary: 'With an intro and an outro',
    manifest: { id: 'playlist-3', title: 'Entropy', duration: 40, poster: `${MEDIA}poster.jpg`,
      streams: [speaker, slides], textTracks: captions,
      intro: { sources: [{ src: `${MEDIA}intro.mp4`, type: 'video/mp4' }] },
      outro: { sources: [{ src: `${MEDIA}outro.mp4`, type: 'video/mp4' }] } },
  },
];

const list = createPlaylist('#player', {
  items: LECTURES.map((l) => l.manifest),
  create: (el, manifest) => {
    const player = create(el, { manifest });
    attachControls(player, { label: 'Course player' });
    return player;
  },
});

// The list beside the player: the same items, kept in step with the bar's.
const queue = document.getElementById('queue')!;
const buttons = LECTURES.map((lecture, i) => {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = `<span class="n">${i + 1}</span><span class="what">`
    + `<b></b><span></span><span class="now" hidden>Now playing</span></span>`;
  button.querySelector('b')!.textContent = lecture.manifest.title ?? '';
  button.querySelector('.what > span')!.textContent = lecture.summary;
  button.addEventListener('click', () => list.go(i));
  item.appendChild(button);
  queue.appendChild(item);
  return button;
});

const mark = (index: number) => buttons.forEach((b, i) => {
  if (i === index) b.setAttribute('aria-current', 'true');
  else b.removeAttribute('aria-current');
  (b.querySelector('.now') as HTMLElement).hidden = i !== index;
});
list.onChange(mark);
mark(list.index);
