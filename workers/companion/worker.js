// Vex Companion relay: a dumb, short-lived mailbox between a desktop Vex and a
// phone browser that has no Vex app. SOURCE ONLY: nothing here is deployed by
// the repo; the owner deploys it (README.md). Contract: docs/COMPANION_PROTOCOL.md.
//
// What it is built not to know and not to keep:
//   - it stores ciphertext (sealed on the desktop with a key derived from the
//     pairing code, which never reaches this worker) and a hash of the
//     publish token and of the read token;
//   - it keeps no account, no email, no IP address (a rate-limit bucket is a
//     hash of it with a per-bucket salt, and expires in 15 minutes), and it
//     writes no log line: there is no console call in this file;
//   - everything expires: a pairing code is redeemable for 5 minutes, once; a
//     read session lasts at most 24 hours; the snapshot goes with it.
//
//   POST   /companion/v1/pair      desktop: open a pairing  { lookup, publishHash, blob, readTtl }
//   POST   /companion/v1/redeem    phone:   code -> read token { lookup }
//   GET    /companion/v1/snapshot  phone:   Bearer <readToken>  (read only)
//   PUT    /companion/v1/snapshot  desktop: X-Vex-Publish  { lookup, blob }
//   DELETE /companion/v1/pair      desktop: X-Vex-Publish  { lookup }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Vex-Publish',
  'Access-Control-Max-Age': '86400',
};
const PAIR_WINDOW_MS = 5 * 60 * 1000;
const MAX_BLOB = 96 * 1024;            // base64 characters; the desktop seals at most 48 KB of JSON
const MAX_BODY = 128 * 1024;
const MIN_READ_TTL = 300, MAX_READ_TTL = 86400, DEFAULT_READ_TTL = 3600;
const HEX64 = /^[a-f0-9]{64}$/;
const LIMITS = { pair: [10, 900], redeem: [20, 900], publish: [240, 900], read: [600, 900] };

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function randomHex(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// A fixed-window counter per (action, client). KV is not atomic, so a burst can
// overshoot the limit a little; it is a brake, not an account system.
async function limited(env, action, request, now) {
  const [limit, windowSec] = LIMITS[action];
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const slot = Math.floor(now / (windowSec * 1000));
  const key = 'rl:' + action + ':' + slot + ':' + (await sha256Hex('vex-companion-rl\n' + slot + '\n' + ip)).slice(0, 32);
  const used = parseInt(await env.COMPANION_KV.get(key), 10) || 0;
  if (used >= limit) return true;
  await env.COMPANION_KV.put(key, String(used + 1), { expirationTtl: windowSec + 60 });
  return false;
}

async function body(request) {
  const length = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (length > MAX_BODY) return { error: json({ error: 'Request too large' }, 413) };
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: json({ error: 'Request too large' }, 413) };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    return { value };
  } catch { return { error: json({ error: 'JSON body required' }, 400) }; }
}

