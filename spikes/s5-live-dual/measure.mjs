/*
 * Automatic measurement for spike S5.
 *
 * It measures the same thing twice, with the difference that matters:
 * comparing the absolute time of each position (only possible with
 * PROGRAM-DATE-TIME) and comparing raw currentTime values (all that is
 * available without the tag).
 *
 *   node measure.mjs [seconds]
 */
import { chromium } from 'playwright';

const DUR = Number(process.argv[2] ?? 30);
const b = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.goto('http://127.0.0.1:8170/', { waitUntil: 'load' });
await p.click('#btn-load');
await p.waitForTimeout(6000);

const pdt = await p.evaluate(() =>
  document.getElementById('log').textContent.includes('PROGRAM-DATE-TIME: yes'));
console.log(`PROGRAM-DATE-TIME present: ${pdt ? 'yes' : 'NO'}`);

const read = () => p.evaluate(() => ({
  byTime: document.getElementById('byTime').textContent,
  byCurrentTime: document.getElementById('byCurrentTime').textContent,
  delay: document.getElementById('delay').textContent,
}));

console.log('\n--- right at start ---');
console.log(' ', JSON.stringify(await read()));

await p.click('#btn-measure');
console.log(`\n--- measuring ${DUR} s ---`);
for (let t = 5; t <= DUR; t += 5) {
  await p.waitForTimeout(5000);
  const r = await read();
  console.log(`  t=${String(t).padStart(3)}s  real=${r.byTime.padStart(9)}  currentTime=${r.byCurrentTime.padStart(9)}  delay=${r.delay}`);
}

console.log('\n--- one stream cut for 3 s ---');
await p.click('#btn-cut');
await p.waitForTimeout(4000);
for (const t of [1, 5, 12]) {
  await p.waitForTimeout(t === 1 ? 1000 : (t === 5 ? 4000 : 7000));
  const r = await read();
  console.log(`  +${String(t).padStart(2)}s after the cut  real=${r.byTime.padStart(9)}  currentTime=${r.byCurrentTime.padStart(9)}`);
}

const end = await p.evaluate(() => ({
  median: document.getElementById('median').textContent,
  max: document.getElementById('max').textContent,
  samples: document.getElementById('samples').textContent,
}));
console.log(`\nmedian=${end.median}  max=${end.max}  samples=${end.samples}`);
console.log('errors:', errs.length ? errs : 'none');
await b.close();
process.exit(0);
