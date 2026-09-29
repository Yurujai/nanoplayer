import {
  createPlayer, nativeEngineFactory, plugins, type Manifest, type Player,
} from '@nanoplayer/core';
import { enginesWithHls } from '@nanoplayer/engine-hls';
import { attachControls, type ControlBar } from '@nanoplayer/ui';
import '@nanoplayer/plugin-captions';
import '@nanoplayer/plugin-chapters';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const MANIFESTS: Record<string, unknown> = {
  single: {
    id: 'demo-single',
    title: 'Single stream',
    duration: 40,
    streams: [
      { id: 'cam', role: 'presenter', label: 'Speaker', audio: true,
        sources: [{ src: '../media/presenter.mp4', type: 'video/mp4' }] },
    ],
  },
  dual: {
    id: 'demo-dual',
    title: 'Dual stream',
    duration: 40,
    streams: [
      { id: 'cam', role: 'presenter', label: 'Speaker', audio: true,
        sources: [{ src: '../media/presenter.mp4', type: 'video/mp4' }] },
      { id: 'slides', role: 'presentation', label: 'Slides', audio: false,
        sources: [{ src: '../media/slides.mp4', type: 'video/mp4' }] },
    ],
    textTracks: [
      { src: '../media/es.vtt', lang: 'es', label: 'Español', kind: 'subtitles' },
      { src: '../media/en.vtt', lang: 'en', label: 'English', kind: 'subtitles' },
    ],
  },
  hls: {
    id: 'demo-hls',
    title: 'Dual stream over HLS',
    duration: 40,
    streams: [
      { id: 'cam', role: 'presenter', label: 'Speaker', audio: true,
        sources: [{ src: '../media/hls/presenter.m3u8',
                    type: 'application/vnd.apple.mpegurl' }] },
      { id: 'slides', role: 'presentation', label: 'Slides', audio: false,
        sources: [{ src: '../media/hls/slides.m3u8',
                    type: 'application/vnd.apple.mpegurl' }] },
    ],
  },
  audio: {
    id: 'demo-audio',
    title: 'Audio only',
    duration: 40,
    poster: '../media/poster.jpg',
    streams: [
      { id: 'narration', role: 'presenter', label: 'Narration', audio: true,
        sources: [{ src: '../media/audio.m4a', type: 'audio/mp4' }] },
    ],
  },
  'audio-slides': {
    id: 'demo-audio-slides',
    title: 'Audio with slides',
    duration: 40,
    poster: '../media/poster.jpg',
    streams: [
      { id: 'narration', role: 'presenter', label: 'Narration', audio: true,
        sources: [{ src: '../media/audio.m4a', type: 'audio/mp4' }] },
      { id: 'slides', role: 'presentation', label: 'Slides', audio: false,
        sources: [{ src: '../media/slides.mp4', type: 'video/mp4' }] },
    ],
  },
  trimmed: {
    id: 'demo-trimmed',
    title: 'Trimmed',
    duration: 40,
    streams: [
      { id: 'cam', role: 'presenter', label: 'Speaker', audio: true,
        sources: [{ src: '../media/presenter.mp4', type: 'video/mp4' }] },
    ],
    annotations: [{ kind: 'trim', start: 10, end: 25 }],
  },
  invalid: {
    id: 'demo-invalid',
    streams: [
      { id: 'a', role: 'presenter', audio: true,
        sources: [{ src: '../media/presenter.mp4', type: 'video/mp4' }] },
      { id: 'b', role: 'presentation', audio: true,
        sources: [{ src: '../media/slides.mp4', type: 'video/mp4' }] },
    ],
  },
};

/** What each case shows: without pointing at the field that matters, the manifest is a wall of JSON. */
const NOTES: Record<string, string> = {
  single: 'One stream. <b>audio: true</b> makes it the master of the clock.',
  dual: 'Two streams. <b>Exactly one</b> has <b>audio: true</b>: it is the master, ' +
        'and the others follow it. Two audio tracks are rejected because iOS cannot play them. ' +
        'The <b>textTracks</b> switch on the captions plugin with no configuration.',
  hls: 'Same content, but the sources are <b>application/vnd.apple.mpegurl</b>. ' +
       'That makes the hls.js engine win where MediaSource exists, and the native one elsewhere. ' +
       'Nothing else in the manifest changes.',
  audio: 'Nothing to declare: the <b>audio/mp4</b> type is enough to know there is no picture. ' +
         'The artwork stays up during playback instead of leaving a black rectangle.',
  'audio-slides': 'A lecture with no camera but with the slides. The <b>audio is the master</b> ' +
                  'and the silent video follows it: the sync model does not change at all.',
  trimmed: 'The video is 40 s long and the <b>trim</b> annotation shows 10 to 25. ' +
           'The bar reads <b>0:15</b>, not 0:40, and the burned-in timecode starts at 10: ' +
           'the file is untouched, only the time shown is remapped. ' +
           'It stops at the end even though the media has 15 s left.',
  invalid: '<b>Both</b> streams have <b>audio: true</b>. Validation rejects it and says why, ' +
           'instead of leaving a player that only fails on iPhone.',
};

let player: Player | null = null;
let controls: ControlBar | null = null;
let requests = 0;

