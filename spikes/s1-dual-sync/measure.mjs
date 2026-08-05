/*
 * Arnés de medición del spike S1.
 *
 * El objetivo no es "que funcione", es tener números: cuánta deriva aguanta el
 * sistema en régimen estable y cuánto tarda en recuperarse de cada perturbación.
 * Sin esto, el spike es una opinión.
 *
 * Usa Google Chrome del sistema (channel: 'chrome') en lugar del Chromium que
 * empaqueta Playwright, porque este último no trae códecs H.264/AAC.
 *
 *   node measure.mjs            (headless)
 *   HEADED=1 node measure.mjs   (ventana visible)
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://127.0.0.1:8099/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];

function stats(samples) {
  if (!samples.length) return null;
  const abs = samples.map(Math.abs).sort((a, b) => a - b);
  const p = (q) => abs[Math.min(abs.length - 1, Math.floor(abs.length * q))];
  return {
    n: abs.length,
    median: p(0.5),
    p95: p(0.95),
    max: abs[abs.length - 1],
  };
}

const ms = (s) => (s * 1000).toFixed(1) + ' ms';

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.env.HEADED,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const page = await browser.newPage();

  const errors = [];
  const noise = (t) => /favicon/i.test(t);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !noise(m.text())) errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: 'load' });

  // Esperar a que ambos vídeos tengan metadatos y buffer utilizable.
  await page.waitForFunction(
    () => {
      const m = document.getElementById('master');
      const s = document.getElementById('slave');
      return m.readyState >= 3 && s.readyState >= 3;
    },
    { timeout: 30000 }
  );

  const info = await page.evaluate(() => ({
    masterDur: document.getElementById('master').duration,
    slaveDur: document.getElementById('slave').duration,
    hasRVFC: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
  }));
  console.log(`\nMaestro ${info.masterDur.toFixed(2)}s · esclavo ${info.slaveDur.toFixed(2)}s`);
  console.log(`requestVideoFrameCallback: ${info.hasRVFC ? 'sí' : 'no (fallback a rAF)'}\n`);

  const reset = () => page.evaluate(() => window.__sync.reset());
  const play = () => page.evaluate(() => document.getElementById('master').play());
  const pause = () => page.evaluate(() => document.getElementById('master').pause());
  const read = () =>
    page.evaluate(() => ({
      samples: window.__sync.samples.slice(),
      maxDrift: window.__sync.maxDrift,
      hardSeeks: window.__sync.hardSeeks,
      stalls: window.__sync.stalls,
      drift: window.__sync.drift(),
    }));

  /** Perturba y mide cuánto tarda la deriva en volver a la zona muerta. */
  async function recovery(label, perturb, budgetMs = 12000) {
    await page.evaluate(perturb);
    const t0 = Date.now();
    let recovered = null;
    let peak = 0;
    while (Date.now() - t0 < budgetMs) {
      const d = await page.evaluate(() => ({
        drift: window.__sync.drift(),
        hs: window.__sync.hardSeeks,
        seeking: document.getElementById('slave').seeking,
      }));
      peak = Math.max(peak, Math.abs(d.drift));
      if (!d.seeking && Math.abs(d.drift) <= 0.033) {
        recovered = Date.now() - t0;
        break;
      }
      await sleep(60);
    }
    const after = await read();
    results.push({ scenario: label, recoveryMs: recovered, peak, hardSeeks: after.hardSeeks });
    console.log(
      `  ${label.padEnd(28)} pico ${ms(peak).padStart(10)}  ` +
        `recuperación ${recovered === null ? 'NO RECUPERA' : recovered + ' ms'}  ` +
        `saltos duros ${after.hardSeeks}`
    );
  }

  // --- 1. Régimen estable -------------------------------------------------
  console.log('1. Régimen estable (25 s a 1×)');
  await play();
  await sleep(1500);
  await reset();
  await sleep(25000);
  let r = await read();
  const st = stats(r.samples);
  console.log(
    `  muestras ${st.n} · mediana ${ms(st.median)} · p95 ${ms(st.p95)} · ` +
      `máx ${ms(st.max)} · saltos duros ${r.hardSeeks} · stalls ${r.stalls}\n`
  );
  results.push({ scenario: 'estable-1x', ...st, hardSeeks: r.hardSeeks });

  // --- 2. Perturbaciones ---------------------------------------------------
  console.log('2. Recuperación ante perturbaciones');
  await reset();
  await recovery('nudge +250 ms', () => { document.getElementById('slave').currentTime += 0.25; });
  await sleep(1200);
  await reset();
  await recovery('shove +2 s (fuerza salto)', () => { document.getElementById('slave').currentTime += 2.0; });
  await sleep(1200);
  await reset();
  await recovery('seek del maestro', () => {
    document.getElementById('master').currentTime = 40;
  });
  await sleep(1200);
  await reset();
  await recovery('stall del esclavo 1.5 s', () => {
    const s = document.getElementById('slave');
    s.pause();
    setTimeout(() => { const m = document.getElementById('master'); if (!m.paused) s.play(); }, 1500);
  });
  console.log('');

  // --- 3. Velocidad alterada ----------------------------------------------
  console.log('3. Régimen estable a 2× (15 s)');
  await page.evaluate(() => { document.getElementById('master').playbackRate = 2; });
  await sleep(1500);
  await reset();
  await sleep(15000);
  r = await read();
  const st2 = stats(r.samples);
  console.log(
    `  mediana ${ms(st2.median)} · p95 ${ms(st2.p95)} · máx ${ms(st2.max)} · ` +
      `saltos duros ${r.hardSeeks}\n`
  );
  results.push({ scenario: 'estable-2x', ...st2, hardSeeks: r.hardSeeks });

  await pause();

  if (errors.length) {
    console.log('Errores de página:');
    for (const e of new Set(errors)) console.log('  ' + e);
    console.log('');
  }

  await browser.close();

  // --- Veredicto -----------------------------------------------------------
  // El veredicto mira TODOS los escenarios. Mirar solo el régimen estable daba
  // "viable" con tres escenarios rotos en la primera pasada del spike.
  const fails = [];
  const s1x = results.find((x) => x.scenario === 'estable-1x');
  const s2x = results.find((x) => x.scenario === 'estable-2x');

  if (s1x.p95 > 0.015) fails.push(`1×: p95 ${ms(s1x.p95)} > 15 ms`);
  if (s1x.hardSeeks > 0) fails.push(`1×: ${s1x.hardSeeks} saltos duros en régimen estable`);
  if (s2x.p95 > 0.030) fails.push(`2×: p95 ${ms(s2x.p95)} > 30 ms`);
  if (s2x.hardSeeks > 0) fails.push(`2×: ${s2x.hardSeeks} saltos duros en régimen estable`);
  for (const r of results.filter((x) => x.recoveryMs !== undefined)) {
    if (r.recoveryMs === null) fails.push(`"${r.scenario}" no recupera`);
    else if (r.recoveryMs > 4000) fails.push(`"${r.scenario}" tarda ${r.recoveryMs} ms`);
  }

  console.log('─'.repeat(64));
  if (fails.length === 0) {
    console.log('VEREDICTO: S1 viable. Sincronización dentro de tolerancia y');
    console.log('           recuperación en todos los escenarios probados.');
  } else {
    console.log('VEREDICTO: no pasa. Fallos:');
    for (const f of fails) console.log('  · ' + f);
  }
  console.log('─'.repeat(64) + '\n');
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
