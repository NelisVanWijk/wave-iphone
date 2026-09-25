import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../server.mjs';

test('proxy serves MP3 unchanged, limits routes and cancels disconnected streams', async t => {
  let closed = false, upstreamCalls = 0;
  const upstream = http.createServer((req, res) => {
    upstreamCalls++;
    if (req.url === '/stream.mp3') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.write('MP3-test-bytes');
      res.on('close', () => { closed = true; });
    } else res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"nowPlaying":{"title":"test"}}');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const server = createServer(`http://127.0.0.1:${upstream.address().port}`);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); upstream.closeAllConnections(); server.close(); upstream.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/icon-192.png`)).status, 200);
  assert.equal((await fetch(`${base}/api/settings`)).status, 404);
  assert.equal((await fetch(`${base}/api/state`, { method: 'POST' })).status, 405);
  assert.equal(upstreamCalls, 0);
  assert.equal((await (await fetch(`${base}/api/now-playing`)).json()).nowPlaying.title, 'test');
  const abort = new AbortController();
  const stream = await fetch(`${base}/stream.mp3`, { signal: abort.signal });
  assert.equal(stream.headers.get('content-type'), 'audio/mpeg');
  assert.equal(stream.headers.get('cache-control'), 'no-store');
  const reader = stream.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'MP3-test-bytes');
  await reader.cancel(); abort.abort();
  for (let i = 0; i < 20 && !closed; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(closed, true);
});

test('upstream failures produce a bounded, readable error', async t => {
  const server = createServer('http://127.0.0.1:1');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/now-playing`);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /niet bereikbaar/);
});
