/*
 * Medición automática del spike S6.
 *
 * Mide el hueco de cada costura en las tres variantes, en Chrome de escritorio.
 *
 * **Sin `--autoplay-policy=no-user-gesture-required`**, al contrario que los
 * arneses de S1 y S5. Ese flag es justo lo que este spike no puede permitirse:
 * con él, las tres variantes pasarían y la pregunta sobre la política quedaría
 * sin responder. La activación por gesto se consigue como en la vida real, con
 * un clic de verdad (`page.click`).
 *
 * Y una advertencia que conviene no olvidar al leer la salida: **Chrome de
 * escritorio concede la activación por página**, no por elemento. Un clic en
 * cualquier sitio desbloquea todos los `<video>` de la página. iOS **no** hace
 * eso: allí el permiso es de cada elemento. Así que es de esperar que aquí la
 * variante B pase, y eso NO significa que vaya a pasar en un iPhone. La
 * respuesta de iOS solo sale del banco manual.
 *
 *   node measure.mjs
 *   HEADED=1 node measure.mjs
 *   ENGINE=webkit node measure.mjs   (el motor de Safari — el que importa)
 *
 * Conviene generar un principal corto para no esperar de más:
 *   DUR_MAIN=12 ./gen-media.sh
 */
import { chromium, webkit } from 'playwright';

const URL_BANCO = process.env.URL ?? 'http://127.0.0.1:8180/';
const LIMITE_MS = Number(process.env.LIMITE ?? 90000);

const CONFIGS = [
  { variante: 'A', lead: 0, salto: false, nota: 'la propuesta, sin anticipación' },
  { variante: 'A', lead: 300, salto: false, nota: 'la propuesta, anticipando 300 ms' },
  { variante: 'A', lead: 600, salto: false, nota: 'la propuesta, anticipando 600 ms' },
  { variante: 'A', lead: 0, salto: true, nota: 'saltando la cabecera' },
  { variante: 'B', lead: 0, salto: false, nota: 'sin desbloquear en el gesto' },
  { variante: 'C', lead: 0, salto: false, nota: 'un elemento, cambiando src' },
];

const ms = (v) => (v === null || v === undefined ? '    —' : String(Math.round(v)).padStart(5));

async function correr(browser, cfg) {
  // Contexto nuevo en cada pasada: Chrome acumula "media engagement" por
  // origen, y con él se vuelve más permisivo. Reutilizar el contexto haría que
  // las últimas variantes salieran mejor por haber ido después, no por ser
  // mejores.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });

  await page.goto(URL_BANCO, { waitUntil: 'load' });
  await page.selectOption('#sel-variante', cfg.variante);
  if (cfg.variante !== 'C') await page.selectOption('#sel-lead', String(cfg.lead));

  await page.click('#btn-play');

  if (cfg.salto) {
    // Un momento para que la cabecera arranque de verdad antes de saltarla:
    // saltar en el primer fotograma mediría el arranque, no el salto.
    await page.waitForTimeout(2000);
    await page.click('#btn-saltar');
  }

  const t0 = Date.now();
  let informe = null;
  while (Date.now() - t0 < LIMITE_MS) {
    informe = await page.evaluate(() => {
      try { return JSON.parse(document.getElementById('informe').textContent); }
      catch { return null; }
    });
    if (informe && informe.completa) break;
    await page.waitForTimeout(500);
  }

  await ctx.close();
  return { informe, errores, agotado: !(informe && informe.completa) };
}

const MOTOR = process.env.ENGINE ?? 'chromium';

/*
 * S1 y S5 exigen Chrome del sistema porque el Chromium de Playwright no traía
 * códecs H.264. Eso **ya no es cierto** en las versiones recientes: se ha
 * comprobado aquí que decodifica el H.264 de `gen-media.sh`. Aun así se
 * prefiere Chrome si está instalado, y si no se cae al Chromium empaquetado en
 * lugar de no poder medir.
 *
 * WebKit es el que de verdad interesa —es el motor de Safari— pero **no es
 * Safari de iOS**: su política de autoplay no es la del dispositivo. Sirve para
 * ver la forma de la respuesta, no para darla por buena.
 */
