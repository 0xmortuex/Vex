// The companion relay (workers/companion/worker.js), run in memory against a fake KV: input validation, the
// one-time code, expiry, authorisation and the rate limits. No Cloudflare, no network.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { makeKv } from '../helpers/fakeKv.js';
import { handle } from '../../workers/companion/worker.js';

const hex = (c) => c.repeat(64);
const LOOKUP = hex('a');
const TOKEN = hex('b');                  // the desktop's publish token
let PUBLISH_HASH;                        // sha256(TOKEN), computed once
let env, clock;

async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
beforeEach(async () => {
  PUBLISH_HASH = await sha256Hex(TOKEN);
  clock = 1_800_000_000_000;
  env = { COMPANION_KV: makeKv(() => clock) };
});

const call = (method, path, { body, headers = {}, ip = '10.0.0.1', raw } = {}) => handle(new Request('http://relay.test' + path, {
  method,
  headers: { ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), 'CF-Connecting-IP': ip, ...headers },
  body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body)),
}), env, clock);
const json = async (r) => ({ status: r.status, ...(await r.json()) });
const open = (over = {}) => call('POST', '/companion/v1/pair', { body: { lookup: LOOKUP, publishHash: PUBLISH_HASH, blob: 'c2VhbGVk', ...over } });

describe('pairing input validation', () => {
  it('opens a pairing and returns the redeem deadline', async () => {
    const r = await json(await open());
    expect(r).toMatchObject({ status: 200, ok: true, pairExpires: clock + 5 * 60 * 1000 });
  });
  it('refuses a bad lookup, bad publish hash, and a missing, empty or oversized blob', async () => {
    for (const bad of [{ lookup: 'zz' }, { lookup: hex('A') }, { lookup: 5 }, { publishHash: 'short' }, { publishHash: undefined },
      { blob: '' }, { blob: 5 }, { blob: undefined }, { blob: 'x'.repeat(96 * 1024 + 1) }]) {
      expect((await open(bad)).status, JSON.stringify(Object.keys(bad))).toBe(400);
    }
  });
  it('refuses a body that is not a JSON object', async () => {
    for (const raw of ['not json', '[]', '"text"', 'null', '']) {
      expect((await call('POST', '/companion/v1/pair', { raw })).status, raw).toBe(400);
    }
  });
  it('refuses a body over 128 KiB', async () => {
    const r = await call('POST', '/companion/v1/pair', { raw: JSON.stringify({ x: 'y'.repeat(129 * 1024) }) });
    expect(r.status).toBe(413);
  });
  it('refuses to open a pairing that is already open', async () => {
    await open();
    expect((await open()).status).toBe(409);
  });
  it('clamps readTtl to 5 minutes .. 24 hours and ignores a non-integer', async () => {
    const ttl = async (readTtl) => {
      env.COMPANION_KV = makeKv(() => clock);
      await open({ readTtl });
      const redeemed = await json(await call('POST', '/companion/v1/redeem', { body: { lookup: LOOKUP } }));
      return Math.round((redeemed.expiresAt - clock) / 1000);
    };
    expect(await ttl(1)).toBe(300);
    expect(await ttl(10 ** 9)).toBe(86400);
    expect(await ttl(7200)).toBe(7200);
    expect(await ttl('1h')).toBe(3600);
    expect(await ttl(12.5)).toBe(3600);
  });
});

describe('redeeming the code', () => {
  it('works once, then answers like an unknown code', async () => {
    await open();
    const first = await json(await call('POST', '/companion/v1/redeem', { body: { lookup: LOOKUP } }));
    expect(first).toMatchObject({ status: 200, ok: true, blob: 'c2VhbGVk' });
    expect(first.readToken).toMatch(/^[a-f0-9]{64}$/);
    const second = await json(await call('POST', '/companion/v1/redeem', { body: { lookup: LOOKUP } }));
    expect(second).toEqual({ status: 404, error: 'Unknown or expired code' });
  });
  it('answers an unknown, malformed and expired code with the same 404', async () => {
    const unknown = await json(await call('POST', '/companion/v1/redeem', { body: { lookup: hex('c') } }));
    const malformed = await json(await call('POST', '/companion/v1/redeem', { body: { lookup: 'nope' } }));
    await open();
    clock += 5 * 60 * 1000 + 1;
    const expired = await json(await call('POST', '/companion/v1/redeem', { body: { lookup: LOOKUP } }));
    expect(malformed).toEqual(unknown);
    expect(expired).toEqual(unknown);
  });
  it('deletes an unredeemed pairing once the window passed', async () => {
    await open();
    clock += 5 * 60 * 1000 + 1;
    await call('POST', '/companion/v1/redeem', { body: { lookup: LOOKUP } });
    expect(await env.COMPANION_KV.get('p:' + LOOKUP)).toBeNull();
  });
  it('stores only hashes of the tokens, never the read token itself', async () => {
    await open();
    const { readToken } = await json(await call('POST', '/companion/v1/redeem', { body: { lookup: LOOKUP } }));
    const all = JSON.stringify([...env.COMPANION_KV.data.entries()]);
    expect(all).not.toContain(readToken);
    expect(all).not.toContain(TOKEN);
  });
});

