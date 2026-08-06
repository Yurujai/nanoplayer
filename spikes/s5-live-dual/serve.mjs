/*
 * Servidor para el spike de directo.
 *
 * La diferencia crítica con un servidor estático normal: **las listas .m3u8 no
 * se pueden cachear**. En directo se reescriben cada dos segundos, y si el
 * navegador sirve una copia vieja el reproductor se queda mirando un pasado
 * que ya no existe. Los segmentos sí se cachean: son inmutables.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('.', import.meta.url));
const PUERTO = Number(process.argv[2] ?? 8170);
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t',
};

createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let ruta = join(RAIZ, normalize(url).replace(/^(\.\.[/\\])+/, ''));
  try { if (statSync(ruta).isDirectory()) ruta = join(ruta, 'index.html'); } catch { /* 404 */ }
  let st;
  try { st = statSync(ruta); } catch { res.writeHead(404); return res.end('404'); }

  const ext = extname(ruta);
  const cabeceras = {
    'content-type': TIPOS[ext] ?? 'application/octet-stream',
    'content-length': st.size,
    'access-control-allow-origin': '*',
    'cache-control': ext === '.m3u8'
      ? 'no-store, no-cache, must-revalidate'
      : 'public, max-age=3600',
  };
  res.writeHead(200, cabeceras);
  createReadStream(ruta).pipe(res);
}).listen(PUERTO, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${PUERTO}/  (listas sin caché)`);
});
