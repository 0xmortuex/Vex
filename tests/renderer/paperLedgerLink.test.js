// @vitest-environment jsdom
// A finished past-paper session counts as study time under its course, once.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
globalThis.vexId = (p) => p + Math.random().toString(36).slice(2, 8);
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let P, L;
beforeEach(() => {
  localStorage.clear();
  globalThis.VexStudyKit = fresh(JS + 'study-kit.js').VexStudyKit;
  ({ VexStudyLedger: L } = fresh(JS + 'study-ledger.js'));
  globalThis.VexStudyLedger = L;
  ({ VexPaperSession: P } = fresh(JS + 'paper-session.js'));
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 4, 10, 0, 0));
});
afterEach(() => { vi.useRealTimers(); delete globalThis.VexStudyLedger; });

const finishOne = (course) => {
  P.start({ course, paper: 'P1' });
  vi.setSystemTime(new Date(2026, 10, 4, 11, 30, 0));
  return P.finish();
};

describe('paper session -> study ledger', () => {
  it('logs the minutes under the course when the paper is finished', () => {
    finishOne('Calculus');
    const s = L._read().sessions;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ subject: 'Calculus', minutes: 90, source: 'paper' });
  });
  it('never counts the same paper twice', () => {
    const r = finishOne('Calculus');
    expect(L.paperSession(r)).toBeNull();
    expect(L.paperSession(r)).toBeNull();
    expect(L._read().sessions).toHaveLength(1);
  });
  it('does nothing while the study ledger is off', () => {
    L.setEnabled(false);
    finishOne('Calculus');
    expect(L._read().sessions).toHaveLength(0);
  });
  it('falls back to the paper name when there is no course, and skips under a minute', () => {
    const a = finishOne('');
    expect(L._read().sessions[0].subject).toBe('P1');
    expect(L.paperSession({ id: 'x', course: 'C', durationMs: 20000, startedAt: 1 })).toBeNull();
    expect(a.id).toBeTruthy();
  });
  it('still finishes the paper when the ledger is absent', () => {
    delete globalThis.VexStudyLedger;
    expect(() => finishOne('Calculus')).not.toThrow();
  });
});
