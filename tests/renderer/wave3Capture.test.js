// @vitest-environment jsdom
// Wave 3 capture and study: sources, archive on cite, media control, phone share, study notes,
// PDF highlights, PDF toolkit request, element zapper guards.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  globalThis.VexCiteStyles = fresh(JS + 'cite-styles.js').VexCiteStyles;
});

describe('sources (T3-002)', () => {
  it('reads citation meta tags into a record and never invents a field', () => {
    const { VexSources: S } = fresh(JS + 'sources.js');
    const raw = { title: 'Page', url: 'https://j.org/a?utm_source=x', canonical: 'https://j.org/a', lang: 'en', metas: {
      citation_title: ['A study'], citation_author: ['Smith, Jo', 'Lee Kim'], citation_publication_date: ['2020/03/05'], citation_journal_title: ['J. Tests'],
      citation_doi: ['10.1000/xyz'], citation_volume: ['3'], citation_firstpage: ['1'], citation_lastpage: ['9'] }, ld: [], times: [] };
    const r = S.fromPage(raw, { url: 'https://j.org/a?utm_source=x', now: new Date(2026, 9, 16).getTime() });
    expect(r).toMatchObject({ kind: 'article', title: 'A study', date: '2020-03-05', container: 'J. Tests', doi: '10.1000/xyz', pages: '1-9', url: 'https://j.org/a', accessed: '2026-10-16' });
    expect(r.authors).toEqual([{ family: 'Smith', given: 'Jo' }, { family: 'Kim', given: 'Lee' }]);
    expect(S.fromPage({}, { url: 'https://x.org/p', title: 'T' })).toMatchObject({ kind: 'webpage', authors: [], date: '', doi: '' });
  });
  it('matches a page by DOI or address, and keeps what the person edited', () => {
    const { VexSources: S } = fresh(JS + 'sources.js');
    const a = S.normalize({ title: 'Mine', url: 'https://x.org/p?utm_medium=z', edited: true, doi: '10.1/a' });
    expect(S.find([a], { url: 'https://x.org/p', doi: '' })).toBe(a);
    expect(S.find([a], { url: 'https://other.org', doi: '10.1/A' })).toBe(a);
    expect(S.merge(a, S.normalize({ title: 'Page title', url: a.url, authors: [{ family: 'N', given: 'M' }] })).title).toBe('Mine');
  });
  it('attaches each passage once, up to a limit, and reads a damaged list as an error', () => {
    const { VexSources: S } = fresh(JS + 'sources.js');
    const rec = S.normalize({ title: 'T', url: 'https://x.org/p' });
    S._save([rec]);
    expect(S.attach(rec.id, { text: 'one' })).toBeTruthy();
    expect(S.attach(rec.id, { text: 'one' })).toBe(null);
    for (let i = 0; i < 40; i++) S.attach(rec.id, { text: 'q' + i });
    expect(S.get(rec.id).items.length).toBe(S.MAX_ITEMS);
    localStorage.setItem(S.KEY, '{bad');
    expect(() => S.list()).toThrow(/could not be read/);
  });
  it('looks a DOI up only through the main process and fills the record', async () => {
    const { VexSources: S } = fresh(JS + 'sources.js');
    const rec = S.normalize({ title: 'Old', url: 'https://x.org/p', doi: '10.1/a' });
    S._save([rec]);
    window.vex = { sourcesResolveDoi: vi.fn(async () => ({ ok: true, record: { kind: 'article', title: 'New', authors: [{ family: 'A', given: 'B' }], container: 'J', date: '2019', oaUrl: '' } })) };
    const out = await S.lookupDoi(rec.id);
    expect(window.vex.sourcesResolveDoi).toHaveBeenCalledWith('10.1/a');
    expect(out).toMatchObject({ title: 'New', container: 'J', looked: true, url: 'https://x.org/p' });
    window.vex = { sourcesResolveDoi: async () => ({ ok: false, error: 'Crossref does not know it' }) };
    await expect(S.lookupDoi(rec.id)).rejects.toThrow(/does not know/);
    S.update(rec.id, { doi: '' });
    await expect(S.lookupDoi(rec.id)).rejects.toThrow(/no DOI/);
  });
});

