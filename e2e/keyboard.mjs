/*
 * Keyboard walk in two engines, starting **from the document**, not from a
 * programmatic focus(): that shortcut hid that WebKit does not tab into buttons.
 * See docs/browser-quirks.md#webkit-tab.
 *
 * Required of each engine:
 *   - both: the player container is reachable from the document (where shortcuts land);
 *   - both: focus can LEAVE the player (WCAG 2.1.2);
 *   - Chromium: every control reachable one by one.
 *
 *   node keyboard.mjs --serve ../demo/dist
 *   node keyboard.mjs http://127.0.0.1:5180/
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4', '.vtt': 'text/vtt; charset=utf-8', '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

const args = process.argv.slice(2);
let BASE_URL;
let server = null;

if (args[0] === '--serve') {
  const root = fileURLToPath(new URL(args[1] ?? '../demo/dist', import.meta.url));
  server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = normalize(url).replace(/^(\.\.[/\\])+/, '');
    let path = join(root, rel === '/' ? 'index.html' : rel);
    try {
      if (statSync(path).isDirectory()) path = join(path, 'index.html');
    } catch { res.writeHead(404).end('404'); return; }
    try { statSync(path); } catch { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  // 127.0.0.1, not localhost: on the runner localhost resolves to ::1 and WebKit does not always follow.
  await new Promise((r) => server.listen(5202, '127.0.0.1', r));
  BASE_URL = 'http://127.0.0.1:5202/';
} else {
  BASE_URL = args[0] ?? 'http://127.0.0.1:5180/';
}

let failures = 0;
const ok = (t) => console.log(`  ✓ ${t}`);
const fail = (t, d = '') => { console.log(`  ✗ ${t}${d ? ` — ${d}` : ''}`); failures++; };
const note = (t) => console.log(`  · ${t}`);

/** Walks the document with Tab and returns what receives focus. */
async function walk(page, steps = 14) {
  await page.evaluate(() => document.body.focus());
  const seen = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return { what: 'body', inside: false, root: false };
      return {
        what: a.getAttribute('aria-label') || a.tagName.toLowerCase(),
        inside: !!a.closest('.np'),
        root: a.classList?.contains('np') ?? false,
      };
    }));
  }
  return seen;
}

const CONTROLS = ['Play video', 'Seek', 'Mute', 'Volume', 'Settings', 'Full screen'];

for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  console.log(`\n[${name}] Tab walk from the document`);
  let browser;
  try {
    browser = await engine.launch();
  } catch (error) {
    fail(`${name} could not be launched`, String(error).slice(0, 80));
    continue;
  }
  const page = await browser.newPage();
  await page.goto(new URL('video/', BASE_URL).href, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const seen = await walk(page);
  note('order: ' + seen.map((v) => v.what).join(' → '));

  if (seen.some((v) => v.root)) ok('the player container is reachable');
  else fail('the container is NOT reachable with Tab from the document');

  const enters = seen.findIndex((v) => v.inside);
  if (enters < 0) {
    // Focus never gets in, so there is nothing to escape: the failure is the one above.
    note('focus never enters the player; leaving it cannot be evaluated');
  } else if (seen.slice(enters).some((v) => !v.inside)) {
    ok('focus can leave the player');
  } else {
    fail('focus does NOT leave the player: possible keyboard trap');
  }

  const inside = seen.filter((v) => v.inside).map((v) => v.what);
  const missing = CONTROLS.filter((c) => !inside.includes(c));
  if (missing.length === 0) {
    ok('every control is reachable one by one');
  } else if (name === 'Chromium') {
    fail('controls not reachable', missing.join(', '));
  } else {
    note(`WebKit does not tab to ${missing.length} controls (a system setting, not the player)`);
    note('that is why the container is required: shortcuts land there');
  }

  if (name === 'Chromium') {
    await page.evaluate(() => document.querySelector('.np')?.focus());
    await page.keyboard.press('Space');
    await page.waitForTimeout(1200);
    const playing = await page.evaluate(() =>
      [...document.querySelectorAll('.np video')].some((v) => !v.paused));
    if (playing) ok('Space on the container starts playback');
    else fail('Space on the container does not start playback');
  }

  await browser.close();
}

server?.close();
console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failure(s).\n`);
process.exit(failures === 0 ? 0 : 1);
