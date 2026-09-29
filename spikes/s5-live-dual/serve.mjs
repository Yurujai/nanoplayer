/*
 * Server for the live spike.
 *
 * The critical difference from a normal static server: **.m3u8 playlists must
 * not be cached**. In a live stream they are rewritten every two seconds, and
 * if the browser serves a stale copy the player keeps looking at a past that
 * no longer exists. Segments are cached: they are immutable.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] ?? 8170);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t',
};

createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let path = join(ROOT, normalize(url).replace(/^(\.\.[/\\])+/, ''));
  try { if (statSync(path).isDirectory()) path = join(path, 'index.html'); } catch { /* 404 */ }
  let st;
  try { st = statSync(path); } catch { res.writeHead(404); return res.end('404'); }

  const ext = extname(path);
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'content-length': st.size,
    'access-control-allow-origin': '*',
    'cache-control': ext === '.m3u8'
      ? 'no-store, no-cache, must-revalidate'
      : 'public, max-age=3600',
  });
  createReadStream(path).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${PORT}/  (playlists not cached)`);
});
