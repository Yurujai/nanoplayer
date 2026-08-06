/**
 * Comprobación de accesibilidad en navegador real.
 *
 * Es la pieza que convierte "queremos que sea accesible" en algo verificable.
 * Corre en CI y **bloquea el merge**, porque la accesibilidad que no se
 * comprueba automáticamente se degrada sin que nadie se entere.
 *
 * Cubre dos cosas que las herramientas automáticas sí saben medir:
 *   1. Las reglas WCAG 2.1 A y AA que axe-core puede verificar.
 *   2. Que todo control sea alcanzable y operable **solo con el teclado**.
 *
 * Lo que NO cubre, y hay que decirlo: axe detecta en torno a un tercio de los
 * problemas reales de accesibilidad. Que esto pase en verde no sustituye una
 * revisión con lector de pantalla; solo garantiza que no hay regresiones en lo
 * automatizable.
 *
 *   node a11y.mjs [url]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const URL_BASE = process.argv[2] ?? 'http://127.0.0.1:5180/';

const REGLAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const problemas = [];
const nota = (m) => { problemas.push(m); console.log('  ✗ ' + m); };
const bien = (m) => console.log('  ✓ ' + m);

async function auditar(etiqueta) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(
    (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
    REGLAS,
  );
  const graves = r.violations.filter((v) => v.impact !== 'minor');
  console.log(`\n[axe] ${etiqueta}: ${r.passes.length} reglas pasadas, ` +
    `${r.violations.length} incumplidas`);
  for (const v of r.violations) {
    const linea = `${v.id} (${v.impact}) — ${v.help} · ${v.nodes.length} nodo(s)`;
    if (graves.includes(v)) nota(`${etiqueta}: ${linea}`);
    else console.log('  · ' + linea + '  [menor]');
    for (const n of v.nodes.slice(0, 2)) console.log(`      ${n.html.slice(0, 110)}`);
  }
  if (r.violations.length === 0) bien(`${etiqueta}: sin incumplimientos`);
}

/* ------------------------------------------------------------------------- */

console.log(`Auditando ${URL_BASE}\n`);
await page.goto(URL_BASE, { waitUntil: 'load' });

await auditar('página inicial');

// Montar el reproductor con controles.
await page.selectOption('#fuente', 'dual');
await page.click('#btn-resolver');
await page.waitForTimeout(600);
await page.click('#btn-enganchar');
await page.waitForFunction(() => document.querySelector('.np__bar') !== null,
  null, { timeout: 20000 });
await page.waitForTimeout(500);

await auditar('con barra de controles');

/* --- navegación por teclado --------------------------------------------- */

console.log('\n[teclado] recorrido con Tab');
const foco = async () => page.evaluate(() => {
  const a = document.activeElement;
  if (!a) return null;
  return {
    tag: a.tagName.toLowerCase(),
    label: a.getAttribute('aria-label'),
    dentro: !!a.closest('.np'),
  };
});

await page.evaluate(() => document.querySelector('.np')?.focus());
const alcanzados = [];
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab');
  const f = await foco();
  if (!f?.dentro) break;
  alcanzados.push(`${f.tag}[${f.label ?? 'sin etiqueta'}]`);
}
console.log('  alcanzados: ' + (alcanzados.join(', ') || 'ninguno'));

const ESPERADOS = ['Reproducir', 'Silenciar', 'Volumen', 'Posición', 'Pantalla completa'];
for (const e of ESPERADOS) {
  if (alcanzados.some((a) => a.includes(e))) bien(`"${e}" es alcanzable con Tab`);
  else nota(`"${e}" NO se alcanza con Tab`);
}

/* --- operable con teclado ------------------------------------------------ */

console.log('\n[teclado] atajos');
await page.evaluate(() => document.querySelector('.np')?.focus());

await page.keyboard.press('Space');
await page.waitForTimeout(700);
const trasEspacio = await page.evaluate(() => window.__np?.state ?? null);
if (await page.evaluate(() => !document.querySelector('.np video')?.paused)) {
  bien('Espacio inicia la reproducción');
} else {
  nota(`Espacio no inició la reproducción (estado: ${trasEspacio})`);
}

const antes = await page.evaluate(() => document.querySelector('.np video').currentTime);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
const despues = await page.evaluate(() => document.querySelector('.np video').currentTime);
if (despues > antes + 3) bien('Flecha derecha avanza en el vídeo');
else nota(`Flecha derecha no avanzó (${antes.toFixed(2)} → ${despues.toFixed(2)})`);

await page.keyboard.press('m');
await page.waitForTimeout(200);
const silenciado = await page.evaluate(() =>
  document.querySelector('.np__volume input').value === '0');
if (silenciado) bien('M silencia');
else nota('M no silenció');

/* --- el foco no se pierde ------------------------------------------------ */

console.log('\n[foco] la barra no se oculta con el foco dentro');
await page.evaluate(() => document.querySelector('.np__bar button')?.focus());
await page.waitForTimeout(3200);   // más que el tiempo de inactividad
const visible = await page.evaluate(() => {
  const bar = document.querySelector('.np__bar');
  return Number(getComputedStyle(bar).opacity) > 0.5;
});
if (visible) bien('la barra sigue visible con el foco dentro');
else nota('la barra se ocultó con el foco dentro: se pierde de vista el control en uso');

/* --- veredicto ----------------------------------------------------------- */

await browser.close();
console.log('\n' + '─'.repeat(66));
if (problemas.length === 0) {
  console.log('ACCESIBILIDAD: sin problemas automatizables detectados.');
  console.log('Recordatorio: axe cubre ~1/3 de los problemas reales. La revisión');
  console.log('con lector de pantalla sigue siendo necesaria.');
} else {
  console.log(`ACCESIBILIDAD: ${problemas.length} problema(s):`);
  for (const p of problemas) console.log('  · ' + p);
}
console.log('─'.repeat(66) + '\n');
process.exit(problemas.length ? 1 : 0);
