// @vitest-environment node
// The privacy report card's cookie half: what sites kept, what was set this
// week (counted from change events, never names or values), and the cleanup.
import { describe, it, expect, vi } from 'vitest';

const { baseDomain, summarizeCookies, createCookieTally, createPrivacyReport } = require('../../src/main/privacy-report.js');

const DAY = 24 * 3600 * 1000;
const memStore = () => {
  const m = new Map();
  return { read: async (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null), write: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); return true; }, m };
};

describe('baseDomain', () => {
  it('reduces a host to the site', () => {
    expect(baseDomain('.ads.tracker.example.com')).toBe('example.com');
    expect(baseDomain('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(baseDomain('localhost')).toBe('localhost');
    expect(baseDomain('10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('summarizeCookies', () => {
  const now = Date.UTC(2026, 9, 16);
  const cookies = [
    { domain: '.track.net', name: 'a', secure: true, session: false, expirationDate: now / 1000 + 400 * 86400 },
    { domain: 'sub.track.net', name: 'b', secure: false, session: true },
    { domain: 'news.example.org', name: 'c', secure: true, session: true },
  ];
  it('counts per site, flags trackers and puts them first', () => {
    const s = summarizeCookies(cookies, { trackerHosts: ['cdn.track.net'], now });
    expect(s.total).toBe(3);
    expect(s.sites[0]).toMatchObject({ domain: 'track.net', count: 2, tracker: true, longLived: 1, insecure: 1 });
    expect(s.sites[1]).toMatchObject({ domain: 'example.org', tracker: false });
    expect(s.trackerCookies).toBe(2);
  });
  it('ignores junk rows', () => {
    expect(summarizeCookies([null, {}, { domain: 5 }]).total).toBe(0);
  });
});

describe('cookie tally', () => {
  it('counts only cookies being set, by site, with no names or values', async () => {
    const store = memStore();
    let t = Date.UTC(2026, 9, 16, 12);
    const tally = createCookieTally({ store, now: () => t, setTimer: () => null, clearTimer: () => {} });
    expect(await tally.record({ domain: '.a.example', name: 'secret', value: 'xyz' }, 'explicit', false)).toBe(true);
    expect(await tally.record({ domain: 'a.example' }, 'explicit', false)).toBe(true);
    expect(await tally.record({ domain: 'a.example' }, 'expired', true)).toBe(false);
    expect(await tally.record({ domain: 'a.example' }, 'overwrite', false)).toBe(false);
    await tally.flush();
    const saved = JSON.stringify([...store.m.values()]);
    expect(saved).toContain('"a.example":2');
    expect(saved).not.toContain('secret');
    expect(saved).not.toContain('xyz');
    t += DAY;
    const w = await tally.week(7);
    expect(w).toHaveLength(7);
    expect(w[5].sites).toEqual({ 'a.example': 2 });
  });
});

describe('report and cleanup', () => {
  const mkJar = (list) => ({ get: vi.fn(async () => list.slice()), remove: vi.fn(async () => {}) });
  const cookies = [
    { domain: '.track.net', name: 'id', path: '/', secure: true, session: true },
    { domain: 'sub.track.net', name: 'x', path: '/p', secure: false, session: true },
    { domain: 'keep.org', name: 'sess', path: '/', secure: true, session: true },
  ];

  it('says fingerprinting is not detectable rather than showing a number', async () => {
    const r = await createPrivacyReport({ getCookieJar: () => mkJar(cookies), trackerHosts: () => ['track.net'] }).report();
    expect(r.fingerprinting.detectable).toBe(false);
    expect(r.stored.trackerCookies).toBe(2);
  });

  it('removes only the named sites, building each cookie url from its scheme and path', async () => {
    const jar = mkJar(cookies);
    const res = await createPrivacyReport({ getCookieJar: () => jar }).clean(['track.net']);
    expect(res.removed).toBe(2);
    expect(jar.remove).toHaveBeenCalledWith('https://track.net/', 'id');
    expect(jar.remove).toHaveBeenCalledWith('http://sub.track.net/p', 'x');
    expect(jar.remove).not.toHaveBeenCalledWith(expect.stringContaining('keep.org'), expect.anything());
  });

  it('reports a cookie it could not remove instead of hiding it', async () => {
    const jar = mkJar(cookies);
    jar.remove.mockRejectedValueOnce(new Error('locked'));
    const res = await createPrivacyReport({ getCookieJar: () => jar, log: () => {} }).clean(['track.net']);
    expect(res.removed).toBe(1);
    expect(res.failed).toEqual(['.track.net']);
  });

  it('refuses an empty or oversized list', async () => {
    const r = createPrivacyReport({ getCookieJar: () => mkJar([]) });
    await expect(r.clean([])).rejects.toThrow(/at least one/);
    await expect(r.clean(Array.from({ length: 51 }, (_, i) => 's' + i + '.com'))).rejects.toThrow(/Too many/);
  });
});
