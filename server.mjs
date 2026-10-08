import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAuth } from './auth.mjs';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/login', ['login.html', 'text/html; charset=utf-8']],
  ['/login.js', ['login.js', 'text/javascript; charset=utf-8']],
  ...['app.js', 'player.js'].map(n => [`/${n}`, [n, 'text/javascript; charset=utf-8']]),
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ...['icon.svg', 'cover.svg'].map(n => [`/${n}`, [n, 'image/svg+xml']]),
  ...['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].map(n => [`/${n}`, [n, 'image/png']]),
]);
const proxyPaths = /^(?:\/api\/(?:now-playing|state|cover\/[A-Za-z0-9_%.-]+)|\/stream\.mp3)$/;
const requestPath = /^\/api\/request(?:\/[A-Za-z0-9_-]+)?$/;

export function createServer(upstream = process.env.SUBWAVE_URL || 'http://subwave:7700', authOptions) {
  const auth = createAuth(authOptions);
  const base = new URL(upstream);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('SUBWAVE_URL must be an HTTP(S) URL without credentials.');
  }
  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Cache-Control': 'no-store' }).end('Request failed');
      else res.destroy();
    });
  });
  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    let url;
    try { url = new URL(req.url, 'http://local'); }
    catch { res.writeHead(400).end('Invalid URL'); return; }
    if (url.pathname === '/health' && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'); return;
    }
    if (auth && await auth.handle(req, res, url.pathname)) return;
    if (!auth && url.pathname === '/auth/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"enabled":false}'); return;
    }
    const isRequest = requestPath.test(url.pathname);
    if (isRequest && !['GET', 'POST'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, POST' }).end(); return;
    }
    if (!isRequest && !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
    }
    const publicAsset = ['/login', '/login.js', '/style.css', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/sw.js'].includes(url.pathname);
    const session = auth && !publicAsset ? auth.sessionFor(req) : null;
    if (auth && !publicAsset && !session) {
      if (url.pathname === '/') res.writeHead(303, { Location: '/login', 'Cache-Control': 'no-store' }).end();
      else res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"Log opnieuw in"}');
      return;
    }
    if (proxyPaths.test(url.pathname) || isRequest) {
      // Only fixed read-only station paths; never an arbitrary URL proxy.
      const target = new URL(url.pathname, base);
      const headers = { Accept: req.headers.accept || '*/*', 'Accept-Encoding': 'identity' };
      if (req.headers.range) headers.Range = req.headers.range;
      let body;
      if (req.method === 'POST') {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 4096) { res.writeHead(413, { 'Content-Type': 'application/json' }).end('{"error":"Verzoek is te lang"}'); return; } chunks.push(chunk); }
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof parsed.text !== 'string' || !parsed.text.trim() || parsed.text.length > 240) throw new Error();
          body = JSON.stringify({ text: parsed.text.trim(), name: 'WAVE luisteraar' });
        } catch { res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"Ongeldig verzoek"}'); return; }
        headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body);
      }
      const stream = url.pathname.startsWith('/stream.');
      if (auth && stream) auth.track(session, res);
      const upstreamReq = (target.protocol === 'https:' ? https : http).request(target, {
        method: req.method, headers,
      }, upstreamRes => {
        clearTimeout(headerTimeout);
        const forwarded = { 'Cache-Control': !auth && url.pathname.startsWith('/api/cover/') && upstreamRes.statusCode === 200 ? 'private, max-age=3600' : 'no-store', 'X-Accel-Buffering': 'no' };
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
      upstreamReq.end(body); return;
    }
    const file = files.get(url.pathname);
    if (!file) { res.writeHead(404).end('Not found'); return; }
    try {
      const body = await readFile(path.join(publicDir, file[0]));
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': auth ? 'no-store' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(500).end('Asset unavailable'); }
  }
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 7780);
  const server = createServer();
  server.listen(port, '0.0.0.0', () => console.log(`WAVE ready on port ${port}`));
}
