// The version-review relay (workers/feedback/worker.js), run in memory against a fake KV.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeKv } from '../helpers/fakeKv.js';
import { handle, validateReview, LIMITS, cleanComment, sameSecret } from '../../workers/feedback/worker.js';

const ID = 'a'.repeat(32);
const good = (over = {}) => ({ installId: ID, version: '2.40.0', ratings: { speed: 4, ai: 2 }, chips: ['loved'], comment: 'Nice and quick', ...over });
let env, clock;
beforeEach(() => { clock = 1_800_000_000_000; env = { REVIEWS: makeKv(() => clock), ALLOWED_ORIGINS: 'null', ADMIN_TOKEN: 'admin-token-123456789' }; });

const call = (method, path, { body, token, origin, ip, type } = {}) => handle(new Request('http://relay.test' + path, {
  method,
  headers: {
    ...(body !== undefined ? { 'content-type': type || 'application/json' } : {}),
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
    ...(origin ? { Origin: origin } : {}),
    'CF-Connecting-IP': ip || '10.0.0.1',
  },
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
}), env, clock);
const json = async (r) => ({ status: r.status, ...(await r.json()) });

describe('validation', () => {
  it('accepts a good review', () => { expect(validateReview(good()).ok).toBe(true); });
  it('refuses unknown fields, bad ids, versions, ratings, tags and categories', () => {
    for (const bad of [
      good({ extra: 1 }), good({ installId: 'x' }), good({ version: '2.x' }), good({ ratings: { speed: 6 } }), good({ ratings: { speed: 0 } }),
      good({ ratings: { speed: 3.5 } }), good({ ratings: { color: 3 } }), good({ chips: ['nope'] }), good({ chips: ['bug', 'bug'] }), good({ comment: 5 }),
      good({ comment: 'x'.repeat(501) }), null, [], 'text',
    ]) expect(validateReview(bad).ok, JSON.stringify(bad)).toBe(false);
  });
  it('refuses an empty review but accepts a comment of 10+ characters alone', () => {
    expect(validateReview(good({ ratings: {}, chips: ['bug'], comment: '' })).ok).toBe(false);
    expect(validateReview(good({ ratings: {}, comment: 'short' })).ok).toBe(false);
    expect(validateReview(good({ ratings: {}, comment: 'long enough text' })).ok).toBe(true);
  });
  it('cleans control and bidi characters', () => { expect(cleanComment('  a\u0000b‮c  ')).toBe('abc'); });
  it('compares secrets', async () => { expect(await sameSecret('abc', 'abc')).toBe(true); expect(await sameSecret('abc', 'abd')).toBe(false); });
});

describe('POST /v1/review', () => {
  it('stores by version and replaces a repeat from the same install', async () => {
    expect(await json(await call('POST', '/v1/review', { body: good() }))).toMatchObject({ status: 200, ok: true, replaced: false });
    expect(await json(await call('POST', '/v1/review', { body: good({ ratings: { speed: 2 } }) }))).toMatchObject({ status: 200, replaced: true });
    const s = await json(await call('GET', '/v1/summary', { token: 'admin-token-123456789' }));
    expect(s.versions).toEqual([{ version: '2.40.0', count: 1, averages: { speed: { average: 2, count: 1 } } }]);
  });
  it('refuses a body over 2 KB, a wrong content type, bad JSON and bad schema', async () => {
    expect((await call('POST', '/v1/review', { body: good({ comment: '\u{1D49C}'.repeat(500) }) })).status).toBe(413);
    expect((await call('POST', '/v1/review', { body: 'x'.repeat(3000) })).status).toBe(413);
    expect((await call('POST', '/v1/review', { body: '{}', type: 'text/plain' })).status).toBe(415);
    expect((await call('POST', '/v1/review', { body: '{nope' })).status).toBe(400);
    expect((await call('POST', '/v1/review', { body: good({ x: 1 }) })).status).toBe(400);
  });
  it('rate limits per hashed sender and stores no raw address', async () => {
    for (let i = 0; i < LIMITS.POST_PER_HOUR; i++) expect((await call('POST', '/v1/review', { body: good({ installId: String(i).padStart(32, '0') }), ip: '203.0.113.9' })).status).toBe(200);
    expect((await call('POST', '/v1/review', { body: good(), ip: '203.0.113.9' })).status).toBe(429);
    expect((await call('POST', '/v1/review', { body: good({ installId: 'b'.repeat(32) }), ip: '203.0.113.10' })).status).toBe(200);
    for (const k of env.REVIEWS.data.keys()) expect(k).not.toContain('203.0.113');
    for (const v of env.REVIEWS.data.values()) expect(v.value).not.toContain('203.0.113');
  });
  it('only allows GET on the other endpoints and POST here', async () => {
    expect((await call('GET', '/v1/review')).status).toBe(405);
    expect((await call('POST', '/v1/summary', { body: {} })).status).toBe(405);
    expect((await call('GET', '/v1/other')).status).toBe(404);
  });
});

describe('reading', () => {
  beforeEach(async () => {
    await call('POST', '/v1/review', { body: good({ comment: 'secret words here' }) });
    await call('POST', '/v1/review', { body: good({ installId: 'c'.repeat(32), ratings: { speed: 2 } }) });
  });
  it('the summary has averages and counts but no comments, and is closed unless public or admin', async () => {
    expect((await call('GET', '/v1/summary')).status).toBe(401);
    const s = await call('GET', '/v1/summary', { token: 'admin-token-123456789' });
    const text = JSON.stringify(await s.json());
    expect(text).toContain('"count":2');
    expect(text).not.toContain('secret words');
    env.PUBLIC_SUMMARY = 'true';
    expect((await call('GET', '/v1/summary')).status).toBe(200);
  });
  it('the reviews with comments need the admin token; without a configured token they are closed', async () => {
    expect((await call('GET', '/v1/reviews?version=2.40.0')).status).toBe(401);
    expect((await call('GET', '/v1/reviews?version=2.40.0', { token: 'wrong-token-1234567890' })).status).toBe(401);
    const r = await json(await call('GET', '/v1/reviews?version=2.40.0', { token: 'admin-token-123456789' }));
    expect(r.reviews.length).toBe(2);
    expect(JSON.stringify(r)).toContain('secret words here');
    expect(JSON.stringify(r)).not.toContain(ID);
    expect((await call('GET', '/v1/reviews', { token: 'admin-token-123456789' })).status).toBe(400);
    delete env.ADMIN_TOKEN;
    expect((await call('GET', '/v1/reviews?version=2.40.0', { token: 'anything-at-all-123456' })).status).toBe(401);
  });
});

describe('CORS', () => {
  it('gives a browser page that is not on the list a bare 403 and answers the listed one', async () => {
    expect((await call('POST', '/v1/review', { body: good(), origin: 'https://evil.example' })).status).toBe(403);
    const r = await call('POST', '/v1/review', { body: good(), origin: 'null' });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('null');
    expect((await call('OPTIONS', '/v1/review', { origin: 'null' })).status).toBe(204);
  });
});
