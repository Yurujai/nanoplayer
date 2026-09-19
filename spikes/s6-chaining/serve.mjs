/*
 * Servidor estático con soporte de peticiones Range.
 *
 * Igual que el de S1 salvo en una cosa: **escucha en todas las interfaces**, no
 * solo en 127.0.0.1. La pregunta que este spike existe para responder solo se
 * contesta en un iPhone, y para abrirlo desde el móvil hace falta que el
 * servidor sea alcanzable desde la red local. Por eso imprime también las
 * direcciones LAN.
 *
 * Range importa por lo mismo que en S1: sin él, `python -m http.server`
 * devuelve el fichero entero en cada salto y cualquier medición queda
 * contaminada por la descarga.
 *
 *   node serve.mjs [puerto]
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] ?? 8180);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json; charset=utf-8',
};

createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let path = join(ROOT, rel === '/' ? 'index.html' : rel);

  let st;
  try {
    st = statSync(path);
    // Un directorio se sirve por su index.html, que es lo que hace GitHub
    // Pages. Sin esto, la ruta publicada —que termina en barra— daría 404 aquí
    // y funcionaría en producción: el peor orden posible para enterarse.
    if (st.isDirectory()) {
      path = join(path, 'index.html');
      st = statSync(path);
    }
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('404');
  }

  const type = TYPES[extname(path)] ?? 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? st.size - Number(m[2]) : Number(m[1]);
      let end = m[1] === '' || m[2] === '' ? st.size - 1 : Number(m[2]);
      start = Math.max(0, start);
      end = Math.min(st.size - 1, end);
      if (start > end) {
        res.writeHead(416, { 'content-range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'content-type': type,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${st.size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      });
      return createReadStream(path, { start, end }).pipe(res);
    }
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': st.size,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`\n  http://127.0.0.1:${PORT}/   (este equipo)`);
  for (const [nombre, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  http://${a.address}:${PORT}/   (${nombre} — para el móvil)`);
      }
    }
  }
  console.log('\n  Range soportado. Ctrl+C para parar.\n');
});
