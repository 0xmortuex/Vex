// @vitest-environment jsdom
//
// T2-024: close the day, with the top 3 for tomorrow (js/close-day.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const NOW = new Date(2026, 9, 14, 21, 0, 0).getTime();
const notes = () => JSON.parse(localStorage.getItem('vex.notes'));

let D, K;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n1', title: 'To-do', content: '- [ ] send invoice @2026-10-14\n- [ ] old thing @2026-10-10\n- [ ] next week @2026-10-21\n- [ ] undated', updatedAt: '2026-10-01T00:00:00Z' }]));
  globalThis.OpenTasks = fresh(JS + 'open-tasks.js').OpenTasks;
  K = globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  ({ VexCloseDay: D } = fresh(JS + 'close-day.js'));
  for (const g of ['VexPark', 'NotesPanel', 'VexAttention', 'VexJobs']) delete globalThis[g];
});

describe('collect()', () => {
  it('lists tasks dated today or earlier, and nothing from later days', () => {
    const { groups } = D.collect(NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(i => i.text)).toEqual(['old thing', 'send invoice']);
    expect(groups[0].items[0].sub).toMatch(/overdue/);
  });
  it('adds parked contexts and an unsaved note when those exist', () => {
    globalThis.VexPark = { cards: () => [{ id: 'p1', note: 'halfway through the essay', wsName: 'School', tabs: [1, 2], at: 1 }, { id: 'p2', note: 'old', tabs: [], resumedAt: 5 }] };
    globalThis.NotesPanel = { _editorDirty: () => true, flush: vi.fn() };
    const ids = D.collect(NOW).groups.map(g => g.source.id);
    expect(ids).toEqual(['tasks', 'parked', 'notes']);
    expect(D.collect(NOW).groups[1].items).toHaveLength(1);
  });
  it('names a source that cannot be read instead of treating it as empty', () => {
    D.registerSource({ id: 'drafts', title: 'Drafts', list() { throw new Error('store locked'); }, actions: [{ key: 'keep', label: 'Keep', run() {} }] });
    expect(D.collect(NOW).errors[0]).toBe('Drafts: store locked');
    D._sources.clear();
  });
});

describe('the choices', () => {
  it('Tomorrow dates a task tomorrow; Drop takes the date off but keeps the task', () => {
    const tasks = D.sources(NOW)[0];
    const [old, inv] = tasks.list();
    tasks.actions.find(a => a.key === 'tomorrow').run(inv);
    tasks.actions.find(a => a.key === 'drop').run(old);
    const text = notes()[0].content;
    expect(text).toContain('- [ ] send invoice @2026-10-15');
    expect(text).toContain('- [ ] old thing\n');
    expect(text.split('\n')).toHaveLength(4);
  });
  it('Drop on a parked card dismisses it; Tomorrow makes a reminder at 09:00', async () => {
    const patch = vi.fn();
    globalThis.VexPark = { cards: () => [{ id: 'p1', note: 'essay', tabs: [], at: 1 }], _patch: patch };
    const create = vi.fn(async () => ({ id: 'r' }));
    window.VexQuickReminder = { create };
    const parked = D.sources(NOW).find(s => s.id === 'parked');
    const [card] = parked.list();
    parked.actions.find(a => a.key === 'drop').run(card);
    expect(patch).toHaveBeenCalledWith('p1', { dismissedAt: NOW });
    await parked.actions.find(a => a.key === 'tomorrow').run(card);
    expect(create.mock.calls[0][1].getTime()).toBe(new Date(2026, 9, 15, 9, 0, 0).getTime());
  });
});

describe('setTop3()', () => {
  it('adds new lines as tasks dated tomorrow in the To-do note', () => {
    expect(D.setTop3([{ text: 'write the report' }, { text: '' }, { text: 'call mum' }], NOW)).toBe(2);
    const text = notes()[0].content;
    expect(text).toContain('- [ ] write the report @2026-10-15');
    expect(text).toContain('- [ ] call mum @2026-10-15');
  });
  it('dates an existing task instead of copying it', () => {
    const t = K.openTasks(NOW).find(x => x.plain === 'undated');
    D.setTop3([{ text: 'undated', task: t }], NOW);
    expect(notes()[0].content).toContain('- [ ] undated @2026-10-15');
    expect(notes()[0].content.match(/undated/g)).toHaveLength(1);
  });
  it('allows three at most', () => {
    expect(() => D.setTop3([{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }], NOW)).toThrow(/Three is the limit/);
  });
});

describe('the evening notice', () => {
  it('is due only after the chosen hour and only once a day', () => {
    expect(D.nudgeDue(NOW, { nudgeAt: '' }, '')).toBe(false);
    expect(D.nudgeDue(NOW, { nudgeAt: '22:00' }, '')).toBe(false);
    expect(D.nudgeDue(NOW, { nudgeAt: '20:30' }, '')).toBe(true);
    expect(D.nudgeDue(NOW, { nudgeAt: '20:30' }, '2026-10-14')).toBe(false);
  });
  it('goes through the attention gate as a useful notice', () => {
    D.setPrefs({ nudgeAt: '20:30' });
    const notify = vi.fn(() => ({ route: 'inbox' }));
    globalThis.VexAttention = { notify };
    expect(D.nudge(NOW)).toBe(true);
    expect(notify.mock.calls[0][0]).toMatchObject({ feature: 'close-day', urgency: 'useful' });
    expect(D.nudge(NOW)).toBe(false);
  });
  it('refuses a bad hour', () => { expect(() => D.setPrefs({ nudgeAt: '25:00' })).toThrow(/21:30/); });
});
