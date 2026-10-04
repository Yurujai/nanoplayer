/*
 * Checks the built packages, imported by specifier so everything goes through
 * package.json `exports`, as an npm install would.
 *
 * It exists because plugins once shipped their own copy of the core: a plugin
 * registered in a registry nobody read and captions never turned on, silently.
 *
 *   pnpm build && node dist.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const PACKAGES = ['core', 'ui', 'engine-hls', 'plugin-captions', 'plugin-chapters', 'plugin-pip', 'plugin-audio-tracks', 'plugin-media-session', 'plugin-quality', 'plugin-resume', 'plugin-transcript', 'plugin-xapi', 'plugin-thumbnails', 'plugin-cast', 'playlist', 'plugin-h5p', 'bundle'];
const root = new URL('../packages/', import.meta.url);

let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\nEntries declared in package.json');
for (const name of PACKAGES) {
  const pkg = JSON.parse(readFileSync(new URL(`${name}/package.json`, root), 'utf8'));
  const dir = new URL(`${name}/`, root);
  for (const field of ['main', 'types']) {
    const rel = pkg[field];
    check(rel && existsSync(fileURLToPath(new URL(rel, dir))), `${pkg.name} · ${field}`, rel);
  }
  const imp = pkg.exports?.['.']?.import;
  check(imp && existsSync(fileURLToPath(new URL(imp, dir))), `${pkg.name} · exports.import`, imp);
}

console.log('\nPublic surface of the core');
const core = await import('@nanoplayer/core');
for (const n of ['create', 'createPlayer', 'validateManifest', 'parseManifest',
                 'EventBus', 'Synchronizer', 'PlayerRegistry', 'plugins', 'registry']) {
  check(n in core, `@nanoplayer/core exports ${n}`);
}

console.log('\nA single core instance');
await import('@nanoplayer/plugin-captions');
check(core.plugins.has('captions'),
  'the plugin registers in the core registry',
  `registered: [${core.plugins.registered.join(', ')}]`);
await import('@nanoplayer/plugin-chapters');
check(core.plugins.has('chapters'),
  'the chapters plugin too',
  `registered: [${core.plugins.registered.join(', ')}]`);
await import('@nanoplayer/plugin-pip');
check(core.plugins.has('pip'),
  'and the picture-in-picture plugin',
  `registered: [${core.plugins.registered.join(', ')}]`);
await import('@nanoplayer/plugin-audio-tracks');
check(core.plugins.has('audio-tracks'),
  'and the audio tracks plugin',
  `registered: [${core.plugins.registered.join(', ')}]`);
await import('@nanoplayer/plugin-media-session');
check(core.plugins.has('media-session'),
  'and the media session plugin',
  `registered: [${core.plugins.registered.join(', ')}]`);
await import('@nanoplayer/plugin-quality');
check(core.plugins.has('quality'),
  'and the quality plugin',
  `registered: [${core.plugins.registered.join(', ')}]`);
await import('@nanoplayer/plugin-resume');
check(core.plugins.has('resume'),
  'and the resume plugin',
  `registered: [${core.plugins.registered.join(', ')}]`);
await import('@nanoplayer/plugin-transcript');
check(core.plugins.has('transcript'),
  'and the transcript plugin',
  `registered: [${core.plugins.registered.join(', ')}]`);
await import('@nanoplayer/plugin-xapi');
check(core.plugins.has('xapi'),
  'and the xAPI plugin',
  `registered: [${core.plugins.registered.join(', ')}]`);
await import('@nanoplayer/plugin-thumbnails');
check(core.plugins.has('thumbnails'),
  'and the thumbnails plugin',
  `registered: [${core.plugins.registered.join(', ')}]`);
await import('@nanoplayer/plugin-cast');
check(core.plugins.has('cast'),
  'and the cast plugin',
  `registered: [${core.plugins.registered.join(', ')}]`);
await import('@nanoplayer/plugin-h5p');
check(core.plugins.has('h5p'),
  'and the H5P plugin',
  `registered: [${core.plugins.registered.join(', ')}]`);

const hls = await import('@nanoplayer/engine-hls');
check(typeof hls.enginesWithHls === 'function', '@nanoplayer/engine-hls exports enginesWithHls');

console.log('\nFiles for build-free integration');
for (const [pkg, file] of [['ui', 'nanoplayer.css'], ['bundle', 'nanoplayer.css'],
                           ['bundle', 'nanoplayer.min.js'], ['bundle', 'nanoplayer.umd.js']]) {
  const path = new URL(`${pkg}/dist/${file}`, root);
  const exists = existsSync(fileURLToPath(path));
  const size = exists ? readFileSync(path, 'utf8').length : 0;
  check(exists && size > 1000, `${pkg}/dist/${file}`, exists ? `${(size / 1024).toFixed(1)} KB` : 'missing');
}
{
  const css = readFileSync(new URL('bundle/dist/nanoplayer.css', root), 'utf8');
  check(css.includes('.np__bar'), 'the CSS carries the bar rules');
}

console.log('\nThe batteries-included bundle');
const batteries = await import('@nanoplayer/bundle');
check(typeof batteries.create === 'function', '@nanoplayer/bundle exports create');
// A star export once let the core's headless `create` win over the one with controls.
check(batteries.create !== core.create, "its create is not the core's headless one");
check(typeof batteries.attachControls === 'function', 're-exports attachControls');
check(typeof batteries.validateManifest === 'function', 're-exports the rest of the core');

console.log('\nIIFE bundle for the <script> tag');
const iife = readFileSync(new URL('bundle/dist/nanoplayer.min.js', root), 'utf8');
const ctx = createContext({ self: {}, window: {}, document: { documentElement: {} } });
try {
  runInContext(iife, ctx);
} catch (error) {
  check(false, 'the IIFE evaluates', error.message);
}
check(typeof ctx.NanoPlayer === 'object', 'defines the NanoPlayer global');
for (const n of ['create', 'attachControls', 'plugins', 'registry', 'validateManifest']) {
  check(ctx.NanoPlayer?.[n] !== undefined, `NanoPlayer.${n} at the top level`);
}

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
