// @vitest-environment jsdom
//
// T2-045: the week skeleton built from last week (js/week-skeleton.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const at = (d, h = 0, m = 0) => new Date(2026, 9, d, h, m).getTime();
const NOW = at(14, 14);                       // Wednesday 14 October 2026, 14:00

let W, list, create, del;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  ({ VexWeekSkeleton: W } = fresh(JS + 'week-skeleton.js'));
  list = vi.fn(async () => []);
  let n = 0;
  create = vi.fn(async () => ({ ok: true, id: 'r' + (++n) }));
  del = vi.fn(async () => ({ ok: true }));
  window.vex = { reminders: { list, create, delete: del } };
  delete globalThis.FocusOS; delete globalThis.VexLedger;
});

describe('weekStart() and shift()', () => {
  it('finds Monday of this week and of the next', () => {
    expect(W.weekStart(NOW)).toBe(at(12));
    expect(W.weekStart(NOW, true)).toBe(at(19));
    expect(W.weekStart(at(18, 23))).toBe(at(12));                // Sunday belongs to the week before
  });
  it('keeps the weekday and the clock time', () => {
    expect(W.shift(at(13, 10, 30), at(12), at(19))).toEqual({ at: at(20, 10, 30), dayIdx: 1 });
  });
});

describe('build()', () => {
  const from = at(12), to = at(19);
  const items = [
    { id: 'a', text: 'Study block', at: at(13, 10), source: 'reminder' },
    { id: 'b', text: 'Gym', at: at(12, 8), source: 'reminder' },
    { id: 'c', text: 'Outside', at: at(25, 8), source: 'reminder' },       // not last week
    { id: 'd', text: 'Focus block: thesis', at: at(15, 16), source: 'focus' },
  ];
  it('puts each item on the same weekday in the planned week, in time order', () => {
    const out = W.build(items, from, to, { now: NOW });
    expect(out.map(o => [o.text, o.at, o.dayIdx])).toEqual([
      ['Gym', at(19, 8), 0], ['Study block', at(20, 10), 1], ['Focus block: thesis', at(22, 16), 3],
    ]);
  });
  it('leaves out what is already there and what is already past', () => {
    const out = W.build(items, from, to, { now: NOW, existing: [{ at: at(19, 8), text: 'gym' }] });
    expect(out.map(o => o.text)).not.toContain('Gym');
    const thisWeek = W.build([{ id: 'x', text: 'Past', at: at(5, 9), source: 'reminder' }, { id: 'y', text: 'Later', at: at(9, 20), source: 'reminder' }], at(5), at(12), { now: NOW });
    expect(thisWeek.map(o => o.text)).toEqual(['Later']);       // Monday 12th 09:00 has gone; Friday 16th 20:00 has not
  });
});

describe('read()', () => {
  it('takes one-off reminders and Focus OS blocks of last week, not repeats, alarms or its own blocks', async () => {
    list.mockResolvedValue([
      { id: '1', message: 'Pay', at: at(13, 9) },
      { id: '2', message: 'Daily', at: at(13, 9), repeat: 'daily' },
      { id: '3', message: 'Alarm', at: at(13, 9), kind: 'alarm' },
      { id: '4', message: 'Block', at: at(13, 9), focusOsBlock: true },
      { id: '5', message: 'Next', at: at(20, 9) },
    ]);
    globalThis.FocusOS = { goal: () => ({ title: 'thesis' }), state: () => ({ blocks: [{ id: 'b1', state: 'done', start: at(14, 9), end: at(14, 10), goalId: 'g' }, { id: 'b2', state: 'proposed', start: at(14, 11), end: at(14, 12), goalId: 'g' }, { id: 'b3', state: 'planned', start: at(21, 9), end: at(21, 10), goalId: 'g' }] }) };
    const r = await W.read(at(12), at(19));
    expect(r.lastWeek.map(i => i.text)).toEqual(['Pay', 'Focus block: thesis']);
    expect(r.existing.map(i => i.text)).toEqual(['Next', 'Focus block: thesis']);
    expect(r.errors).toEqual([]);
  });
  it('names a store that cannot be read', async () => {
    list.mockRejectedValue(new Error('reminders down'));
    const r = await W.read(at(12), at(19));
    expect(r.errors).toEqual(['reminders: reminders down']);
  });
});

describe('create()', () => {
  const items = [{ text: 'Gym', at: at(19, 8) }, { text: 'Study', at: at(20, 10) }];
  it('makes ordinary reminders and writes a ledger line whose undo deletes them', async () => {
    const rec = vi.fn();
    globalThis.VexLedger = { note: rec };
    expect(await W.create(items, NOW)).toBe(2);
    expect(create.mock.calls.map(c => c[0])).toEqual(['Gym', 'Study']);
    expect(rec.mock.calls[0][0].undo).toEqual({ kind: 'week-uncarry', ids: ['r1', 'r2'] });
  });
  it('leaves nothing behind when one fails', async () => {
    create.mockResolvedValueOnce({ ok: true, id: 'r1' }).mockResolvedValueOnce({ ok: false, error: 'storage full' });
    await expect(W.create(items, NOW)).rejects.toThrow(/Nothing was created: storage full/);
    expect(del).toHaveBeenCalledWith('r1');
  });
  it('needs at least one future item', async () => {
    await expect(W.create([], NOW)).rejects.toThrow(/Tick at least one/);
    await expect(W.create([{ text: 'Past', at: NOW - 1 }], NOW)).rejects.toThrow(/Tick at least one/);
  });
});
