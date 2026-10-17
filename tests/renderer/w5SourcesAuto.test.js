// @vitest-environment jsdom
// T3-002: arXiv/ISBN lookup through main, and auto-stamping clips and screenshots (opt in).
import { describe, it, expect, beforeEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let S;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  delete globalThis.VexLedger;
  globalThis.VexCiteStyles = fresh(JS + 'cite-styles.js').VexCiteStyles;
  ({ VexSources: S } = fresh(JS + 'sources.js'));
});

describe('lookups', () => {
  it('fills a source from arXiv, only through main, and not over what is typed elsewhere', async () => {
    const rec = S.normalize({ title: 'Old', url: 'https://arxiv.org/abs/2101.00001', arxiv: '2101.00001' });
    S._save([rec]);
    window.vex = { sourcesResolveId: vi.fn(async () => ({ ok: true, record: { kind: 'preprint', title: 'New title', authors: [{ family: 'L', given: 'A' }], date: '2021-01-01', doi: '10.1000/x', url: 'https://arxiv.org/abs/2101.00001' } })) };
    const out = await S.lookupId(rec.id, 'arxiv');
    expect(window.vex.sourcesResolveId).toHaveBeenCalledWith('arxiv', '2101.00001');
    expect(out).toMatchObject({ title: 'New title', doi: '10.1000/x', looked: true, url: 'https://arxiv.org/abs/2101.00001' });
  });
  it('fills a book from its ISBN and reports a refusal', async () => {
    const rec = S.normalize({ title: 'Old', isbn: '9780306406157', url: 'https://shop.example/b' });
    S._save([rec]);
    window.vex = { sourcesResolveId: vi.fn(async () => ({ ok: true, record: { kind: 'book', title: 'A Book', publisher: 'Press', date: '2001' } })) };
    expect(await S.lookupId(rec.id, 'isbn')).toMatchObject({ title: 'A Book', publisher: 'Press', url: 'https://shop.example/b' });
    window.vex = { sourcesResolveId: async () => ({ ok: false, error: 'Open Library does not know the ISBN' }) };
    await expect(S.lookupId(rec.id, 'isbn')).rejects.toThrow(/does not know/);
  });
  it('needs the id on the record and a known kind of lookup', async () => {
    const rec = S.normalize({ title: 'x', url: 'https://x.org/p' });
    S._save([rec]);
    await expect(S.lookupId(rec.id, 'arxiv')).rejects.toThrow(/no arXiv id/);
    await expect(S.lookupId(rec.id, 'isbn')).rejects.toThrow(/no ISBN/);
    await expect(S.lookupId(rec.id, 'doi')).rejects.toThrow(/Unknown lookup/);
    await expect(S.lookupId('nope', 'isbn')).rejects.toThrow(/gone/);
  });
});

describe('auto-stamp', () => {
  it('is off by default and a switch turns it on', () => {
    expect(S.prefs().autoStamp).toBe(false);
    S.setPrefs({ autoStamp: true });
    expect(S.prefs()).toMatchObject({ autoStamp: true, enabled: true });
    S.setPrefs({ style: 'mla' });
    expect(S.prefs().autoStamp).toBe(true);
  });
  it('a clip or a screenshot is kept under the page\'s source only when it is on', async () => {
    S.init();
    const keep = vi.spyOn(S, 'keepPassage').mockResolvedValue(null);
    document.dispatchEvent(new CustomEvent('vex:capture-taken', { detail: { kind: 'clip', text: 'a clipped line' } }));
    expect(keep).not.toHaveBeenCalled();
    S.setPrefs({ autoStamp: true });
    document.dispatchEvent(new CustomEvent('vex:capture-taken', { detail: { kind: 'clip', text: 'a clipped line' } }));
    document.dispatchEvent(new CustomEvent('vex:capture-taken', { detail: { kind: 'screenshot', text: 'Screenshot of this page' } }));
    document.dispatchEvent(new CustomEvent('vex:capture-taken', { detail: { kind: 'other', text: 'x' } }));
    expect(keep.mock.calls.map(c => c[0].kind)).toEqual(['clip', 'screenshot']);
  });
  it('Clip to Notes and the screenshot preview announce what they took', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/' + f), 'utf8');
    expect(read('readlater.js')).toContain("'vex:capture-taken'");
    expect(read('screenshot.js')).toContain("'vex:capture-taken'");
  });
});
