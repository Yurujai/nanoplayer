/*
 * Packs the probe into a single self-contained HTML file.
 *
 * The aim is that it can be sent in a message or put on any static hosting
 * with no dependencies: whoever opens it installs nothing, and there is no
 * external resource that could be missing.
 *
 *   node build.mjs   ->   dist/nanoplayer-probe.html
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const MARK = 'const MEDIA_B64 = null; /* __MEDIA_B64__ */';

const html = readFileSync(join(DIR, 'probe.html'), 'utf8');
if (!html.includes(MARK)) {
  console.error('Media marker not found in probe.html');
  process.exit(1);
}

const b64 = (f) => readFileSync(join(DIR, 'media', f)).toString('base64');
const payload = { a: b64('probe-a.mp4'), b: b64('probe-b.mp4') };

const out = html.replace(MARK, `const MEDIA_B64 = ${JSON.stringify(payload)};`);

mkdirSync(join(DIR, 'dist'), { recursive: true });
const dest = join(DIR, 'dist', 'nanoplayer-probe.html');
writeFileSync(dest, out);

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`${dest}`);
console.log(`  media   ${kb(payload.a.length + payload.b.length)} (base64)`);
console.log(`  total   ${kb(Buffer.byteLength(out))}`);
