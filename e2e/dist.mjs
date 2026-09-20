/*
 * Comprobación de los paquetes construidos.
 *
 * Existe por un fallo real: los plugins se llevaban dentro su propia copia del
 * núcleo, así que `import '@nanoplayer/plugin-captions'` registraba el plugin
 * en un registro que nadie miraba y los subtítulos no se activaban nunca. Sin
 * un solo error por ninguna parte, y sin que la demo lo notara —usa alias al
 * código fuente, no los `dist`—.
 *
 * Es el mismo razonamiento que la auditoría de accesibilidad: lo que no se
 * comprueba automáticamente se pierde sin que nadie se entere. Aquí se importa
 * **por especificador**, nunca por ruta, para que todo pase por el `exports`
 * del package.json, que es lo que resolverá quien lo instale de npm.
 *
 *   pnpm build && node dist.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const PAQUETES = ['core', 'ui', 'engine-hls', 'plugin-captions', 'bundle'];
const raiz = new URL('../packages/', import.meta.url);

let fallos = 0;
const comprobar = (ok, que, detalle = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${que}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};

console.log('\nEntradas declaradas en package.json');
for (const nombre of PAQUETES) {
  const pkg = JSON.parse(readFileSync(new URL(`${nombre}/package.json`, raiz), 'utf8'));
  const dir = new URL(`${nombre}/`, raiz);
  for (const campo of ['main', 'types']) {
    const rel = pkg[campo];
    comprobar(rel && existsSync(fileURLToPath(new URL(rel, dir))),
      `${pkg.name} · ${campo}`, rel);
  }
  const imp = pkg.exports?.['.']?.import;
  comprobar(imp && existsSync(fileURLToPath(new URL(imp, dir))),
    `${pkg.name} · exports.import`, imp);
}

console.log('\nSuperficie pública del núcleo');
const core = await import('@nanoplayer/core');
// Lo que el README de core documenta que se puede importar. Si el entry vuelve
// a apuntar a un módulo parcial, esto lo caza.
for (const n of ['create', 'createPlayer', 'validateManifest', 'parseManifest',
                 'EventBus', 'Synchronizer', 'PlayerRegistry', 'plugins', 'registry']) {
  comprobar(n in core, `@nanoplayer/core exporta ${n}`);
}

console.log('\nUna sola instancia del núcleo');
await import('@nanoplayer/plugin-captions');
comprobar(core.plugins.has('captions'),
  'el plugin se registra en el registro del núcleo',
  `registrados: [${core.plugins.registered.join(', ')}]`);

const hls = await import('@nanoplayer/engine-hls');
comprobar(typeof hls.enginesWithHls === 'function', '@nanoplayer/engine-hls exporta enginesWithHls');

console.log('\nFicheros para integrar sin build');
for (const [paquete, fichero] of [['ui', 'nanoplayer.css'], ['bundle', 'nanoplayer.css'],
                                  ['bundle', 'nanoplayer.min.js'], ['bundle', 'nanoplayer.umd.js']]) {
  const ruta = new URL(`${paquete}/dist/${fichero}`, raiz);
  const hay = existsSync(fileURLToPath(ruta));
  const tam = hay ? readFileSync(ruta, 'utf8').length : 0;
  comprobar(hay && tam > 1000, `${paquete}/dist/${fichero}`, hay ? `${(tam / 1024).toFixed(1)} KB` : 'no existe');
}
// La hoja tiene que servir para una CSP estricta, así que no puede venir vacía
// ni ser un resto de otra cosa.
{
  const css = readFileSync(new URL('bundle/dist/nanoplayer.css', raiz), 'utf8');
  comprobar(css.includes('.np__bar'), 'el CSS trae las reglas de la barra');
}

console.log('\nEl bundle con pilas incluidas');
const conPilas = await import('@nanoplayer/bundle');
comprobar(typeof conPilas.create === 'function', '@nanoplayer/bundle exporta create');
// La distinción que da sentido al paquete: su `create` monta los controles, y
// el del núcleo no. Son funciones distintas y aquí se comprueba que no se haya
// colado la del núcleo por un `export *`.
comprobar(conPilas.create !== core.create,
  'su create no es el headless del núcleo');
comprobar(typeof conPilas.attachControls === 'function', 'reexporta attachControls');
comprobar(typeof conPilas.validateManifest === 'function', 'reexporta el resto del núcleo');

console.log('\nBundle IIFE para la etiqueta <script>');
// El del bundle, no el del núcleo: es el que alguien pegaría en una etiqueta.
const iife = readFileSync(new URL('bundle/dist/nanoplayer.min.js', raiz), 'utf8');
// Contexto mínimo: solo interesa la forma de la global, no ejecutar el DOM.
const ctx = createContext({ self: {}, window: {}, document: { documentElement: {} } });
try {
  runInContext(iife, ctx);
} catch (error) {
  comprobar(false, 'el IIFE se evalúa', error.message);
}
comprobar(typeof ctx.NanoPlayer === 'object', 'define la global NanoPlayer');
for (const n of ['create', 'attachControls', 'plugins', 'registry', 'validateManifest']) {
  comprobar(ctx.NanoPlayer?.[n] !== undefined, `NanoPlayer.${n} en el primer nivel`);
}

console.log(fallos === 0
  ? '\nTodo correcto.\n'
  : `\n${fallos} comprobación(es) fallida(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