const GONE = () => json({ error: 'Unknown or expired code' }, 404);
const recordKey = lookup => 'p:' + lookup;
async function load(env, lookup) {
  const raw = await env.COMPANION_KV.get(recordKey(lookup));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function publisher(request, env, lookup) {
  const record = HEX64.test(String(lookup)) ? await load(env, lookup) : null;
  const token = request.headers.get('X-Vex-Publish') || '';
  if (!record || !/^[a-f0-9]{64}$/.test(token) || !equal(await sha256Hex(token), record.publishHash)) return null;
  return record;
}

export async function handle(request, env, now = Date.now()) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env || !env.COMPANION_KV) return json({ error: 'Companion relay is not configured' }, 503);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const method = request.method;

  if (path === '/companion/v1/pair' && method === 'POST') {
    if (await limited(env, 'pair', request, now)) return json({ error: 'Too many requests — try again later' }, 429);
    const b = await body(request);
    if (b.error) return b.error;
    const { lookup, publishHash, blob } = b.value;
    if (!HEX64.test(String(lookup)) || !HEX64.test(String(publishHash))) return json({ error: 'Invalid pairing request' }, 400);
    if (typeof blob !== 'string' || !blob || blob.length > MAX_BLOB) return json({ error: 'Invalid snapshot' }, 400);
    if (await load(env, lookup)) return json({ error: 'Pairing already open' }, 409);
    const readTtl = Number.isInteger(b.value.readTtl) ? Math.min(MAX_READ_TTL, Math.max(MIN_READ_TTL, b.value.readTtl)) : DEFAULT_READ_TTL;
    const record = { publishHash, blob, updatedAt: now, pairExpires: now + PAIR_WINDOW_MS, redeemed: false, readTtl, readExpires: 0 };
    await env.COMPANION_KV.put(recordKey(lookup), JSON.stringify(record), { expirationTtl: PAIR_WINDOW_MS / 1000 + readTtl + 60 });
    return json({ ok: true, pairExpires: record.pairExpires });
  }

  if (path === '/companion/v1/redeem' && method === 'POST') {
    if (await limited(env, 'redeem', request, now)) return json({ error: 'Too many requests — try again later' }, 429);
    const b = await body(request);
    if (b.error) return b.error;
    const { lookup } = b.value;
    if (!HEX64.test(String(lookup))) return GONE();
    const record = await load(env, lookup);
    // One answer for "never existed", "expired" and "already used".
    if (!record || record.redeemed || now > record.pairExpires) {
      if (record && !record.redeemed) await env.COMPANION_KV.delete(recordKey(lookup));
      return GONE();
    }
    const readToken = randomHex(32);
    record.redeemed = true;
    record.readExpires = now + record.readTtl * 1000;
    // The read token's own entry: found by the hash of the token, gone with the session.
    await env.COMPANION_KV.put('t:' + await sha256Hex(readToken), lookup, { expirationTtl: record.readTtl + 60 });
    await env.COMPANION_KV.put(recordKey(lookup), JSON.stringify(record), { expirationTtl: record.readTtl + 60 });
    return json({ ok: true, readToken, blob: record.blob, updatedAt: record.updatedAt, expiresAt: record.readExpires });
  }

  if (path === '/companion/v1/snapshot' && method === 'GET') {
    if (await limited(env, 'read', request, now)) return json({ error: 'Too many requests — try again later' }, 429);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!HEX64.test(token)) return json({ error: 'Unauthorized' }, 401);
    const lookup = await env.COMPANION_KV.get('t:' + await sha256Hex(token));
    const record = lookup ? await load(env, lookup) : null;
    if (!record || !record.redeemed || now > record.readExpires) return json({ error: 'Session expired' }, 401);
    return json({ ok: true, blob: record.blob, updatedAt: record.updatedAt, expiresAt: record.readExpires });
  }

  if (path === '/companion/v1/snapshot' && method === 'PUT') {
    if (await limited(env, 'publish', request, now)) return json({ error: 'Too many requests — try again later' }, 429);
    const b = await body(request);
    if (b.error) return b.error;
    const record = await publisher(request, env, b.value.lookup);
    if (!record) return json({ error: 'Unauthorized' }, 401);
    if (typeof b.value.blob !== 'string' || !b.value.blob || b.value.blob.length > MAX_BLOB) return json({ error: 'Invalid snapshot' }, 400);
    record.blob = b.value.blob;
    record.updatedAt = now;
    const remaining = record.redeemed ? Math.max(60, Math.ceil((record.readExpires - now) / 1000) + 60) : PAIR_WINDOW_MS / 1000 + record.readTtl + 60;
    await env.COMPANION_KV.put(recordKey(b.value.lookup), JSON.stringify(record), { expirationTtl: remaining });
    return json({ ok: true, updatedAt: now });
  }

  if (path === '/companion/v1/pair' && method === 'DELETE') {
    if (await limited(env, 'publish', request, now)) return json({ error: 'Too many requests — try again later' }, 429);
    const b = await body(request);
    if (b.error) return b.error;
    const record = await publisher(request, env, b.value.lookup);
    if (!record) return json({ error: 'Unauthorized' }, 401);
    await env.COMPANION_KV.delete(recordKey(b.value.lookup));
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

export default { fetch: (request, env) => handle(request, env) };
