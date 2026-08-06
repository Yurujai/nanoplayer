/*
 * Medición automática del spike S5.
 *
 * Mide lo mismo dos veces, con la diferencia que importa: comparando la hora
 * absoluta de cada posición (posible solo con PROGRAM-DATE-TIME) y comparando
 * los currentTime en crudo (lo único disponible sin la etiqueta).
 *
 *   node measure.mjs [segundos]
 */
import { chromium } from 'playwright';

const DUR = Number(process.argv[2] ?? 30);
const b = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.goto('http://127.0.0.1:8170/', { waitUntil: 'load' });
await p.click('#btn-cargar');
await p.waitForTimeout(6000);

const pdt = await p.evaluate(() =>
  document.getElementById('registro').textContent.includes('PROGRAM-DATE-TIME: sí'));
console.log(`PROGRAM-DATE-TIME presente: ${pdt ? 'sí' : 'NO'}`);

const leer = () => p.evaluate(() => ({
  hora: document.getElementById('porHora').textContent,
  tiempo: document.getElementById('porTiempo').textContent,
  retraso: document.getElementById('retraso').textContent,
}));

console.log('\n--- justo al arrancar ---');
console.log(' ', JSON.stringify(await leer()));

await p.click('#btn-medir');
console.log(`\n--- midiendo ${DUR} s ---`);
for (let t = 5; t <= DUR; t += 5) {
  await p.waitForTimeout(5000);
  const r = await leer();
  console.log(`  t=${String(t).padStart(3)}s  real=${r.hora.padStart(9)}  currentTime=${r.tiempo.padStart(9)}  retraso=${r.retraso}`);
}

console.log('\n--- se corta un flujo 3 s ---');
await p.click('#btn-cortar');
await p.waitForTimeout(4000);
for (const t of [1, 5, 12]) {
  await p.waitForTimeout(t === 1 ? 1000 : (t === 5 ? 4000 : 7000));
  const r = await leer();
  console.log(`  +${String(t).padStart(2)}s tras el corte  real=${r.hora.padStart(9)}  currentTime=${r.tiempo.padStart(9)}`);
}

const fin = await p.evaluate(() => ({
  mediana: document.getElementById('mediana').textContent,
  maxima: document.getElementById('maxima').textContent,
  muestras: document.getElementById('muestras').textContent,
}));
console.log(`\nmediana=${fin.mediana}  máxima=${fin.maxima}  muestras=${fin.muestras}`);
console.log('errores:', errs.length ? errs : 'ninguno');
await b.close();
process.exit(0);
