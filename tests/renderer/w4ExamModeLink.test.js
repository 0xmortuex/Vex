// @vitest-environment jsdom
// W4 I2: an exam added to the planner can arm exam safe mode at its start, only after a yes, never silently.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const H = 3600e3;
const T0 = new Date(2026, 11, 1, 8, 0).getTime();       // "now" for most tests
const EXAM_AT = T0 + 2 * 24 * H;                         // two days later, with a time
let M, exams, suggested;

const exam = (o = {}) => ({ id: 'x1', title: 'Physics midterm', course: 'Physics', date: EXAM_AT, hasTime: true, createdAt: T0 + 1000, ...o });
const answer = (id = 'x1', now = T0 + 5000) => M.linkAnswer(id, now);

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  suggested = [];
  exams = [];
  globalThis.VexExamPlanner = { list: () => exams.slice() };
  globalThis.VexAttention = { suggest: vi.fn((o) => { suggested.push(o); return true; }) };
  window.showToast = vi.fn();
  window.VexProblems = { note: vi.fn() };
  ({ VexExamSafeMode: M } = fresh(JS + 'exam-safe-mode.js'));
  globalThis.VexExamSafeMode = M;
  localStorage.removeItem('vex.examMode.link');            // init() ran at load with the real clock
  M.linkSync(T0);                                         // first run: sets "since"
});
afterEach(() => { vi.useRealTimers(); delete globalThis.VexExamPlanner; delete globalThis.VexAttention; });

describe('the offer', () => {
  it('is made once per timed exam, in the Attention Inbox, and arms nothing by itself', () => {
    exams = [exam()];
    expect(M.linkSync(T0 + 1500)).toMatchObject({ offered: 1 });
    expect(suggested).toHaveLength(1);
    expect(suggested[0]).toMatchObject({ feature: 'exam-safe-mode', action: { key: 'arm:x1' } });
    M.linkSync(T0 + 2000); M.linkSync(T0 + 3000);
    expect(suggested).toHaveLength(1);
    expect(M.active()).toBe(false);
    expect(M.linkWaiting()).toEqual([]);
  });
  it('is not made for an exam that was already in the planner, for a date without a time, or a past exam', () => {
    exams = [exam({ id: 'old', createdAt: T0 - 10 * H }), exam({ id: 'day', hasTime: false }), exam({ id: 'past', date: T0 - H })];
    M.linkSync(T0 + 1500);
    expect(suggested).toHaveLength(0);
  });
  it('is not made while exam mode is switched off', () => {
    M.setEnabled(false);
    exams = [exam()];
    M.linkSync(T0 + 1500);
    expect(suggested).toHaveLength(0);
  });
});

