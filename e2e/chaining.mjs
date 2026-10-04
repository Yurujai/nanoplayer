/*
 * Intro, content and outro chained end to end, in real browsers.
 *
 * The unit tests drive the chain with fake engines that never reject a
 * play(), so they could not see the regression where the outro was dropped
 * at start-up: the unlock's play()+pause() was aborted by the browser and
 * taken for a broken outro. This walks the whole chain on the built site.
 *
 *   node chaining.mjs --serve ../demo/dist
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.jpg': 'image/jpeg',
  '.vtt': 'text/vtt; charset=utf-8',
};

/** Static server with Range support: without it a browser cannot seek in an MP4. */
function serve(root, port) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
      .replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); } catch { /* 404 below */ }
    let size;
    try { size = statSync(file).size; } catch { res.writeHead(404).end(); return; }
    const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes' };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1] || 0);
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': size });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const args = process.argv.slice(2);
if (args[0] !== '--serve') {
  console.error('Usage: node chaining.mjs --serve <dir>');
  process.exit(2);
}
const server = await serve(fileURLToPath(new URL(args[1] ?? '../demo/dist', import.meta.url)), 5204);
const PAGE = 'http://127.0.0.1:5204/video/';

let failures = 0;
const ok = (t) => console.log(`  ✓ ${t}`);
const fail = (t, d = '') => { console.log(`  ✗ ${t}${d ? ` — ${d}` : ''}`); failures++; };
const check = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const phase = (page) => page.evaluate(() => document.querySelector('#player')?.dataset['phase']);
const waitPhase = (page, target, timeout) => page
  .waitForFunction((p) => document.querySelector('#player')?.dataset['phase'] === p, target, { timeout })
  .then(() => true, () => false);

/** Opens the video demo with intro and outro turned on, and presses play. */
async function start(page) {
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.click('label:has(#bumpers)');
  await page.waitForSelector('#player .np__poster-play');
  await page.click('#player .np__poster-play');
}

for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  console.log(`\n[${name}] the whole chain`);
  const browser = name === 'Chromium'
    ? await engine.launch({ channel: 'chrome' }).catch(() => engine.launch())
    : await engine.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await start(page);
  check(await waitPhase(page, 'intro', 5000), 'starts with the intro');
  check(await waitPhase(page, 'main', 10000), 'the intro hands over to the content on its own');
  check(await page.locator('#player [data-bumper="outro"]').count() === 1,
    'the outro is still attached', 'it was dropped at start-up');

  // A timeline of what the media does from here, printed if the outro never comes:
  // this step fails only on Linux WebKit in CI, where it cannot be watched.
  await page.evaluate(() => {
    const t0 = performance.now();
    window.__chainLog = [];
    for (const v of document.querySelectorAll('#player video')) {
      const who = v.closest('[data-stream]')?.dataset['stream'] ?? v.closest('[data-bumper]')?.dataset['bumper'];
      for (const type of ['play', 'playing', 'pause', 'waiting', 'seeking', 'seeked', 'ended', 'error', 'stalled']) {
        v.addEventListener(type, () => window.__chainLog.push(
          `${Math.round(performance.now() - t0)}ms ${who} ${type} t=${v.currentTime.toFixed(2)}`));
      }
    }
  });
  const before = await page.evaluate(() => document.querySelector('#player video')?.currentTime ?? 0);
  await page.locator('#player').press('9');
  const after = await page.waitForFunction((t) => (document.querySelector('#player video')?.currentTime ?? 0) > t + 10,
    before, { timeout: 5000 }).then(() => true, () => false);
  check(after, 'the 9 key seeks to 90 %', `still near ${before.toFixed(1)} s`);
  const reached = await waitPhase(page, 'outro', 15000);
  check(reached, 'reaching the end of the content plays the outro');
  if (!reached) {
    console.log('    state:', JSON.stringify(await page.evaluate(() => {
      const p = document.querySelector('#player');
      return {
        phase: p?.dataset['phase'],
        focus: document.activeElement?.id || document.activeElement?.className,
        status: p?.querySelector('[role="status"]')?.textContent,
        media: [...(p?.querySelectorAll('video') ?? [])].map((v) => ({
          who: v.closest('[data-stream]')?.dataset['stream'] ?? v.closest('[data-bumper]')?.dataset['bumper'],
          t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(2), paused: v.paused, ended: v.ended,
          ready: v.readyState, network: v.networkState, error: v.error?.code ?? null, muted: v.muted,
        })),
      };
    })));
    for (const line of await page.evaluate(() => window.__chainLog.slice(-40))) console.log(`    ${line}`);
  }

  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  check(await phase(page) === 'outro', 'the outro cannot be skipped forward');

  const ended = await page
    .waitForFunction(() => /ended/i.test(document.querySelector('#player [role="status"]')?.textContent ?? ''),
      null, { timeout: 10000 })
    .then(() => true, () => false);
  check(ended, 'the end is announced when the outro finishes');

  console.log(`[${name}] skipping the intro`);
  await start(page);
  await waitPhase(page, 'intro', 5000);
  await page.click('#player .np__skip');
  check(await waitPhase(page, 'main', 3000), 'the skip button goes straight to the content');
  check(await page.evaluate(() => document.activeElement === document.querySelector('#player')),
    'focus stays in the player after the button disappears');

  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await browser.close();
}

server.close();
console.log(failures ? `\n${failures} failure(s).` : '\nAll good.');
process.exit(failures ? 1 : 0);
