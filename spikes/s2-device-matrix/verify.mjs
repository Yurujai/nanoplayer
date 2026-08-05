/*
 * Verifica la sonda empaquetada antes de mandársela a nadie.
 *
 * Enviar a otras personas una página de diagnóstico rota cuesta mucho más que
 * un fallo propio: no se puede depurar en su dispositivo y se gasta el favor de
 * pedirles la prueba. Esto la ejecuta entera contra Chrome local.
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

// Las secciones 1 y 2 se rellenan solas al cargar.
const filled = await page.evaluate(() => ({
  env: document.getElementById('env').children.length,
  caps: document.getElementById('caps').children.length,
}));
console.log(`\nFilas rellenadas sin interacción: entorno ${filled.env / 2}, capacidades ${filled.caps / 2}`);
if (!filled.env || !filled.caps) { console.error('FALLO: secciones pasivas vacías'); process.exit(1); }

console.log('Ejecutando pruebas de reproducción…');
await page.click('#run');
// Ojo: el 2.º argumento de waitForFunction es el ARGUMENTO de la función, no
// las opciones. Pasando las opciones ahí se ignoran silenciosamente y aplica el
// timeout por defecto de 30 s, que no llega para una pasada completa.
await page.waitForFunction(
  () => document.getElementById('status').textContent.includes('terminadas'),
  null,
  { timeout: 180000 }
);

console.log('Ejecutando prueba de pantalla completa…');
await page.click('#fs');
await page.waitForFunction(
  () => document.getElementById('fsres').children.length > 0,
  null,
  { timeout: 60000 }
);

const report = JSON.parse(await page.inputValue('#out'));
await browser.close();
server.close();

console.log('\n─── Informe ───────────────────────────────────────────────');
console.log(JSON.stringify(report, null, 2));
console.log('───────────────────────────────────────────────────────────\n');

// Comprobaciones de que la SONDA funciona. No se juzga al dispositivo aquí:
// un "0 vídeos simultáneos" en un móvil viejo es un resultado válido; en Chrome
// de escritorio significa que la sonda está rota.
const fails = [];
const p = report.playback ?? {};
if (!report.env?.viewport) fails.push('entorno sin recoger');
if (report.caps?.rVFC === undefined) fails.push('capacidades sin recoger');
if (!p.maxConcurrentVideos) fails.push('la prueba de decodificación no midió nada');
if (p.driftMedianMs === null || p.driftMedianMs === undefined) fails.push('la sincronización no midió nada');
if (p.driftMedianMs > 33) fails.push(`deriva ${p.driftMedianMs} ms por encima de un frame en Chrome`);
if (!p.loopFps) fails.push('el lazo de control no corrió');
if (!report.fullscreen) fails.push('la prueba de pantalla completa no reportó');
if (errors.length) fails.push('errores JS: ' + [...new Set(errors)].join(' | '));

if (fails.length) {
  console.log('SONDA NO VÁLIDA:');
  for (const f of fails) console.log('  · ' + f);
  process.exit(1);
}
console.log('SONDA VÁLIDA: recoge las cuatro familias de datos sin errores.\n');
