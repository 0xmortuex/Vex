// @vitest-environment jsdom
// T2-043: the past-paper session recorder (js/paper-session.js).
import { describe, it, expect, beforeEach } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let P;
beforeEach(() => {
  localStorage.clear();
  ({ VexPaperSession: P } = fresh(JS + 'paper-session.js'));
});

describe('a recording', () => {
  it('logs questions, marks one wrong, finishes and summarises', () => {
    P.start({ course: 'Calc', paper: '2024 P1', plannedMin: 90, totalMarks: 20 });
    P.logQuestion({ topic: 'Integrals', marks: 5, got: 5 });
    P.logQuestion({ topic: 'Series', marks: 5, got: 2, text: 'Does the series converge?', note: 'Use the ratio test' });
    P.logQuestion({ topic: 'Series', marks: 10, got: 10 });
    P.markLastWrong({ note: 'wrong anyway' });
    const s = P.finish({ scoreEntered: '14' });
    const m = P.summarize(s);
    expect(m.questions).toBe(3);
    expect(m.wrong).toBe(2);               // the 2/5 (auto) and the last one marked by hand
    expect(m.score).toBe(14);
    expect(m.total).toBe(20);
    expect(m.percent).toBe(70);
    expect(m.topics[0]).toMatchObject({ topic: 'Series', wrong: 2 });
    expect(P.running()).toBeNull();
    expect(P.sessions()).toHaveLength(1);
  });
  it('turns the wrong questions into FlashMind cards', () => {
    P.start({ course: 'Calc', paper: 'P1' });
    P.logQuestion({ topic: 'Series', marks: 5, got: 2, text: 'Does it converge?', note: 'ratio test' });
    P.logQuestion({ topic: 'Limits', marks: 3, got: 3 });
    const cards = P.mistakeCards(P.finish());
    expect(cards).toEqual([{ front: 'Does it converge?', back: 'ratio test', difficulty: 'hard', category: 'Series' }]);
  });
  it('refuses nonsense and a second recording', () => {
    expect(() => P.start({ plannedMin: 0 })).toThrow(/1 to 600/);
    P.start({ paper: 'x' });
    expect(() => P.start({ paper: 'y' })).toThrow(/already/);
    expect(() => P.logQuestion({ marks: 3, got: 5 })).toThrow(/more than/);
    expect(() => P.markLastWrong()).toThrow(/Log a question/);
    P.discard();
    expect(() => P.pause()).toThrow(/No paper/);
  });
  it('does not count paused time and reports a paper that ran over', () => {
    const s = { startedAt: 0, pausedMs: 10 * 60000, endedAt: 100 * 60000, plannedMin: 60, questions: [] };
    expect(P.elapsed(s)).toBe(90 * 60000);
    expect(P.summarize({ ...s, durationMs: 90 * 60000 }).overTime).toBe(true);
  });
  it('writes a note with the topics and what to revise', () => {
    const md = P.toMarkdown({ paper: 'P1', course: 'Calc', startedAt: 0, durationMs: 60000, questions: [{ no: 1, topic: 'Series', marks: 5, got: 1, wrong: true, text: 'q', note: 'n' }] });
    expect(md).toContain('## By topic');
    expect(md).toContain('Series: 1 wrong of 1');
    expect(md).toContain('## Revise');
  });
});
