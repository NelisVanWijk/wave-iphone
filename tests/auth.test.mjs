import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { createAuth, passwordHash } from '../auth.mjs';

const secret = 'test-only-long-password-123';
const password = await passwordHash(secret);
const origin = 'https://radio.example.test';
async function fixture(t, changes = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'wave-auth-'));
  const config = { enabled: 'true', password, origin, directory, ...changes };
  const upstream = http.createServer((req, res) => {
    if (req.url === '/stream.mp3') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.write('radio'); }
    else res.end('{}');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const servers = [];
  async function start() {
    const server = createServer(`http://127.0.0.1:${upstream.address().port}`, config);
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); servers.push(server);
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = (url, cookie) => fetch(base + url, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
    const post = (url, body, cookie, from = origin) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const login = async () => {
      const response = await post('/auth/login', { password: secret });
      assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
    };
    return { get, post, login, server };
  }
  t.after(() => {
    for (const server of servers) { server.closeAllConnections(); server.close(); }
    upstream.closeAllConnections(); upstream.close(); rmSync(directory, { recursive: true, force: true });
  });
  return { ...await start(), start, directory, config };
}

test('login protects page, API, cover and stream and sets a persistent secure cookie', async t => {
  const f = await fixture(t);
  assert.equal((await f.get('/')).status, 303);
  assert.equal((await f.get('/login')).status, 200);
  for (const url of ['/api/now-playing', '/api/state', '/api/cover/one', '/stream.mp3', '/app.js']) assert.equal((await f.get(url)).status, 401);
  assert.equal((await f.post('/auth/login', { password: 'wrong' })).status, 401);
  assert.equal((await f.post('/auth/login', { password: secret }, null, 'https://evil.example')).status, 403);
  const response = await f.post('/auth/login', { password: secret });
  assert.equal(response.status, 200);
  const header = response.headers.get('set-cookie');
  assert.match(header, /Secure; HttpOnly; SameSite=Strict/);
  assert.match(header, /Max-Age=7776000/);
  const cookie = header.split(';')[0];
  assert.equal((await f.get('/api/now-playing', cookie)).status, 200);
  assert.equal((await f.get('/api/now-playing?token=' + cookie.split('=')[1])).status, 401);
  assert.equal((await f.get('/api/now-playing', cookie.replace(/.$/, 'z'))).status, 401);
  const saved = readFileSync(path.join(f.directory, 'sessions.json'), 'utf8');
  assert.ok(!saved.includes(secret)); assert.ok(!saved.includes(cookie.split('=')[1]));
  const restarted = await f.start();
  assert.equal((await restarted.get('/api/now-playing', cookie)).status, 200);
});

test('logout revokes token and active stream; logout-all revokes other devices', async t => {
  const f = await fixture(t);
  const first = await f.login(), second = await f.login();
  const stream = await f.get('/stream.mp3', first);
  const reader = stream.body.getReader(); await reader.read();
  const closed = reader.read();
  const rejection = assert.rejects(closed);
  assert.equal((await f.post('/auth/logout', {}, first, 'https://evil.example')).status, 403);
  assert.equal((await f.post('/auth/logout', {}, first)).status, 200);
  await rejection;
  assert.equal((await f.get('/api/now-playing', first)).status, 401);
  assert.equal((await f.get('/api/now-playing', second)).status, 200);
  const third = await f.login();
  assert.equal((await f.post('/auth/logout-all', {}, second)).status, 200);
  assert.equal((await f.get('/api/now-playing', third)).status, 401);
  assert.equal((await f.get('/api/now-playing', second)).status, 401);
});

test('idle expiry, absolute expiry, and password change invalidate sessions', async t => {
  let time = Date.now(); const day = 86400000;
  const f = await fixture(t, { now: () => time });
  const idle = await f.login(); time += 30 * day;
  assert.equal((await f.get('/api/now-playing', idle)).status, 401);
  const active = await f.login();
  for (let i = 0; i < 8; i++) { time += 10 * day; assert.equal((await f.get('/api/now-playing', active)).status, 200); }
  time += 10 * day; assert.equal((await f.get('/api/now-playing', active)).status, 401);
  const changed = await f.login(); f.config.password = await passwordHash('another-test-password-456');
  const restarted = await f.start(); assert.equal((await restarted.get('/api/now-playing', changed)).status, 401);
});

test('global login budget survives restart', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.post('/auth/login', {})).status, 400);
  assert.equal((await f.post('/auth/login', { password: secret })).status, 429);
  const restarted = await f.start(); assert.equal((await restarted.post('/auth/login', { password: secret })).status, 429);
});

test('partial or insecure authentication configuration fails closed', () => {
  assert.throws(() => createAuth({ enabled: 'false', password }));
  assert.throws(() => createAuth({ enabled: 'yes' }));
  assert.throws(() => createAuth({ enabled: 'true', password, origin: 'http://radio.example.test' }));
  assert.throws(() => createAuth({ enabled: 'true', origin, password: 'plain-password' }));
});
