// @vitest-environment jsdom
// Wave 4: the FlashMind entry points (js/study-entry.js).
import { describe, it, expect, beforeEach } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let S, F;
beforeEach(() => {
  localStorage.clear();
  F = fresh(JS + 'flashmind-bridge.js').FlashMindBridge;
  globalThis.FlashMindBridge = F;
  globalThis.VexAnswerCitations = fresh(JS + 'answer-citations.js').VexAnswerCitations;
  ({ VexStudyEntry: S } = fresh(JS + 'study-entry.js'));
});

describe('quiz me from this page', () => {
  it('heads the study text with the course deck', () => {
    const text = S.quizText({ title: 'Limits', url: 'https://x.test/a', body: 'A limit is a value.' }, 'Calculus II');
    expect(text).toContain('Deck: Calculus II - Limits');
    expect(text).toContain('Source: https://x.test/a');
    expect(text).toContain('A limit is a value.');
  });
  it('refuses an empty page', () => {
    expect(() => S.quizText({ title: 'T', body: '  ' }, '')).toThrow(/nothing to quiz/);
  });
  it('names the deck, else the course', () => {
    expect(S.deckName({ deck: 'Calc cards', name: 'Calculus' })).toBe('Calc cards');
    expect(S.deckName({ name: 'Calculus' })).toBe('Calculus');
    expect(S.deckName(null)).toBe('');
  });
  it('adds the menu rows only while it is on, and a word row for a short selection', () => {
    expect(S.pageItems('').map(i => i.label)).toEqual(['Quiz me from this page']);
    expect(S.pageItems('ephemeral').map(i => i.label)).toEqual(['Quiz me from this page', 'Save "ephemeral" with its sentence']);
    expect(S.pageItems('x'.repeat(200)).length).toBe(1);
    S.setEnabled(false);
    expect(S.pageItems('')).toEqual([]);
  });
});

describe('vocabulary with its sentence and source', () => {
  it('finds the sentence holding the word', () => {
    const ctx = 'It was a quiet day. The ephemeral nature of fame is old news! Nobody cared.';
    expect(S.sentenceAround(ctx, 'ephemeral')).toBe('The ephemeral nature of fame is old news!');
  });
  it('refuses a sentence-long selection and a word that is not there', () => {
    expect(() => S.sentenceAround('Some text here.', 'this is far too many words to be a single word')).toThrow(/one word/);
    expect(() => S.sentenceAround('Some text here.', 'absent')).toThrow(/not found/);
    expect(() => S.sentenceAround('', 'x')).toThrow(/could not be read/);
  });
  it('keeps a word once per sentence and exports FlashMind CSV', () => {
    const a = S.addWord({ word: 'ephemeral', sentence: 'The ephemeral nature of fame.', url: 'https://x.test/p', title: 'On fame' });
    expect(a.added).toBe(true);
    expect(S.addWord({ word: 'Ephemeral', sentence: 'The ephemeral nature of fame.', url: 'https://x.test/p' }).added).toBe(false);
    const csv = S.vocabCsv(S.vocab(), 'English');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('front,back,difficulty,category');
    expect(csv).toContain('"ephemeral"');
    expect(csv).toContain('Source: On fame - https://x.test/p');
    expect(csv).toContain('"English"');
  });
  it('refuses to export nothing and to save a word without a sentence', () => {
    expect(() => S.vocabCsv([], '')).toThrow(/no saved words/);
    expect(() => S.addWord({ word: 'w', sentence: '' })).toThrow(/sentence/);
  });
  it('says so when the saved words are damaged', () => {
    localStorage.setItem('vex.studyEntry.vocab', '{nope');
    expect(() => S.vocab()).toThrow(/damaged/);
  });
});

