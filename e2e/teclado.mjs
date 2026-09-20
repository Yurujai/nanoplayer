/*
 * Recorrido de teclado, en dos motores y **desde el documento**.
 *
 * Existe por un fallo que el arnés de accesibilidad no podía ver, y por dos
 * motivos a la vez:
 *
 *   1. Solo corría en Chrome. WebKit —Safari, y el único motor de iOS— no se
 *      probaba nunca.
 *   2. Empezaba con `document.querySelector('.np').focus()`, foco programático.
 *      Eso se salta justo el tramo que puede romperse: el camino desde el
 *      documento hasta dentro del reproductor.
 *
 * Lo que se descubrió al mirarlo: **WebKit no tabula a los botones** salvo que
 * el usuario active la navegación completa por teclado, que viene apagada. No
 * es un fallo del reproductor —le pasa a cualquier web— pero sí desmonta la
 * frase «navegable entero con el teclado» si se dice a secas.
 *
 * De ahí lo que se exige a cada motor:
 *
 *   - **Los dos**: el contenedor tiene que ser alcanzable desde el documento.
 *     Es el asidero del que depende Safari, y donde llegan los atajos.
 *   - **Los dos**: el foco tiene que poder SALIR del reproductor (WCAG 2.1.2).
 *   - **Chromium**: además, todos los controles alcanzables uno a uno.
 *
 *   node teclado.mjs --serve ../demo/dist
 *   node teclado.mjs http://127.0.0.1:5180/
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4', '.vtt': 'text/vtt; charset=utf-8', '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

const args = process.argv.slice(2);
let URL_BASE;
let servidor = null;

if (args[0] === '--serve') {
  const raiz = fileURLToPath(new URL(args[1] ?? '../demo/dist', import.meta.url));
  servidor = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = normalize(url).replace(/^(\.\.[/\\])+/, '');
    let ruta = join(raiz, rel === '/' ? 'index.html' : rel);
    try {
      if (statSync(ruta).isDirectory()) ruta = join(ruta, 'index.html');
    } catch { res.writeHead(404).end('404'); return; }
    try { statSync(ruta); } catch { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'content-type': TIPOS[extname(ruta)] ?? 'application/octet-stream' });
    createReadStream(ruta).pipe(res);
  });
  // 127.0.0.1 y no localhost: en el runner localhost resuelve a ::1 y WebKit
  // no siempre lo sigue.
  await new Promise((r) => servidor.listen(5202, '127.0.0.1', r));
  URL_BASE = 'http://127.0.0.1:5202/';
} else {
  URL_BASE = args[0] ?? 'http://127.0.0.1:5180/';
}

let fallos = 0;
const bien = (t) => console.log(`  ✓ ${t}`);
const mal = (t, d = '') => { console.log(`  ✗ ${t}${d ? ` — ${d}` : ''}`); fallos++; };
const nota = (t) => console.log(`  · ${t}`);

/** Recorre el documento con Tab y devuelve lo que va recibiendo el foco. */
async function recorrer(page, pasos = 14) {
  await page.evaluate(() => document.body.focus());
  const visto = [];
  for (let i = 0; i < pasos; i++) {
    await page.keyboard.press('Tab');
    visto.push(await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return { que: 'body', dentro: false, raiz: false };
      return {
        que: a.getAttribute('aria-label') || a.tagName.toLowerCase(),
        dentro: !!a.closest('.np'),
        raiz: a.classList?.contains('np') ?? false,
      };
    }));
  }
  return visto;
}

const CONTROLES = ['Reproducir vídeo', 'Posición', 'Silenciar', 'Volumen',
                   'Ajustes', 'Pantalla completa'];

for (const [nombre, motor] of [['Chromium', chromium], ['WebKit', webkit]]) {
  console.log(`\n[${nombre}] recorrido con Tab desde el documento`);
  let navegador;
  try {
    navegador = await motor.launch();
  } catch (error) {
    mal(`${nombre} no se pudo abrir`, String(error).slice(0, 80));
    continue;
  }
  const page = await navegador.newPage();
  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const visto = await recorrer(page);
  nota('orden: ' + visto.map((v) => v.que).join(' → '));

  // 1. El contenedor, alcanzable. Es lo que sostiene el caso de Safari.
  if (visto.some((v) => v.raiz)) bien('el contenedor del reproductor es alcanzable');
  else mal('el contenedor NO se alcanza con Tab desde el documento');

  // 2. El foco tiene que poder salir: un reproductor que atrapa el Tab deja la
  //    página entera inservible con teclado.
  const iEntra = visto.findIndex((v) => v.dentro);
  if (iEntra < 0) {
    // El foco no llega a entrar, así que no hay nada que escapar. Decir
    // "trampa de teclado" aquí sería mandar a mirar al sitio equivocado: el
    // fallo es el de arriba.
    nota('el foco nunca entra en el reproductor; la salida no se puede evaluar');
  } else if (visto.slice(iEntra).some((v) => !v.dentro)) {
    bien('el foco puede salir del reproductor');
  } else {
    mal('el foco NO sale del reproductor: posible trampa de teclado');
  }

  // 3. Los controles, uno a uno. Solo se exige donde el motor los tabula.
  const dentro = visto.filter((v) => v.dentro).map((v) => v.que);
  const faltan = CONTROLES.filter((c) => !dentro.includes(c));
  if (faltan.length === 0) {
    bien('todos los controles son alcanzables uno a uno');
  } else if (nombre === 'Chromium') {
    mal('controles que no se alcanzan', faltan.join(', '));
  } else {
    // WebKit por defecto no tabula botones ni deslizadores. No es un fallo del
    // reproductor, pero sí la razón de que el contenedor tenga que servir.
    nota(`WebKit no tabula ${faltan.length} controles (ajuste del sistema, no del reproductor)`);
    nota('por eso el contenedor es obligatorio: allí llegan los atajos');
  }

  // 4. Y en el motor que sí decodifica, que el atajo funcione de verdad.
  if (nombre === 'Chromium') {
    await page.evaluate(() => document.querySelector('.np')?.focus());
    await page.keyboard.press('Space');
    await page.waitForTimeout(1200);
    const sonando = await page.evaluate(() =>
      [...document.querySelectorAll('.np video')].some((v) => !v.paused));
    if (sonando) bien('el espacio sobre el contenedor inicia la reproducción');
    else mal('el espacio sobre el contenedor no inicia la reproducción');
  }

  await navegador.close();
}

servidor?.close();
console.log(fallos === 0 ? '\nTodo correcto.\n' : `\n${fallos} fallo(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