describe('arming', () => {
  beforeEach(() => { exams = [exam()]; M.linkSync(T0 + 1500); });

  it('person said no (no answer or a dismissed row): nothing arms at the start', () => {
    expect(M.linkTick(EXAM_AT + 60000)).toEqual([]);
    expect(M.active()).toBe(false);
    expect(document.getElementById('vex-exam-bar')).toBeNull();
  });
  it('after a yes it arms exactly at the start, with the bar and a toast, until the end of the exam', () => {
    answer();
    expect(M.linkWaiting()).toHaveLength(1);
    expect(M.linkTick(EXAM_AT - 1)).toEqual([]);
    expect(M.active()).toBe(false);
    expect(M.linkTick(EXAM_AT)).toEqual(['x1']);
    expect(M.active()).toBe(true);
    expect(M.until()).toBe(EXAM_AT + 120 * 60000);
    expect(M.holds('sync')).toBe(true);
    expect(document.getElementById('vex-exam-bar')).not.toBeNull();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Exam mode is on until'), 'info', 6000);
    expect(M._read().active.linkExam).toBe('x1');
  });
  it('does not arm again if the person ended it by hand', () => {
    answer();
    M.linkTick(EXAM_AT);
    M.deactivate('ended');
    expect(M.linkTick(EXAM_AT + 60000)).toEqual([]);
    expect(M.active()).toBe(false);
  });
  it('a timer fires it: nothing is armed before the start, armed after it (fake clock)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 5000);
    answer('x1', Date.now());
    vi.setSystemTime(T0 + 5000);
    vi.advanceTimersByTime(H);                              // an hour later: still waiting, timer re-armed
    expect(M.active()).toBe(false);
    vi.setSystemTime(EXAM_AT - 1000);
    vi.advanceTimersByTime(1000 + 3600e3);                  // the start passes
    expect(M.active()).toBe(true);
    expect(M.until()).toBe(EXAM_AT + 120 * 60000);
    M.deactivate('ended');
  });
  it('an exam moved after a yes is not armed at the old time and is offered again', () => {
    answer();
    exams = [exam({ date: EXAM_AT + 24 * H })];
    expect(M.linkSync(T0 + 9000)).toMatchObject({ dropped: 1, offered: 1 });
    expect(M.linkWaiting()).toEqual([]);
    expect(M.linkTick(EXAM_AT + 60000)).toEqual([]);
    expect(M.active()).toBe(false);
    expect(suggested).toHaveLength(2);
  });
  it('an exam deleted after a yes is not armed', () => {
    answer();
    exams = [];
    expect(M.linkSync(T0 + 9000)).toMatchObject({ dropped: 1 });
    expect(M.linkTick(EXAM_AT + 60000)).toEqual([]);
    expect(M.active()).toBe(false);
  });
  it('an exam deleted behind our back (no event) is still not armed by the tick', () => {
    answer();
    exams = [];
    expect(M.linkTick(EXAM_AT + 60000)).toEqual([]);
    expect(M.active()).toBe(false);
  });
  it('an exam deleted or moved while its exam mode is running ends that mode', () => {
    answer();
    M.linkTick(EXAM_AT + 60000);
    expect(M.active()).toBe(true);
    exams = [];
    M.linkSync(EXAM_AT + 120000);
    expect(M.active()).toBe(false);
  });
  it('does not touch a mode the person turned on themselves when an exam is deleted', () => {
    answer();
    M.activate(null, EXAM_AT - 3600e3);                      // by hand, an hour before: no linkExam
    exams = [];
    M.linkSync(EXAM_AT - 1800e3);
    expect(M.active()).toBe(true);
    M.deactivate('ended');
  });
  it('a yes taken back (Cancel) arms nothing', () => {
    answer();
    expect(M.linkCancel('x1')).toBe(true);
    expect(M.linkTick(EXAM_AT + 60000)).toEqual([]);
    expect(M.active()).toBe(false);
  });
  it('a yes while exam mode is switched off arms nothing and says why', () => {
    answer();
    M.setEnabled(false);
    expect(M.linkTick(EXAM_AT + 60000)).toEqual([]);
    expect(window.VexProblems.note).toHaveBeenCalled();
  });
});

describe('Vex was closed at the start', () => {
  beforeEach(() => { exams = [exam()]; M.linkSync(T0 + 1500); answer(); });

  it('opened in the middle of the exam: arms, only until the end of the exam', () => {
    const now = EXAM_AT + 40 * 60000;
    expect(M.linkTick(now)).toEqual(['x1']);
    expect(M.until()).toBe(EXAM_AT + 120 * 60000);
    expect(document.getElementById('vex-exam-bar')).not.toBeNull();
    M.deactivate('ended');
  });
  it('opened after the end of the exam: never arms, and the entry is closed', () => {
    expect(M.linkTick(EXAM_AT + 120 * 60000)).toEqual([]);
    expect(M.linkTick(EXAM_AT + 5 * H)).toEqual([]);
    expect(M.active()).toBe(false);
    expect(M.linkWaiting()).toEqual([]);
  });
  it('a yes given after the exam is over is refused', () => {
    exams = [exam({ id: 'x2', createdAt: T0 + 2000 })];
    M.linkSync(T0 + 2500);
    expect(() => M.linkAnswer('x2', EXAM_AT + 3 * H)).toThrow(/already over/);
    expect(M.active()).toBe(false);
  });
  it('init() on the next start runs the same check', () => {
    localStorage.setItem('vex.examMode.link', localStorage.getItem('vex.examMode.link'));
    ({ VexExamSafeMode: M } = fresh(JS + 'exam-safe-mode.js'));
    vi.useFakeTimers();
    vi.setSystemTime(EXAM_AT + 130 * 60000);               // after the end
    M.init();
    expect(M.active()).toBe(false);
  });
});

describe('arm path', () => {
  it('activate() without options behaves as before (pack minutes, no link tag)', () => {
    const a = M.activate(null, T0);
    expect(a.until).toBe(T0 + 120 * 60000);
    expect(a.linkExam).toBeUndefined();
    M.deactivate('ended');
  });
});
