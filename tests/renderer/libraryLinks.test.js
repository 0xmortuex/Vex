// @vitest-environment jsdom
// Wave 4: backlinks, conflicts between sources, and the spoken answer (js/library-links.js,
// ListenReader.speakText).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let L;
beforeEach(() => {
  localStorage.clear();
  globalThis.VexAnswerCitations = fresh(JS + 'answer-citations.js').VexAnswerCitations;
  ({ VexLibraryLinks: L } = fresh(JS + 'library-links.js'));
});

describe('backlinks', () => {
  const notes = [
    { id: 'n1', title: 'Fame', sourceUrl: 'https://www.x.test/a/?utm_source=mail' },
    { id: 'n2', title: 'Essay', content: 'See https://x.test/a, and also (https://y.test/b).', sourceUrl: '' },
    { id: 'n3', title: 'Secret', content: 'https://x.test/a', private: true },
    { id: 'n4', title: 'Other', sourceUrl: 'https://z.test/' },
  ];
  it('treats a page and its tracked, www, trailing-slash twin as one', () => {
    expect(L.urlKey('https://www.x.test/a/?utm_source=mail')).toBe(L.urlKey('https://x.test/a'));
    expect(L.urlKey('ftp://x.test/a')).toBe('');
  });
  it('finds the notes that cite a page, by source or by text, and skips private notes', () => {
    expect(L.backlinks('https://x.test/a', notes)).toEqual([
      { id: 'n1', title: 'Fame', via: 'source' },
      { id: 'n2', title: 'Essay', via: 'mention' },
    ]);
    expect(L.backlinks('not a url', notes)).toEqual([]);
  });
  it('lists the sources a note cites, once each', () => {
    expect(L.sourcesOf(notes[1]).map(s => s.url)).toEqual(['https://x.test/a', 'https://y.test/b']);
  });
  it('answers per hit kind', () => {
    expect(L.linksFor({ id: 'note:n2', kind: 'note' }, notes)).toMatchObject({ kind: 'sources' });
    expect(L.linksFor({ id: 'bookmark:1', kind: 'bookmark', url: 'https://x.test/a' }, notes).items).toHaveLength(2);
  });
});

describe('conflicts between sources', () => {
  const sources = [
    { n: 1, title: 'Study A', url: 'https://a.test', passage: 'The trial enrolled 400 patients and the drug cut relapse by 30 percent overall.' },
    { n: 2, title: 'Study B', url: 'https://b.test', passage: 'In our trial of 400 patients the drug cut relapse by only 5 percent, within chance.' },
    { n: 3, title: 'Review C', url: '', passage: 'A review of drug trials found small effects in general.' },
  ];
  const raw = (conflicts) => JSON.stringify({ conflicts });
  const pos = (n, says, quote) => ({ n, says, quote });

  it('keeps a conflict whose positions both quote their sources, side by side', () => {
    const parsed = L.parseConflicts(raw([{ topic: 'Size of the effect', positions: [
      pos(1, '30 percent', 'the drug cut relapse by 30 percent overall'),
      pos(2, '5 percent', 'the drug cut relapse by only 5 percent, within chance'),
    ] }]));
    const r = L.checkConflicts(parsed, sources);
    expect(r.dropped).toBe(0);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].positions.map(p => p.n)).toEqual([1, 2]);
    expect(r.conflicts[0].positions[0]).toMatchObject({ source: 'Study A', says: '30 percent' });
  });
  it('drops a position whose quote is not in its source, and a conflict left with one side', () => {
    const parsed = L.parseConflicts(raw([
      { topic: 'Invented', positions: [pos(1, 'x', 'the drug cut relapse by 30 percent overall'), pos(2, 'y', 'a sentence nobody wrote in study B at all')] },
      { topic: 'Same source twice', positions: [pos(1, 'x', 'the drug cut relapse by 30 percent overall'), pos(1, 'x', 'the trial enrolled 400 patients')] },
      { topic: 'Unknown source', positions: [pos(1, 'x', 'the trial enrolled 400 patients'), pos(9, 'z', 'anything at all in source nine')] },
    ]));
    const r = L.checkConflicts(parsed, sources);
    expect(r.conflicts).toEqual([]);
    expect(r.dropped).toBe(3);
  });
  it('reads fenced JSON, and refuses prose', () => {
    expect(L.parseConflicts('Here:\n```json\n{"conflicts": []}\n```')).toEqual([]);
    expect(L.parseConflicts({ result: '{"conflicts": []}' })).toEqual([]);
    expect(() => L.parseConflicts('they agree')).toThrow(/form asked for/);
    expect(() => L.parseConflicts('{"nope": 1}')).toThrow(/no comparison/);
  });
  it('asks never to merge or rule', () => {
    const p = L.conflictPrompt('Does it work?', sources);
    expect(p).toMatch(/Do not merge/);
    expect(p).toMatch(/not say who is right/);
    expect(p).toContain('[2] Study B');
    expect(() => L.conflictPrompt('q', [])).toThrow(/no sources/);
  });
  it('asks the local model only, and reports its failure without the cloud', async () => {
    const callOn = vi.fn().mockResolvedValue({ result: raw([]) });
    globalThis.AIRouter = { callOn };
    expect(await L.checkSources('q', sources)).toEqual({ conflicts: [], dropped: 0, model: '' });   // model: what the provenance chip names
    expect(callOn.mock.calls[0][0]).toBe('local');
    callOn.mockRejectedValue(new Error('Ollama is down.'));
    await expect(L.checkSources('q', sources)).rejects.toThrow(/Nothing was sent to the cloud/);
    delete globalThis.AIRouter;
  });
});

