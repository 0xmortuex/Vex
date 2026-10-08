import { boundedJson, durableKV, isDevelopment, expireRecords, parseCounter } from '../shared/security.js';
// Vex Sync Worker
// Endpoints:
//   POST   /auth/request-code       { email }
//   POST   /auth/verify-code        { email, code, deviceName }
//   POST   /sync/push               { encryptedBlob, updatedAt }          (Bearer token)
//   GET    /sync/pull                                                     (Bearer token)
//   GET    /sync/devices                                                  (Bearer token)
//   DELETE /sync/devices/:id                                              (Bearer token)
//   DELETE /sync/all                                                      (Bearer token)
//
// Where things live (from the release after v2.37.0):
//   VEX_STATE (one object, 'vex-sync')  — what has to be global: sign-in codes,
//     wrong-guess counters, rate limits, and which account each session token
//     belongs to (a token is all a /sync/ request carries). It also still holds
//     every account as the previous worker left it, read once to move it.
//   VEX_ACCOUNTS (one object per account, idFromName(<HMAC of the address>))
//     — the account itself: its encrypted blob and revision, device list,
//     handoff mailbox and sessions. One account's requests never touch
//     another's object, and an object refuses any session not its own.
// The first request for an account copies it out of VEX_STATE into its own
// object (migrateAccount). The old copy is left where it was.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

function randomId(len = 32) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Cryptographically-secure 6-digit numeric code. Math.random() is NOT safe for
// an auth secret — its output is predictable, which (combined with the old lack
// of an attempt cap) made the magic code brute-forceable. Rejection sampling
// avoids the modulo bias a plain `% 1000000` would introduce.
function genNumericCode() {
  const max = 1000000;                                   // 000000–999999
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return String(x % max).padStart(6, '0');
}

// Constant-time string compare so code verification doesn't leak via timing.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Fixed-window counters use the Durable Object's serialized storage adapter.
// Missing, corrupt or unavailable quota storage fails closed.
async function rateLimited(env, bucket, limit, windowSec) {
  try {
    if (!env.VEX_AUTH_KV) return true;
    const win = Math.floor(Date.now() / (windowSec * 1000));
    const key = `rl:${bucket}:${win}`;
    const cur = parseCounter(await env.VEX_AUTH_KV.get(key));
    if (cur >= limit) return true;
    await env.VEX_AUTH_KV.put(key, String(cur + 1), { expirationTtl: windowSec + 60 });
    return false;
  } catch {
    return true;
  }
}

const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

// Accounts are keyed by an HMAC of the address with a secret only the worker
// has. A plain SHA-256 of an address is reversed by hashing candidate
// addresses, so anyone who could read the storage learned who syncs (found
// 2026-09-30). Without the secret there is no key to look an account up by,
// and falling back to the unsalted hash would undo the fix unseen.
function hashSecretMissing(env) {
  return typeof env.EMAIL_HASH_SECRET !== 'string' || env.EMAIL_HASH_SECRET.length < 32;
}

async function hashEmail(email, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('EMAIL_HASH_SECRET is not configured');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email.trim().toLowerCase())));
}

// The key accounts were stored under before the HMAC. Read only to move them.
async function legacyHashEmail(email) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase())));
}

const SESSION_TTL = 60 * 60 * 24 * 365; // 1 year
const DROP_TTL = 60 * 60 * 24 * 7;
const ACCOUNT_RE = /^[0-9a-f]{64}$/;

// What is left of a session's year, for rewriting it without extending it.
function sessionTtl(session) {
  const left = Math.floor((Date.parse(session.createdAt) + SESSION_TTL * 1000 - Date.now()) / 1000);
  return Number.isFinite(left) ? Math.max(60, left) : SESSION_TTL;
}

// Every session token an account has, so removing a device or wiping the
// account deletes them. DELETE /sync/devices/:id and DELETE /sync/all used to
// leave each sess:<token> in VEX_AUTH_KV for its whole year (found
// 2026-09-30). Sessions from before this list join it when next seen.
async function accountSessions(env, emailHash) {
  const raw = await env.VEX_AUTH_KV.get(`sessions:${emailHash}`);
  return raw ? JSON.parse(raw) : [];
}

async function rememberSession(env, emailHash, token, deviceId) {
  const list = await accountSessions(env, emailHash);
  if (list.some(s => s.token === token)) return;
  // Entries whose session has since expired are dropped as a new one joins.
  const live = [];
  for (const s of list) if (await env.VEX_AUTH_KV.get(`sess:${s.token}`)) live.push(s);
  live.push({ token, deviceId });
  await env.VEX_AUTH_KV.put(`sessions:${emailHash}`, JSON.stringify(live));
}

