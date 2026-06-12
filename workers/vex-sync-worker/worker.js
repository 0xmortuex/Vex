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

// Fixed-window rate limiter backed by VEX_AUTH_KV. Time-bucketed keys give a
// stable window; the read-then-write isn't atomic (KV is eventually consistent)
// but that's acceptable for abuse mitigation. Fails OPEN on KV errors so an
// outage degrades to "no limit" rather than locking every user out.
async function rateLimited(env, bucket, limit, windowSec) {
  try {
    if (!env.VEX_AUTH_KV) return false;
    const win = Math.floor(Date.now() / (windowSec * 1000));
    const key = `rl:${bucket}:${win}`;
    const cur = parseInt(await env.VEX_AUTH_KV.get(key), 10) || 0;
    if (cur >= limit) return true;
    await env.VEX_AUTH_KV.put(key, String(cur + 1), { expirationTtl: windowSec + 60 });
    return false;
  } catch {
    return false;
  }
}

async function hashEmail(email) {
  const normalized = email.trim().toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendMagicCode(email, code, env) {
  // Never log the code itself — Worker logs are retained by Cloudflare and a
  // logged code is a logged credential. Log only that one was issued.
  console.log('[AUTH] Magic code issued');

  if (env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Vex Sync <onboarding@resend.dev>',
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
    } catch (err) {
      console.error('Resend failed:', err);
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

    try {
      // ====== AUTH ======
      if (path === '/auth/request-code' && request.method === 'POST') {
        const { email } = await request.json();
        if (!email || !email.includes('@')) {
          return json({ error: 'Invalid email' }, 400);
        }

        const emailHash = await hashEmail(email);

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

        return json({ ok: true, message: 'Code sent to email' });
      }

      if (path === '/auth/verify-code' && request.method === 'POST') {
        const { email, code, deviceName } = await request.json();
        if (!email || !code) return json({ error: 'Missing email or code' }, 400);

        const emailHash = await hashEmail(email);

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
        const attempts = parseInt(await env.VEX_AUTH_KV.get(attemptsKey), 10) || 0;
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

        const sessionToken = randomId(32);
        const deviceId = randomId(16);
        const session = {
          emailHash,
          deviceId,
          deviceName: deviceName || 'Unknown device',
          createdAt: new Date().toISOString()
        };
        await env.VEX_AUTH_KV.put(`sess:${sessionToken}`, JSON.stringify(session), {
          expirationTtl: 60 * 60 * 24 * 365 // 1 year
        });

        const devicesKey = `devices:${emailHash}`;
        const existing = await env.VEX_SYNC_KV.get(devicesKey);
        const devices = existing ? JSON.parse(existing) : [];
        devices.push({
          deviceId,
          deviceName: session.deviceName,
          createdAt: session.createdAt,
          lastSeenAt: session.createdAt
        });
        await env.VEX_SYNC_KV.put(devicesKey, JSON.stringify(devices));

        return json({ ok: true, sessionToken, deviceId, emailHash });
      }

      // ====== SYNC (auth required) ======
      if (path.startsWith('/sync/')) {
        const auth = request.headers.get('Authorization') || '';
        const token = auth.replace(/^Bearer\s+/, '');
        if (!token) return json({ error: 'Unauthorized' }, 401);

        const sessionRaw = await env.VEX_AUTH_KV.get(`sess:${token}`);
        if (!sessionRaw) return json({ error: 'Invalid session' }, 401);
        const session = JSON.parse(sessionRaw);

        // Touch lastSeenAt
        const devicesKey = `devices:${session.emailHash}`;
        const existingDevices = await env.VEX_SYNC_KV.get(devicesKey);
        if (existingDevices) {
          const devices = JSON.parse(existingDevices);
          const d = devices.find(x => x.deviceId === session.deviceId);
          if (d) {
            d.lastSeenAt = new Date().toISOString();
            await env.VEX_SYNC_KV.put(devicesKey, JSON.stringify(devices));
          } else {
            // Device was removed — invalidate session
            await env.VEX_AUTH_KV.delete(`sess:${token}`);
            return json({ error: 'Device revoked' }, 401);
          }
        }

        if (path === '/sync/push' && request.method === 'POST') {
          const { encryptedBlob, updatedAt } = await request.json();
          if (!encryptedBlob || typeof encryptedBlob !== 'string') {
            return json({ error: 'Missing encryptedBlob' }, 400);
          }
          if (encryptedBlob.length > 5 * 1024 * 1024) {
            return json({ error: 'Blob too large (max 5 MB)' }, 413);
          }
          const blobKey = `blob:${session.emailHash}`;
          const data = {
            encryptedBlob,
            updatedAt: updatedAt || new Date().toISOString(),
            pushedBy: session.deviceId,
            pushedAt: new Date().toISOString()
          };
          await env.VEX_SYNC_KV.put(blobKey, JSON.stringify(data));
          return json({ ok: true, savedAt: data.pushedAt });
        }

        if (path === '/sync/pull' && request.method === 'GET') {
          const blobKey = `blob:${session.emailHash}`;
          const existing = await env.VEX_SYNC_KV.get(blobKey);
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
          return json({ ok: true });
        }

        if (path === '/sync/all' && request.method === 'DELETE') {
          const blobKey = `blob:${session.emailHash}`;
          await env.VEX_SYNC_KV.delete(blobKey);
          await env.VEX_SYNC_KV.delete(devicesKey);
          await env.VEX_SYNC_KV.delete(`drop:${session.emailHash}`);
          return json({ ok: true });
        }

        // ====== DROP — cross-device tab handoff ("Send to Phone/Desktop") ======
        // A small mailbox per account: POST adds {url,title} stamped with the
        // sending device; GET delivers (and consumes) every item that was NOT
        // sent by the requesting device. Plain URLs/titles only — no page data.
        if (path === '/sync/drop' && request.method === 'POST') {
          const { url: dropUrl, title } = await request.json();
          if (!dropUrl || typeof dropUrl !== 'string' || !/^https?:\/\//i.test(dropUrl)) {
            return json({ error: 'Invalid url' }, 400);
          }
          const dropKey = `drop:${session.emailHash}`;
          const existing = await env.VEX_SYNC_KV.get(dropKey);
          let items = [];
          try { items = existing ? JSON.parse(existing) : []; } catch { items = []; }
          items.push({
            id: randomId(8),
            url: dropUrl.slice(0, 2048),
            title: String(title || '').slice(0, 300),
            fromDeviceId: session.deviceId,
            fromDeviceName: session.deviceName,
            at: new Date().toISOString()
          });
          if (items.length > 20) items = items.slice(-20);
          await env.VEX_SYNC_KV.put(dropKey, JSON.stringify(items), { expirationTtl: 60 * 60 * 24 * 7 });
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
            if (rest.length) await env.VEX_SYNC_KV.put(dropKey, JSON.stringify(rest), { expirationTtl: 60 * 60 * 24 * 7 });
            else await env.VEX_SYNC_KV.delete(dropKey);
          }
          return json({ ok: true, items: mine });
        }
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message || 'Server error' }, 500);
    }
  }
};

// Named exports for unit tests (no effect on the Worker runtime, which only
// uses the default export's fetch()).
export { genNumericCode, timingSafeEqual, rateLimited, hashEmail };
