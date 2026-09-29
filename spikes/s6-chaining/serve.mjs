/*
 * Static server with support for Range requests.
 *
 * The same as S1's except for one thing: **it listens on every interface**,
 * not only on 127.0.0.1. The question this spike exists to answer can only be
 * answered on an iPhone, and opening it from the phone needs the server to be
 * reachable from the local network. That is why it also prints the LAN
 * addresses.
 *
 * Range matters for the same reason as in S1: without it,
 * `python -m http.server` returns the whole file on every seek and any
 * measurement is contaminated by the download.
 *
 *   node serve.mjs [port]
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
    // A directory is served through its index.html, which is what GitHub
    // Pages does. Without this, the published path —which ends in a slash—
    // would give a 404 here and work in production: the worst possible order
    // to find out.
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
  console.log(`\n  http://127.0.0.1:${PORT}/   (this machine)`);
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  http://${a.address}:${PORT}/   (${name} — for the phone)`);
      }
    }
  }
  console.log('\n  Range supported. Ctrl+C to stop.\n');
});
