// @vitest-environment jsdom
//
// T3-019, Wave 5: the two-minute drawer is a New Tab card of its own while something is tagged #2min.
import { describe, it, expect, beforeEach } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let T, S;

const tasks = (...texts) => texts.map((text, i) => ({ text, done: false, noteId: 'n', index: i, noteTitle: 'To-do' }));

beforeEach(() => {
  localStorage.clear();
  ({ VexTwoMinute: T } = fresh(JS + 'quick-tasks.js'));
  ({ NewTabSlots: S } = fresh(JS + 'newtab-slots.js'));
  globalThis.NewTabSlots = S;
  globalThis.VexDefaults = { get: (k, d) => d, set() {}, isExplicit: () => false };
  globalThis.OpenTasks = { notes: () => [], collect: () => [] };
});

describe('the card', () => {
  it('registers a card that rides on the brief section, below the brief and today', () => {
    T.init();
    const d = S.list().find(x => x.id === 'two-minute');
    expect(d).toMatchObject({ slot: 'card', briefSection: 'two-minute', priority: 70 });
    const brief = S.list().find(x => x.id === 'brief'), today = S.list().find(x => x.id === 'today');
    expect(d.priority).toBeLessThan(today.priority);
    expect(today.priority).toBeLessThan(brief.priority);
  });
  it('asks for a place only while something is tagged', () => {
    T.init();
    const d = S.list().find(x => x.id === 'two-minute');
    expect(d.available()).toBe(false);
    globalThis.OpenTasks.collect = () => tasks('call the bank #2min', 'plain chore');
    expect(d.available()).toBe(true);
  });
  it('is off when the drawer is switched off, and with no tasks store', () => {
    T.init();
    const d = S.list().find(x => x.id === 'two-minute');
    globalThis.OpenTasks.collect = () => tasks('call the bank #2min');
    T.setEnabled(false);
    expect(d.available()).toBe(false);
    T.setEnabled(true);
    delete globalThis.OpenTasks;
    expect(d.available()).toBe(false);
  });
  it('takes one of the three card places when there are tasks, and is dropped from the brief otherwise only if not chosen', () => {
    T.init();
    globalThis.OpenTasks.collect = () => tasks('call the bank #2min');
    const plan = S.plan({ layout: 'calm' });
    expect(plan.cards).toContain('two-minute');
    const snap = { morning: { sections: [{ id: 'two-minute' }, { id: 'other' }] }, newtab: { v: 1 } };
    S.applyTo(snap, plan);
    expect(snap.morning.sections.map(s => s.id)).toEqual(['two-minute', 'other']);
    const off = S.plan({ layout: 'calm' });
    expect(off.cards.length).toBeLessThanOrEqual(3);
  });
});
