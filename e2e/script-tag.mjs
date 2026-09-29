/*
 * One `<script>` tag and three lines must give a player WITH controls, checked
 * on the built file in a real browser: a star export once made the global ship
 * the headless `create`, and types, build and unit tests said nothing.
 *
 *   pnpm build && node script-tag.mjs
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const IIFE = new URL('../packages/bundle/dist/nanoplayer.min.js', import.meta.url);
const script = readFileSync(IIFE, 'utf8');

// Exactly what the documentation says, not one line more.
const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<body>
<div id="player" style="width:640px"></div>
<script src="/nanoplayer.min.js"></script>
<script>
  window.__p = NanoPlayer.create('#player', { manifest: {
    id: 'x',
    streams: [{ id: 'cam', role: 'presenter', audio: true,
                sources: [{ src: '/not-downloaded.mp4', type: 'video/mp4' }] }],
  } });
</script>
</body></html>`;

const server = createServer((req, res) => {
  if (req.url === '/nanoplayer.min.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(script);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(5201, '127.0.0.1', r));

let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const requests = [];
page.on('request', (r) => requests.push(r.url()));

await page.goto('http://127.0.0.1:5201/', { waitUntil: 'load' });

console.log('\nOne <script> tag and three lines');
check(errors.length === 0, 'the page throws no errors', errors[0] ?? '');
check(await page.evaluate(() => typeof NanoPlayer === 'object'), 'defines the NanoPlayer global');
check(await page.evaluate(() => !!window.__p), 'create() returns a player');

console.log('\nAnd the controls come attached');
const bars = await page.locator('.np__bar').count();
check(bars === 1, 'there is a control bar', `found: ${bars}`);

const buttons = await page.locator('#player button').count();
check(buttons > 0, 'there are buttons', `${buttons}`);

const unnamed = await page.evaluate(() =>
  [...document.querySelectorAll('#player button')]
    .filter((b) => !(b.getAttribute('aria-label') ?? '').trim()).length);
check(unnamed === 0, 'every button has an accessible name', unnamed ? `${unnamed} unnamed` : '');

console.log('\nWithout breaking the lazy lifecycle');
const videos = await page.locator('#player video').count();
check(videos === 0, 'no <video> in the DOM before playing');
const requestedMedia = requests.some((u) => u.includes('not-downloaded.mp4'));
check(!requestedMedia, 'not a byte of video requested');

await browser.close();
server.close();

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failure(s).\n`);
process.exit(failures === 0 ? 0 : 1);
