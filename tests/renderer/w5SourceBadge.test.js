// @vitest-environment jsdom
// T3-115: the chip beside the address bar (opt in) and the short predatory-publisher list.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let S;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  document.body.innerHTML = '<div id="url-bar"><button id="url-site-btn"></button><input id="url-input"></div>';
  globalThis.VexStudyKit = fresh(JS + 'study-kit.js').VexStudyKit;
  ({ VexSourceBadge: S } = fresh(JS + 'source-badge.js'));
});

const base = { url: 'https://journal.example.edu/paper', date: new Date().toISOString(), author: true, outLinks: 5, refs: true };

describe('predatory publisher match', () => {
  it('matches a listed host and its subdomains, and a listed publisher name', () => {
    expect(S.predatoryMatch('www.omicsonline.org', '')).toBe('omicsonline.org');
    expect(S.predatoryMatch('articles.scirp.org', '')).toBe('scirp.org');
    expect(S.predatoryMatch('x.org', 'OMICS International')).toBe('omics international');
    expect(S.predatoryMatch('nature.com', 'Springer Nature')).toBe(null);
    expect(S.predatoryMatch('notscirp.org', '')).toBe(null);
  });
  it('adds a flag with a plain "check it" sentence, first in the list', () => {
    const r = S.assess({ ...base, url: 'https://www.omicsonline.org/a' });
    expect(r.flags[0].id).toBe('predatory');
    expect(r.flags[0].label).toMatch(/Check the journal in DOAJ/);
    expect(S.assess(base).flags.some(f => f.id === 'predatory')).toBe(false);
  });
  it('uses the publisher tag, and your own additions', () => {
    expect(S.assess({ ...base, publisher: 'Scientific Research Publishing Inc.' }).flags[0].id).toBe('predatory');
    S.addPredatory('https://www.bad-journals.com/path');
    expect(S.extraPredatory()).toEqual(['bad-journals.com']);
    expect(S.assess({ ...base, url: 'https://x.bad-journals.com/a' }).flags[0].id).toBe('predatory');
    expect(() => S.addPredatory('not a site')).toThrow(/like example-journals.com/);
  });
  it('reports a damaged own list instead of hiding it', () => {
    localStorage.setItem(S.PREDATORY_KEY, '{nope');
    expect(S.assess(base).flags.some(f => f.id === 'list-error')).toBe(true);
  });
  it('asks the page for its publisher and journal', () => {
    document.head.innerHTML = '<meta name="citation_publisher" content="Some Press"><meta name="citation_journal_title" content="J Things">';
    const { vexSourcePageLib } = fresh(JS + 'source-badge.js');
    const f = vexSourcePageLib();
    expect(f.publisher).toBe('Some Press');
    expect(f.journal).toBe('J Things');
  });
});

describe('the chip', () => {
  it('summarises the flags', () => {
    expect(S.chipSummary({ flags: [{ id: 'a', tone: 'good', label: 'x' }] }).text).toBe('Source: no flags');
    expect(S.chipSummary({ flags: [{ id: 'a', tone: 'warn', label: 'x' }, { id: 'b', tone: 'warn', label: 'y' }] }).text).toBe('Source: 2 to check');
    expect(S.chipSummary({ flags: [{ id: 'predatory', tone: 'warn', label: 'z' }] }).text).toBe('Source: check publisher');
  });
  it('is off until switched on: nothing is drawn or read', async () => {
    const exec = vi.fn();
    globalThis.TabManager = { getActiveTab: () => ({ id: 't', url: 'https://a.com/x' }) };
    globalThis.WebviewManager = { getActiveWebview: () => ({ executeJavaScript: exec, getURL: () => 'https://a.com/x' }) };
    expect(S.chipEnabled()).toBe(false);
    expect(await S.refreshChip()).toBe(null);
    expect(exec).not.toHaveBeenCalled();
    expect(document.getElementById('vex-sb-chip')).toBe(null);
  });
  it('draws one chip after the site button when on, and removes it with the switch', async () => {
    const wv = { executeJavaScript: vi.fn(async () => ({ title: 'T', date: '', author: false, outLinks: 0, refs: false, opinionTag: false, publisher: '', journal: '' })), getURL: () => 'https://a.com/x' };
    globalThis.TabManager = { getActiveTab: () => ({ id: 't', url: 'https://a.com/x' }) };
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    localStorage.setItem(S.CHIP_KEY, 'on');
    const s = await S.refreshChip();
    expect(s.tone).toBe('warn');
    const chips = document.querySelectorAll('#vex-sb-chip');
    expect(chips).toHaveLength(1);
    expect(document.getElementById('url-site-btn').nextElementSibling.id).toBe('vex-sb-chip');
    await S.refreshChip();
    expect(document.querySelectorAll('#vex-sb-chip')).toHaveLength(1);
    S.setChip(false);
    expect(document.getElementById('vex-sb-chip')).toBe(null);
  });
  it('skips a private tab and a non-web page', async () => {
    const exec = vi.fn();
    globalThis.WebviewManager = { getActiveWebview: () => ({ executeJavaScript: exec }) };
    localStorage.setItem(S.CHIP_KEY, 'on');
    globalThis.TabManager = { getActiveTab: () => ({ id: 't', url: 'file:///x' }) };
    expect(await S.refreshChip()).toBe(null);
    globalThis.TabManager = { getActiveTab: () => ({ id: 't', url: 'https://a.com/x', private: true }) };
    window.VexTabPolicy = { canRestore: () => false };
    expect(await S.refreshChip()).toBe(null);
    expect(exec).not.toHaveBeenCalled();
    delete window.VexTabPolicy;
  });
});
