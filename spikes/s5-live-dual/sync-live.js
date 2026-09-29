/*
 * Spike S5 — synchronising two independent live HLS streams.
 *
 * Throwaway code: it answers one question, it is not meant for reuse.
 *
 * The question: **can the player keep together two live streams that leave
 * the source aligned?** Not whether the source aligns them —that is the
 * broadcast server's job— but whether the browser manages not to pull them
 * apart.
 *
 * Why two things have to be measured at once:
 *
 *   - `currentTime` is the position within the playlist window. Each stream has
 *     its own window, which starts wherever it happens to and **slides** as
 *     segments expire. Comparing two currentTime values is comparing clocks
 *     with no common origin: it can read zero while out of sync, or the reverse.
 *
 *   - `playingDate` is the absolute time of the current position, and it only
 *     exists if the playlist carries `EXT-X-PROGRAM-DATE-TIME`. That one is
 *     comparable: two positions with the same time are the same instant.
 *
 * Measuring both is what answers what turning the tag on buys.
 */

const $ = (id) => document.getElementById(id);

const CFG = {
  // How many segments behind the edge hls.js starts. It is the parameter with
  // the most influence on whether two instances start together or apart.
  liveSyncDurationCount: Number(new URLSearchParams(location.search).get('lsdc') ?? 3),
};

const streams = [
  { id: 'presenter', el: $('vPresenter'), hls: null },
  { id: 'slides', el: $('vSlides'), hls: null },
];

const samples = [];
let measuring = false;
let startedAt = null;

function log(txt) {
  const l = document.createElement('div');
  l.textContent = `${new Date().toLocaleTimeString()}  ${txt}`;
  $('log').prepend(l);
  while ($('log').childElementCount > 60) $('log').lastElementChild?.remove();
}

/* ------------------------------------------------------------------- load -- */

function create(stream) {
  const hls = new Hls({
    lowLatencyMode: false,
    liveSyncDurationCount: CFG.liveSyncDurationCount,
    enableWorker: true,
  });
  stream.hls = hls;
  hls.attachMedia(stream.el);
  hls.loadSource(`live/${stream.id}.m3u8`);

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    const withPdt = hls.levels?.[0]?.details?.hasProgramDateTime;
    log(`${stream.id}: playlist loaded · PROGRAM-DATE-TIME: ${withPdt ? 'yes' : 'NO'}`);
    stream.el.play().catch((e) => log(`${stream.id}: play rejected — ${e.name}`));
  });
  hls.on(Hls.Events.ERROR, (_e, d) => {
    if (d.fatal) log(`${stream.id}: ERROR ${d.type} / ${d.details}`);
  });
  stream.el.addEventListener('waiting', () => log(`${stream.id}: out of buffer`));
}

/* ------------------------------------------------------------ measuring --- */

/** Absolute time of the current position. `null` if the playlist lacks the tag. */
function timeOf(stream) {
  const d = stream.hls?.playingDate;
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
}

function measure() {
  const [a, b] = streams;
  const ta = timeOf(a), tb = timeOf(b);

  // True drift: difference in absolute time between the two positions.
  const byTime = (ta !== null && tb !== null) ? tb - ta : null;
  // All that could be compared without the tag.
  const byCurrentTime = (b.el.currentTime - a.el.currentTime) * 1000;
  // Delay behind live: how far behind the real time it is playing.
  const delay = ta !== null ? Date.now() - ta : null;

  return { byTime, byCurrentTime, delay, t: performance.now() };
}

function render(m) {
  const fmt = (v, u = 'ms') => v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(0)} ${u}`;
  $('byTime').textContent = fmt(m.byTime);
  $('byTime').className = 'val ' + (m.byTime === null ? ''
    : Math.abs(m.byTime) > 200 ? 'bad' : Math.abs(m.byTime) > 50 ? 'fair' : 'good');
  $('byCurrentTime').textContent = fmt(m.byCurrentTime);
  $('delay').textContent = m.delay === null ? '—' : `${(m.delay / 1000).toFixed(1)} s`;
  $('samples').textContent = String(samples.length);

  if (samples.length > 1) {
    const abs = samples.map((x) => Math.abs(x.byTime ?? 0)).sort((p, q) => p - q);
    $('median').textContent = `${abs[Math.floor(abs.length / 2)].toFixed(0)} ms`;
    $('max').textContent = `${abs[abs.length - 1].toFixed(0)} ms`;
  }
}

setInterval(() => {
  const m = measure();
  if (measuring && m.byTime !== null) samples.push(m);
  render(m);
}, 250);

/* --------------------------------------------------------------- controls */

$('btn-load').onclick = () => {
  if (!Hls.isSupported()) { log('hls.js is not supported here'); return; }
  for (const s of streams) create(s);
  $('btn-load').disabled = true;
  $('btn-measure').disabled = false;
  $('btn-cut').disabled = false;
  log(`liveSyncDurationCount = ${CFG.liveSyncDurationCount}`);
};

$('btn-measure').onclick = () => {
  measuring = !measuring;
  if (measuring) { samples.length = 0; startedAt = performance.now(); log('measuring…'); }
  else log(`measurement stopped after ${((performance.now() - startedAt) / 1000).toFixed(0)} s`);
  $('btn-measure').textContent = measuring ? 'Stop measuring' : 'Start measuring';
};

/** Cuts one stream's buffer to see whether it recovers or stays behind. */
$('btn-cut').onclick = async () => {
  const s = streams[1];
  log('cutting "slides" for 3 s…');
  s.el.pause();
  await new Promise((r) => setTimeout(r, 3000));
  await s.el.play().catch(() => {});
  log('resumed');
};

$('btn-edge').onclick = () => {
  for (const s of streams) {
    const d = s.hls?.liveSyncPosition;
    if (typeof d === 'number') s.el.currentTime = d;
  }
  log('both taken to the live edge');
};
