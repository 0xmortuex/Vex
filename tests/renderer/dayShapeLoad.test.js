// @vitest-environment jsdom
//
// T3-023, Wave 5: the day shape's load meter counts the work the Deadline ledger asks of each day.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const NOW = at(14, 8);
const dayStart = (d) => new Date(2026, 9, d).getTime();

let S, L;
const quiet = { events: () => [], reminders: async () => [], occurrences: () => [], blocks: () => [], tasks: () => [] };

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  ({ VexDayShape: S } = fresh(JS + 'day-shape.js'));
  ({ VexDeadlineLedger: L } = fresh(JS + 'deadline-ledger.js'));
  globalThis.VexDeadlineLedger = L;
  document.body.innerHTML = '';
});

const entry = (due, work, over = {}) => ({ id: 'e' + due, title: 'T ' + due, kind: 'exam', due, work, withCards: false, url: '', doneAt: 0, ...over });

describe('what the ledger asks of one day', () => {
  it('spreads the work left evenly up to the due day and asks nothing after it', () => {
    const entries = [entry('2026-10-18', { unit: 'pages', total: 100, done: 20 })];   // 80 left, 4 days from the 14th (today counted)
    expect(L.shareOn(dayStart(14), NOW, entries)).toEqual({ pages: 20 });
    expect(L.shareOn(dayStart(18), NOW, entries)).toEqual({ pages: 20 });
    expect(L.shareOn(dayStart(19), NOW, entries)).toEqual({});
  });
  it('adds entries per unit and skips finished ones', () => {
    const entries = [
      entry('2026-10-16', { unit: 'hours', total: 6, done: 0 }),
      entry('2026-10-15', { unit: 'hours', total: 2, done: 0 }),
      entry('2026-10-16', { unit: 'cards', total: 30, done: 0 }, { id: 'c' }),
      entry('2026-10-16', { unit: 'hours', total: 50, done: 0 }, { id: 'd', doneAt: 5 }),
    ];
    expect(L.shareOn(dayStart(14), NOW, entries)).toEqual({ hours: 3 + 2, cards: 15 });
  });
});

describe('the load meter', () => {
  it('turns hours and tasks into minutes and leaves pages and cards as a list', () => {
    expect(S.countedMinutes({ hours: 2, tasks: 3, pages: 40 })).toBe(120 + 90);
    expect(S.countedMinutes({})).toBe(0);
    expect(S.countedMinutes(undefined)).toBe(0);
    expect(S.countedText({ pages: 40, cards: 20, hours: 0 })).toBe('40 pages, 20 cards');
  });
  it('raises a day\'s load by the counted work and says what was counted', async () => {
    localStorage.setItem(L.KEY, JSON.stringify([entry('2026-10-16', { unit: 'hours', total: 9, done: 0 }), entry('2026-10-16', { unit: 'pages', total: 90, done: 0 }, { id: 'p' })]));
    const w = await S.week(NOW, quiet);
    const today = w.days[0];
    expect(today.counted).toEqual({ hours: 5, pages: 45 });   // 9 hours and 90 pages over the 2 days left
    expect(today.load).toBe(300);
    expect(today.level.key).toBe('heavy');
    expect(w.days[3].counted).toEqual({});               // after the due day
    expect(w.days[3].load).toBe(0);
  });
  it('does nothing when the ledger is off or absent', async () => {
    localStorage.setItem(L.KEY, JSON.stringify([entry('2026-10-16', { unit: 'hours', total: 9, done: 0 })]));
    L.setEnabled(false);
    expect((await S.week(NOW, quiet)).days[0].load).toBe(0);
    delete globalThis.VexDeadlineLedger;
    expect((await S.week(NOW, quiet)).days[0].load).toBe(0);
  });
  it('is a line in the brief and a note in the dialog', async () => {
    const soon = new Date(Date.now() + 2 * 86400000);
    const due = soon.getFullYear() + '-' + String(soon.getMonth() + 1).padStart(2, '0') + '-' + String(soon.getDate()).padStart(2, '0');
    localStorage.setItem(L.KEY, JSON.stringify([entry(due, { unit: 'cards', total: 30, done: 0 })]));
    S._src = () => quiet;
    const out = await S.briefModule().build();
    const line = out.lines.find(l => l.text === 'Counted work today');
    expect(line.detail).toBe('15 cards (from your deadlines)');
  });
});
