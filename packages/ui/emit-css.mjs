/*
 * Escribe el CSS a un fichero, además de dejarlo como cadena exportada.
 *
 * Hace falta para los despliegues con **CSP estricta**, que es el caso normal
 * en una instalación institucional: `injectStyles()` crea un `<style>` en
 * línea, y una política `style-src 'self'` sin `'unsafe-inline'` lo bloquea sin
 * decir nada. El reproductor se queda sin estilos y no hay error que mirar.
 *
 * Con el fichero, quien tenga esa política lo sirve como un recurso más y pasa
 * `injectStyles: false`. La cadena sigue siendo la fuente única: este script la
 * vuelca, no la duplica.
 *
 *   node emit-css.mjs dist/nanoplayer.css
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CSS } from './dist/index.js';

const destino = resolve(process.cwd(), process.argv[2] ?? 'dist/nanoplayer.css');
const cabecera = '/* NanoPlayer — hoja de estilos por defecto.\n'
  + ' * Generada desde packages/ui/src/styles.ts; no editar a mano.\n'
  + ' * Úsala con `injectStyles: false` si tu CSP no admite estilos en línea. */\n';

writeFileSync(destino, cabecera + CSS);
console.log(`  ${destino}  ${((cabecera.length + CSS.length) / 1024).toFixed(1)} KB`);
