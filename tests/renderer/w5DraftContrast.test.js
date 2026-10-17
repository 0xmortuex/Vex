// @vitest-environment jsdom
// T3-104: two-source contrast table and rubric check in the draft check.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let D;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  globalThis.VexStudyKit = fresh(JS + 'study-kit.js').VexStudyKit;
  ({ VexDraftCheck: D } = fresh(JS + 'draft-check.js'));
});

const A = { id: 'n:1', kind: 'note', title: 'Sleep notes', url: '', text: 'A 2019 study found that teenagers who slept less than 7 hours had 30 percent lower exam scores.' };
const B = { id: 'r:2', kind: 'saved page', title: 'Other page', url: '', text: 'A 2021 survey found that teenagers who slept less than 7 hours had 12 percent lower exam scores in the sample.' };
const C = { id: 'r:3', kind: 'saved page', title: 'Volcano page', url: '', text: 'Volcanoes erupt when pressure builds in the magma chamber under the crust.' };
const claim = 'A 2019 study found that teenagers who slept less than 7 hours had 30 percent lower exam scores.';

describe('two-source contrast', () => {
  it('says supports for the source that has it and "numbers differ" for the one with other figures', () => {
    expect(D.stanceIn(claim, A).stance).toBe('supports');
    expect(D.stanceIn(claim, B).stance).toBe('numbers differ');
    expect(D.stanceIn(claim, C).stance).toBe('silent');
  });
  it('flags a negation the other source does not have', () => {
    const neg = { id: 'x', kind: 'note', title: 'x', text: 'Teenagers who slept less than 7 hours did not have lower exam scores in any of the groups tested.' };
    expect(D.stanceIn('Teenagers who slept less than 7 hours have lower exam scores in the groups tested.', neg).stance).toBe('may disagree');
  });
  it('builds rows with a relation and counts', () => {
    const r = D.contrast(claim, A, B);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].relation).toBe('conflict');
    expect(r.counts.conflict).toBe(1);
    expect(D.contrast(claim, A, C).rows[0].relation).toBe('only-a');
    expect(D.contrast(claim, C, B).rows[0].relation).toBe('only-b');
    expect(D.contrast(claim, C, { ...C, id: 'c2' }).rows[0].relation).toBe('neither');
  });
  it('needs two different sources', () => {
    expect(() => D.contrast(claim, A, A)).toThrow(/two different/);
    expect(() => D.contrast(claim, A, null)).toThrow(/Pick two/);
  });
});

describe('rubric', () => {
  const essay = 'This essay argues that sleep matters for exam results.\n\n' + claim + ' (Lee, 2019). Some students sleep little.\n\nHowever, critics say the effect is small in other samples and it may differ by age group, culture and school year.\n\nIn conclusion, sleep matters.';
  it('marks thesis, citations, other side and conclusion from the text', () => {
    const res = D.check(essay, [A]);
    const items = D.rubricCheck(essay, res, { minWords: 0, maxWords: 0 });
    const by = Object.fromEntries(items.map(i => [i.id, i.pass]));
    expect(by.thesis).toBe(true);
    expect(by.counter).toBe(true);
    expect(by.conclusion).toBe(true);
    expect(by.evidence).toBe(true);
    expect(items.some(i => i.id === 'length')).toBe(false);
  });
  it('fails what is missing and checks the length you set', () => {
    const bare = 'Teenagers sleep.\n\nThat is all there is.';
    const items = D.rubricCheck(bare, D.check(bare, [A]), { minWords: 100, maxWords: 0 });
    const by = Object.fromEntries(items.map(i => [i.id, i.pass]));
    expect(by.thesis).toBe(false);
    expect(by.conclusion).toBe(false);
    expect(by.length).toBe(false);
    expect(by.evidence).toBe(null);
  });
  it('keeps your rubric lines and length, refusing a min above the max', () => {
    D.saveRubricPrefs({ minWords: 500, maxWords: 900, custom: ['Uses two sources', '  ', 'Has a title'] });
    expect(D.rubricPrefs()).toEqual({ minWords: 500, maxWords: 900, custom: ['Uses two sources', 'Has a title'] });
    expect(() => D.saveRubricPrefs({ minWords: 900, maxWords: 500, custom: [] })).toThrow(/more than/);
  });
  it('judges a custom line only through the local model', async () => {
    await expect(D.judgeRubricLine('Has a title', 'text')).rejects.toThrow(/No local model/);
  });
});
