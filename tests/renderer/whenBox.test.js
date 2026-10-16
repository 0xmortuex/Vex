// @vitest-environment jsdom
//
// T2-039: one parser for "fri 17:00 at school", "tomorrow 9", "after the game" (js/snooze-syntax.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const NOW = new Date(2026, 9, 14, 14, 0, 0).getTime();     // Wednesday 14 October 2026, 14:00
const at = (d, h = 0, m = 0) => new Date(2026, 9, d, h, m, 0).getTime();

let W;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  ({ VexWhen: W } = fresh(JS + 'snooze-syntax.js'));
  delete globalThis.VexSnooze; delete globalThis.VexLedger; delete globalThis.TabSnooze;
});

describe('parse()', () => {
  it('reads a weekday with a time and a place', () => {
    const r = W.parse('fri 17:00 at school', NOW);
    expect(r.at).toBe(at(16, 17));
    expect(r.place).toBe('school');
    expect(r.cond).toBe('');
  });
  it('reads a bare hour after a day word', () => {
    expect(W.parse('tomorrow 9', NOW).at).toBe(at(15, 9));
    expect(W.parse('tomorrow evening', NOW).at).toBe(at(15, 19));
  });
  it('reads relative spans in several spellings', () => {
    expect(W.parse('in 2h', NOW).at).toBe(NOW + 2 * 3600000);
    expect(W.parse('in 45 min', NOW).at).toBe(NOW + 45 * 60000);
    expect(W.parse('in three days', NOW).at).toBe(NOW + 3 * 86400000);
  });
  it('reads next week, the weekend and dates', () => {
    expect(W.parse('next week', NOW).at).toBe(at(19, 9));
    expect(W.parse('weekend', NOW).at).toBe(at(17, 10));
    expect(W.parse('oct 20', NOW).at).toBe(at(20, 9));
    expect(W.parse('2026-10-20 8:30', NOW).at).toBe(at(20, 8, 30));
  });
  it('does not mistake a time for a place', () => {
    const r = W.parse('at 5pm', NOW);
    expect(r.place).toBe('');
    expect(r.at).toBe(at(14, 17));
  });
  it('puts the same weekday a week on once its time has passed', () => {
    expect(W.parse('wed 9am', NOW).at).toBe(at(21, 9));
    expect(W.parse('wed 17:00', NOW).at).toBe(at(14, 17));
  });
  it('turns "after the game" into a condition, not a clock time', () => {
    const r = W.parse('after the game', NOW);
    expect(r.cond).toBe('game-end');
    expect(r.at).toBe(0);
  });
  it('says what it did not understand', () => {
    expect(() => W.parse('whenever', NOW)).toThrow(/no day or time I understand/);
    expect(() => W.parse('', NOW)).toThrow(/Say when/);
    expect(() => W.parse('today 7:00', NOW)).toThrow(/already passed/);
    expect(() => W.parse('2026-02-31', NOW)).toThrow(/not a real day/);
  });
});

describe('apply()', () => {
  it('puts a page off through the existing snooze handler with the place as its note', async () => {
    const add = vi.fn(() => ({ id: 'x' }));
    globalThis.VexSnooze = { add };
    const r = await W.apply({ kind: 'page', title: 'Docs', url: 'https://a.test/' }, 'fri 17:00 at school', NOW);
    expect(add).toHaveBeenCalledWith('page', { title: 'Docs', url: 'https://a.test/', ref: 'https://a.test/', note: 'at school' }, at(16, 17), NOW);
    expect(r.place).toBe('school');
  });
  it('refuses an object it does not know', async () => {
    globalThis.VexSnooze = { add: vi.fn() };
    await expect(W.apply({ kind: 'toaster' }, 'tomorrow 9', NOW)).rejects.toThrow(/Cannot put this off/);
  });
  it('refuses when switched off', async () => {
    W.setEnabled(false);
    await expect(W.apply({ kind: 'clip', text: 'x' }, 'tomorrow 9', NOW)).rejects.toThrow(/switched off/);
  });
  it('moves a task date, and makes a reminder only when a time was given', async () => {
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n1', title: 'To-do', content: '- [ ] file taxes @2026-10-14' }]));
    globalThis.OpenTasks = fresh(JS + 'open-tasks.js').OpenTasks;
    globalThis.VexSnooze = { add: vi.fn() };
    const create = vi.fn(async () => ({ id: 'r1' }));
    window.VexQuickReminder = { create };
    const task = () => globalThis.VexPlanKit.openTasks(NOW)[0];
    await W.apply({ kind: 'task', task: task() }, 'oct 20', NOW);
    expect(JSON.parse(localStorage.getItem('vex.notes'))[0].content).toBe('- [ ] file taxes @2026-10-20');
    expect(create).not.toHaveBeenCalled();
    await W.apply({ kind: 'task', task: task() }, 'oct 21 8:30', NOW);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('after the game', () => {
  it('keeps the object, then brings it back ten minutes after Game mode ends', async () => {
    const add = vi.fn(() => ({ id: 'x' }));
    globalThis.VexSnooze = { add };
    const r = await W.apply({ kind: 'page', title: 'Guide', url: 'https://g.test/' }, 'after the game', NOW);
    expect(r.held).toBe(true);
    expect(W.pending()).toHaveLength(1);
    expect(add).not.toHaveBeenCalled();
    const n = await W.release(NOW + 3600000);
    expect(n).toBe(1);
    expect(add.mock.calls[0][2]).toBe(NOW + 3600000 + W.GAME_DELAY_MS);
    expect(W.pending()).toHaveLength(0);
  });
  it('can be taken back', async () => {
    globalThis.VexSnooze = { add: vi.fn() };
    await W.apply({ kind: 'page', title: 'Guide', url: 'https://g.test/' }, 'after the game', NOW);
    W.unhold(W.pending()[0].id);
    expect(W.pending()).toHaveLength(0);
    expect(() => W.unhold('nope')).toThrow(/no longer waiting/);
  });
});
