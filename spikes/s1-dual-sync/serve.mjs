/*
 * Static server with support for Range requests.
 *
 * Not a minor detail: `python -m http.server` ignores the Range header and
 * returns the whole file. With that, every seek forces the browser to download
 * the whole video again from the start, and any synchronisation measurement is
 * polluted by the download, not by the algorithm.
 *
 *   node serve.mjs [port]
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] ?? 8099);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.vtt': 'text/vtt; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const path = join(ROOT, rel === '/' ? 'index.html' : rel);

  let st;
  try {
    st = statSync(path);
    if (st.isDirectory()) throw new Error('dir');
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
}).listen(PORT, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${PORT}/  (Range supported)`);
});
