/*
 * Los dos caminos de integración que usa un LMS, en un navegador de verdad.
 *
 * 1. **CSP estricta.** `injectStyles()` crea un `<style>` en línea, y una
 *    política `style-src 'self'` lo bloquea sin decir nada: el reproductor se
 *    queda sin estilos y no hay error que mirar. Se sirve la hoja como fichero
 *    y se pasa `injectStyles: false`. La página de prueba lleva la CSP puesta
 *    de verdad, por cabecera, no simulada.
 *
 * 2. **Cargador AMD.** Moodle carga su JS con RequireJS. Ahí un UMD hace falta,
 *    y a la vez es una trampa: un `<script src>` de UMD en una página con
 *    RequireJS se registra como módulo anónimo y NO deja la global. Por eso se
 *    publican los dos ficheros, y aquí se comprueba que cada uno hace lo suyo
 *    en presencia del cargador.
 *
 *   pnpm build && node integracion.mjs
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const dist = (f) => readFileSync(new URL(`../packages/bundle/dist/${f}`, import.meta.url), 'utf8');
const IIFE = dist('nanoplayer.min.js');
const UMD = dist('nanoplayer.umd.js');
const CSS = dist('nanoplayer.css');

const MANIFIESTO = `{ id: 'x', streams: [{ id: 'cam', role: 'presenter', audio: true,
  sources: [{ src: '/v.mp4', type: 'video/mp4' }] }] }`;

/*
 * Cargador AMD mínimo, fiel en lo que importa: el envoltorio UMD de Rollup
 * llama `define(['exports'], factory)` y espera que el cargador le pase el
 * objeto donde dejar los exports. Una versión que invoque `factory()` a secas
 * no registra nada — y parece un fallo del build cuando es del arnés.
 */
const AMD = `
  window.__modulos = {};
  window.define = function (deps, factory) {
    var exports = {};
    var args = (deps || []).map(function (d) { return d === 'exports' ? exports : undefined; });
    var ret = factory.apply(null, args);
    window.__modulos.anonimo = ret || exports;
  };
  window.define.amd = true;
`;

const PAGINAS = {
  // CSP real por cabecera: sin 'unsafe-inline' en style-src.
  '/csp': {
    csp: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:",
    html: `<link rel="stylesheet" href="/nanoplayer.css">
<div id="p"></div>
<script src="/nanoplayer.min.js"></script>
<script>
  window.__p = NanoPlayer.create('#p', { manifest: ${MANIFIESTO}, controls: { injectStyles: false } });
</script>`,
  },
  // El IIFE con un cargador AMD ya presente: la global tiene que seguir ahí.
  '/amd-iife': {
    html: `<div id="p"></div><script>${AMD}</script>
<script src="/nanoplayer.min.js"></script>
<script>window.__global = typeof NanoPlayer;</script>`,
  },
  // El UMD con el cargador: se registra como módulo.
  '/amd-umd': {
    html: `<div id="p"></div><script>${AMD}</script>
<script src="/nanoplayer.umd.js"></script>
<script>window.__modulo = typeof (window.__modulos.anonimo || {}).create;</script>`,
  },
};

const servidor = createServer((req, res) => {
  const ruta = req.url.split('?')[0];
  if (ruta === '/nanoplayer.min.js' || ruta === '/nanoplayer.umd.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(ruta.includes('umd') ? UMD : IIFE);
  }
  if (ruta === '/nanoplayer.css') {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    return res.end(CSS);
  }
  if (ruta === '/v.mp4') { res.writeHead(404); return res.end(); }
  const p = PAGINAS[ruta];
  if (!p) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    ...(p.csp ? { 'content-security-policy': p.csp } : {}),
  });
  res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><body>${p.html}</body></html>`);
});
await new Promise((r) => servidor.listen(5203, '127.0.0.1', r));

let fallos = 0;
const comprobar = (ok, que, detalle = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${que}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};

const navegador = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

/* --- 1. CSP estricta ------------------------------------------------------ */
console.log('\nCon CSP estricta (style-src \'self\', sin unsafe-inline)');
{
  const page = await navegador.newPage();
  const violaciones = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violaciones.push(m.text());
  });
  await page.goto('http://127.0.0.1:5203/csp', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  comprobar(await page.evaluate(() => !!window.__p), 'el reproductor se crea');
  comprobar((await page.locator('#p .np__bar').count()) === 1, 'la barra está montada');
  comprobar(violaciones.length === 0, 'ninguna violación de CSP', violaciones[0]?.slice(0, 90) ?? '');

  // Lo que de verdad importa: que la hoja externa se haya aplicado.
  const pintado = await page.evaluate(() => {
    const bar = document.querySelector('#p .np__bar');
    return bar ? getComputedStyle(bar).display : null;
  });
  comprobar(pintado === 'flex', 'el CSS del fichero se aplica', `display=${pintado}`);

  const enLinea = await page.evaluate(() => !!document.getElementById('nanoplayer-styles'));
  comprobar(!enLinea, 'no se inyectó ningún <style> en línea');
  await page.close();
}

/* --- 2. Con un cargador AMD ------------------------------------------------ */
console.log('\nCon un cargador AMD en la página (el caso Moodle)');
{
  const page = await navegador.newPage();
  await page.goto('http://127.0.0.1:5203/amd-iife', { waitUntil: 'load' });
  const tipo = await page.evaluate(() => window.__global);
  comprobar(tipo === 'object', 'el IIFE sigue dejando la global pese al cargador', `typeof = ${tipo}`);
  await page.close();

  const page2 = await navegador.newPage();
  await page2.goto('http://127.0.0.1:5203/amd-umd', { waitUntil: 'load' });
  const create = await page2.evaluate(() => window.__modulo);
  comprobar(create === 'function', 'el UMD se registra como módulo AMD', `create = ${create}`);
  await page2.close();
}

await navegador.close();
servidor.close();
console.log(fallos === 0 ? '\nTodo correcto.\n' : `\n${fallos} fallo(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