describe('the spoken answer', () => {
  it('says how many sources and how many are disputed', () => {
    expect(L.citationSummary(3, [{}])).toBe('Three sources, one disputed.');
    expect(L.citationSummary(3, [])).toBe('Three sources, none disputed.');
    expect(L.citationSummary(1, [])).toBe('One source.');
    expect(L.citationSummary(3, null)).toBe('Three sources, not checked for disagreement.');
    expect(L.citationSummary(0, null)).toBe('No sources were cited.');
    expect(L.citationSummary(12, [])).toBe('12 sources, none disputed.');
  });
  it('drops the [n] markers and adds the summary as its own chapter', () => {
    const s = L.spokenAnswer({ answer: 'It works [1]. Mostly [2][3].', sources: [{}, {}, {}, {}], cited: [1, 2, 3], conflicts: [{ topic: 'Size of the effect' }] });
    expect(s[0]).toMatchObject({ title: 'Answer', paras: ['It works. Mostly.'] });
    expect(s[1].paras).toEqual(['Three sources, one disputed.', 'Disputed: Size of the effect.']);
    expect(() => L.spokenAnswer({ answer: '  ' })).toThrow(/no answer/);
  });
  it('counts all sources when none were marked as cited', () => {
    expect(L.spokenAnswer({ answer: 'Yes.', sources: [{}, {}], cited: [], conflicts: [] })[1].paras[0]).toBe('Two sources, none disputed.');
  });
});

describe('ListenReader.speakText', () => {
  it('opens a panel for text that is not a page and starts it', async () => {
    const { ListenReader: R } = fresh(JS + 'listen-reader.js');
    localStorage.setItem('vex.listen.enabled', 'on');
    globalThis.speechSynthesis = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] };
    globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; };
    window.escapeHtml = (s) => s;
    const s = await R.speakText({ title: 'Answer', sections: L.spokenAnswer({ answer: 'It works [1].', sources: [{}], cited: [1], conflicts: [] }) });
    expect(s.plan.map(p => p.title)).toEqual(['Answer', 'Sources']);
    expect(globalThis.speechSynthesis.speak).toHaveBeenCalled();
    expect(globalThis.speechSynthesis.speak.mock.calls[0][0].text).toBe('Answer.');
    R.stop();
    await expect(R.speakText({ title: 'x', sections: [] })).rejects.toThrow(/nothing to read/);
  });
});
