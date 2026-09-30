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

// An account made before the HMAC key lives under the unsalted hash. The first
// sign-in after the change moves it — the encrypted data, the device list and
// the handoff mailbox — and leaves each of its devices a pointer, so a session
// that still names the old key follows it instead of being signed out.
async function moveLegacyAccount(env, oldHash, newHash) {
  const S = env.VEX_SYNC_KV;
  if (await S.get(`blob:${newHash}`) || await S.get(`devices:${newHash}`)) return;
  const blob = await S.get(`blob:${oldHash}`);
  const devices = await S.get(`devices:${oldHash}`);
  if (!blob && !devices) return;
  const drop = await S.get(`drop:${oldHash}`);
  if (blob) await S.put(`blob:${newHash}`, blob);
  if (devices) await S.put(`devices:${newHash}`, devices);
  if (drop) await S.put(`drop:${newHash}`, drop, { expirationTtl: DROP_TTL });
  for (const d of devices ? JSON.parse(devices) : []) {
    await env.VEX_AUTH_KV.put(`moved:${d.deviceId}`, newHash, { expirationTtl: SESSION_TTL });
  }
  // Sessions seen on the old key since this worker was deployed.
  const oldSessions = await accountSessions(env, oldHash);
  if (oldSessions.length) {
    await env.VEX_AUTH_KV.put(`sessions:${newHash}`, JSON.stringify([...await accountSessions(env, newHash), ...oldSessions]));
    await env.VEX_AUTH_KV.delete(`sessions:${oldHash}`);
  }
  await S.delete(`blob:${oldHash}`);
  await S.delete(`devices:${oldHash}`);
  if (drop) await S.delete(`drop:${oldHash}`);
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

        await moveLegacyAccount(env, await legacyHashEmail(email), emailHash);

        // The device joins the account's list on its first successful push or
        // pull, not here. Registering it before the app had decided anything
        // left a ghost device whenever the sign-in was then refused (an
        // account with data but no recovery code, a wrong recovery code)
        // and the app could not remove it (found 2026-09-30).
        const sessionToken = randomId(32);
        const deviceId = randomId(16);
        const session = {
          emailHash,
          deviceId,
          deviceName: deviceName || 'Unknown device',
          createdAt: new Date().toISOString(),
          pending: true
        };
        await env.VEX_AUTH_KV.put(`sess:${sessionToken}`, JSON.stringify(session), {
          expirationTtl: SESSION_TTL
        });
        await rememberSession(env, emailHash, sessionToken, deviceId);

        const hasEncryptedData = !!(await env.VEX_SYNC_KV.get(`blob:${emailHash}`));
        return json({ ok: true, sessionToken, deviceId, emailHash, hasEncryptedData });
      }

      // ====== SYNC (auth required) ======
      if (path.startsWith('/sync/')) {
        const auth = request.headers.get('Authorization') || '';
        const token = auth.replace(/^Bearer\s+/, '');
        if (!token) return json({ error: 'Unauthorized' }, 401);

        const sessionRaw = await env.VEX_AUTH_KV.get(`sess:${token}`);
        if (!sessionRaw) return json({ error: 'Invalid session' }, 401);
        let session = JSON.parse(sessionRaw);
        let devicesKey = `devices:${session.emailHash}`;
        let existingDevices = await env.VEX_SYNC_KV.get(devicesKey);
        const listed = () => !!existingDevices && JSON.parse(existingDevices).some(x => x.deviceId === session.deviceId);

        // A session that still names the account's old unsalted key, after a
        // sign-in elsewhere moved the account (moveLegacyAccount).
        if (!session.pending && !listed()) {
          const moved = await env.VEX_AUTH_KV.get(`moved:${session.deviceId}`);
          if (moved) {
            session = { ...session, emailHash: moved };
            await env.VEX_AUTH_KV.put(`sess:${token}`, JSON.stringify(session), { expirationTtl: sessionTtl(session) });
            await env.VEX_AUTH_KV.delete(`moved:${session.deviceId}`);
            devicesKey = `devices:${session.emailHash}`;
            existingDevices = await env.VEX_SYNC_KV.get(devicesKey);
          }
        }

        // Not yet in the device list (see verify-code): it may push or pull,
        // which registers it, or remove itself when the app gives up on the
        // sign-in. Nothing else until then.
        const pendingOk = (request.method === 'POST' && path === '/sync/push') || (request.method === 'GET' && path === '/sync/pull');
        if (session.pending) {
          if (request.method === 'DELETE' && path === `/sync/devices/${session.deviceId}`) {
            await env.VEX_AUTH_KV.delete(`sess:${token}`);
            await forgetSessions(env, session.emailHash, s => s.token !== token);
            return json({ ok: true });
          }
          if (!pendingOk) return json({ error: 'This device has not synced yet' }, 403);
        } else if (!listed()) {
          // Removed from another device, or the account was wiped: the
          // session goes too. It used to stay when the whole list was gone.
          await env.VEX_AUTH_KV.delete(`sess:${token}`);
          await forgetSessions(env, session.emailHash, s => s.token !== token);
          return json({ error: 'Device revoked' }, 401);
        } else {
          // Touch lastSeenAt
          const devices = JSON.parse(existingDevices);
          devices.find(x => x.deviceId === session.deviceId).lastSeenAt = new Date().toISOString();
          await env.VEX_SYNC_KV.put(devicesKey, JSON.stringify(devices));
          await rememberSession(env, session.emailHash, token, session.deviceId);
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
          const blobKey = `blob:${session.emailHash}`;
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
          const blobKey = `blob:${session.emailHash}`;
          const existing = await env.VEX_SYNC_KV.get(blobKey);
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
          await forgetSessions(env, session.emailHash, s => s.deviceId !== targetDeviceId);
          return json({ ok: true });
        }

        if (path === '/sync/all' && request.method === 'DELETE') {
          const blobKey = `blob:${session.emailHash}`;
          await env.VEX_SYNC_KV.delete(blobKey);
          await env.VEX_SYNC_KV.delete(devicesKey);
          await env.VEX_SYNC_KV.delete(`drop:${session.emailHash}`);
          await forgetSessions(env, session.emailHash, () => false);
          return json({ ok: true });
        }

        // ====== DROP — cross-device tab handoff ("Send to Phone/Desktop") ======
        // A small mailbox per account: POST adds {url,title} stamped with the
        // sending device; GET delivers (and consumes) every item that was NOT
        // sent by the requesting device. Plain URLs/titles only — no page data.
        if (path === '/sync/drop' && request.method === 'POST') {
          const { encryptedBlob } = await boundedJson(request);
          if (typeof encryptedBlob !== 'string' || !encryptedBlob || encryptedBlob.length > 16384) {
            return json({ error: 'Encrypted handoff required (max 16 KB)' }, 400);
          }
          const dropKey = `drop:${session.emailHash}`;
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
          const dropKey = `drop:${session.emailHash}`;
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
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.status ? err.message : 'Sync request failed' }, err.status || 500);
    }
  }
};

// Named exports for unit tests (no effect on the Worker runtime, which only
// uses the default export's fetch()).
export { genNumericCode, timingSafeEqual, rateLimited, hashEmail, legacyHashEmail };

export { syncHandler };
export class VexSyncState {
  constructor(state, env) { this.state = state; this.env = env; }
  fetch(request) {
    return this.state.blockConcurrencyWhile(() => syncHandler.fetch(request, { ...this.env, VEX_AUTH_KV: durableKV(this.state.storage, 'auth:', this.env.VEX_AUTH_KV), VEX_SYNC_KV: durableKV(this.state.storage, 'sync:', this.env.VEX_SYNC_KV) }));
  }
  alarm() { return expireRecords(this.state.storage); }
}
export default {
  fetch(request, env) {
    if (request.method === 'OPTIONS') return syncHandler.fetch(request, env);
    if (!env.VEX_STATE) return Promise.resolve(json({ error: 'Durable state is not configured' }, 503));
    return env.VEX_STATE.get(env.VEX_STATE.idFromName('vex-sync')).fetch(request);
  }
};
