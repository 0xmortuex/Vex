// @vitest-environment jsdom
//
// T2-023: js/answer-citations.js verifies each cited statement against the
// words of its source, in code; unsupported statements are greyed with a reason.
import { describe, it, expect, beforeEach } from 'vitest';

const { VexAnswerCitations: C } = require('../../src/renderer/js/answer-citations.js');
const { KnowledgeAsk: K } = require('../../src/renderer/js/knowledge.js');

beforeEach(() => { localStorage.clear(); });

const SOURCES = [
  { n: 1, passage: 'The renewal is due on 14 March, and the fee is “120 euros” per year.' },
  { n: 2, passage: 'Postgres was chosen over MySQL because of JSON support.' },
];

describe('verify', () => {
  it('supports a statement whose quote is really in the source (quotes and spaces aside)', () => {
    const r = C.verify('The renewal is due on 14 March [1].', [{ n: 1, quote: 'The renewal is   due on 14 March' }], SOURCES);
    expect(r[0].status).toBe('supported');
    expect(r[0].n).toBe(1);
  });
  it('matches curly quotes against straight ones', () => {
    const r = C.verify('The fee is 120 euros a year [1].', [{ n: 1, quote: 'the fee is "120 euros" per year' }], SOURCES);
    expect(r[0].status).toBe('supported');
  });
  it('greys a quote that is not in the source', () => {
    const r = C.verify('The renewal is due on 20 April [1].', [{ n: 1, quote: 'The renewal is due on 20 April for sure' }], SOURCES);
    expect(r[0].status).toBe('unsupported');
    expect(r[0].reason).toMatch(/not in that source/);
  });
  it('greys a statement with no source, a missing source number and a missing quote', () => {
    const r = C.verify('Nothing cited here. Postgres is great [9]. MySQL lost [2].', [], SOURCES);
    expect(r.map(x => x.status)).toEqual(['unsupported', 'unsupported', 'unsupported']);
    expect(r[0].reason).toMatch(/no source/);
    expect(r[1].reason).toMatch(/does not exist/);
    expect(r[2].reason).toMatch(/gave no quote/);
  });
  it('greys a real quote that has nothing to do with the sentence', () => {
    const r = C.verify('Cats are mammals [2].', [{ n: 2, quote: 'Postgres was chosen over MySQL' }], SOURCES);
    expect(r[0].status).toBe('unsupported');
    expect(r[0].reason).toMatch(/nothing in common/);
  });
  it('ignores a quote that is too short to prove anything', () => {
    expect(C.find('the renewal is due', 'due')).toBe(-1);
  });
});

describe('claims and quotes', () => {
  it('splits sentences and keeps their markers', () => {
    const c = C.claims('First thing [1]. Second thing [2][3]! Third.');
    expect(c.map(x => x.cites)).toEqual([[1], [2, 3], []]);
  });
  it('reads the quotes from the model reply, and nothing from plain text', () => {
    expect(C.parseQuotes('{"reply":"x","quotes":[{"n":1,"quote":"abc def ghi jkl"}]}')).toEqual([{ n: 1, quote: 'abc def ghi jkl' }]);
    expect(C.parseQuotes('plain')).toEqual([]);
    expect(C.parseQuotes({ reply: 'x' })).toEqual([]);
  });
  it('the snippet for the browser find is one short line', () => {
    expect(C.snippet('a b\nc ' + 'word '.repeat(40)).length).toBeLessThanOrEqual(80);
    expect(C.snippet('a b\nc')).toBe('a b c');
  });
});

describe('the knowledge-base prompt asks for quotes and keeps the passage', () => {
  it('names the quote format and returns the passage per source', () => {
    const built = K.buildAskPrompt({ question: 'when is the renewal?', page: { title: 'P', url: 'https://x.example/', text: 'The renewal is due on 14 March.' } });
    expect(built.message).toMatch(/"quotes"/);
    expect(built.sources[0].passage).toContain('14 March');
  });
});

describe('the chip', () => {
  it('draws a button on supported claims and a reason on grey ones', () => {
    const host = document.createElement('div');
    const claims = C.verify('The renewal is due on 14 March [1]. Unsure thing.', [{ n: 1, quote: 'The renewal is due on 14 March' }], SOURCES);
    C.render(host, claims, SOURCES);
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(host.querySelector('[data-citation="unsupported"]').textContent).toMatch(/names no source/);
    expect(C.summaryLine(claims)).toMatch(/1 of 2/);
  });
});
