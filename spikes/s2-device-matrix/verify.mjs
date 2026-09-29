/*
 * Checks the packed probe before sending it to anyone.
 *
 * Sending other people a broken diagnostics page costs far more than a failure
 * of our own: it cannot be debugged on their device, and it spends the favour
 * of asking them to test. This runs it in full against local Chrome.
 *
 *   node verify.mjs [--headed]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const FILE = DIR + 'dist/nanoplayer-probe.html';
const PORT = 8123;

const body = readFileSync(FILE);
const server = createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}).listen(PORT, '127.0.0.1');

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !process.argv.includes('--headed'),
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

// Sections 1 and 2 fill in by themselves on load.
const filled = await page.evaluate(() => ({
  env: document.getElementById('env').children.length,
  caps: document.getElementById('caps').children.length,
}));
console.log(`\nRows filled with no interaction: environment ${filled.env / 2}, capabilities ${filled.caps / 2}`);
if (!filled.env || !filled.caps) { console.error('FAILURE: passive sections are empty'); process.exit(1); }

console.log('Running playback tests…');
await page.click('#run');
// Careful: waitForFunction's 2nd parameter is the function's ARGUMENT, not the
// options. Passing the options there silently ignores them and the default
// 30 s timeout applies, which is not enough for a full pass.
await page.waitForFunction(
  () => document.getElementById('status').textContent.includes('finished'),
  null,
  { timeout: 180000 }
);

console.log('Running the full screen test…');
await page.click('#fs');
await page.waitForFunction(
  () => document.getElementById('fsres').children.length > 0,
  null,
  { timeout: 60000 }
);

const report = JSON.parse(await page.inputValue('#out'));
await browser.close();
server.close();

console.log('\n─── Report ────────────────────────────────────────────────');
console.log(JSON.stringify(report, null, 2));
console.log('───────────────────────────────────────────────────────────\n');

// Checks that the PROBE works. The device is not judged here: "0 simultaneous
// videos" on an old phone is a valid result; on desktop Chrome it means the
// probe is broken.
const fails = [];
const p = report.playback ?? {};
if (!report.env?.viewport) fails.push('environment not collected');
if (report.caps?.rVFC === undefined) fails.push('capabilities not collected');
if (!p.maxConcurrentVideos) fails.push('the decoding test measured nothing');
if (p.driftMedianMs === null || p.driftMedianMs === undefined) fails.push('the sync test measured nothing');
if (p.driftMedianMs > 33) fails.push(`drift ${p.driftMedianMs} ms above one frame on Chrome`);
if (!p.loopFps) fails.push('the control loop did not run');
if (!report.fullscreen) fails.push('the full screen test did not report');
if (errors.length) fails.push('JS errors: ' + [...new Set(errors)].join(' | '));

if (fails.length) {
  console.log('PROBE NOT VALID:');
  for (const f of fails) console.log('  · ' + f);
  process.exit(1);
}
console.log('PROBE VALID: it collects the four families of data with no errors.\n');
