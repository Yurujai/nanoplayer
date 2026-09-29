/*
 * Automatic measurement for spike S6.
 *
 * Measures the gap of each seam in the three variants, on desktop Chrome.
 *
 * **Without `--autoplay-policy=no-user-gesture-required`**, unlike the S1 and
 * S5 harnesses. That flag is exactly what this spike cannot afford: with it,
 * all three variants would pass and the policy question would stay
 * unanswered. Gesture activation is obtained as in real life, with a real
 * click (`page.click`).
 *
 * And a warning worth remembering when reading the output: **desktop Chrome
 * grants activation per page**, not per element. A click anywhere unlocks
 * every `<video>` on the page. iOS does **not** do that: there the permission
 * belongs to each element. So variant B is expected to pass here, and that
 * does NOT mean it will pass on an iPhone. The iOS answer only comes from the
 * manual bench.
 *
 *   node measure.mjs
 *   HEADED=1 node measure.mjs
 *   ENGINE=webkit node measure.mjs   (Safari's engine — the one that matters)
 *
 * Generating a short main piece avoids waiting too long:
 *   DUR_MAIN=12 ./gen-media.sh
 */
import { chromium, webkit } from 'playwright';

const BENCH_URL = process.env.URL ?? 'http://127.0.0.1:8180/';
const LIMIT_MS = Number(process.env.LIMIT ?? 90000);

const CONFIGS = [
  { variant: 'A', lead: 0, skip: false, note: 'the proposal, no anticipation' },
  { variant: 'A', lead: 300, skip: false, note: 'the proposal, anticipating 300 ms' },
  { variant: 'A', lead: 600, skip: false, note: 'the proposal, anticipating 600 ms' },
  { variant: 'A', lead: 0, skip: true, note: 'skipping the intro' },
  { variant: 'B', lead: 0, skip: false, note: 'not unlocked in the gesture' },
  { variant: 'C', lead: 0, skip: false, note: 'one element, swapping src' },
];

const ms = (v) => (v === null || v === undefined ? '    —' : String(Math.round(v)).padStart(5));

async function run(browser, cfg) {
  // A new context on every pass: Chrome accumulates "media engagement" per
  // origin, and becomes more permissive with it. Reusing the context would
  // make the last variants come out better for having gone later, not for
  // being better.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BENCH_URL, { waitUntil: 'load' });
  await page.selectOption('#sel-variant', cfg.variant);
  if (cfg.variant !== 'C') await page.selectOption('#sel-lead', String(cfg.lead));

  await page.click('#btn-play');

  if (cfg.skip) {
    // A moment for the intro to really start before skipping it: skipping on
    // the first frame would measure the start, not the skip.
    await page.waitForTimeout(2000);
    await page.click('#btn-skip');
  }

  const t0 = Date.now();
  let report = null;
  while (Date.now() - t0 < LIMIT_MS) {
    report = await page.evaluate(() => {
      try { return JSON.parse(document.getElementById('report').textContent); }
      catch { return null; }
    });
    if (report && report.complete) break;
    await page.waitForTimeout(500);
  }

  await ctx.close();
  return { report, errors, timedOut: !(report && report.complete) };
}

const ENGINE = process.env.ENGINE ?? 'chromium';

/*
 * S1 and S5 require the system Chrome because Playwright's Chromium did not
 * ship H.264 codecs. That is **no longer true** in recent versions: it was
 * checked here that it decodes the H.264 from `gen-media.sh`. Even so, Chrome
 * is preferred if installed, and otherwise it falls back to the bundled
 * Chromium instead of being unable to measure.
 *
 * WebKit is the one that really matters —it is Safari's engine— but **it is
 * not iOS Safari**: its autoplay policy is not the device's. It shows the
 * shape of the answer, not an answer to take as good.
 */
async function openBrowser() {
  const headless = !process.env.HEADED;
  if (ENGINE === 'webkit') {
    return { browser: await webkit.launch({ headless }), which: 'WebKit (Playwright)' };
  }
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless });
    return { browser, which: 'system Google Chrome' };
  } catch {
    const browser = await chromium.launch({ headless });
    return { browser, which: 'Playwright Chromium (Chrome is not installed)' };
  }
}

const { browser, which } = await openBrowser();

/*
 * Check that this browser decodes the pieces' H.264 BEFORE measuring anything.
 * Without this, a browser with no codecs would give zero frames and the gaps
 * would come out null: an environment failure disguised as a result.
 */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BENCH_URL, { waitUntil: 'load' });
  const ok = await page.evaluate(() => new Promise((res) => {
    const v = document.createElement('video');
    v.muted = true; v.src = 'media/intro.mp4';
    v.addEventListener('loadeddata', () => res(true), { once: true });
    v.addEventListener('error', () => res(false), { once: true });
    setTimeout(() => res(false), 8000);
  }));
  await ctx.close();
  if (!ok) {
    console.error(`\n  ${which} does not decode the H.264 in media/. Without that there is nothing to measure.`);
    await browser.close();
    process.exit(1);
  }
}

console.log(`\nBench:   ${BENCH_URL}`);
console.log(`Engine:  ${which}`);
console.log('Desktop browsers grant activation PER PAGE.');
console.log('Variant B passing here says nothing about iOS.\n');

const rows = [];

for (const cfg of CONFIGS) {
  const label = `${cfg.variant}${cfg.skip ? ' (skip)' : ''} lead=${cfg.lead}ms`;
  process.stdout.write(`  ${label.padEnd(22)} ${cfg.note} ... `);

  const { report, errors, timedOut } = await run(browser, cfg);

  if (!report) { console.log('NO REPORT'); continue; }
  console.log(timedOut ? 'incomplete (timed out)' : 'ok');

  for (const s of report.seams) {
    rows.push({
      config: label,
      seam: `${s.from}→${s.to}`,
      reason: s.reason,
      gap: s.gapMs,
      latency: s.latencyMs,
      blocked: s.blocked,
      withSound: s.withSound,
      paused: s.pausedAfterUnmute,
      rs: s.incomingReadyState,
    });
  }
  if (report.rvfc === false) {
    console.log('    WARNING: no requestVideoFrameCallback, the gaps are estimates.');
  }
  for (const e of errors.slice(0, 3)) console.log(`    page error: ${e}`);
}

console.log('\n  config                 seam          reason    gap  latency  blkd   sound  paused  rs');
console.log('  ' + '-'.repeat(86));
for (const r of rows) {
  console.log(
    '  ' + r.config.padEnd(22) +
    r.seam.padEnd(14) +
    String(r.reason).padEnd(8) +
    ms(r.gap) +
    ms(r.latency) + '  ' +
    String(r.blocked ? 'yes' : 'no').padStart(4) +
    String(r.withSound === null ? '—' : (r.withSound ? 'yes' : 'NO')).padStart(8) +
    String(r.paused ? 'yes' : 'no').padStart(9) +
    String(r.rs === null ? '—' : r.rs).padStart(4)
  );
}

console.log(`
  gap      milliseconds between the outgoing piece's last presented frame and
           the incoming one's first. One frame at 30 fps is 33 ms
  latency  from the play() request to the first presented frame.
           If gap ≈ latency, the problem is that it started too late
  blkd     the play was rejected with NotAllowedError
  sound    the request went WITH sound. If it says NO, that row proves nothing
           about the policy: a muted play is always granted
  paused   after unmuting it, the browser paused it
  rs       readyState of the incoming piece when its play was requested.
           Below 2 means the gap is a buffer gap, not a policy one
`);

await browser.close();
