/*
 * The two integration paths an LMS uses, in a real browser.
 *
 * 1. Strict CSP: `style-src 'self'` silently blocks the inline `<style>` of
 *    injectStyles(), so the stylesheet is served as a file with
 *    `injectStyles: false`. The CSP is really set by header here.
 * 2. AMD loader (Moodle uses RequireJS): a UMD `<script src>` registers as an
 *    anonymous module and leaves NO global, so both files ship and each is
 *    checked with the loader present.
 *
 *   pnpm build && node integration.mjs
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const dist = (f) => readFileSync(new URL(`../packages/bundle/dist/${f}`, import.meta.url), 'utf8');
const IIFE = dist('nanoplayer.min.js');
const UMD = dist('nanoplayer.umd.js');
const CSS = dist('nanoplayer.css');

const MANIFEST = `{ id: 'x', streams: [{ id: 'cam', role: 'presenter', audio: true,
  sources: [{ src: '/v.mp4', type: 'video/mp4' }] }] }`;

// Rollup's UMD wrapper calls `define(['exports'], factory)` and expects the
// exports object: a loader calling `factory()` bare registers nothing.
const AMD = `
  window.__modules = {};
  window.define = function (deps, factory) {
    var exports = {};
    var args = (deps || []).map(function (d) { return d === 'exports' ? exports : undefined; });
    var ret = factory.apply(null, args);
    window.__modules.anonymous = ret || exports;
  };
  window.define.amd = true;
`;

const PAGES = {
  '/csp': {
    csp: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:",
    html: `<link rel="stylesheet" href="/nanoplayer.css">
<div id="p"></div>
<script src="/nanoplayer.min.js"></script>
<script>
  window.__p = NanoPlayer.create('#p', { manifest: ${MANIFEST}, controls: { injectStyles: false } });
</script>`,
  },
  '/amd-iife': {
    html: `<div id="p"></div><script>${AMD}</script>
<script src="/nanoplayer.min.js"></script>
<script>window.__global = typeof NanoPlayer;</script>`,
  },
  '/amd-umd': {
    html: `<div id="p"></div><script>${AMD}</script>
<script src="/nanoplayer.umd.js"></script>
<script>window.__module = typeof (window.__modules.anonymous || {}).create;</script>`,
  },
};

const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/nanoplayer.min.js' || path === '/nanoplayer.umd.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(path.includes('umd') ? UMD : IIFE);
  }
  if (path === '/nanoplayer.css') {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    return res.end(CSS);
  }
  if (path === '/v.mp4') { res.writeHead(404); return res.end(); }
  const p = PAGES[path];
  if (!p) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    ...(p.csp ? { 'content-security-policy': p.csp } : {}),
  });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><body>${p.html}</body></html>`);
});
await new Promise((r) => server.listen(5203, '127.0.0.1', r));

let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

console.log('\nWith a strict CSP (style-src \'self\', no unsafe-inline)');
{
  const page = await browser.newPage();
  const violations = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('http://127.0.0.1:5203/csp', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  check(await page.evaluate(() => !!window.__p), 'the player is created');
  check((await page.locator('#p .np__bar').count()) === 1, 'the bar is attached');
  check(violations.length === 0, 'no CSP violation', violations[0]?.slice(0, 90) ?? '');

  const display = await page.evaluate(() => {
    const bar = document.querySelector('#p .np__bar');
    return bar ? getComputedStyle(bar).display : null;
  });
  check(display === 'flex', 'the stylesheet file is applied', `display=${display}`);

  const inline = await page.evaluate(() => !!document.getElementById('nanoplayer-styles'));
  check(!inline, 'no inline <style> was injected');
  await page.close();
}

console.log('\nWith an AMD loader on the page (the Moodle case)');
{
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5203/amd-iife', { waitUntil: 'load' });
  const type = await page.evaluate(() => window.__global);
  check(type === 'object', 'the IIFE still leaves the global despite the loader', `typeof = ${type}`);
  await page.close();

  const page2 = await browser.newPage();
  await page2.goto('http://127.0.0.1:5203/amd-umd', { waitUntil: 'load' });
  const create = await page2.evaluate(() => window.__module);
  check(create === 'function', 'the UMD registers as an AMD module', `create = ${create}`);
  await page2.close();
}

await browser.close();
server.close();
console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failure(s).\n`);
process.exit(failures === 0 ? 0 : 1);
