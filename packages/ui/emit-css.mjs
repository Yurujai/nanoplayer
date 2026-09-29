/*
 * Writes the CSS to a file for sites with a strict CSP: `injectStyles()` adds
 * an inline `<style>` that `style-src 'self'` blocks silently. Those sites serve
 * this file and pass `injectStyles: false`. The string stays the single source.
 *
 *   node emit-css.mjs dist/nanoplayer.css
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CSS } from './dist/index.js';

const target = resolve(process.cwd(), process.argv[2] ?? 'dist/nanoplayer.css');
const header = '/* NanoPlayer — default stylesheet.\n'
  + ' * Generated from packages/ui/src/styles.ts; do not edit by hand.\n'
  + ' * Use it with `injectStyles: false` if your CSP does not allow inline styles. */\n';

writeFileSync(target, header + CSS);
console.log(`  ${target}  ${((header.length + CSS.length) / 1024).toFixed(1)} KB`);
