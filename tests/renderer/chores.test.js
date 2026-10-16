// @vitest-environment jsdom
//
// T2-062: recurring chores and bills (js/chores.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const NOW = new Date(2026, 9, 14, 10, 0, 0).getTime();       // Wednesday 14 October 2026
const d = (m, day, h = 0) => new Date(2026, m - 1, day, h).getTime();

let C, create, del;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  ({ VexChores: C } = fresh(JS + 'chores.js'));
  let n = 0;
  create = vi.fn(async () => ({ ok: true, id: 'r' + (++n) }));
  del = vi.fn(async () => ({ ok: true }));
  window.vex = { reminders: { create, delete: del } };
  delete globalThis.VexLedger; delete globalThis.VexJobs; delete globalThis.TabManager;
});

const chore = (over = {}) => ({ id: 'c', name: 'Electricity', cadence: 'monthly', day: 15, month: 1, url: 'https://pay.test/', remind: 3, lastDone: '', createdAt: d(10, 1), remindFor: '', remindId: '', ...over });

describe('occurrences()', () => {
  it('clamps a day that a month does not have', () => {
    const feb = C.occurrences(chore({ day: 31 }), d(2, 1), d(2, 28, 23));
    expect(feb).toEqual([new Date(2026, 1, 28).getTime()]);
  });
  it('steps quarterly and yearly chores from their anchor month', () => {
    const q = C.occurrences(chore({ cadence: 'quarterly', day: 10, month: 1 }), d(1, 1), d(12, 31));
    expect(q.map(t => new Date(t).getMonth() + 1)).toEqual([1, 4, 7, 10]);
    const y = C.occurrences(chore({ cadence: 'yearly', day: 3, month: 6 }), d(1, 1), d(12, 31));
    expect(y.map(t => new Date(t).getMonth() + 1)).toEqual([6]);
  });
});

describe('status()', () => {
  it('is the next due date, labelled', () => {
    const s = C.status(chore(), NOW);
    expect(s).toMatchObject({ due: d(10, 15), days: 1, state: 'week' });
    expect(C.label(s)).toBe('Tomorrow');
  });
  it('does not call a cycle from before the chore existed overdue', () => {
    expect(C.status(chore({ createdAt: d(10, 10) }), NOW).due).toBe(d(10, 15));
  });
  it('calls an untouched earlier cycle overdue, and today today', () => {
    const o = C.status(chore({ createdAt: d(8, 1) }), NOW);
    expect(o).toMatchObject({ due: d(9, 15), state: 'overdue' });
    expect(C.label(o)).toBe('Overdue 29 days');
    expect(C.status(chore({ day: 14 }), NOW).state).toBe('today');
  });
  it('a tick settles its cycle: early, on time or a few days late', () => {
    expect(C.status(chore({ lastDone: '2026-10-10' }), NOW).due).toBe(d(11, 15));        // early for Oct 15
    expect(C.status(chore({ createdAt: d(9, 1), lastDone: '2026-09-18' }), NOW).due).toBe(d(10, 15)); // late for Sep 15
  });
  it('a tick settles the cycles that have started, the closest one included', () => {
    expect(C.status(chore({ createdAt: d(9, 1), lastDone: '2026-09-29' }), NOW).due).toBe(d(10, 15));      // too early for October's
    expect(C.status(chore({ createdAt: d(9, 1), lastDone: '2026-10-31' }), d(11, 1)).due).toBe(d(12, 15));  // nearer November's than October's
  });
});

