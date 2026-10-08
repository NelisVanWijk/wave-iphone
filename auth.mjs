import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const hash = value => createHash('sha256').update(value).digest('hex');
const COOKIE = '__Host-wave-session';
const DAY = 86400000;
const MAX_AGE = 90 * DAY;
const IDLE = 30 * DAY;
const WINDOW = 10 * 60 * 1000;

export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 16 || Buffer.byteLength(password) > 1024) throw new Error('Use a password of at least 16 characters (maximum 1024 bytes).');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 32, options);
  return `scrypt-v1:${salt}:${key.toString('hex')}`;
}

export function createAuth({ enabled = process.env.WAVE_AUTH, origin = process.env.WAVE_ORIGIN,
  password = process.env.WAVE_PASSWORD_HASH, directory = process.env.WAVE_DATA_DIR || '/data', now = Date.now } = {}) {
  if (enabled !== undefined && !['true', 'false'].includes(enabled)) throw new Error('WAVE_AUTH must be true or false.');
  if (enabled !== 'true') {
    if (origin || password) throw new Error('Set WAVE_AUTH=true to enable the configured login.');
    return null;
  }
  const publicURL = new URL(origin);
  if (publicURL.protocol !== 'https:' || publicURL.origin !== origin) throw new Error('WAVE_ORIGIN must be an HTTPS origin without a trailing slash.');
  if (!/^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$/.test(password || '')) throw new Error('Invalid WAVE_PASSWORD_HASH. Generate it using password-hash.mjs.');
  const [, salt, key] = password.split(':');
  const fingerprint = hash(`${origin}|${password}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'sessions.json');
  let state = { fingerprint, sessions: {}, attempts: [] };
  try {
    const saved = JSON.parse(readFileSync(filename, 'utf8'));
    if (saved.fingerprint === fingerprint) {
      if (!saved.sessions || !Array.isArray(saved.attempts)) throw new Error('Invalid session store');
      state = saved;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const save = () => {
    const temp = `${filename}.tmp`;
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    renameSync(temp, filename);
  };
  const prune = () => {
    state.attempts = state.attempts.filter(t => t > now() - WINDOW);
    for (const [id, session] of Object.entries(state.sessions)) {
      if (now() >= session.expires || now() - session.used >= IDLE) delete state.sessions[id];
    }
  };
  prune(); save(); // Fail closed on unwritable storage, even before the first login.
  const connections = new Map();
  let checking = false;
  function valid(id) {
    const session = state.sessions[id];
    return session && now() < session.expires && now() - session.used < IDLE;
  }
  function sessionFor(req) {
    const cookies = (req.headers.cookie || '').split(';').map(c => c.trim());
    const tokens = cookies.filter(c => c.startsWith(`${COOKIE}=`)).map(c => c.slice(COOKIE.length + 1));
    if (tokens.length !== 1 || !/^[a-f0-9]{64}$/.test(tokens[0])) return null;
    const id = hash(tokens[0]);
    if (!valid(id)) return null;
    if (now() - state.sessions[id].used >= 60 * 60 * 1000) { state.sessions[id].used = now(); save(); }
    return id;
  }
  function track(id, res) {
    if (!connections.has(id)) connections.set(id, new Set());
    connections.get(id).add(res);
    const timer = setInterval(() => { if (!valid(id)) res.destroy(); }, 60000);
    timer.unref();
    res.once('close', () => { clearInterval(timer); connections.get(id)?.delete(res); if (!connections.get(id)?.size) connections.delete(id); });
  }
  const cookie = (token, seconds) => `${COOKIE}=${token}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Strict`;
  const reply = (res, status, payload) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(payload));
  async function handle(req, res, pathname) {
    if (pathname === '/auth/status' && req.method === 'GET') {
      reply(res, 200, { enabled: true, authenticated: !!sessionFor(req) }); return true;
    }
    if (!['/auth/login', '/auth/logout', '/auth/logout-all'].includes(pathname)) return false;
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return true; }
    // Fixed configured origin: never trust forwarded Host/Origin from arbitrary peers.
    if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site' || req.headers['content-type']?.split(';')[0] !== 'application/json') {
      reply(res, 403, { error: 'Open WAVE via het ingestelde HTTPS-adres.' }); return true;
    }
    if (pathname !== '/auth/login') {
      const id = sessionFor(req);
      if (!id) { reply(res, 401, { error: 'Log opnieuw in.' }); return true; }
      const ids = pathname === '/auth/logout-all' ? Object.keys(state.sessions) : [id];
      for (const removed of ids) delete state.sessions[removed];
      save();
      for (const removed of ids) for (const stream of connections.get(removed) || []) stream.destroy();
      res.setHeader('Set-Cookie', cookie('', 0)); reply(res, 200, { ok: true }); return true;
    }
    prune();
    // Global single-account limiter. No spoofable X-Forwarded-For trust and no
    // unbounded password hashing queue; the budget survives container restarts.
    if (checking || state.attempts.length >= 10) {
      res.setHeader('Retry-After', '600'); reply(res, 429, { error: 'Te veel pogingen. Probeer over 10 minuten opnieuw.' }); return true;
    }
    checking = true;
    state.attempts.push(now());
    try {
      save();
      const chunks = [];
      let bytes = 0;
      const timer = setTimeout(() => req.destroy(), 10000);
      try {
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 2048) { reply(res, 413, { error: 'Aanvraag te groot.' }); return true; }
          chunks.push(chunk);
        }
      } finally { clearTimeout(timer); }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply(res, 400, { error: 'Ongeldige aanvraag.' }); return true; }
      if (typeof input.password !== 'string' || Buffer.byteLength(input.password) > 1024) { reply(res, 400, { error: 'Ongeldige aanvraag.' }); return true; }
      const actual = await derive(input.password, salt, 32, options);
      if (!timingSafeEqual(actual, Buffer.from(key, 'hex'))) { reply(res, 401, { error: 'Wachtwoord klopt niet.' }); return true; }
      if (Object.keys(state.sessions).length >= 100) { reply(res, 409, { error: 'Te veel apparaten. Log eerst alle apparaten uit.' }); return true; }
      const token = randomBytes(32).toString('hex');
      state.sessions[hash(token)] = { used: now(), expires: now() + MAX_AGE };
      save();
      res.setHeader('Set-Cookie', cookie(token, MAX_AGE / 1000)); reply(res, 200, { ok: true });
    } finally { checking = false; }
    return true;
  }
  return { handle, sessionFor, track };
}
