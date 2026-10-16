// The shared polite fetch (src/main/polite-fetch.js, T3-030), against a stand-in fetch and a fake clock.
import { describe, it, expect } from 'vitest';

const { createPoliteFetch } = require('../../src/main/polite-fetch');

function clock() {
  let t = 1_000_000;
  const slept = [];
  return { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, slept, advance: (ms) => { t += ms; } };
}
function res(status, body = 'x', headers = {}) { return new Response(status === 304 ? null : body, { status, headers }); }
function make(handler, extra = {}) {
  const c = clock();
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); };
  const polite = createPoliteFetch({ fetch, userAgent: 'Vex/test', now: c.now, sleep: c.sleep, random: () => 0.5, ...extra });
  return { polite, calls, c };
}

describe('polite fetch', () => {
  it('needs a fetch and a User-Agent', () => {
    expect(() => createPoliteFetch({ userAgent: 'x' })).toThrow(/needs a fetch/);
    expect(() => createPoliteFetch({ fetch: async () => res(200) })).toThrow(/User-Agent/);
  });

  it('adds the User-Agent unless the caller set one', async () => {
    const { polite, calls } = make(() => res(200));
    await polite('https://a.test/1');
    await polite('https://a.test/2', { headers: { 'User-Agent': 'Mine' } });
    expect(new Headers(calls[0].init.headers).get('user-agent')).toBe('Vex/test');
    expect(new Headers(calls[1].init.headers).get('user-agent')).toBe('Mine');
  });

  it('spends a token per request and waits for the next one, per host', async () => {
    const { polite, c } = make(() => res(200), { burst: 2, perMinute: 60 });
    await polite('https://a.test/1'); await polite('https://a.test/2');
    expect(c.slept).toEqual([]);
    await polite('https://a.test/3');
    expect(c.slept.length).toBe(1);
    expect(c.slept[0]).toBeGreaterThan(900);
    await polite('https://b.test/1');             // another host has its own bucket
    expect(c.slept.length).toBe(1);
  });

  it('says so, instead of queueing for ever, when the wait is too long', async () => {
    const { polite } = make(() => res(200), { burst: 1, perMinute: 1, maxWaitMs: 5000 });
    await polite('https://a.test/1');
    await expect(polite('https://a.test/2')).rejects.toThrow(/Too many requests to a\.test/);
  });

  it('retries a 429 after Retry-After, then returns the answer', async () => {
    const { polite, calls, c } = make((u, i, n) => (n === 1 ? res(429, '', { 'Retry-After': '2' }) : res(200, 'ok')));
    const r = await polite('https://a.test/x');
    expect(r.status).toBe(200);
    expect(calls.length).toBe(2);
    expect(c.slept).toContain(2000);
  });

  it('gives up after the retries, hands back the 429, and leaves the host alone for a while', async () => {
    const { polite, calls } = make(() => res(429, '', { 'Retry-After': '1' }), { retries: 1 });
    const r = await polite('https://a.test/x');
    expect(r.status).toBe(429);
    expect(calls.length).toBe(2);
    expect(polite.stats().backoffs).toBe(2);
  });

  it('refuses a host that asked for a long wait', async () => {
    const { polite } = make(() => res(503, '', { 'Retry-After': '600' }), { maxWaitMs: 5000, maxBackoffMs: 600000 });
    const first = await polite('https://a.test/x');
    expect(first.status).toBe(503);
    await expect(polite('https://a.test/y')).rejects.toThrow(/asked to be left alone/);
  });

  it('revalidates with ETag and answers a 304 from the cache', async () => {
    const { polite, calls } = make((u, init, n) => (n === 1 ? res(200, 'hello', { ETag: '"v1"' }) : res(304)));
    const a = await polite('https://a.test/p');
    expect(await a.text()).toBe('hello');
    const b = await polite('https://a.test/p');
    expect(new Headers(calls[1].init.headers).get('if-none-match')).toBe('"v1"');
    expect(b.status).toBe(200);
    expect(b.headers.get('x-vex-cache')).toBe('revalidated');
    expect(await b.text()).toBe('hello');
    expect(polite.stats().revalidated).toBe(1);
  });

  it('answers from the cache without asking while ttlMs holds', async () => {
    const { polite, calls, c } = make(() => res(200, 'fresh'));
    await polite('https://a.test/p', { polite: { ttlMs: 60000 } });
    c.advance(1000);
    const b = await polite('https://a.test/p', { polite: { ttlMs: 60000 } });
    expect(calls.length).toBe(1);
    expect(b.headers.get('x-vex-cache')).toBe('fresh');
  });

  it('never caches a POST', async () => {
    const { polite, calls } = make(() => res(200, 'x', { ETag: '"e"' }));
    await polite('https://a.test/p', { method: 'POST', body: '{}' });
    await polite('https://a.test/p', { method: 'POST', body: '{}' });
    expect(calls.length).toBe(2);
    expect(new Headers(calls[1].init.headers).get('if-none-match')).toBe(null);
  });

  it('evicts the least recently used entry over the entry limit', async () => {
    const { polite } = make((u) => res(200, 'b', { ETag: '"' + u + '"' }), { maxEntries: 2 });
    await polite('https://a.test/1'); await polite('https://a.test/2'); await polite('https://a.test/3');
    expect(polite.stats().cacheEntries).toBe(2);
  });

  it('skips a background request on a metered connection, and asks Windows only once in a while', async () => {
    let asked = 0;
    const { polite, calls } = make(() => res(200), { metered: async () => { asked++; return true; } });
    await expect(polite('https://a.test/1', { polite: { background: true } })).rejects.toThrow(/metered/);
    await expect(polite('https://a.test/2', { polite: { background: true } })).rejects.toThrow(/metered/);
    expect(asked).toBe(1);
    await polite('https://a.test/3');            // not a background request: goes
    expect(calls.length).toBe(1);
  });

  it('treats "could not tell" as not metered, and says so once', async () => {
    const lines = [];
    const { polite } = make(() => res(200), { metered: async () => { throw new Error('no powershell'); }, log: (l) => lines.push(l) });
    await polite('https://a.test/1', { polite: { background: true } });
    expect(lines.length).toBe(1);
  });

  it('waits a random part of jitterMs before a polled request', async () => {
    const { polite, c } = make(() => res(200));
    await polite('https://a.test/1', { polite: { jitterMs: 10000 } });
    expect(c.slept).toContain(5000);
  });
});