// Deletes the account's sessions that `keep` rejects.
async function forgetSessions(env, emailHash, keep) {
  const list = await accountSessions(env, emailHash);
  const kept = [];
  for (const s of list) {
    if (keep(s)) kept.push(s);
    else await env.VEX_AUTH_KV.delete(`sess:${s.token}`);
  }
  if (kept.length === list.length) return;
  if (kept.length) await env.VEX_AUTH_KV.put(`sessions:${emailHash}`, JSON.stringify(kept));
  else await env.VEX_AUTH_KV.delete(`sessions:${emailHash}`);
}

async function sendMagicCode(email, code, env) {
  // Never log the code itself — Worker logs are retained by Cloudflare and a
  // logged code is a logged credential. Log only that one was issued.
  console.log('[AUTH] Magic code issued');

  if (env.RESEND_API_KEY) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        signal: AbortSignal.timeout(10000),
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: env.RESEND_FROM || 'Vex Sync <onboarding@resend.dev>',
          to: email,
          subject: `Your Vex Sync code: ${code}`,
          html: `
            <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 500px; padding: 32px; background: #0a0c10; color: #e5e9f0;">
              <h1 style="color: #6366f1; margin: 0 0 16px;">Vex Sync</h1>
              <p>Use this code to enroll your device:</p>
              <div style="font-size: 36px; font-weight: 700; letter-spacing: 4px; color: #6366f1; margin: 24px 0; text-align: center;">${code}</div>
              <p style="color: #6b7482; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
            </div>
          `
        })
      });
      if (!response.ok) throw new Error('Email delivery failed');
    } catch (err) {
      throw Object.assign(new Error('Could not deliver verification email'), { status: 502 });
    }
  }
}

// ====== The global object: sign-in codes, rate limits, token routing ======
// On a successful verify-code it answers the entry worker (never a client
// directly) with the new token and the account it belongs to; the entry
// worker then has the account's own object open the session.
const syncHandler = {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (hashSecretMissing(env)) {
      console.error('[vex-sync] EMAIL_HASH_SECRET is not set (32+ characters). Refusing every request: run `wrangler secret put EMAIL_HASH_SECRET` (see wrangler.toml).');
      return json({ error: 'Sync server is misconfigured: EMAIL_HASH_SECRET is not set' }, 503);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith('/auth/') && !env.RESEND_API_KEY && !isDevelopment(request, env)) return json({ error: 'Email delivery is not configured' }, 503);
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

    try {
      // ====== AUTH ======
      if (path === '/auth/request-code' && request.method === 'POST') {
        const { email } = await boundedJson(request);
        if (!email || !email.includes('@')) {
          return json({ error: 'Invalid email' }, 400);
        }

        const emailHash = await hashEmail(email, env.EMAIL_HASH_SECRET);

        // Rate limit issuance per-email and per-IP. Without this, /auth/request-code
        // is an open relay for magic-code email bombing (via Resend) and KV-write
        // abuse. Limits are generous enough for a real user's retries.
        if (await rateLimited(env, `req:email:${emailHash}`, 3, 900) ||
            await rateLimited(env, `req:ip:${clientIp}`, 10, 900)) {
          return json({ error: 'Too many requests — try again in a few minutes' }, 429);
        }

        const code = genNumericCode();

        await env.VEX_AUTH_KV.put(`code:${emailHash}`, code, { expirationTtl: 600 });
        // Fresh code → reset any prior failed-attempt counter for this email.
        await env.VEX_AUTH_KV.delete(`attempts:${emailHash}`);
        await sendMagicCode(email, code, env);

        // No-email fallback: without RESEND_API_KEY the code can't reach the
        // user, so return it in the response. ⚠ This means anyone who knows
        // your worker URL can enroll as any email — fine for a personal
        // deployment you keep private; set RESEND_API_KEY to turn it off.
        if (!env.RESEND_API_KEY && isDevelopment(request, env)) {
          return json({ ok: true, message: 'No email configured — use this code', devCode: code });
        }

        return json({ ok: true, message: 'Code sent to email' });
      }

      if (path === '/auth/verify-code' && request.method === 'POST') {
        const { email, code, deviceName } = await boundedJson(request);
        if (!email || !code) return json({ error: 'Missing email or code' }, 400);

        const emailHash = await hashEmail(email, env.EMAIL_HASH_SECRET);

        // Per-IP throttle blunts distributed brute force before the per-code
        // attempt cap below even applies.
        if (await rateLimited(env, `vrf:ip:${clientIp}`, 30, 600)) {
          return json({ error: 'Too many attempts — try again later' }, 429);
        }

        const storedCode = await env.VEX_AUTH_KV.get(`code:${emailHash}`);
        if (!storedCode) {
          return json({ error: 'Invalid or expired code' }, 401);
        }

        // Per-code attempt cap. The code space is only 1e6, so within the 10-min
        // TTL an unlimited-guess endpoint is brute-forceable. Burn the code after
        // 5 wrong guesses — the user must request a new one.
        const attemptsKey = `attempts:${emailHash}`;
        const attempts = parseCounter(await env.VEX_AUTH_KV.get(attemptsKey));
        if (attempts >= 5) {
          await env.VEX_AUTH_KV.delete(`code:${emailHash}`);
          await env.VEX_AUTH_KV.delete(attemptsKey);
          return json({ error: 'Too many incorrect attempts — request a new code' }, 429);
        }

        if (!timingSafeEqual(storedCode, String(code))) {
          await env.VEX_AUTH_KV.put(attemptsKey, String(attempts + 1), { expirationTtl: 600 });
          return json({ error: 'Invalid or expired code' }, 401);
        }

        // Success — consume the code and clear the attempt counter.
        await env.VEX_AUTH_KV.delete(`code:${emailHash}`);
        await env.VEX_AUTH_KV.delete(attemptsKey);

        // The session itself is written by the account's object
        // (/internal/open-session); here only the route to it. The device
        // joins the account's list on its first successful push or pull, not
        // at sign-in: registering it before the app had decided anything left
        // a ghost device whenever the sign-in was then refused (an account
        // with data but no recovery code, a wrong recovery code) and the app
        // could not remove it (found 2026-09-30).
        const sessionToken = randomId(32);
        const deviceId = randomId(16);
        await env.VEX_AUTH_KV.put(`route:${sessionToken}`, emailHash, { expirationTtl: SESSION_TTL });
        return json({
          ok: true,
          sessionToken,
          deviceId,
          emailHash,
          // An account made before the HMAC key lives under this one; the
          // account's object takes it over (VexSyncAccount.adoptLegacy).
          legacyHash: await legacyHashEmail(email),
          deviceName: deviceName || 'Unknown device',
          createdAt: new Date().toISOString()
        });
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.status ? err.message : 'Sync request failed' }, err.status || 500);
    }
  }
};

