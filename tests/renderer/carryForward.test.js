// @vitest-environment jsdom
//
// T2-009: yesterday's left-overs, with Today / Tomorrow / Drop (js/carry-forward.js),
// and the task-date editor it shares (js/plan-kit.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const NOW = new Date(2026, 9, 14, 10, 0, 0).getTime();     // Wednesday 14 October 2026

let C, K;
const notes = () => JSON.parse(localStorage.getItem('vex.notes'));

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  localStorage.setItem('vex.notes', JSON.stringify([{
    id: 'n1', title: 'To-do', updatedAt: '2026-10-01T00:00:00Z',
    content: '- [ ] call plumber @2026-10-12\n- [ ] buy milk @2026-10-14\n- [ ] later @2026-10-20\n- [x] done @2026-10-01\n- [ ] undated',
  }]));
  globalThis.OpenTasks = fresh(JS + 'open-tasks.js').OpenTasks;
  K = globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  ({ VexCarry: C } = fresh(JS + 'carry-forward.js'));
  delete globalThis.VexLedger; delete globalThis.VexAttention;
});

describe('pick()', () => {
  it('lists only open tasks whose day has passed, oldest first, with their age', () => {
    const rows = C.pick(K.openTasks(NOW), NOW);
    expect(rows.map(r => r.plain)).toEqual(['call plumber']);
    expect(rows[0].days).toBe(2);
    expect(C.ageLabel(1)).toBe('from yesterday');
    expect(C.ageLabel(3)).toBe('3 days ago');
  });
  it('does not count a task due today, a future one, a done one or an undated one', () => {
    const plains = C.pick(K.openTasks(NOW), NOW).map(r => r.plain);
    expect(plains).not.toContain('buy milk');
    expect(plains).not.toContain('later');
    expect(plains).not.toContain('undated');
  });
});

describe('choose()', () => {
  it('writes an absolute day, never a relative word', () => {
    expect(C.choose('today', NOW)).toBe('2026-10-14');
    expect(C.choose('tomorrow', NOW)).toBe('2026-10-15');
    expect(C.choose('drop', NOW)).toBe('');
  });
  it('refuses anything else', () => { expect(() => C.choose('later', NOW)).toThrow(/Today, to Tomorrow/); });
});

describe('apply()', () => {
  const task = () => C.list(NOW)[0];
  it('moves the date in the note where the task lives and keeps the rest of the note', () => {
    C.apply(task(), 'tomorrow', NOW);
    const text = notes()[0].content;
    expect(text).toContain('- [ ] call plumber @2026-10-15');
    expect(text).toContain('- [ ] buy milk @2026-10-14');
    expect(text).not.toContain('@2026-10-12');
  });
  it('drops the date and leaves the task in its note', () => {
    C.apply(task(), 'drop', NOW);
    const lines = notes()[0].content.split('\n');
    expect(lines[0]).toBe('- [ ] call plumber');
    expect(lines).toHaveLength(5);
  });
  it('writes a ledger line whose undo token restores the old date', () => {
    const rec = vi.fn();
    globalThis.VexLedger = { note: rec };
    C.apply(task(), 'today', NOW);
    const token = rec.mock.calls[0][0].undo;
    expect(token).toMatchObject({ kind: 'carry-restore', was: '2026-10-12', now: '2026-10-14' });
    K.setTaskDate({ noteId: token.noteId, index: token.index, plain: token.plain }, token.was);
    expect(notes()[0].content).toContain('call plumber @2026-10-12');
  });
  it('refuses a task that changed since the list was drawn', () => {
    const t = task();
    const n = notes(); n[0].content = n[0].content.replace('call plumber', 'call the plumber'); localStorage.setItem('vex.notes', JSON.stringify(n));
    expect(() => C.apply(t, 'today', NOW)).toThrow(/changed since/);
  });
});

describe('offer()', () => {
  it('asks once a day through the attention gate, and not when nothing is left over', () => {
    const notify = vi.fn((o, show) => { show(); return { route: 'toast' }; });
    globalThis.VexAttention = { notify };
    window.showToast = vi.fn();
    expect(C.offer(NOW)).toBe(true);
    expect(notify.mock.calls[0][0]).toMatchObject({ feature: 'carry-forward', urgency: 'useful', id: '2026-10-14' });
    expect(C.offer(NOW)).toBe(false);                       // same day
    expect(C.offer(NOW + 86400000)).toBe(true);             // next day, still left over
  });
  it('is silent when switched off', () => {
    C.setEnabled(false);
    expect(C.offer(NOW)).toBe(false);
  });
});

describe('brief module', () => {
  it('gives each row Today, Tomorrow and Drop actions', async () => {
    const out = await C.briefModule().build();
    expect(out.lines[0].actions.map(a => a.label)).toEqual(['Today', 'Tomorrow', 'Drop']);
  });
});