async function abrirNavegador() {
  const headless = !process.env.HEADED;
  if (MOTOR === 'webkit') {
    return { browser: await webkit.launch({ headless }), cual: 'WebKit (Playwright)' };
  }
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless });
    return { browser, cual: 'Google Chrome del sistema' };
  } catch {
    const browser = await chromium.launch({ headless });
    return { browser, cual: 'Chromium de Playwright (no hay Chrome instalado)' };
  }
}

const { browser, cual } = await abrirNavegador();

/*
 * Comprobar que este navegador decodifica el H.264 de las piezas ANTES de
 * medir nada. Sin esto, un navegador sin códecs daría cero fotogramas y los
 * huecos saldrían nulos: un fallo de entorno disfrazado de resultado.
 */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL_BANCO, { waitUntil: 'load' });
  const ok = await page.evaluate(() => new Promise((res) => {
    const v = document.createElement('video');
    v.muted = true; v.src = 'media/intro.mp4';
    v.addEventListener('loadeddata', () => res(true), { once: true });
    v.addEventListener('error', () => res(false), { once: true });
    setTimeout(() => res(false), 8000);
  }));
  await ctx.close();
  if (!ok) {
    console.error(`\n  ${cual} no decodifica el H.264 de media/. Sin eso no hay nada que medir.`);
    await browser.close();
    process.exit(1);
  }
}

console.log(`\nBanco:   ${URL_BANCO}`);
console.log(`Motor:   ${cual}`);
console.log('Los navegadores de escritorio conceden la activación POR PÁGINA.');
console.log('Que la variante B pase aquí no dice nada sobre iOS.\n');

const filas = [];

for (const cfg of CONFIGS) {
  const etiqueta = `${cfg.variante}${cfg.salto ? ' (salto)' : ''} lead=${cfg.lead}ms`;
  process.stdout.write(`  ${etiqueta.padEnd(22)} ${cfg.nota} ... `);

  const { informe, errores, agotado } = await correr(browser, cfg);

  if (!informe) { console.log('SIN INFORME'); continue; }
  console.log(agotado ? 'incompleto (se agotó el tiempo)' : 'ok');

  for (const c of informe.costuras) {
    filas.push({
      config: etiqueta,
      costura: `${c.de}→${c.a}`,
      motivo: c.motivo,
      hueco: c.huecoMs,
      latencia: c.latenciaMs,
      bloqueado: c.bloqueado,
      conSonido: c.conSonido,
      pausada: c.pausadaTrasSonido,
      rs: c.readyStateEntrante,
    });
  }
  if (informe.rvfc === false) {
    console.log('    AVISO: sin requestVideoFrameCallback, los huecos son estimaciones.');
  }
  for (const e of errores.slice(0, 3)) console.log(`    error de página: ${e}`);
}

console.log('\n  config                 costura       motivo  hueco  latenc  bloq  sonido  pausada  rs');
console.log('  ' + '-'.repeat(86));
for (const f of filas) {
  console.log(
    '  ' + f.config.padEnd(22) +
    f.costura.padEnd(14) +
    String(f.motivo).padEnd(8) +
    ms(f.hueco) +
    ms(f.latencia) + '  ' +
    String(f.bloqueado ? 'sí' : 'no').padStart(4) +
    String(f.conSonido === null ? '—' : (f.conSonido ? 'sí' : 'NO')).padStart(8) +
    String(f.pausada ? 'sí' : 'no').padStart(9) +
    String(f.rs === null ? '—' : f.rs).padStart(4)
  );
}

console.log(`
  hueco    milisegundos entre el último fotograma presentado de la pieza
           saliente y el primero de la entrante. Un fotograma a 30 fps son 33 ms
  latenc   desde que se pidió el play() hasta el primer fotograma presentado.
           Si el hueco ≈ la latencia, el problema es que se arrancó tarde
  bloq     el play fue rechazado con NotAllowedError
  sonido   la petición iba CON sonido. Si pone NO, esa fila no prueba nada
           sobre la política: un play silenciado se concede siempre
  pausada  tras quitarle el silencio, el navegador la pausó
  rs       readyState de la entrante al pedirle el play. Menos de 2 significa
           que el hueco es de búfer, no de política
`);

await browser.close();