// ====== Calls between the worker's own objects ======
// Paths under /internal/ are refused at the entry worker, so only this code
// can reach them.
function internalRequest(path, body, account) {
  const headers = { 'Content-Type': 'application/json' };
  if (account) headers['X-Vex-Account'] = account;
  return new Request('https://vex-sync.internal' + path, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function callInternal(stub, path, body, account) {
  const response = await stub.fetch(internalRequest(path, body, account));
  const data = await response.json();
  if (!response.ok) throw new Error(`${path} answered ${response.status}: ${data && data.error}`);
  return data;
}

const globalStub = env => env.VEX_STATE.get(env.VEX_STATE.idFromName('vex-sync'));
const accountStub = (env, account) => env.VEX_ACCOUNTS.get(env.VEX_ACCOUNTS.idFromName(account));

function withAccount(request, account) {
  const headers = new Headers(request.headers);
  headers.set('X-Vex-Account', account);
  return new Request(request, { headers });
}

// The keys one account has in storage. Sessions are keyed by token.
const accountKeys = account => [`sync:blob:${account}`, `sync:devices:${account}`, `sync:drop:${account}`, `auth:sessions:${account}`];

function live(record) {
  return !!record && !record.deleted && typeof record.value === 'string' && !(record.expires && record.expires <= Date.now());
}

// A stored session, rewritten to name the account it now belongs to.
function sessionFor(record, account) {
  if (!live(record)) return record || null;
  return { ...record, value: JSON.stringify({ ...JSON.parse(record.value), emailHash: account }) };
}

// The object storage API takes at most 128 keys per put.
async function putAll(storage, entries) {
  const keys = Object.keys(entries);
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = {};
    for (const key of keys.slice(i, i + 100)) chunk[key] = entries[key];
    await storage.put(chunk);
  }
}

// Reads every key back and compares it with what was meant to be written.
async function verifyAll(storage, entries) {
  for (const [key, record] of Object.entries(entries)) {
    if (JSON.stringify(await storage.get(key)) !== JSON.stringify(record)) throw new Error(`Copy of ${key.split(':').slice(0, 2).join(':')} did not read back`);
  }
}

// ====== The global object's internal side ======
class GlobalStore {
  constructor(state, env) {
    this.storage = state.storage;
    // Reading through durableKV also imports what a worker from before the
    // Durable Object (2026-09-07) left in Workers KV.
    this.auth = durableKV(state.storage, 'auth:', env.VEX_AUTH_KV);
    this.sync = durableKV(state.storage, 'sync:', env.VEX_SYNC_KV);
  }

  async record(key) {
    const store = key.startsWith('auth:') ? this.auth : this.sync;
    await store.get(key.slice(5));
    return (await this.storage.get(key)) ?? null;
  }

  // Which account a session token belongs to, or null.
  async resolve(token) {
    let account = await this.auth.get(`route:${token}`);
    if (!account) {
      // A session from before per-account objects: the account is in it.
      const raw = await this.auth.get(`sess:${token}`);
      if (!raw) return null;
      const session = JSON.parse(raw);
      account = session.emailHash;
      // Moved by a sign-in to the HMAC key while this device was away
      // (the previous worker's moveLegacyAccount left it a pointer).
      if (!session.pending) {
        const devices = await this.sync.get(`devices:${account}`);
        const listed = !!devices && JSON.parse(devices).some(d => d.deviceId === session.deviceId);
        const moved = listed ? null : await this.auth.get(`moved:${session.deviceId}`);
        if (moved) account = moved;
      }
      if (!ACCOUNT_RE.test(account || '')) return null;
      await this.auth.put(`route:${token}`, account, { expirationTtl: sessionTtl(session) });
    }
    return (await this.auth.get(`alias:${account}`)) || account;
  }

  // Everything the previous worker kept for one account.
  async exportAccount(account) {
    const records = [];
    for (const key of accountKeys(account)) {
      const record = await this.record(key);
      if (record) records.push([key, record]);
    }
    const list = await this.auth.get(`sessions:${account}`);
    for (const { token } of list ? JSON.parse(list) : []) {
      const record = await this.exportSession(account, token);
      if (record) records.push([`auth:sess:${token}`, record]);
    }
    return records;
  }

  async exportSession(account, token) {
    if (await this.resolve(token) !== account) return null;
    const record = await this.record(`auth:sess:${token}`);
    return record ? sessionFor(record, account) : null;
  }

  async hasAccount(account) {
    return !!(await this.sync.get(`blob:${account}`) || await this.sync.get(`devices:${account}`));
  }

  // DELETE /sync/all: the copy kept here goes too.
  async forgetAccount(account) {
    const list = await this.auth.get(`sessions:${account}`);
    for (const { token } of list ? JSON.parse(list) : []) await this.storage.put(`auth:sess:${token}`, { deleted: true, expires: 0 });
    for (const key of accountKeys(account)) await this.storage.put(key, { deleted: true, expires: 0 });
  }

  async handle(path, body) {
    if (path === '/internal/route') return { account: await this.resolve(String(body.token)) };
    if (!ACCOUNT_RE.test(body.account || '')) throw new Error('Invalid account');
    if (path === '/internal/export-account') return { records: await this.exportAccount(body.account) };
    if (path === '/internal/export-session') return { record: await this.exportSession(body.account, String(body.token)) };
    if (path === '/internal/has-account') return { exists: await this.hasAccount(body.account) };
    if (path === '/internal/forget-account') { await this.forgetAccount(body.account); return { ok: true }; }
    if (path === '/internal/alias') {
      if (!ACCOUNT_RE.test(body.to || '')) throw new Error('Invalid account');
      await this.auth.put(`alias:${body.account}`, body.to);
      return { ok: true };
    }
    throw Object.assign(new Error('Not found'), { status: 404 });
  }
}

// ====== One account's object ======
// Its storage: like durableKV, but with the global object as the place an
// unknown session is looked up. A session it has deleted is kept as a
// tombstone so it is never looked up again.
function accountKV(storage, prefix, importSession) {
  return {
    async get(key) {
      let record = await storage.get(prefix + key);
      if (record === undefined && importSession && key.startsWith('sess:')) {
        record = (await importSession(key.slice(5))) || { deleted: true, expires: 0 };
        await storage.put(prefix + key, record);
      }
      if (!live(record)) return null;
      return record.value;
    },
    async put(key, value, options = {}) {
      await storage.put(prefix + key, { value: String(value), expires: options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : 0 });
      if (options.expirationTtl && storage.setAlarm && !(await storage.getAlarm())) await storage.setAlarm(Date.now() + 60000);
    },
    async delete(key) {
      if (importSession && key.startsWith('sess:')) await storage.put(prefix + key, { deleted: true, expires: 0 });
      else await storage.delete(prefix + key);
    },
  };
}

// /sync/* for one account. `env` holds this account's own stores.
async function handleSync(request, env, account, path) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const sessionRaw = await env.VEX_AUTH_KV.get(`sess:${token}`);
  if (!sessionRaw) return json({ error: 'Invalid session' }, 401);
  const session = JSON.parse(sessionRaw);
  // Never serve a session that is not this account's, whatever routed it here.
  if (session.emailHash !== account) return json({ error: 'Invalid session' }, 401);
  const devicesKey = `devices:${account}`;
  const existingDevices = await env.VEX_SYNC_KV.get(devicesKey);
  const listed = () => !!existingDevices && JSON.parse(existingDevices).some(x => x.deviceId === session.deviceId);

  // Not yet in the device list (see verify-code): it may push or pull,
  // which registers it, or remove itself when the app gives up on the
  // sign-in. Nothing else until then.
  const pendingOk = (request.method === 'POST' && path === '/sync/push') || (request.method === 'GET' && path === '/sync/pull');
  if (session.pending) {
    if (request.method === 'DELETE' && path === `/sync/devices/${session.deviceId}`) {
      await env.VEX_AUTH_KV.delete(`sess:${token}`);
      await forgetSessions(env, account, s => s.token !== token);
      return json({ ok: true });
    }
    if (!pendingOk) return json({ error: 'This device has not synced yet' }, 403);
  } else if (!listed()) {
    // Removed from another device, or the account was wiped: the
    // session goes too. It used to stay when the whole list was gone.
    await env.VEX_AUTH_KV.delete(`sess:${token}`);
    await forgetSessions(env, account, s => s.token !== token);
    return json({ error: 'Device revoked' }, 401);
  } else {
    // Touch lastSeenAt
    const devices = JSON.parse(existingDevices);
    devices.find(x => x.deviceId === session.deviceId).lastSeenAt = new Date().toISOString();
    await env.VEX_SYNC_KV.put(devicesKey, JSON.stringify(devices));
    await rememberSession(env, account, token, session.deviceId);
  }

  // A pending device's first successful push or pull puts it in the list.
  const registerPending = async () => {
    if (!session.pending) return;
    const devices = existingDevices ? JSON.parse(existingDevices) : [];
    devices.push({ deviceId: session.deviceId, deviceName: session.deviceName, createdAt: session.createdAt, lastSeenAt: new Date().toISOString() });
    await env.VEX_SYNC_KV.put(devicesKey, JSON.stringify(devices));
    const settled = { ...session };
    delete settled.pending;
    await env.VEX_AUTH_KV.put(`sess:${token}`, JSON.stringify(settled), { expirationTtl: sessionTtl(settled) });
  };

  if (path === '/sync/push' && request.method === 'POST') {
    const { encryptedBlob, updatedAt, baseRevision } = await boundedJson(request);
    if (!encryptedBlob || typeof encryptedBlob !== 'string') {
      return json({ error: 'Missing encryptedBlob' }, 400);
    }
    if (encryptedBlob.length > 5 * 1024 * 1024) {
      return json({ error: 'Blob too large (max 5 MB)' }, 413);
    }
    const blobKey = `blob:${account}`;
    const previous = await env.VEX_SYNC_KV.get(blobKey);
    const revision = previous ? (JSON.parse(previous).revision || 0) : 0;
    if (!Number.isSafeInteger(baseRevision) || baseRevision !== revision) return json({ error: 'Sync conflict: pull and merge before pushing', revision }, 409);
    const data = {
      revision: revision + 1,
      encryptedBlob,
      updatedAt: updatedAt || new Date().toISOString(),
      pushedBy: session.deviceId,
      pushedAt: new Date().toISOString()
    };
    await env.VEX_SYNC_KV.put(blobKey, JSON.stringify(data));
    await registerPending();
    return json({ ok: true, savedAt: data.pushedAt, revision: data.revision });
  }

  if (path === '/sync/pull' && request.method === 'GET') {
    const existing = await env.VEX_SYNC_KV.get(`blob:${account}`);
    await registerPending();
    if (!existing) return json({ ok: true, blob: null });
    const data = JSON.parse(existing);
    return json({ ok: true, ...data });
  }

  if (path === '/sync/devices' && request.method === 'GET') {
    const existing = await env.VEX_SYNC_KV.get(devicesKey);
    const devices = existing ? JSON.parse(existing) : [];
    return json({ ok: true, devices, currentDeviceId: session.deviceId });
  }

  const devMatch = path.match(/^\/sync\/devices\/([a-f0-9]+)$/);
  if (devMatch && request.method === 'DELETE') {
    const targetDeviceId = devMatch[1];
    const existing = await env.VEX_SYNC_KV.get(devicesKey);
    if (existing) {
      const devices = JSON.parse(existing);
      const filtered = devices.filter(d => d.deviceId !== targetDeviceId);
      await env.VEX_SYNC_KV.put(devicesKey, JSON.stringify(filtered));
    }
    await forgetSessions(env, account, s => s.deviceId !== targetDeviceId);
    return json({ ok: true });
  }

  if (path === '/sync/all' && request.method === 'DELETE') {
    // The copy the previous worker kept goes first, so a failure leaves the
    // account as it was rather than half wiped.
    await env.forgetElsewhere();
    await wipeAccount(env, account);
    return json({ ok: true });
  }

  // ====== DROP — cross-device tab handoff ("Send to Phone/Desktop") ======
  // A small mailbox per account: POST adds {url,title} stamped with the
  // sending device; GET delivers (and consumes) every item that was NOT
  // sent by the requesting device. Each item is encrypted on the sending
  // device (a URL and title inside); the server keeps only that
  // ciphertext, the sending device and the time it was sent.
  if (path === '/sync/drop' && request.method === 'POST') {
    const { encryptedBlob } = await boundedJson(request);
    if (typeof encryptedBlob !== 'string' || !encryptedBlob || encryptedBlob.length > 16384) {
      return json({ error: 'Encrypted handoff required (max 16 KB)' }, 400);
    }
    const dropKey = `drop:${account}`;
    const existing = await env.VEX_SYNC_KV.get(dropKey);
    let items = [];
    try { items = existing ? JSON.parse(existing) : []; } catch { items = []; }
    items.push({
      id: randomId(8),
      encryptedBlob,
      fromDeviceId: session.deviceId,
      fromDeviceName: session.deviceName,
      at: new Date().toISOString()
    });
    if (items.length > 20) items = items.slice(-20);
    await env.VEX_SYNC_KV.put(dropKey, JSON.stringify(items), { expirationTtl: DROP_TTL });
    return json({ ok: true });
  }

  if (path === '/sync/drop' && request.method === 'GET') {
    const dropKey = `drop:${account}`;
    const existing = await env.VEX_SYNC_KV.get(dropKey);
    let items = [];
    try { items = existing ? JSON.parse(existing) : []; } catch { items = []; }
    const mine = items.filter(i => i.fromDeviceId !== session.deviceId);
    const rest = items.filter(i => i.fromDeviceId === session.deviceId);
    if (mine.length) {
      if (rest.length) await env.VEX_SYNC_KV.put(dropKey, JSON.stringify(rest), { expirationTtl: DROP_TTL });
      else await env.VEX_SYNC_KV.delete(dropKey);
    }
    return json({ ok: true, items: mine });
  }

  return json({ error: 'Not found' }, 404);
}

