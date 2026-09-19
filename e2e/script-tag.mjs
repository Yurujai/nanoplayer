/*
 * La promesa del objetivo O5, comprobada en un navegador de verdad.
 *
 * Una etiqueta `<script>` y tres líneas tienen que dar un reproductor **con
 * controles**. Suena a que no hace falta comprobarlo, y sin embargo es
 * exactamente lo que falló al montar el paquete: el `export *` del núcleo
 * ganaba sobre el `create` con pilas, y la global acababa trayendo el headless.
 * Los tipos, el build y los tests de unidad no dijeron nada.
 *
 * Por eso se audita el FICHERO CONSTRUIDO cargado como lo cargaría cualquiera,
 * y no el código fuente.
 *
 *   pnpm build && node script-tag.mjs
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const IIFE = new URL('../packages/bundle/dist/nanoplayer.min.js', import.meta.url);
const guion = readFileSync(IIFE, 'utf8');

// Exactamente lo que diría la documentación, sin una línea más.
const PAGINA = `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<body>
<div id="player" style="width:640px"></div>
<script src="/nanoplayer.min.js"></script>
<script>
  window.__p = NanoPlayer.create('#player', { manifest: {
    id: 'x',
    streams: [{ id: 'cam', role: 'presenter', audio: true,
                sources: [{ src: '/no-se-descarga.mp4', type: 'video/mp4' }] }],
  } });
</script>
</body></html>`;

const servidor = createServer((req, res) => {
  if (req.url === '/nanoplayer.min.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(guion);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGINA);
});
await new Promise((r) => servidor.listen(5201, '127.0.0.1', r));

let fallos = 0;
const comprobar = (ok, que, detalle = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${que}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};

const navegador = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const pagina = await navegador.newPage();

const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));
const peticiones = [];
pagina.on('request', (r) => peticiones.push(r.url()));

await pagina.goto('http://127.0.0.1:5201/', { waitUntil: 'load' });

console.log('\nUna etiqueta <script> y tres líneas');
comprobar(errores.length === 0, 'la página no lanza errores', errores[0] ?? '');
comprobar(await pagina.evaluate(() => typeof NanoPlayer === 'object'),
  'define la global NanoPlayer');
comprobar(await pagina.evaluate(() => !!window.__p), 'create() devuelve un reproductor');

console.log('\nY trae los controles puestos');
const barra = await pagina.locator('.np__bar').count();
comprobar(barra === 1, 'hay barra de controles', `encontradas: ${barra}`);

const botones = await pagina.locator('#player button').count();
comprobar(botones > 0, 'hay botones', `${botones}`);

const sinNombre = await pagina.evaluate(() =>
  [...document.querySelectorAll('#player button')]
    .filter((b) => !(b.getAttribute('aria-label') ?? '').trim()).length);
comprobar(sinNombre === 0, 'todos los botones tienen nombre accesible',
  sinNombre ? `${sinNombre} sin nombre` : '');

console.log('\nSin romper el ciclo perezoso');
const videos = await pagina.locator('#player video').count();
comprobar(videos === 0, 'ningún <video> en el DOM antes de reproducir');
const pidioMedios = peticiones.some((u) => u.includes('no-se-descarga.mp4'));
comprobar(!pidioMedios, 'ni un byte de vídeo pedido');

await navegador.close();
servidor.close();

console.log(fallos === 0 ? '\nTodo correcto.\n' : `\n${fallos} fallo(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
