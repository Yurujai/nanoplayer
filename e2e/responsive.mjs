/*
 * The player at every width a page may give it: no control outside the box or
 * out of reach, the settings menu inside the player, and the page never
 * scrolling sideways. Measured in a real layout engine, as CSS container
 * queries and the bar's fitting cannot be checked in a DOM without layout.
 *
 * Under 320 px full screen used to end up outside the player, where nobody
 * could press it, and the menu ran off the player's left side.
 *
 *   node responsive.mjs --serve ../demo/dist
 *   node responsive.mjs http://127.0.0.1:5180/
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4', '.vtt': 'text/vtt; charset=utf-8', '.json': 'application/json',
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
      statSync(path);
    } catch { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  await new Promise((r) => server.listen(5203, '127.0.0.1', r));
  BASE_URL = 'http://127.0.0.1:5203/';
} else {
  BASE_URL = args[0] ?? 'http://127.0.0.1:5180/';
}

const WIDTHS = [240, 280, 320, 360, 414, 480, 640, 768, 1024, 1440];
let failures = 0;
const fail = (t) => { console.log(`  ✗ ${t}`); failures++; };

/** What is wrong with the player as laid out now; nothing means all good. */
const inspect = () => {
  const root = document.querySelector('.np');
  const box = root.getBoundingClientRect();
  const problems = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) problems.push('the page scrolls sideways');
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0;
  };
  for (const el of root.querySelectorAll('.np__bar button, .np__bar input, .np__time, .np__skip')) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    const name = el.getAttribute('aria-label') ?? el.className;
    if (r.left < box.left - 0.5 || r.right > box.right + 0.5) problems.push(`"${name}" is outside the player`);
    // WCAG 2.5.8: at least 24 × 24 CSS pixels.
    if (el.tagName === 'BUTTON' && (r.width < 24 || r.height < 24)) problems.push(`"${name}" is under 24 px`);
  }
  for (const row of root.querySelectorAll('.np__row')) {
    if (row.scrollWidth > row.clientWidth + 1) problems.push(`a row overflows by ${row.scrollWidth - row.clientWidth} px`);
  }
  const menu = document.querySelector('.np__menu:not([hidden])');
  if (menu) {
    const m = menu.getBoundingClientRect();
    if (m.left < box.left - 0.5 || m.right > box.right + 0.5 || m.top < box.top - 0.5 || m.bottom > box.bottom + 0.5) {
      problems.push('the settings menu sticks out of the player');
    }
    for (const item of menu.querySelectorAll('[role^="menuitem"]')) {
      if (item.scrollWidth > item.clientWidth + 1) problems.push(`menu item clipped: "${item.getAttribute('aria-label') ?? item.textContent}"`);
    }
  }
  return problems;
};

async function open(browser, width, { single = false, bumpers = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}video/`);
  if (single) await page.click('label:has(#mode-single)');
  if (bumpers) await page.click('#bumpers');
  await page.click('.np__poster-play');
  await page.waitForSelector('.np video');
  await page.waitForTimeout(800);
  // Paused, so the bar stays shown while it is measured.
  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.pause()));
  await page.waitForTimeout(300);
  return { context, page };
}

async function check(page, label) {
  const problems = [...await page.evaluate(inspect)];
  await page.locator('.np__btn--settings').click({ force: true });
  await page.waitForTimeout(150);
  problems.push(...await page.evaluate(inspect));
  await page.keyboard.press('Escape');
  // Hovering the volume opens its slider; it must not push anything out.
  const mute = await page.locator('.np__volume button').boundingBox();
  await page.mouse.move(mute.x + mute.width / 2, mute.y + mute.height / 2);
  await page.waitForTimeout(250);
  problems.push(...(await page.evaluate(inspect)).map((p) => `${p} (volume open)`));
  if (problems.length === 0) console.log(`  ✓ ${label}`);
  else for (const p of new Set(problems)) fail(`${label}: ${p}`);
}

for (const [name, type] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = name === 'Chromium'
    ? await type.launch({ channel: 'chrome' }).catch(() => type.launch())
    : await type.launch();
  console.log(`\n${name}`);
  for (const single of [false, true]) {
    for (const width of WIDTHS) {
      const { context, page } = await open(browser, width, { single });
      await check(page, `${single ? 'one video' : 'two videos'}, ${width} px`);
      await context.close();
    }
  }
  for (const width of [240, 320, 480]) {
    const { context, page } = await open(browser, width, { bumpers: true });
    await check(page, `during the intro, ${width} px`);
    await context.close();
  }
  await browser.close();
}

server?.close();
console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failure(s).\n`);
process.exit(failures === 0 ? 0 : 1);