async function wipeAccount(env, account) {
  await env.VEX_SYNC_KV.delete(`blob:${account}`);
  await env.VEX_SYNC_KV.delete(`devices:${account}`);
  await env.VEX_SYNC_KV.delete(`drop:${account}`);
  await forgetSessions(env, account, () => false);
}

export class VexSyncAccount {
  constructor(state, env) { this.state = state; this.env = env; }

  stores(account) {
    const storage = this.state.storage;
    const importSession = async token => (await callInternal(globalStub(this.env), '/internal/export-session', { account, token })).record;
    return {
      ...this.env,
      VEX_AUTH_KV: accountKV(storage, 'auth:', importSession),
      VEX_SYNC_KV: accountKV(storage, 'sync:', null),
      forgetElsewhere: () => this.forgetElsewhere(account),
    };
  }

  async fetch(request) {
    const account = request.headers.get('X-Vex-Account') || '';
    if (!ACCOUNT_RE.test(account)) return json({ error: 'Sync request failed' }, 500);
    const path = new URL(request.url).pathname;
    const outcome = await this.state.blockConcurrencyWhile(async () => {
      try {
        // An account made before the HMAC key that has since been taken over
        // by its HMAC-keyed object sends its devices' requests on.
        const forward = path.startsWith('/sync/') ? await this.state.storage.get('meta:forward') : null;
        if (forward) return { forward: forward.to };
        const bound = await this.state.storage.get('meta:account');
        if (bound && bound !== account) throw new Error('Request for another account');
        if (!bound) await this.state.storage.put('meta:account', account);
        await this.migrate(account);
        await this.finishAdoption(account);
        return { response: await this.handle(request, account, path) };
      } catch (err) {
        if (!err.status) console.error('[vex-sync] account request failed:', err.message);
        return { response: json({ error: err.status ? err.message : 'Sync request failed' }, err.status || 500) };
      }
    });
    // Outside the lock: the target may itself be waiting on this object.
    if (outcome.forward) return accountStub(this.env, outcome.forward).fetch(withAccount(request, outcome.forward));
    return outcome.response;
  }

