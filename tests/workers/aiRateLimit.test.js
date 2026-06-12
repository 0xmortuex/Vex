// Security regression tests for vex-ai-worker rate limiting.
//
// The worker proxies a PAID model with the project's OpenRouter key and its URL
// ships in the public app. Without a per-IP limit, anyone who reads the URL can
// drain credits. These tests pin the limiter and the 429 short-circuit.

import { describe, it, expect } from 'vitest';
import worker, { aiRateLimited } from '../../workers/vex-ai-worker/worker.js';

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

describe('aiRateLimited', () => {
  it('fails OPEN when the KV namespace is not bound (worker keeps serving)', async () => {
    const env = {}; // no VEX_AI_KV
    for (let i = 0; i < 100; i++) {
      expect(await aiRateLimited(env, '1.1.1.1')).toBe(false);
    }
  });

  it('allows 30 requests/min/IP then blocks the 31st', async () => {
    const env = { VEX_AI_KV: makeKV() };
    const ip = '198.51.100.4';
    for (let i = 0; i < 30; i++) {
      expect(await aiRateLimited(env, ip)).toBe(false);
    }
    expect(await aiRateLimited(env, ip)).toBe(true);
  });

  it('tracks IPs independently', async () => {
    const env = { VEX_AI_KV: makeKV() };
    for (let i = 0; i < 30; i++) await aiRateLimited(env, 'a');
    expect(await aiRateLimited(env, 'a')).toBe(true);
    expect(await aiRateLimited(env, 'b')).toBe(false); // fresh IP unaffected
  });
});

describe('fetch — 429 short-circuit', () => {
  it('returns 429 with Retry-After once the IP is over the limit, before calling OpenRouter', async () => {
    const env = { VEX_AI_KV: makeKV() };
    const ip = '198.51.100.9';
    // Saturate the minute bucket via the same code path the handler uses.
    for (let i = 0; i < 30; i++) await aiRateLimited(env, ip);

    const req = new Request('https://ai.test/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ action: 'chat', message: 'hi' }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('rejects oversized bodies with 413', async () => {
    // The cap was raised to 4 MB so screenshot-to-code (a downscaled image) fits;
    // anything beyond that is still rejected before reaching the model.
    const env = { VEX_AI_KV: makeKV() };
    const req = new Request('https://ai.test/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '198.51.100.50',
        'content-length': String(5 * 1024 * 1024),
      },
      body: JSON.stringify({ action: 'chat', message: 'x' }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(413);
  });

  it('allows a sub-4MB image body through the size gate (screenshot-to-code)', async () => {
    // 1 MB is under the cap → must NOT be rejected with 413 (it'll fail later for
    // other reasons like missing key, but not at the size gate).
    const env = { VEX_AI_KV: makeKV() };
    const req = new Request('https://ai.test/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '198.51.100.51',
        'content-length': String(1024 * 1024),
      },
      body: JSON.stringify({ action: 'screenshot-to-code', image: 'data:image/png;base64,AAAA' }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).not.toBe(413);
  });
});
