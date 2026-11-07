// @vitest-environment jsdom
// W4 I1: research brief -> Sources records -> dossier items -> position-paper bibliography.
import { describe, it, expect, beforeEach } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let S, D, T;
beforeEach(() => {
  localStorage.clear();
  delete globalThis.VexPageSensitivity; delete globalThis.VexUsage;
  globalThis.vexId = (prefix = '') => prefix + Math.random().toString(36).slice(2, 10);
  globalThis.VexCiteStyles = fresh(JS + 'cite-styles.js').VexCiteStyles;
  globalThis.VexSources = S = fresh(JS + 'sources.js').VexSources;
  globalThis.VexMunDossier = D = fresh(JS + 'mun-dossier.js').VexMunDossier;
  ({ VexMunToolkit: T } = fresh(JS + 'mun-toolkit.js'));
});

describe('saveFromBrief', () => {
  const pages = [{ title: 'UN report on water', url: 'https://un.org/water?utm_source=x' }, { title: 'Other', url: 'https://other.org/a' }, { title: 'Bad', url: 'vex://start' }];
  it('keeps each web page once, skips what is not a web page, never duplicates by address', () => {
    const r = S.saveFromBrief(pages);
    expect(r).toMatchObject({ created: 2, existing: 0, skipped: 1 });
    expect(S.list()).toHaveLength(2);
    const again = S.saveFromBrief([{ title: 'Same page', url: 'https://un.org/water' }]);
    expect(again).toMatchObject({ created: 0, existing: 1 });
    expect(S.list()).toHaveLength(2);
    expect(again.ids[0]).toBe(r.ids[0]);
  });
  it('refuses when Sources is switched off and skips a sensitive page', () => {
    S.setEnabled(false);
    expect(() => S.saveFromBrief(pages)).toThrow(/switched off/);
    S.setEnabled(true);
    globalThis.VexPageSensitivity = { reason: (u) => (u.includes('other.org') ? 'bank' : null) };
    expect(S.saveFromBrief(pages)).toMatchObject({ created: 1, skipped: 2 });
  });
  it('allText with ids writes only those records; without ids, all of them (unchanged)', () => {
    const r = S.saveFromBrief(pages);
    expect(S.allText('apa').count).toBe(2);
    expect(S.allText('apa', [r.ids[0]]).count).toBe(1);
    expect(S.allText('apa', []).count).toBe(0);
  });
});

describe('dossier items that point at a source', () => {
  it('an item takes its address and title from the record, and still accepts free text', () => {
    const { ids } = S.saveFromBrief([{ title: 'UN report on water', url: 'https://un.org/water' }]);
    const d = D.create({ country: 'Brazil', topic: 'Water' });
    expect(D.addItem(d.id, 'position', { text: 'Backs the treaty', source: { sourceId: ids[0] } }).added).toBe(true);
    expect(D.addItem(d.id, 'votes', { text: 'Voted yes', source: 'A/RES/78/1 (2023)' }).added).toBe(true);
    const got = D.get(d.id);
    expect(got.sections.position[0].source).toEqual({ url: 'https://un.org/water', title: 'UN report on water', sourceId: ids[0] });
    expect(got.sections.votes[0].source).toEqual({ url: '', title: 'A/RES/78/1 (2023)' });
    expect(got.v).toBe(2);
    expect(D.sourceIds(got)).toEqual([ids[0]]);
    expect(() => D.addItem(d.id, 'position', { text: 'x', source: { sourceId: 'nope' } })).toThrow(/gone/);
  });
  it('a dossier saved before this change loads and works unchanged', () => {
    localStorage.setItem(D.KEY, JSON.stringify([{ id: 'old1', country: 'Chile', committee: '', topic: '', at: 1,
      sections: { position: [{ id: 'i1', text: 'Old item', source: { url: 'https://a.org/x', title: 'A' }, at: 1 }], votes: [], allies: [], blocs: [], resolutions: [], speeches: [] } }]));
    const d = D.get('old1');
    expect(d.v).toBeUndefined();
    expect(D.sourceIds(d)).toEqual([]);
    expect(D.bibliography(d)).toEqual({ text: '', count: 0, missing: 0 });
    expect(D.sectionMarkdown(d, 'position')).toContain('Old item [1]');
    expect(D.addItem('old1', 'position', { text: 'New', source: 'https://b.org/y' }).added).toBe(true);
  });
  it('the bibliography is only the linked sources, in the style chosen in Settings, and counts a removed record', () => {
    const { ids } = S.saveFromBrief([{ title: 'Water report', url: 'https://un.org/water' }, { title: 'Unlinked page', url: 'https://x.org/u' }, { title: 'Gone soon', url: 'https://g.org/g' }]);
    const d = D.create({ country: 'Brazil' });
    D.addItem(d.id, 'position', { text: 'a', source: { sourceId: ids[0] } });
    D.addItem(d.id, 'allies', { text: 'b', source: { sourceId: ids[2] } });
    S.setPrefs({ style: 'bibtex' });
    let b = D.bibliography(D.get(d.id));
    expect(b.count).toBe(2);
    expect(b.text).toContain('@');
    expect(b.text).toContain('Water report');
    expect(b.text).not.toContain('Unlinked page');
    S.remove(ids[2]);
    b = D.bibliography(D.get(d.id));
    expect(b).toMatchObject({ count: 1, missing: 1 });
  });
});

describe('position paper skeleton', () => {
  it('is the plain template without a dossier, and gets the linked bibliography with one', () => {
    const { ids } = S.saveFromBrief([{ title: 'Water report', url: 'https://un.org/water' }]);
    const d = D.create({ country: 'Brazil' });
    D.addItem(d.id, 'position', { text: 'a', source: { sourceId: ids[0] } });
    expect(T.positionSkeleton('en')).toBe(T.TEMPLATES.position.en);
    const text = T.positionSkeleton('en', d.id);
    expect(text.startsWith(T.TEMPLATES.position.en)).toBe(true);
    expect(text).toContain('Water report');
    expect(T.positionSkeleton('tr', d.id).startsWith(T.TEMPLATES.position.tr)).toBe(true);
    const empty = D.create({ country: 'Chile' });
    expect(T.positionSkeleton('en', empty.id)).toBe(T.TEMPLATES.position.en);
    expect(() => T.positionSkeleton('en', 'nope')).toThrow(/gone/);
  });
});