  async handle(request, account, path) {
    const env = this.stores(account);
    if (path.startsWith('/sync/')) return handleSync(request, env, account, path);
    const body = await request.json();
    if (path === '/internal/open-session') return json(await this.openSession(env, account, body));
    if (path === '/internal/handover') return json({ records: await this.handover(account, body.to) });
    if (path === '/internal/wipe') {
      await this.forgetElsewhere(account);
      await wipeAccount(env, account);
      return json({ ok: true });
    }
    return json({ error: 'Not found' }, 404);
  }

  // The first request for an account copies what the previous worker kept
  // for it in the global object. Safe to repeat: a key already here is never
  // overwritten, and the account counts as moved only once every copied key
  // has been read back. Nothing is deleted from the global object.
  async migrate(account) {
    const storage = this.state.storage;
    if (await storage.get('meta:migrated')) return;
    const { records } = await callInternal(globalStub(this.env), '/internal/export-account', { account });
    const allowed = new Set(accountKeys(account));
    const entries = {};
    const expected = {};
    for (const [key, record] of records) {
      if (!allowed.has(key) && !/^auth:sess:[^:]+$/.test(key)) throw new Error('Unexpected key in an exported account');
      const here = await storage.get(key);
      if (here === undefined) entries[key] = record;
      expected[key] = here === undefined ? record : here;
    }
    await putAll(storage, entries);
    await verifyAll(storage, expected);
    const blob = records.find(([key]) => key === `sync:blob:${account}`);
    const revision = live(blob?.[1]) ? JSON.parse(blob[1].value).revision || 0 : null;
    await storage.put('meta:migrated', { at: new Date().toISOString(), records: records.length, revision });
    if (records.length) console.log(`[vex-sync] account moved to its own object: ${records.length} records, revision ${revision}`);
  }

