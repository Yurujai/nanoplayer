/**
 * Accessibility check in a real browser, blocking in CI: axe-core's WCAG 2.1
 * A/AA rules plus keyboard-only operation. axe catches about a third of real
 * problems: passing does not replace a screen reader review.
 *
 *   node a11y.mjs http://127.0.0.1:5180/     (dev server)
 *   node a11y.mjs --serve ../demo/dist       (static build, what CI uses)
 */
import { chromium } from 'playwright';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json',
};

function serve(root, port) {
  return new Promise((ready) => {
    const srv = createServer((req, res) => {
      const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let path = join(root, normalize(url).replace(/^(\.\.[/\\])+/, ''));
      try { if (statSync(path).isDirectory()) path = join(path, 'index.html'); } catch { /* 404 below */ }
      let st;
      try { st = statSync(path); } catch { res.writeHead(404); return res.end('404'); }

      const type = TYPES[extname(path)] ?? 'application/octet-stream';
      // Without Range support the browser cannot seek inside the video.
      const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (range) {
        const start = Number(range[1] || 0);
        const end = range[2] ? Number(range[2]) : st.size - 1;
        res.writeHead(206, {
          'content-type': type, 'content-length': end - start + 1,
          'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes',
        });
        return createReadStream(path, { start, end }).pipe(res);
      }
      res.writeHead(200, {
        'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes',
      });
      createReadStream(path).pipe(res);
    });
    srv.listen(port, '127.0.0.1', () => ready(srv));
  });
}

const args = process.argv.slice(2);
let server = null;
let BASE_URL;
if (args[0] === '--serve') {
  const root = args[1];
  if (!root) { console.error('Missing the directory to serve'); process.exit(2); }
  server = await serve(root, 5199);
  BASE_URL = 'http://127.0.0.1:5199/';
  console.log(`Serving ${root}`);
} else {
  BASE_URL = args[0] ?? 'http://127.0.0.1:5180/';
}

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const problems = [];
const fail = (m) => { problems.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

async function audit(label) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(
    (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
    RULES,
  );
  const serious = r.violations.filter((v) => v.impact !== 'minor');
  console.log(`\n[axe] ${label}: ${r.passes.length} rules passed, ${r.violations.length} violated`);
  for (const v of r.violations) {
    const line = `${v.id} (${v.impact}) — ${v.help} · ${v.nodes.length} node(s)`;
    if (serious.includes(v)) fail(`${label}: ${line}`);
    else console.log('  · ' + line + '  [minor]');
    for (const n of v.nodes.slice(0, 2)) console.log(`      ${n.html.slice(0, 110)}`);
  }
  if (r.violations.length === 0) ok(`${label}: no violations`);
}

const DEMO_URL = new URL('video/', BASE_URL).href;
console.log(`Auditing ${DEMO_URL}\n`);
await page.goto(DEMO_URL, { waitUntil: 'load' });

await audit('initial state (poster)');

const posterButton = await page.evaluate(() => {
  const b = document.querySelector('.np__poster-play');
  return b ? { tag: b.tagName.toLowerCase(), label: b.getAttribute('aria-label') } : null;
});
if (posterButton?.tag === 'button' && posterButton.label) {
  ok(`the poster button is accessible ("${posterButton.label}")`);
} else {
  fail('the poster play button is not a button with an accessible name');
}

const mp4Before = await page.evaluate(() => performance.getEntriesByType('resource')
  .filter((r) => r.name.endsWith('.mp4')).length);
if (mp4Before === 0) ok('no video downloaded while the poster is showing');
else fail(`${mp4Before} video requests before any interaction`);

await page.click('.np__poster-play');
await page.waitForFunction(() => document.querySelectorAll('.np video').length > 0,
  null, { timeout: 20000 });
await page.waitForTimeout(1200);
await page.hover('#player');

await audit('with the control bar');

/* --- settings menu, open -------------------------------------------------- */

// Menu semantics only exist while it is open.
await page.evaluate(() => document.querySelector('.np__btn--settings')?.focus());
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await audit('settings menu open');

console.log('\n[menu] WAI-ARIA menu button pattern');
const menuRole = await page.evaluate(() =>
  document.querySelector('.np__menu [role="menu"]') !== null);
if (menuRole) ok('the container declares role="menu"');
else fail('the menu does not declare role="menu"');

const expanded = await page.evaluate(() =>
  document.querySelector('.np__btn--settings')?.getAttribute('aria-expanded'));
if (expanded === 'true') ok('aria-expanded reflects that it is open');
else fail(`aria-expanded is "${expanded}" with the menu open`);

const focusInside = await page.evaluate(() =>
  !!document.activeElement?.closest('.np__menu'));
if (focusInside) ok('focus enters the menu when it opens');
else fail('focus did not enter the menu');

const tabbables = await page.evaluate(() =>
  [...document.querySelectorAll('.np__menu [role^="menuitem"]')]
    .filter((el) => el.tabIndex === 0).length);
if (tabbables === 1) ok('only one menu item is tabbable (roving tabindex)');
else fail(`${tabbables} menu items are tabbable; should be 1`);

await page.keyboard.press('ArrowDown');
const moved = await page.evaluate(() =>
  document.activeElement?.getAttribute('aria-label'));
if (moved) ok(`arrows move focus (now on "${moved}")`);
else fail('arrows do not move focus inside the menu');

await page.keyboard.press('Enter');
await page.waitForTimeout(250);
const checked = await page.evaluate(() =>
  document.querySelectorAll('.np__menu [role="menuitemradio"][aria-checked="true"]').length);
if (checked === 1) ok('the active option is marked with aria-checked');
else fail(`${checked} options marked with aria-checked; should be 1`);

const clip = await page.evaluate(() => {
  const m = document.querySelector('.np__menu');
  const np = document.querySelector('.np');
  const a = m.getBoundingClientRect(), b = np.getBoundingClientRect();
  return { overflows: a.top < b.top - 1, height: Math.round(a.height) };
});
if (!clip.overflows) ok(`the menu fits inside the player (${clip.height}px)`);
else fail('the menu overflows the player and is clipped by overflow:hidden');

await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const focusBack = await page.evaluate(() =>
  document.activeElement?.classList.contains('np__btn--settings'));
if (focusBack) ok('closing returns focus to the gear');
else fail('closing does not return focus to the button that opened the menu');

/* --- keyboard navigation -------------------------------------------------- */

console.log('\n[keyboard] Tab walk');
const focused = async () => page.evaluate(() => {
  const a = document.activeElement;
  if (!a) return null;
  return { tag: a.tagName.toLowerCase(), label: a.getAttribute('aria-label'), inside: !!a.closest('.np') };
});

await page.evaluate(() => document.querySelector('.np')?.focus());
const reached = [];
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab');
  const f = await focused();
  if (!f?.inside) break;
  reached.push(`${f.tag}[${f.label ?? 'no label'}]`);
}
console.log('  reached: ' + (reached.join(', ') || 'none'));