describe('archive on cite (T3-112)', () => {
  it('fingerprints long lines only and flags a page that lost a fifth of them', () => {
    const { VexArchiveOnCite: A } = fresh(JS + 'archive-on-cite.js');
    const lines = Array.from({ length: 20 }, (_, i) => 'This is a long enough line of article text number ' + i + ' here.');
    const old = A.lineHashes(['Menu', 'Home', ...lines].join('\n'));
    expect(old.length).toBe(20);
    expect(A.changed(old, A.lineHashes(lines.join('\n'))).changed).toBe(false);
    expect(A.changed(old, A.lineHashes(lines.slice(0, 12).join('\n'))).changed).toBe(true);
    expect(A.changed(old.slice(0, 2), []).known).toBe(false);
  });
});

describe('media control (T3-015)', () => {
  it('lists only audible sources and mutes the others, not the one kept', () => {
    const { VexMediaControl: M } = fresh(JS + 'media-control.js');
    const rows = M.rows({ tabs: [{ id: 1, title: 'A', audible: true }, { id: 2, title: 'B', audible: true, muted: true }, { id: 3, title: 'C', audible: false }], panels: [{ name: 'spotify', label: 'Spotify', audible: true }] });
    expect(rows.map(r => r.id)).toEqual([1, 2, 'spotify']);
    expect(M.othersToMute(rows, { kind: 'tab', id: 1 }).map(r => r.id)).toEqual(['spotify']);
  });
  it('pauses and toggles the page players with its fixed script', () => {
    const { VexMediaControl: M } = fresh(JS + 'media-control.js');
    document.body.innerHTML = '<video id="a"></video><audio id="b"></audio>';
    for (const el of document.querySelectorAll('video,audio')) {
      el.__paused = false; Object.defineProperty(el, 'paused', { get() { return this.__paused; } });
      Object.defineProperty(el, 'duration', { value: 100 });
      el.pause = function () { this.__paused = true; }; el.play = function () { this.__paused = false; };
    }
    expect(new Function('return ' + M.mediaScript('pause'))()).toBe(2);
    expect(new Function('return ' + M.mediaScript('toggle'))()).toBe('playing');
  });
});

describe('phone share (T3-036)', () => {
  it('files only phone items into Clips when asked, and puts the card back on undo', async () => {
    const { VexPhoneShare: P } = fresh(JS + 'phone-share.js');
    let inbox = [{ id: 'h1', url: 'https://a.org/x', title: 'X', from: 'Pixel 8', at: 'z', receivedAt: 1, note: 'read this' }, { id: 'h2', url: 'https://b.org', title: 'B', from: 'Work PC', at: 'z', receivedAt: 1 }];
    globalThis.Handoff = { looksLikePhone: n => /pixel/i.test(n), inbox: () => inbox.slice(), take: id => { inbox = inbox.filter(i => i.id !== id); }, pushAll: () => 0, _save: l => { inbox = l; } };
    const added = [];
    window.vex = { clipsInboxAdd: async t => { added.push(t); return { ok: true, id: 'c1' }; }, clipsInboxRemove: async () => ({ ok: true }) };
    expect(await P.onFresh(inbox)).toEqual([]);                      // off by default
    P.setPrefs({ autoFile: true });
    expect(await P.onFresh(inbox.slice())).toEqual(['h1']);
    expect(added).toEqual(['X\nhttps://a.org/x\nread this']);
    expect(inbox.map(i => i.id)).toEqual(['h2']);
    await P.unfile('c1', { id: 'h1', url: 'https://a.org/x', title: 'X', from: 'Pixel 8', at: 'z', receivedAt: 1 });
    expect(inbox.map(i => i.id)).toContain('h1');
    expect(() => P.clipText({ title: 'no link' })).toThrow(/no link/);
  });
});

describe('study notes (T3-043)', () => {
  it('builds the Cornell layout and keeps each flagged question once', () => {
    const { VexStudyNotes: N } = fresh(JS + 'study-notes.js');
    const md = N.cornell({ title: 'Cells [intro]', url: 'https://x.org/c', cues: ['What is a ribosome?'], now: new Date(2026, 9, 16).getTime() });
    expect(md).toContain('## Cues and questions\n\n- What is a ribosome?');
    expect(md).toContain('Source: [Cells intro](https://x.org/c)');
    expect(md).toContain('Date: 2026-10-16');
    expect(N.addQuestion({ text: ' why   so? ', url: 'https://x.org/c', title: 'C' }).created).toBe(true);
    expect(N.addQuestion({ text: 'why so?', url: 'https://x.org/c', title: 'C' }).created).toBe(false);
    expect(N.openCount()).toBe(1);
    expect(N.forUrl('https://x.org/c#frag').length).toBe(1);
    expect(() => N.addQuestion({ text: '', url: 'https://x.org/c' })).toThrow(/Select the passage/);
  });
});

