// src/main/status-check.js (T3-016): reads only the public status summaries the person listed.
import { describe, it, expect, vi } from 'vitest';

const { createStatusCheck, summaryUrl, parse } = require('../../src/main/status-check.js');

const doc = (indicator, description, incidents = []) => ({ page: { name: 'Discord' }, status: { indicator, description }, incidents });
const reply = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });

describe('the address', () => {
  it('turns a site into its summary document and nothing else', () => {
    expect(summaryUrl('discordstatus.com')).toBe('https://discordstatus.com/api/v2/summary.json');
    expect(summaryUrl('https://www.githubstatus.com/')).toBe('https://www.githubstatus.com/api/v2/summary.json');
    expect(summaryUrl('https://x.example/api/v2/status.json?token=1')).toBe('https://x.example/api/v2/status.json');
  });
  it('refuses http, logins, local hosts and pages inside a site', () => {
    expect(() => summaryUrl('http://x.example')).toThrow(/https/);
    expect(() => summaryUrl('https://u:p@x.example')).toThrow(/user name/);
    expect(() => summaryUrl('https://192.168.1.1')).toThrow(/local network/);
    expect(() => summaryUrl('https://localhost')).toThrow();
    expect(() => summaryUrl('https://x.example/some/page')).toThrow(/status site/);
    expect(() => summaryUrl('')).toThrow();
  });
});

describe('the reading', () => {
  it('keeps the state, the sentence and up to five incident names', () => {
    const r = parse(doc('minor', 'Partial outage', [{ name: 'Voice', impact: 'minor', status: 'investigating' }]));
    expect(r).toMatchObject({ name: 'Discord', indicator: 'minor', description: 'Partial outage' });
    expect(r.incidents).toEqual([{ name: 'Voice', impact: 'minor', status: 'investigating' }]);
  });
  it('throws for something that is not a status page', () => {
    expect(() => parse({})).toThrow(/not a status page/);
    expect(() => parse(doc('weird', 'x'))).toThrow(/unknown state/);
  });
});

describe('check()', () => {
  it('asks each listed page once with no credentials and says why one failed', async () => {
    const publicFetch = vi.fn(async (href) => (href.includes('down') ? Promise.reject(new Error('timeout')) : href.includes('bad') ? reply({}, 200) : reply(doc('none', 'All Systems Operational'))));
    const c = createStatusCheck({ publicFetch });
    const out = await c.check(['ok.example', 'down.example', 'bad.example']);
    expect(out[0]).toMatchObject({ ok: true, indicator: 'none' });
    expect(out[1]).toMatchObject({ ok: false });
    expect(out[1].error).toMatch(/Could not reach it: timeout/);
    expect(out[2].error).toMatch(/not a status page/);
    for (const call of publicFetch.mock.calls) expect(call[1]).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error' });
  });
  it('refuses an empty or oversized list and a bad address (not "the page is down")', async () => {
    const c = createStatusCheck({ publicFetch: vi.fn() });
    await expect(c.check([])).rejects.toThrow(/at least one/);
    await expect(c.check(Array(13).fill('a.example'))).rejects.toThrow(/At most 12/);
    await expect(c.check(['http://a.example'])).rejects.toThrow(/https/);
  });
  it('needs a public-only fetch', () => {
    expect(() => createStatusCheck({})).toThrow(/public-only fetch/);
  });
});
