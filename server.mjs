import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ...['app.js', 'player.js'].map(n => [`/${n}`, [n, 'text/javascript; charset=utf-8']]),
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ...['icon.svg', 'cover.svg'].map(n => [`/${n}`, [n, 'image/svg+xml']]),
  ...['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].map(n => [`/${n}`, [n, 'image/png']]),
]);
const proxyPaths = /^(?:\/api\/(?:now-playing|state|cover\/[A-Za-z0-9_%.-]+)|\/stream\.(?:flac|mp3))$/;

export function createServer(upstream = process.env.SUBWAVE_URL || 'http://subwave:7700') {
  const base = new URL(upstream);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('SUBWAVE_URL must be an HTTP(S) URL without credentials.');
  }
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
    }
    let url;
    try { url = new URL(req.url, 'http://local'); }
    catch { res.writeHead(400).end('Invalid URL'); return; }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'); return;
    }
    if (proxyPaths.test(url.pathname)) {
      // Only fixed read-only station paths; never an arbitrary URL proxy.
      const target = new URL(url.pathname, base);
      const headers = { Accept: req.headers.accept || '*/*', 'Accept-Encoding': 'identity' };
      if (req.headers.range) headers.Range = req.headers.range;
      const stream = url.pathname.startsWith('/stream.');
      const upstreamReq = (target.protocol === 'https:' ? https : http).request(target, {
        method: req.method, headers,
      }, upstreamRes => {
        clearTimeout(headerTimeout);
        const forwarded = { 'Cache-Control': url.pathname.startsWith('/api/cover/') && upstreamRes.statusCode === 200 ? 'private, max-age=3600' : 'no-store', 'X-Accel-Buffering': 'no' };
        for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          if (upstreamRes.headers[key]) forwarded[key] = upstreamRes.headers[key];
        }
        res.writeHead(upstreamRes.statusCode || 502, forwarded);
        upstreamRes.on('error', () => res.destroy());
        upstreamRes.pipe(res);
      });
      const fail = () => {
        clearTimeout(headerTimeout);
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"SUB/WAVE niet bereikbaar"}');
        else res.destroy();
      };
      const headerTimeout = setTimeout(() => upstreamReq.destroy(new Error('Upstream timeout')), 12000);
      upstreamReq.setTimeout(stream ? 45000 : 12000, () => upstreamReq.destroy());
      upstreamReq.on('error', fail);
      res.on('close', () => { clearTimeout(headerTimeout); upstreamReq.destroy(); });
      upstreamReq.end(); return;
    }
    const file = files.get(url.pathname);
    if (!file) { res.writeHead(404).end('Not found'); return; }
    try {
      const body = await readFile(path.join(publicDir, file[0]));
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'");
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(500).end('Asset unavailable'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 7780);
  const server = createServer();
  server.listen(port, '0.0.0.0', () => console.log(`WAVE ready on port ${port}`));
}