describe('validation', () => {
  const ok = { name: 'Phone', cadence: 'monthly', day: 5, url: 'https://pay.test/x', remind: 2 };
  it('keeps a good chore and defaults the reminder to three days', () => {
    expect(C.clean({ ...ok, remind: '' })).toMatchObject({ name: 'Phone', day: 5, remind: 3, month: 1 });
  });
  it('refuses a bad name, cadence, day, month, address or lead time', () => {
    expect(() => C.clean({ ...ok, name: ' ' })).toThrow(/Name the chore/);
    expect(() => C.clean({ ...ok, cadence: 'daily' })).toThrow(/how often/);
    expect(() => C.clean({ ...ok, day: 32 })).toThrow(/1 to 31/);
    expect(() => C.clean({ ...ok, cadence: 'yearly', month: 13 })).toThrow(/1 to 12/);
    expect(() => C.clean({ ...ok, url: 'http://pay.test/' })).toThrow(/https/);
    expect(() => C.clean({ ...ok, url: 'javascript:alert(1)' })).toThrow(/https/);
    expect(() => C.clean({ ...ok, remind: 99 })).toThrow(/0 to 30/);
  });
  it('limits the list', () => {
    for (let i = 0; i < C.MAX; i++) C.add(ok, NOW + i);
    expect(() => C.add(ok, NOW)).toThrow(/chores already/);
  });
});

describe('reminders', () => {
  it('makes one for the next due date, with the page address, and not twice', async () => {
    const rec = vi.fn();
    globalThis.VexLedger = { note: rec };
    const c = C.add({ name: 'Rent', cadence: 'monthly', day: 17, url: 'https://pay.test/rent', remind: 3 }, d(10, 1));
    expect(await C.sync(NOW)).toBe(1);
    expect(create.mock.calls[0][0]).toMatch(/^Chore due .*Rent$/);
    expect(create.mock.calls[0][1]).toBe(NOW + 60000);            // 09:00 on the 14th has gone: soon
    expect(create.mock.calls[0][2]).toEqual({ url: 'https://pay.test/rent' });
    expect(await C.sync(NOW)).toBe(0);
    expect(rec.mock.calls[0][0].undo).toMatchObject({ kind: 'chore-unremind', chore: c.id, reminder: 'r1' });
  });
  it('Done takes the reminder back, ticks the cycle and makes the next one', async () => {
    const c = C.add({ name: 'Rent', cadence: 'monthly', day: 17, remind: 3 }, d(10, 1));
    await C.sync(NOW);
    await C.done(c.id, NOW);
    expect(del).toHaveBeenCalledWith('r1');
    expect(C.list()[0].lastDone).toBe('2026-10-14');
    expect(C.list()[0].remindFor).toBe('2026-11-17');
    expect(create.mock.calls[1][1]).toBe(d(11, 14, 9));
  });
  it('no reminder when the lead time is zero, none when switched off, and an error when reminders are missing', async () => {
    C.add({ name: 'Backup', cadence: 'monthly', day: 20, remind: 0 }, d(10, 1));
    expect(await C.sync(NOW)).toBe(0);
    C.setEnabled(false);
    expect(await C.sync(NOW)).toBe(0);
    C.setEnabled(true);
    C.add({ name: 'Phone', cadence: 'monthly', day: 20, remind: 3 }, d(10, 1));
    delete window.vex;
    await expect(C.sync(NOW)).rejects.toThrow(/Reminders are not available/);
  });
});

describe('Open page', () => {
  it('opens the saved address in a tab and nothing else', () => {
    const createTab = vi.fn();
    globalThis.TabManager = { createTab };
    C.open(chore());
    expect(createTab).toHaveBeenCalledWith('https://pay.test/', true);
    expect(() => C.open(chore({ url: '' }))).toThrow(/No page address/);
  });
});

describe('brief module', () => {
  it('lists what is due this week with Done and Open page', async () => {
    C.add({ name: 'Rent', cadence: 'monthly', day: new Date().getDate(), url: 'https://pay.test/', remind: 0 }, Date.now() - 1000);
    const out = await C.briefModule().build();
    expect(out.lines[0].text).toBe('Rent');
    expect(out.lines[0].actions.map(a => a.label)).toEqual(['Done', 'Open page']);
  });
});