const EXPECTED = ['Pause', 'Mute', 'Volume', 'Seek', 'Full screen'];
for (const e of EXPECTED) {
  if (reached.some((a) => a.includes(e))) ok(`"${e}" is reachable with Tab`);
  else fail(`"${e}" is NOT reachable with Tab`);
}

/* --- what a plugin adds --------------------------------------------------- */

// Plugins declare and the UI builds, so their controls obey the same rules.
console.log('\n[plugins] contributed controls meet the same contract');
const pluginControl = await page.evaluate(() => {
  const b = document.querySelector('[data-control]');
  if (!b) return null;
  return {
    id: b.dataset.control,
    tag: b.tagName.toLowerCase(),
    label: b.getAttribute('aria-label'),
    pressed: b.getAttribute('aria-pressed'),
  };
});
if (!pluginControl) {
  fail('no plugin added a control to the bar: the contract cannot be checked');
} else {
  if (pluginControl.tag === 'button') ok(`"${pluginControl.id}" is a native <button>`);
  else fail(`"${pluginControl.id}" is not a <button>: it loses native role and keyboard`);

  if (pluginControl.label) ok(`"${pluginControl.id}" has an accessible name ("${pluginControl.label}")`);
  else fail(`"${pluginControl.id}" has no accessible name`);

  if (pluginControl.pressed !== null) ok(`"${pluginControl.id}" exposes aria-pressed`);
  else fail(`"${pluginControl.id}" is a toggle without aria-pressed`);

  if (reached.some((a) => a.includes(pluginControl.label))) ok(`"${pluginControl.id}" is reachable with Tab`);
  else fail(`"${pluginControl.id}" is NOT reachable with Tab`);
}

/* --- keyboard operation --------------------------------------------------- */

console.log('\n[keyboard] shortcuts');
await page.evaluate(() => document.querySelector('.np')?.focus());

await page.keyboard.press('Space');
await page.waitForTimeout(700);
const paused = await page.evaluate(() => document.querySelector('.np video')?.paused);
if (paused) ok('Space pauses playback');
else fail('Space did not pause playback');
await page.keyboard.press('Space');
await page.waitForTimeout(500);

const before = await page.evaluate(() => document.querySelector('.np video').currentTime);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
const after = await page.evaluate(() => document.querySelector('.np video').currentTime);
if (after > before + 3) ok('Right arrow seeks forward');
else fail(`Right arrow did not seek (${before.toFixed(2)} → ${after.toFixed(2)})`);

await page.keyboard.press('m');
await page.waitForTimeout(200);
const muted = await page.evaluate(() =>
  document.querySelector('.np__volume input').value === '0');
if (muted) ok('M mutes');
else fail('M did not mute');

/* --- focus is not lost ---------------------------------------------------- */

console.log('\n[focus] the bar does not hide with focus inside');
await page.evaluate(() => document.querySelector('.np__bar button')?.focus());
await page.waitForTimeout(3200);   // longer than the inactivity timeout
const visible = await page.evaluate(() => {
  const bar = document.querySelector('.np__bar');
  return Number(getComputedStyle(bar).opacity) > 0.5;
});
if (visible) ok('the bar stays visible with focus inside');
else fail('the bar hid with focus inside: the control in use is lost from sight');

/* --- verdict -------------------------------------------------------------- */

await browser.close();
server?.close();
console.log('\n' + '─'.repeat(66));
if (problems.length === 0) {
  console.log('ACCESSIBILITY: no automatable problems found.');
  console.log('Reminder: axe covers ~1/3 of real problems. A screen reader');
  console.log('review is still needed.');
} else {
  console.log(`ACCESSIBILITY: ${problems.length} problem(s):`);
  for (const p of problems) console.log('  · ' + p);
}
console.log('─'.repeat(66) + '\n');
process.exit(problems.length ? 1 : 0);
