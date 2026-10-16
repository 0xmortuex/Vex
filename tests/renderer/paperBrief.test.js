// @vitest-environment jsdom
// T2-035: the paper brief (js/paper-brief.js) and the page-aware PDF reader (src/main/pdf-text.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let B;
beforeEach(() => { ({ VexPaperBrief: B } = fresh(JS + 'paper-brief.js')); });

const PAGES = [
  'A Study of Things\nAbstract\nWe measure the thing carefully and report results.',
  '1 Introduction\nThings matter a great deal in the world today.\nPrior work is thin.',
  '2 Methods\nWe sampled 400 participants over three weeks in autumn.',
  '3 Results\nThe effect was large and statistically significant overall.\nRESULTS TABLE',
  '4. Discussion\nLimitations include a small sample from one city.',
  'References\n[1] Someone 2020.',
];

describe('the chapter map', () => {
  it('finds numbered and named headings with their pages and page spans', () => {
    const ch = B.chapters(PAGES);
    expect(ch.map(c => [c.title, c.page, c.endPage])).toEqual([
      ['Abstract', 1, 2], ['1 Introduction', 2, 3], ['2 Methods', 3, 4], ['3 Results', 4, 5], ['4 Discussion', 5, 6], ['References', 6, 6],
    ]);
  });
  it('keeps a repeated running header once and ignores sentences', () => {
    const ch = B.chapters(['Abstract\nx', 'Abstract\n1 This is a sentence that ends with a full stop.']);
    expect(ch.map(c => c.title)).toEqual(['Abstract']);
  });
});

describe('quotes are checked against the page', () => {
  it('accepts a quote that is on the page whatever its spacing and case', () => {
    expect(B.verifyQuote('the effect was LARGE and statistically significant', PAGES[3])).toBe(true);
    expect(B.verifyQuote('Prior work\nis thin.', PAGES[1])).toBe(true);
  });
  it('refuses a made-up or too-short quote', () => {
    expect(B.verifyQuote('The effect was tiny and meaningless in every case', PAGES[3])).toBe(false);
    expect(B.verifyQuote('thin', PAGES[1])).toBe(false);
  });
  it('drops unverifiable claims, counts them, and fixes a wrong page number', () => {
    const r = B.checkClaims([
      { quote: 'We sampled 400 participants over three weeks in autumn.', page: 4 },      // on page 3, not 4
      { quote: 'The sample was ten thousand people in total.', page: 3 },                   // invented
    ], PAGES, { from: 2, to: 5 });
    expect(r.claims).toEqual([{ quote: 'We sampled 400 participants over three weeks in autumn.', page: 3 }]);
    expect(r.dropped).toBe(1);
  });
});

describe('reading the model', () => {
  it('reads a bare object, a fenced one, and one wrapped in a reply', () => {
    expect(B.parseModelJson('{"summary":"a","claims":[]}')).toMatchObject({ summary: 'a' });
    expect(B.parseModelJson('```json\n{"summary":"b"}\n```')).toMatchObject({ summary: 'b' });
    expect(B.parseModelJson(JSON.stringify({ reply: '{"question":"q"}' }))).toMatchObject({ question: 'q' });
  });
  it('says plainly when the answer is not an object', () => {
    expect(() => B.parseModelJson('I cannot do that')).toThrow(/could not be read/);
  });
  it('splits text into pieces with page markers', () => {
    const pieces = B.chunk(['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)], 1, 3, 120);
    expect(pieces[0]).toContain('[[page 1]]');
    expect(pieces.join('')).toContain('[[page 3]]');
    expect(pieces.length).toBeGreaterThan(1);
  });
});

describe('the local model only', () => {
  it('refuses an answer from any other backend', async () => {
    globalThis.AIRouter = { callOn: vi.fn().mockResolvedValue({ backend: 'cloud', result: '{}' }) };
    await expect(B._ask('s', 'm')).rejects.toThrow(/Only the local model/);
    expect(AIRouter.callOn.mock.calls[0][0]).toBe('local');
  });
  it('explains that Ollama is needed instead of falling back', async () => {
    globalThis.AIRouter = { callOn: vi.fn().mockRejectedValue(new Error('connection refused')) };
    await expect(B._ask('s', 'm')).rejects.toThrow(/never uses the cloud/);
  });
  it('summarises a chapter and drops a quote that is not on the page', async () => {
    globalThis.AIRouter = { callOn: vi.fn().mockResolvedValue({ backend: 'local', result: JSON.stringify({ summary: 'They sampled people.', claims: [{ quote: 'We sampled 400 participants over three weeks in autumn.', page: 3 }, { quote: 'Nobody ever wrote this sentence anywhere.', page: 3 }] }) }) };
    const r = await B.summarizeChapter({ pages: PAGES }, { title: '2 Methods', page: 3, endPage: 4 });
    expect(r.claims).toHaveLength(1);
    expect(r.dropped).toBe(1);
    expect(r.summary).toContain('sampled');
  });
});

describe('the markdown', () => {
  it('cites pages, says it is the model, and flags approximate pages', () => {
    const md = B.toMarkdown({ fileName: 'a.pdf', pagesApprox: true, summary: { decision: 'read', why: 'core', finding: 'big' }, chapters: [{ title: '3 Results', page: 4, endPage: 5, summary: 's', claims: [{ quote: 'q q q', page: 4 }], dropped: 1 }] });
    expect(md).toContain('local model');
    expect(md).toContain('approximate');
    expect(md).toContain('(p. 4)');
    expect(md).toContain('1 claim(s) left out');
  });
});

describe('pages out of a PDF (src/main/pdf-text.js)', () => {
  const { extractPages } = require('../../src/main/pdf-text.js');
  const stream = (n, text) => n + ' 0 obj\n<< /Length 10 >>\nstream\nBT (' + text + ') Tj ET\nendstream\nendobj\n';
  const page = (n, contents, parent) => n + ' 0 obj\n<< /Type /Page /Parent ' + parent + ' 0 R /Contents ' + contents + ' 0 R >>\nendobj\n';
  const inflate = (b) => b;
  it('follows the page tree, so pages come out in order whatever their object numbers', () => {
    const pdf = '%PDF-1.4\n'
      + '1 0 obj\n<< /Type /Pages /Kids [7 0 R 5 0 R] /Count 2 >>\nendobj\n'
      + stream(10, 'Second page') + stream(11, 'First page')
      + page(5, 10, 1) + page(7, 11, 1);
    const r = extractPages(Buffer.from(pdf, 'latin1'), inflate);
    expect(r.approx).toBe(false);
    expect(r.pages).toEqual(['First page', 'Second page']);
  });
  it('falls back to stream order and says the numbers are approximate', () => {
    const r = extractPages(Buffer.from('%PDF-1.5\n' + stream(3, 'Alpha') + stream(4, 'Beta'), 'latin1'), inflate);
    expect(r.approx).toBe(true);
    expect(r.pages).toEqual(['Alpha', 'Beta']);
  });
});
