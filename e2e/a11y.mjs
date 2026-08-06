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

/* --- el menú de ajustes, abierto ----------------------------------------- */

// Auditarlo cerrado no vale de nada: las semánticas de menú solo existen
// mientras está desplegado.
await page.evaluate(() => document.querySelector('.np__btn--settings')?.focus());
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await auditar('menú de ajustes abierto');

console.log('\n[menú] patrón WAI-ARIA de botón de menú');
const rolMenu = await page.evaluate(() =>
  document.querySelector('.np__menu [role="menu"]') !== null);
if (rolMenu) bien('el contenedor declara role="menu"');
else nota('el menú no declara role="menu"');

const expandido = await page.evaluate(() =>
  document.querySelector('.np__btn--settings')?.getAttribute('aria-expanded'));
if (expandido === 'true') bien('aria-expanded refleja que está abierto');
else nota(`aria-expanded es "${expandido}" con el menú abierto`);

const focoDentro = await page.evaluate(() =>
  !!document.activeElement?.closest('.np__menu'));
if (focoDentro) bien('el foco entra al menú al abrirlo');
else nota('el foco no entró al menú');

// Tabindex móvil: dentro de un menú recorren las flechas, no Tab.
const tabbables = await page.evaluate(() =>
  [...document.querySelectorAll('.np__menu [role^="menuitem"]')]
    .filter((el) => el.tabIndex === 0).length);
if (tabbables === 1) bien('solo un elemento del menú es tabulable (tabindex móvil)');
else nota(`${tabbables} elementos del menú son tabulables; debería ser 1`);

await page.keyboard.press('ArrowDown');
const movio = await page.evaluate(() =>
  document.activeElement?.getAttribute('aria-label'));
if (movio) bien(`las flechas mueven el foco (ahora en "${movio}")`);
else nota('las flechas no mueven el foco dentro del menú');

// El submenú marca la opción activa de forma que un lector la anuncie.
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
const marcada = await page.evaluate(() =>
  document.querySelectorAll('.np__menu [role="menuitemradio"][aria-checked="true"]').length);
if (marcada === 1) bien('la opción activa está marcada con aria-checked');
else nota(`${marcada} opciones marcadas con aria-checked; debería ser 1`);

// El menú no puede quedar recortado por el overflow del reproductor.
const recorte = await page.evaluate(() => {
  const m = document.querySelector('.np__menu');
  const np = document.querySelector('.np');
  const a = m.getBoundingClientRect(), b = np.getBoundingClientRect();
  return { desborda: a.top < b.top - 1, alto: Math.round(a.height) };
});
if (!recorte.desborda) bien(`el menú cabe en el reproductor (${recorte.alto}px)`);
else nota('el menú se sale del reproductor y queda recortado por overflow:hidden');

await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const focoVuelto = await page.evaluate(() =>
  document.activeElement?.classList.contains('np__btn--settings'));
if (focoVuelto) bien('al cerrar, el foco vuelve al engranaje');
else nota('al cerrar, el foco no vuelve al botón que abrió el menú');

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

/* --- lo que aporta un plugin ---------------------------------------------- */

// La garantía que justifica que el plugin declare en vez de pintar su DOM: lo
// que aporta queda sujeto a las mismas reglas que el resto de la interfaz.
console.log('\n[plugins] los controles aportados cumplen el mismo contrato');
const ctrlPlugin = await page.evaluate(() => {
  const b = document.querySelector('[data-control]');
  if (!b) return null;
  return {
    id: b.dataset.control,
    tag: b.tagName.toLowerCase(),
    label: b.getAttribute('aria-label'),
    pressed: b.getAttribute('aria-pressed'),
    tabbable: b.tabIndex >= 0,
  };
});
if (!ctrlPlugin) {
  nota('ningún plugin aportó control a la barra: no se puede verificar el contrato');
} else {
  if (ctrlPlugin.tag === 'button') bien(`"${ctrlPlugin.id}" es un <button> nativo`);
  else nota(`"${ctrlPlugin.id}" no es un <button>: pierde rol y teclado nativos`);

  if (ctrlPlugin.label) bien(`"${ctrlPlugin.id}" tiene nombre accesible ("${ctrlPlugin.label}")`);
  else nota(`"${ctrlPlugin.id}" no tiene nombre accesible`);

  if (ctrlPlugin.pressed !== null) bien(`"${ctrlPlugin.id}" expone aria-pressed`);
  else nota(`"${ctrlPlugin.id}" es un conmutador sin aria-pressed`);

  if (alcanzados.some((a) => a.includes(ctrlPlugin.label)))
    bien(`"${ctrlPlugin.id}" es alcanzable con Tab`);
  else nota(`"${ctrlPlugin.id}" NO se alcanza con Tab`);
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
