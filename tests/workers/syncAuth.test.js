// Security regression tests for vex-sync-worker auth hardening.
//
// Before the fix: magic codes came from Math.random() and /auth/verify-code had
// no attempt cap, so the 6-digit code was brute-forceable within its 10-min TTL
// → account takeover. These tests pin the crypto code generator and the
// attempt-cap / rate-limit behaviour that closes it.

import { describe, it, expect } from 'vitest';
import worker, { genNumericCode, timingSafeEqual } from '../../workers/vex-sync-worker/worker.js';

// ---- In-memory KV that honours expirationTtl, mirroring the Workers KV API ----
function makeKV() {
  const raw = new Map();
  return {
    raw,
    async get(k) {
      const e = raw.get(k);
      if (!e) return null;
      if (e.exp && Date.now() > e.exp) { raw.delete(k); return null; }
      return e.v;
    },
    async put(k, v, opts) {
      raw.set(k, { v: String(v), exp: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0 });
    },
    async delete(k) { raw.delete(k); },
  };
}

function makeEnv() {
  return { VEX_AUTH_KV: makeKV(), VEX_SYNC_KV: makeKV() }; // no RESEND_API_KEY → no email send
}

function post(path, body, ip = '10.0.0.1') {
  return new Request('https://sync.test' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

// Pull the freshly-issued code straight out of KV (the attacker can't, but the
// test can) so we can exercise the verify path deterministically.
function storedCodeFor(env) {
  for (const [k, e] of env.VEX_AUTH_KV.raw) {
    if (k.startsWith('code:')) return e.v;
  }
  return null;
}

describe('genNumericCode', () => {
  it('always returns a 6-digit numeric string', () => {
    for (let i = 0; i < 500; i++) {
      const c = genNumericCode();
      expect(c).toMatch(/^[0-9]{6}$/);
    }
  });

  it('is not constant (uses real entropy, not a fixed value)', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(genNumericCode());
    expect(seen.size).toBeGreaterThan(40); // overwhelmingly likely if random
  });
});

describe('timingSafeEqual', () => {
  it('true only for identical equal-length strings', () => {
    expect(timingSafeEqual('123456', '123456')).toBe(true);
    expect(timingSafeEqual('123456', '123457')).toBe(false);
    expect(timingSafeEqual('123456', '12345')).toBe(false); // length mismatch
    expect(timingSafeEqual('123456', 123456)).toBe(false);  // non-string
  });
});

describe('/auth/verify-code — brute-force protection', () => {
  it('burns the code after 5 wrong guesses, then rejects even the correct code', async () => {
    const env = makeEnv();
    const email = 'victim@example.com';

    const rc = await worker.fetch(post('/auth/request-code', { email }), env);
    expect(rc.status).toBe(200);

    const realCode = storedCodeFor(env);
    expect(realCode).toMatch(/^[0-9]{6}$/);

    // 5 wrong guesses → 401 each.
    for (let i = 0; i < 5; i++) {
      const res = await worker.fetch(post('/auth/verify-code', { email, code: '000000' }), env);
      expect(res.status).toBe(401);
    }

    // 6th attempt → 429, and the code is burned.
    const sixth = await worker.fetch(post('/auth/verify-code', { email, code: '000000' }), env);
    expect(sixth.status).toBe(429);

    // Even the genuine code no longer works — user must request a new one.
    const afterBurn = await worker.fetch(post('/auth/verify-code', { email, code: realCode }), env);
    expect(afterBurn.status).toBe(401);
  });

  it('accepts the correct code within the attempt budget and issues a session', async () => {
    const env = makeEnv();
    const email = 'good@example.com';

    await worker.fetch(post('/auth/request-code', { email }), env);
    const realCode = storedCodeFor(env);

    // One wrong guess, then the right one.
    expect((await worker.fetch(post('/auth/verify-code', { email, code: '111111' }), env)).status).toBe(401);

    const ok = await worker.fetch(post('/auth/verify-code', { email, code: realCode, deviceName: 'Test' }), env);
    expect(ok.status).toBe(200);
    const data = await ok.json();
    expect(data.ok).toBe(true);
    expect(data.sessionToken).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes hex
    expect(data.deviceId).toBeTruthy();
  });
});

describe('/auth/request-code — issuance rate limit', () => {
  it('allows 3 codes per email then 429s the 4th', async () => {
    const env = makeEnv();
    const email = 'spam@example.com';
    const ip = '203.0.113.7';

    for (let i = 0; i < 3; i++) {
      const r = await worker.fetch(post('/auth/request-code', { email }, ip), env);
      expect(r.status).toBe(200);
    }
    const fourth = await worker.fetch(post('/auth/request-code', { email }, ip), env);
    expect(fourth.status).toBe(429);
  });

  it('rejects a malformed email', async () => {
    const env = makeEnv();
    const r = await worker.fetch(post('/auth/request-code', { email: 'nope' }), env);
    expect(r.status).toBe(400);
  });
});
