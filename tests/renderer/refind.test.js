// @vitest-environment jsdom
//
// T2-016: time-scoped and natural-language re-find (js/refind.js) on top of the lost-tab finder.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const NOW = new Date(2026, 9, 14, 14, 0, 0).getTime();
const H = 3600000;

let R;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  globalThis.LostTabFinder = fresh(JS + 'lost-tab-finder.js').LostTabFinder;
  ({ VexRefind: R } = fresh(JS + 'refind.js'));
  delete globalThis.Recall;
});

const src = (over = {}) => ({
  history: () => [], recall: async () => ({ hits: [] }), notes: () => [], readLater: () => [], highlights: () => ({}), clips: async () => [], ...over,
});

describe('parse()', () => {
  it('reads "in the last 2 hours" and the colon form', () => {
    const a = R.parse('cookies in the last 2 hours', NOW);
    expect(a.terms).toEqual(['cookies']);
    expect(a.since).toBe(NOW - 2 * H);
    expect(R.parse('h: last 30 min: dpi scaling', NOW)).toMatchObject({ terms: ['dpi', 'scaling'], since: NOW - 30 * 60000 });
    expect(R.parse('past hour websocket', NOW).since).toBe(NOW - H);
  });
  it('reads "since monday" and "since 3pm"', () => {
    expect(R.parse('react since monday', NOW).since).toBe(new Date(2026, 9, 12).getTime());
    expect(R.parse('react since 3pm', NOW).since).toBe(new Date(2026, 9, 13, 15).getTime());   // 15:00 today is ahead of 14:00: yesterday
  });
  it('still reads what the finder read', () => {
    expect(R.parse('that page about DPI last week', NOW)).toMatchObject({ terms: ['dpi'], label: 'the last two weeks' });
  });
  it('takes a host and an anchor out of the words', () => {
    const p = R.parse('that XSS article on stackoverflow.com from around the Discord fix', NOW);
    expect(p.site).toBe('stackoverflow.com');
    expect(p.anchor).toBe('discord fix');
    expect(p.terms).toEqual(['xss']);
  });
  it('refuses a span it cannot use', () => {
    expect(() => R.parse('x in the last 5000 hours', NOW)).toThrow(/not a span/);
  });
});

describe('find()', () => {
  const hist = [
    { url: 'https://a.test/xss', title: 'XSS cheat sheet', visitedAt: new Date(NOW - 1 * H).toISOString() },
    { url: 'https://a.test/old', title: 'XSS history', visitedAt: new Date(NOW - 30 * H).toISOString() },
    { url: 'https://c.onion/x', title: 'XSS onion', visitedAt: new Date(NOW - 1 * H).toISOString() },
  ];

  it('scopes history to the time window and never shows an onion address', async () => {
    const r = await R.find('xss in the last 3 hours', { now: NOW, src: src({ history: () => hist }) });
    expect(r.rows.map(x => x.url)).toEqual(['https://a.test/xss']);
  });
  it('looks through notes, read-later, highlights and clips as well, each saying where it came from', async () => {
    const t = new Date(NOW - H).toISOString();
    const r = await R.find('cookies', {
      now: NOW,
      src: src({
        notes: () => [{ id: 'n1', title: 'Cookie notes', content: 'about cookies and consent', updatedAt: t }],
        readLater: () => [{ id: 'r1', url: 'https://b.test/cookies', title: 'All about cookies', at: NOW - H }],
        highlights: () => ({ k: [{ id: 'h', text: 'cookies expire', title: 'Spec', url: 'https://d.test/', at: NOW - H }] }),
        clips: async () => [{ id: 'c', text: 'remember cookies banner', at: NOW - H }],
      }),
    });
    expect(r.rows.map(x => x.where).sort()).toEqual(['Clip', 'Highlight', 'Note', 'Read later']);
    expect(r.errors).toEqual([]);
  });
  it('merges the same page from history and from page text into one row', async () => {
    const r = await R.find('xss', {
      now: NOW,
      src: src({
        history: () => [hist[0]],
        recall: async () => ({ hits: [{ url: 'https://a.test/xss', title: 'XSS cheat sheet', at: NOW - H, snippet: 'reflected xss' }] }),
      }),
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].wheres.sort()).toEqual(['History', 'Page text']);
  });
  it('limits to a site, and then leaves notes out', async () => {
    const r = await R.find('xss on a.test', { now: NOW, src: src({ history: () => [hist[0], { url: 'https://z.test/xss', title: 'XSS elsewhere', visitedAt: new Date(NOW - H).toISOString() }], notes: () => [{ id: 'n', title: 'xss', content: 'xss', updatedAt: new Date(NOW - H).toISOString() }] }) });
    expect(r.rows.map(x => x.url)).toEqual(['https://a.test/xss']);
  });
  it('names a store that cannot be read and still answers from the rest', async () => {
    const r = await R.find('xss', { now: NOW, src: src({ history: () => hist.slice(0, 1), notes: () => { throw new Error('"vex.notes" could not be read'); } }) });
    expect(r.rows).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^notes: /);
  });
  it('anchors on the thing after "around" and scopes to two days either side', async () => {
    const fixAt = NOW - 10 * 86400000;
    const history = [
      { url: 'https://github.com/x/pull/9', title: 'Fix Discord screen share', visitedAt: new Date(fixAt).toISOString() },
      { url: 'https://a.test/xss-near', title: 'XSS writeup', visitedAt: new Date(fixAt + 3600000).toISOString() },
      { url: 'https://a.test/xss-far', title: 'XSS other', visitedAt: new Date(NOW - H).toISOString() },
    ];
    const r = await R.find('that XSS article from around the Discord fix', { now: NOW, src: src({ history: () => history }) });
    expect(r.anchored.title).toMatch(/Fix Discord/);
    expect(r.rows.map(x => x.url)).toEqual(['https://a.test/xss-near']);
    expect(r.parsed.label).toMatch(/^around "Fix Discord/);
  });
  it('says so when the anchor is not in history or notes', async () => {
    await expect(R.find('xss around the moon landing', { now: NOW, src: src() })).rejects.toThrow(/Could not find "moon landing"/);
  });
  it('asks for something to look for', async () => {
    await expect(R.find('the', { now: NOW, src: src() })).rejects.toThrow(/Say what you are after/);
  });
  it('never calls a cloud model: the file does not mention the AI router', async () => {
    const text = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/refind.js'), 'utf8');
    expect(text).not.toMatch(/AIRouter|searchSmart/);
  });
  it('refuses when switched off', async () => {
    R.setEnabled(false);
    await expect(R.find('xss', { now: NOW, src: src() })).rejects.toThrow(/switched off/);
  });
});

describe('the Ctrl+K prefix', () => {
  it('answers only to h:', async () => {
    const p = R.provider();
    expect(p.search('cookies')).toEqual([]);
    expect(p.search('h:')[0].id).toBe('refind-hint');
  });
});