describe('PDF highlights (T3-064)', () => {
  it('keeps the page, builds a link that opens at it and cites p. N', () => {
    const { VexPdfHighlights: H } = fresh(JS + 'pdf-highlights.js');
    expect(H.pageFromUrl('https://x.org/a.pdf#page=14&zoom=100')).toBe(14);
    expect(H.pageFromUrl('https://x.org/a.pdf')).toBe(null);
    const { highlight, created } = H.add({ text: 'a passage', page: '14', url: 'https://x.org/a.pdf#page=3', title: 'Report' });
    expect(created).toBe(true);
    expect(highlight.url).toBe('https://x.org/a.pdf');
    expect(H.quoteMarkdown(highlight)).toContain('— [Report, p. 14](https://x.org/a.pdf#page=14)');
    expect(H.add({ text: 'a passage', page: 14, url: 'https://x.org/a.pdf', title: 'Report' }).created).toBe(false);
    expect(() => H.add({ text: 'x', page: 0, url: 'https://x.org/a.pdf' })).toThrow(/start at 1/);
    expect(H.forDoc('https://x.org/a.pdf#page=9').length).toBe(1);
  });
});

describe('PDF toolkit request (T3-117)', () => {
  it('asks main only for what the form allows', () => {
    const { VexPdfTools: T } = fresh(JS + 'pdf-tools-ui.js');
    const f = [{ token: 'a'.repeat(32), name: 'a.pdf', pages: 3 }];
    expect(() => T.buildRequest(f, { op: 'merge' })).toThrow(/at least two/);
    expect(T.buildRequest([...f, { token: 'b'.repeat(32) }], { op: 'merge' }).tokens.length).toBe(2);
    expect(() => T.buildRequest(f, { op: 'extract', spec: ' ' })).toThrow(/which pages/);
    expect(T.buildRequest(f, { op: 'rotate', degrees: '90' })).toMatchObject({ degrees: 90, spec: 'all' });
    expect(T.buildRequest(f, { op: 'split', mode: 'every', n: '2' })).toMatchObject({ mode: 'every', n: 2 });
    expect(() => T.buildRequest([...f, f[0]], { op: 'split', mode: 'each' })).toThrow(/one PDF/);
  });
});

describe('element zapper guards (T3-090)', () => {
  it('refuses banking, sign-in and payment pages and unsafe selectors', () => {
    const { VexPageSensitivity: S } = fresh(JS + 'page-sensitivity.js');
    globalThis.VexPageSensitivity = S;
    expect(S.reason('https://www.mybank.com/home')).toMatch(/banking/);
    expect(S.reason('https://shop.example.com/checkout')).toMatch(/payment/);
    expect(S.reason('https://news.example.com/story')).toBe(null);
    const { VexBoosts: B } = fresh(JS + 'boosts.js');
    expect(B.safeSelector('div.ad > a:nth-of-type(2)')).toBe(true);
    expect(B.safeSelector('a{color:red}')).toBe(false);
    B.boosts = { 'news.example.com': { zaps: ['.ad', 'x}body{display:none'], css: '', js: '' } };
    const css = [];
    const wv = { insertCSS: async c => { css.push(c); return 'k'; }, removeInsertedCSS: async () => {} };
    B.applyTo(wv, 'https://news.example.com/story');
    B.applyTo(wv, 'https://news.example.com/login');
    return B._wvChain || Promise.resolve().then(() => wv._vexBoostCss).then(() => {
      expect(css.length).toBe(1);
      expect(css[0]).toContain('.ad{');
      expect(css[0]).not.toContain('body{display');
    });
  });
  it('removes and restores one hidden element', () => {
    const { VexBoosts: B } = fresh(JS + 'boosts.js');
    B.boosts = { 'a.com': { zaps: ['.x', '.y'], css: '', js: '' } };
    expect(B.removeZap('a.com', '.x')).toBe(1);
    expect(() => B.removeZap('a.com', '.x')).toThrow(/not hidden/);
    expect(B.addZap('a.com', '.x')).toBe(2);
    expect(() => B.addZap('a.com', '.z}')).toThrow(/not a safe/);
  });
});