function log(type: string, payload: unknown): void {
  // Drift arrives at ~30 Hz and would drown everything else.
  if (type === 'sync:drift' || type === 'time') return;
  const line = document.createElement('div');
  line.className = 'ev';
  const short = JSON.stringify(payload, (k, v) =>
    (k === 'manifest' ? '…' : typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
  line.innerHTML = `<span class="t">${type}</span> <span class="p">${short ?? ''}</span>`;
  const list = $('#events');
  list.prepend(line);
  while (list.childElementCount > 120) list.lastElementChild?.remove();
}

function createFor(key: string): Player {
  const p = createPlayer({
    container: $('#player'),
    manifest: MANIFESTS[key] as Manifest,
    engines: enginesWithHls(nativeEngineFactory),
  });

  p.bus.onAny((type, payload) => log(type, payload));
  p.on('engine:attach:ok', ({ engine }) => log('engine chosen', { engine }));
  p.on('state:change', render);
  p.on('time', render);

  p.on('sync:drift', ({ drift, action }) => {
    const ms = drift * 1000;
    const el = $('#drift');
    el.textContent = (ms >= 0 ? '+' : '') + ms.toFixed(0) + ' ms';
    el.className = 'val ' + (Math.abs(ms) > 33 ? 'bad' : 'good');
    $('#action').textContent = action;
  });

  return p;
}

function clearStage(message: string): void {
  controls?.destroy();
  controls = null;
  $('#stage').innerHTML = `<p class="empty">${message}</p><div id="player"></div>`;
}

function render(): void {
  const s = player?.state ?? 'idle';
  $('#state').textContent = s;
  $('#state').dataset['s'] = s;
  $('#resumeAt').textContent = (player?.resumeAt ?? 0).toFixed(2) + ' s';
  $('#requests').textContent = String(requests);
  $('#videos').textContent = String(document.querySelectorAll('#stage video').length);
  $('#time').textContent = (player?.currentTime ?? 0).toFixed(2) + ' s';

  const enable = (sel: string, on: boolean) => { $<HTMLButtonElement>(sel).disabled = !on; };
  enable('#btn-resolve', s === 'idle');
  enable('#btn-attach', s === 'resolved');
  enable('#btn-play', s === 'attached');
  enable('#btn-pause', s === 'active');
  enable('#btn-detach', s === 'attached' || s === 'active');
  enable('#btn-seek', s === 'attached' || s === 'active');
}

$('#btn-resolve').addEventListener('click', async () => {
  player ??= createFor($<HTMLSelectElement>('#source').value);
  requests++;
  await player.resolve().catch(() => {});
  render();
});

$('#btn-attach').addEventListener('click', async () => {
  $('#stage').querySelector('.empty')?.remove();
  await player?.attach().catch(() => {});
  // The bar goes on after attaching, when there are streams to wrap.
  if (player && !controls) {
    controls = attachControls(player, { lang: 'en' });
    const res = await plugins.activate(player, {}, player.manifest);
    log('plugins:activated', { activated: res.activated, skipped: res.skipped });
  }
  render();
});

$('#btn-play').addEventListener('click', async () => {
  await player?.play().catch(() => {});
  render();
});

$('#btn-pause').addEventListener('click', () => { player?.pause(); render(); });

$('#btn-seek').addEventListener('click', () => {
  player?.seek(Math.random() * 30);
  render();
});

$('#btn-detach').addEventListener('click', () => {
  player?.detach();
  clearStage('Engine detached. Zero &lt;video&gt; elements in the DOM, position kept.');
  render();
});

$('#btn-reset').addEventListener('click', () => {
  player?.destroy();
  player = null;
  requests = 0;
  $('#events').innerHTML = '';
  $('#drift').textContent = '—';
  $('#drift').className = 'val';
  $('#action').textContent = '—';
  clearStage('State <code>idle</code>: poster only. Not a single network request.');
  render();
});

function renderManifest(): void {
  const key = $<HTMLSelectElement>('#source').value;
  // The real object, not a hand-written copy that could drift from what runs.
  $('#manifest').textContent = JSON.stringify(MANIFESTS[key], null, 2);
  $('#manifest-note').innerHTML = NOTES[key] ?? '';
}

$('#btn-copy').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('#btn-copy');
  try {
    await navigator.clipboard.writeText($('#manifest').textContent ?? '');
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Could not copy';
  }
  setTimeout(() => { btn.textContent = 'Copy manifest'; }, 2000);
});

$('#source').addEventListener('change', () => {
  $<HTMLButtonElement>('#btn-reset').click();
  renderManifest();
});

renderManifest();

// 400 ms is above WebKit's hard-seek threshold (200 ms) but below Blink's
// (500 ms): depending on the engine you see a smooth correction or a jump.
$('#btn-sync').addEventListener('click', () => {
  const slaves = [...document.querySelectorAll<HTMLVideoElement>('#stage video')]
    .filter((v) => v.muted);
  for (const v of slaves) v.currentTime = Math.max(0, v.currentTime - 0.4);
  log('demo:desynced', { streams: slaves.length, ms: -400 });
});

render();
setInterval(render, 500);