describe('mistake journal', () => {
  const sessions = [
    { id: 's1', paper: 'P1', course: 'Calc', startedAt: 10, questions: [
      { no: 1, topic: 'Series', wrong: true, text: 'Does it converge?', note: 'ratio test', at: 20, url: 'https://x.test/series' },
      { no: 2, topic: 'Integrals', wrong: true, at: 30 },
      { no: 3, topic: 'Integrals', wrong: false },
    ] },
    { id: 's2', paper: 'P2', startedAt: 40, questions: [{ no: 1, topic: 'Series', wrong: true, at: 50, url: 'javascript:alert(1)' }] },
  ];
  it('lists wrong questions, most-missed topic first, and drops an unsafe address', () => {
    const q = S.mistakeQueue(sessions, {});
    expect(q.map(i => i.id)).toEqual(['s1:1', 's2:1', 's1:2']);
    expect(q[0].url).toBe('https://x.test/series');
    expect(q[1].url).toBe('');
  });
  it('puts what was read last, and makes cards only of the unread', () => {
    S.markRead('s1:1');
    const q = S.mistakeQueue(sessions, S.read());
    expect(q.map(i => i.id)).toEqual(['s2:1', 's1:2', 's1:1']);
    expect(q[2].read).toBe(true);
    const cards = S.queueCards(q);
    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({ category: 'Integrals', difficulty: 'hard' });
    S.markRead('s1:1', false);
    expect(S.read()).toEqual({});
  });
});

describe('the paper recorder keeps the page of a mistake', () => {
  it('stores a web address and nothing else', () => {
    globalThis.vexId = (p) => p + '_1';
    const { VexPaperSession: P } = fresh(JS + 'paper-session.js');
    P.start({ course: 'c', paper: 'p' });
    expect(P.logQuestion({ wrong: true, url: 'https://x.test/q' }).url).toBe('https://x.test/q');
    expect(P.logQuestion({ wrong: true, url: 'file:///etc/passwd' }).url).toBeUndefined();
  });
});

describe('teach-back questions', () => {
  const page = 'Photosynthesis converts light energy into chemical energy stored in glucose. It happens in the chloroplasts of plant cells. Oxygen is released as a by-product.';
  const good = { question: 'Where does it happen?', answer: 'In the chloroplasts', quote: 'It happens in the chloroplasts of plant cells' };
  it('parses fenced or wrapped JSON and refuses prose', () => {
    expect(S.parseTeachBack('Sure!\n```json\n{"cards":[' + JSON.stringify(good) + ']}\n```')).toEqual([good]);
    expect(S.parseTeachBack({ result: JSON.stringify({ cards: [good] }) })).toEqual([good]);
    expect(() => S.parseTeachBack('no json here')).toThrow(/form asked for/);
    expect(() => S.parseTeachBack('{"cards": 3}')).toThrow(/no questions/);
  });
  it('keeps only questions whose quote is on the page', () => {
    const made = { question: 'Why?', answer: 'Because of mitochondria', quote: 'Mitochondria produce all the energy in the cell' };
    const noQuote = { question: 'Q', answer: 'A', quote: '' };
    const unrelated = { question: 'What is released?', answer: 'Zebra', quote: 'Oxygen is released as a by-product' };
    const r = S.checkTeachBack([good, made, noQuote, unrelated], page);
    expect(r.kept).toEqual([good]);
    expect(r.dropped.map(d => d.reason)).toEqual(['The quote is not on the page.', 'No quote given.', 'The answer has nothing in common with its quote.']);
  });
  it('writes cards that carry the quote, in FlashMind CSV', () => {
    const cards = S.teachBackCards([good], 'Biology', 'Plants');
    expect(cards[0].back).toContain('From the page: "It happens in the chloroplasts of plant cells"');
    expect(F.cardsToCsv(cards)).toContain('"Biology"');
  });
  it('builds a prompt that forbids outside knowledge and asks for a quote', () => {
    const p = S.teachBackPrompt('Plants', page);
    expect(p).toMatch(/ONLY the text/);
    expect(p).toMatch(/quote/);
    expect(() => S.teachBackPrompt('t', '')).toThrow(/no page text/);
  });
});