  async openSession(env, account, body) {
    const storage = this.state.storage;
    if (body.legacyHash && body.legacyHash !== account && !(await storage.get('meta:legacyChecked'))) {
      const own = await env.VEX_SYNC_KV.get(`blob:${account}`) || await env.VEX_SYNC_KV.get(`devices:${account}`);
      if (!own && (await callInternal(globalStub(this.env), '/internal/has-account', { account: body.legacyHash })).exists) {
        await storage.put('meta:adopting', { from: body.legacyHash, stage: 'handover' });
        await this.finishAdoption(account);
      }
      await storage.put('meta:legacyChecked', { at: new Date().toISOString() });
    }
    const session = { emailHash: account, deviceId: body.deviceId, deviceName: body.deviceName, createdAt: body.createdAt, pending: true };
    await env.VEX_AUTH_KV.put(`sess:${body.sessionToken}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
    await rememberSession(env, account, body.sessionToken, body.deviceId);
    return { hasEncryptedData: !!(await env.VEX_SYNC_KV.get(`blob:${account}`)) };
  }

  // Taking over an account made before the HMAC key (it lives in the object
  // named by the unsalted hash, which may have synced since this worker was
  // deployed). The old object hands over a snapshot and from then on sends
  // its devices' requests here; the snapshot is copied and read back; then
  // the global object routes the old key here. Each stage is recorded, so an
  // interrupted takeover finishes on the next request.
  async finishAdoption(account) {
    const storage = this.state.storage;
    let job = await storage.get('meta:adopting');
    if (!job) return;
    if (job.stage === 'handover') {
      const from = job.from;
      const { records } = await callInternal(accountStub(this.env, from), '/internal/handover', { to: account }, from);
      const entries = {};
      for (const [key, record] of records) {
        if (key.startsWith('auth:sess:')) { entries[key] = sessionFor(record, account); continue; }
        const kind = accountKeys(from).indexOf(key);
        if (kind < 0) throw new Error('Unexpected key in a handed-over account');
        entries[accountKeys(account)[kind]] = record;
      }
      // Sessions this account already had (sign-ins that never synced) stay.
      const sessionsKey = `auth:sessions:${account}`;
      const mine = await storage.get(sessionsKey);
      if (live(mine)) {
        const theirs = live(entries[sessionsKey]) ? JSON.parse(entries[sessionsKey].value) : [];
        const merged = [...theirs, ...JSON.parse(mine.value).filter(s => !theirs.some(t => t.token === s.token))];
        entries[sessionsKey] = { value: JSON.stringify(merged), expires: 0 };
      }
      await putAll(storage, entries);
      await verifyAll(storage, entries);
      job = { from, stage: 'alias', moved: records.length };
      await storage.put('meta:adopting', job);
    }
    if (job.moved) {
      await callInternal(globalStub(this.env), '/internal/alias', { account: job.from, to: account });
      await storage.put('meta:adopted', { from: job.from, at: new Date().toISOString() });
      console.log(`[vex-sync] account from before the HMAC key taken over: ${job.moved} records`);
    }
    await storage.delete('meta:adopting');
  }

  async handover(account, to) {
    if (!ACCOUNT_RE.test(to || '') || to === account) throw new Error('Invalid handover');
    const storage = this.state.storage;
    const forward = await storage.get('meta:forward');
    if (forward && forward.to !== to) throw new Error('Already handed over elsewhere');
    const records = [];
    for (const key of accountKeys(account)) {
      const record = await storage.get(key);
      if (record !== undefined) records.push([key, record]);
    }
    if (!records.some(([key, record]) => live(record) && /^sync:(blob|devices):/.test(key))) return [];
    for (const [key, record] of await storage.list({ prefix: 'auth:sess:' })) records.push([key, record]);
    // From here on this object only forwards; its own copy stays.
    if (!forward) await storage.put('meta:forward', { to, at: new Date().toISOString() });
    return records;
  }

  // DELETE /sync/all reaches every copy of the account.
  async forgetElsewhere(account) {
    await callInternal(globalStub(this.env), '/internal/forget-account', { account });
    const adopted = await this.state.storage.get('meta:adopted');
    if (adopted) await callInternal(accountStub(this.env, adopted.from), '/internal/wipe', {}, adopted.from);
  }

  alarm() { return expireRecords(this.state.storage); }
}

// Named exports for unit tests (no effect on the Worker runtime, which only
// uses the default export's fetch()).
export { genNumericCode, timingSafeEqual, rateLimited, hashEmail, legacyHashEmail };

export { syncHandler };
export class VexSyncState {
  constructor(state, env) { this.state = state; this.env = env; this.store = new GlobalStore(state, env); }
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/internal/')) {
      // Only the worker's own objects call these; they never call out, so
      // holding the lock cannot wait on another object.
      return this.state.blockConcurrencyWhile(async () => {
        try { return json(await this.store.handle(path, await request.json())); }
        catch (err) {
          if (!err.status) console.error('[vex-sync] global request failed:', err.message);
          return json({ error: err.status ? err.message : 'Sync request failed' }, err.status || 500);
        }
      });
    }
    return this.state.blockConcurrencyWhile(() => syncHandler.fetch(request, { ...this.env, VEX_AUTH_KV: this.store.auth, VEX_SYNC_KV: this.store.sync }));
  }
  alarm() { return expireRecords(this.state.storage); }
}

async function route(request, env) {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/internal/')) return json({ error: 'Not found' }, 404);
  if (path.startsWith('/sync/')) {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '');
    if (!token) return json({ error: 'Unauthorized' }, 401);
    const { account } = await callInternal(globalStub(env), '/internal/route', { token });
    if (!account) return json({ error: 'Invalid session' }, 401);
    return accountStub(env, account).fetch(withAccount(request, account));
  }
  const response = await globalStub(env).fetch(request);
  if (path !== '/auth/verify-code' || request.method !== 'POST' || response.status !== 200) return response;
  const signedIn = await response.json();
  const { hasEncryptedData } = await callInternal(accountStub(env, signedIn.emailHash), '/internal/open-session', signedIn, signedIn.emailHash);
  return json({ ok: true, sessionToken: signedIn.sessionToken, deviceId: signedIn.deviceId, emailHash: signedIn.emailHash, hasEncryptedData });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return syncHandler.fetch(request, env);
    if (!env.VEX_STATE || !env.VEX_ACCOUNTS) return json({ error: 'Durable state is not configured' }, 503);
    if (hashSecretMissing(env)) return syncHandler.fetch(request, env);
    try {
      return await route(request, env);
    } catch (err) {
      console.error('[vex-sync] request failed:', err.message);
      return json({ error: 'Sync request failed' }, 500);
    }
  }
};
