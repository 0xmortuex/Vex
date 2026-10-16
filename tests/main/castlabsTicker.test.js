import { describe, it, expect } from 'vitest';

const { createCastlabsTicker, compare, parseTags } = require('../../src/main/castlabs-ticker');

const tag = (n) => ({ name: n });
const TAGS = ['v42.5.2+wvcus', 'v42.11.0+wvcus', 'v42.12.1+wvcus', 'v42.14.0+wvcus', 'v43.0.0+wvcus', 'v41.9.9+wvcus', 'nightly', 'v42.99.0-beta'].map(tag);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => Buffer.from(JSON.stringify(body)) });

describe('compare', () => {
  it('counts releases newer on the same major and mentions a newer major', () => {
    const r = compare('42.11.0', parseTags(TAGS));
    expect(r).toMatchObject({ pinned: '42.11.0', behind: 2, latestSameMajor: '42.14.0', latest: '43.0.0', newerMajor: 1, pinnedListed: true });
  });
  it('is zero behind when current', () => {
    expect(compare('42.14.0', parseTags(TAGS)).behind).toBe(0);
  });
  it('ignores tags that are not castLabs wvcus releases', () => {
    expect(parseTags(TAGS)).toHaveLength(6);
  });
  it('refuses an empty list and a missing version', () => {
    expect(() => compare('42.1.0', [])).toThrow(/No castLabs releases/);
    expect(() => compare('', parseTags(TAGS))).toThrow(/does not report/);
  });
});

describe('ticker', () => {
  it('asks GitHub once per six hours, without credentials', async () => {
    let t = 1000;
    const calls = [];
    const tk = createCastlabsTicker({ fetch: async (u, init) => { calls.push({ u, init }); return res(200, TAGS); }, versions: { electron: '42.11.0', chrome: '148.0.1' }, now: () => t });
    const a = await tk.check();
    t += 60000;
    await tk.check();
    expect(calls).toHaveLength(1);
    expect(calls[0].u).toMatch(/^https:\/\/api\.github\.com\/repos\/castlabs\/electron-releases\/tags/);
    expect(calls[0].init.credentials).toBe('omit');
    expect(JSON.stringify(calls[0].init.headers)).not.toMatch(/authorization/i);
    expect(a.behind).toBe(2);
    t += 7 * 3600 * 1000;
    await tk.check();
    expect(calls).toHaveLength(2);
  });
  it('raises a failure instead of saying 0 behind', async () => {
    const tk = createCastlabsTicker({ fetch: async () => res(500, {}), versions: { electron: '42.11.0' } });
    await expect(tk.check()).rejects.toThrow(/answered 500/);
    const rl = createCastlabsTicker({ fetch: async () => res(403, {}), versions: { electron: '42.11.0' } });
    await expect(rl.check()).rejects.toThrow(/limiting/);
  });
});