describe('reading the snapshot', () => {
  async function paired() {
    await open();
    return (await json(await call('POST', '/companion/v1/redeem', { body: { lookup: LOOKUP } }))).readToken;
  }
  it('needs a well-formed bearer token that belongs to a live session', async () => {
    const readToken = await paired();
    const get = (token) => call('GET', '/companion/v1/snapshot', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    expect((await get()).status).toBe(401);
    expect((await get('short')).status).toBe(401);
    expect((await get(hex('d'))).status).toBe(401);
    const ok = await json(await get(readToken));
    expect(ok).toMatchObject({ status: 200, ok: true, blob: 'c2VhbGVk' });
  });
  it('ends when the session time is over', async () => {
    const readToken = await paired();
    clock += 3600 * 1000 + 1;
    const r = await call('GET', '/companion/v1/snapshot', { headers: { Authorization: 'Bearer ' + readToken } });
    expect(r.status).toBe(401);
  });
  it('shows the newest snapshot the desktop published', async () => {
    const readToken = await paired();
    const put = await call('PUT', '/companion/v1/snapshot', { headers: { 'X-Vex-Publish': TOKEN }, body: { lookup: LOOKUP, blob: 'bmV3ZXI=' } });
    expect(put.status).toBe(200);
    const r = await json(await call('GET', '/companion/v1/snapshot', { headers: { Authorization: 'Bearer ' + readToken } }));
    expect(r.blob).toBe('bmV3ZXI=');
  });
});

describe('publishing and revoking (desktop side)', () => {
  it('refuses a missing, malformed or wrong publish token and an unknown lookup', async () => {
    await open();
    const put = (headers, body) => call('PUT', '/companion/v1/snapshot', { headers, body });
    expect((await put({}, { lookup: LOOKUP, blob: 'x' })).status).toBe(401);
    expect((await put({ 'X-Vex-Publish': 'short' }, { lookup: LOOKUP, blob: 'x' })).status).toBe(401);
    expect((await put({ 'X-Vex-Publish': hex('e') }, { lookup: LOOKUP, blob: 'x' })).status).toBe(401);
    expect((await put({ 'X-Vex-Publish': TOKEN }, { lookup: hex('f'), blob: 'x' })).status).toBe(401);
    expect((await put({ 'X-Vex-Publish': TOKEN }, { lookup: 'nope', blob: 'x' })).status).toBe(401);
  });
  it('refuses an empty or oversized snapshot from the right desktop', async () => {
    await open();
    for (const blob of ['', 5, undefined, 'x'.repeat(96 * 1024 + 1)]) {
      const r = await call('PUT', '/companion/v1/snapshot', { headers: { 'X-Vex-Publish': TOKEN }, body: { lookup: LOOKUP, blob } });
      expect(r.status).toBe(400);
    }
  });
  it('revokes: the phone loses access at once', async () => {
    await open();
    const { readToken } = await json(await call('POST', '/companion/v1/redeem', { body: { lookup: LOOKUP } }));
    expect((await call('DELETE', '/companion/v1/pair', { headers: { 'X-Vex-Publish': hex('e') }, body: { lookup: LOOKUP } })).status).toBe(401);
    expect((await call('DELETE', '/companion/v1/pair', { headers: { 'X-Vex-Publish': TOKEN }, body: { lookup: LOOKUP } })).status).toBe(200);
    expect((await call('GET', '/companion/v1/snapshot', { headers: { Authorization: 'Bearer ' + readToken } })).status).toBe(401);
  });
});

describe('rate limits and routing', () => {
  it('limits pairings to 10 per client per 15 minutes, per client address', async () => {
    for (let i = 0; i < 10; i++) expect((await open({ lookup: String(i).repeat(64) })).status).toBe(200);
    expect((await open({ lookup: 'a'.repeat(64) })).status).toBe(429);
    const other = await call('POST', '/companion/v1/pair', { ip: '10.0.0.2', body: { lookup: 'a'.repeat(64), publishHash: PUBLISH_HASH, blob: 'x' } });
    expect(other.status).toBe(200);
    clock += 15 * 60 * 1000;                                  // a new window
    expect((await open({ lookup: 'b'.repeat(64) })).status).toBe(200);
  });
  it('limits redeem guesses to 20 per client per 15 minutes', async () => {
    for (let i = 0; i < 20; i++) expect((await call('POST', '/companion/v1/redeem', { body: { lookup: hex('c') } })).status).toBe(404);
    expect((await call('POST', '/companion/v1/redeem', { body: { lookup: hex('c') } })).status).toBe(429);
  });
  it('answers CORS preflight, 404 for other routes and methods, and 503 when the KV binding is missing', async () => {
    const pre = await call('OPTIONS', '/companion/v1/pair');
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('PUT');
    expect((await call('GET', '/companion/v1/pair')).status).toBe(404);
    expect((await call('POST', '/companion/v1/other', { body: {} })).status).toBe(404);
    expect((await call('PATCH', '/companion/v1/snapshot', { body: {} })).status).toBe(404);
    const noKv = await handle(new Request('http://relay.test/companion/v1/pair', { method: 'POST' }), {}, clock);
    expect(noKv.status).toBe(503);
  });
  it('sets no-store on every JSON answer', async () => {
    expect((await open()).headers.get('cache-control')).toBe('no-store');
  });
});

describe('the source keeps its promises', () => {
  it('has no console call (the relay writes no log line)', () => {
    const src = fs.readFileSync(new URL('../../workers/companion/worker.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/console\./);
  });
  it('turns Workers logs and traces off in wrangler.toml and ships no real KV id', () => {
    const toml = fs.readFileSync(new URL('../../workers/companion/wrangler.toml', import.meta.url), 'utf8');
    expect(toml).toMatch(/\[observability\]\s*\nenabled = false/);
    expect(toml).toContain('REPLACE_WITH_YOUR_KV_NAMESPACE_ID');
  });
});
