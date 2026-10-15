// @vitest-environment jsdom
//
// Focus OS orchestration: it proposes, you confirm, a block runs only when
// started (or auto-start was opted into), what it borrows is put back, and
// every optional module it touches may be absent.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/focus-os-planner.js');
const { FocusOS } = require('../../src/renderer/js/focus-os.js');
const { VexReview } = require('../../src/renderer/js/weekly-review.js');

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();     // the 19th is a Monday
const MON = 19;
const OPTIONAL = ['IcsCalendar', 'Calendar', 'ThemeAuto', 'DistractionBudget', 'FocusFlows', 'GameMode', 'GameSession', 'VexBrief', 'CommandBar', 'VexJobs'];

function fresh() {
  localStorage.clear();
  FocusOS._reload();
  for (const k of OPTIONAL) delete globalThis[k];
  delete window.vex;
  window.showToast = vi.fn();
}

function goal(extra = {}) {
  return FocusOS.addGoal({ title: 'Ship the release', deadline: at(MON + 4, 18), estimateMin: 150, ...extra });
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at(MON, 8, 30)); fresh(); });
afterEach(() => { vi.useRealTimers(); });

describe('goals', () => {
  it('refuses what cannot be planned, with a reason', () => {
    expect(() => FocusOS.addGoal({ title: '  ', deadline: Date.now() + 1e7, estimateMin: 60 })).toThrow(/title/);
    expect(() => FocusOS.addGoal({ title: 'x', deadline: Date.now() - 1000, estimateMin: 60 })).toThrow(/passed/);
    expect(() => FocusOS.addGoal({ title: 'x', deadline: Date.now() + 1e7, estimateMin: 5 })).toThrow(/minutes from 15/);
    expect(() => FocusOS.addGoal({ title: 'x', deadline: Date.now() + 1e7, estimateMin: 60, budget: { categories: ['social'], minutes: 0 } })).toThrow(/budget/i);
    expect(FocusOS.goals()).toEqual([]);
  });

  it('is saved, and everything off by default', () => {
    vi.setSystemTime(at(MON, 8));
    const g = goal();
    expect(g).toMatchObject({ status: 'active', autoStart: false, quiet: false, remind: false, flowId: '', budget: null });
    FocusOS._reload();
    expect(FocusOS.goals().map(x => x.title)).toEqual(['Ship the release']);
  });

  it('throws when storage refuses, instead of claiming it saved', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => goal()).toThrow(/could not save/);
    spy.mockRestore();
  });
});

describe('proposing and confirming', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at(MON, 8, 30)); });

  it('works with no optional module present, and says what it could not read', async () => {
    const g = goal();
    const r = await FocusOS.propose(g.id, at(MON, 8, 30));
    expect(r.feasible).toBe(true);
    expect(r.plannedMin).toBe(150);
    expect(r.sources.calendar).toBe(false);
    expect(r.sources.reminders).toBe(false);
    expect(r.sources.quiet).toBe(false);
    expect(r.sources.windDown).toBe(false);
    expect(FocusOS.blocks().every(b => b.state === 'proposed')).toBe(true);
    expect(FocusOS.active()).toBeNull();            // proposing starts nothing
  });

  it('plans around the calendar, reminders, quiet hours and the wind-down when they exist', async () => {
    globalThis.IcsCalendar = { between: () => [{ summary: 'Standup', start: at(MON, 9), end: at(MON, 10), allDay: false }] };
    globalThis.Calendar = { occurrences: (r) => [r.at] };
    window.vex = {
      reminders: { list: async () => [{ id: 'r', message: 'Call', at: at(MON, 10, 15) }, { id: 'rv', message: 'review', kind: 'review', at: at(MON, 11) }] },
      quiet: { get: async () => ({ enabled: true, start: '16:00', end: '08:00', inWindow: false }) },
    };
    globalThis.ThemeAuto = { windState: () => ({ on: true, start: '14:00', end: '23:00' }) };
    const g = goal({ estimateMin: 400 });
    const r = await FocusOS.propose(g.id, at(MON, 8, 30));
    expect(r.sources).toMatchObject({ calendar: true, reminders: true, quiet: true, windDown: true });
    for (const b of r.blocks) {
      expect(b.start < at(MON, 10) && b.end > at(MON, 9)).toBe(false);                  // standup
      expect(b.start < at(MON, 10, 30) && b.end > at(MON, 10, 15)).toBe(false);          // reminder
      const s = new Date(b.start), e = new Date(b.end);
      const endMin = e.getHours() * 60 + e.getMinutes(), startMin = s.getHours() * 60 + s.getMinutes();
      expect(endMin <= 14 * 60 && startMin >= 9 * 60).toBe(true);                        // before the wind-down, inside the work day
      expect(startMin < 13 * 60 && endMin > 12 * 60).toBe(false);                        // meal
    }
  });

  it('names a source that failed instead of hiding it', async () => {
    globalThis.IcsCalendar = { between: () => { throw new Error('feed broke'); } };
    const g = goal();
    const r = await FocusOS.propose(g.id, at(MON, 8, 30));
    expect(r.warnings.join(' ')).toMatch(/Calendar: feed broke/);
    expect(r.blocks.length).toBeGreaterThan(0);
  });

  it('replaces an earlier proposal and only plans what is not already done', async () => {
    const g = goal();
    await FocusOS.propose(g.id, at(MON, 8, 30));
    const first = FocusOS.proposed(g.id).length;
    await FocusOS.propose(g.id, at(MON, 8, 30));
    expect(FocusOS.proposed(g.id).length).toBe(first);
    await FocusOS.confirmGoal(g.id);
    const b = FocusOS.blocks(g.id)[0];
    await FocusOS.start(b.id, { now: at(MON, 9) });
    await FocusOS.finish(b.id, { now: at(MON, 9, 50), quiet: true });
    const again = await FocusOS.propose(g.id, at(MON, 10));
    expect(again.remainingMin).toBe(100);
    expect(again.plannedMin).toBe(100);
  });

  it('confirm turns the proposal into planned blocks and discard removes it', async () => {
    const g = goal();
    await FocusOS.propose(g.id, at(MON, 8, 30));
    await FocusOS.confirmGoal(g.id);
    expect(FocusOS.blocks(g.id).every(b => b.state === 'planned')).toBe(true);
    await expect(FocusOS.confirmGoal(g.id)).rejects.toThrow(/nothing proposed/);
    const g2 = goal({ title: 'Other' });
    await FocusOS.propose(g2.id, at(MON, 8, 30));
    await FocusOS.discard(g2.id);
    expect(FocusOS.blocks(g2.id)).toEqual([]);
  });

  it('only books reminders on confirm, and only when the goal asked', async () => {
    const create = vi.fn(async (m, at2) => ({ id: 'rem' + at2 }));
    window.vex = { reminders: { list: async () => [], create } };
    const plain = goal();
    await FocusOS.propose(plain.id, at(MON, 8, 30));
    expect(create).not.toHaveBeenCalled();
    await FocusOS.confirmGoal(plain.id);
    expect(create).not.toHaveBeenCalled();
    const asked = goal({ title: 'With reminders', remind: true, estimateMin: 60 });
    await FocusOS.propose(asked.id, at(MON, 8, 30));
    await FocusOS.confirmGoal(asked.id);
    expect(create).toHaveBeenCalledTimes(FocusOS.blocks(asked.id).length);   // 60 min = a 50 and a 10
    expect(create.mock.calls[0][2]).toMatchObject({ focusOsBlock: expect.any(String) });
  });
});

describe('running a block', () => {
  let g, b;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at(MON, 8, 30));
  });
  async function planned(extra) {
    g = goal({ estimateMin: 100, ...extra });
    await FocusOS.propose(g.id, at(MON, 8, 30));
    await FocusOS.confirmGoal(g.id);
    b = FocusOS.blocks(g.id)[0];
    return b;
  }

  it('starts only when told to, and finishes with plain counts', async () => {
    await planned();
    expect(b.state).toBe('planned');
    await FocusOS.tick(b.start + 1000);              // time alone starts nothing
    expect(FocusOS.block(b.id).state).toBe('planned');
    await FocusOS.start(b.id, { now: b.start });
    expect(FocusOS.active().id).toBe(b.id);
    await expect(FocusOS.start(FocusOS.blocks(g.id)[1].id)).rejects.toThrow(/already running/);
    await FocusOS.finish(b.id, { now: b.start + 50 * 60000 });
    expect(FocusOS.active()).toBeNull();
    expect(FocusOS.progressLine(b.start)).toMatch(/^1 of 2 blocks done$/);
  });

  it('works when every optional module is missing', async () => {
    await planned({ flowId: 'f1', quiet: true, budget: { categories: ['social'], minutes: 10 } });
    await expect(FocusOS.start(b.id, { now: b.start })).resolves.toBeTruthy();
    await expect(FocusOS.finish(b.id, { now: b.start + 3000000 })).resolves.toBeTruthy();
  });

  it('brings the flow, budget and quiet hours along and puts them back', async () => {
    const flow = { id: 'f1', name: 'Deep work', openTabs: ['https://a.example/'] };
    globalThis.FocusFlows = { _active: null, _load: () => [flow], activate: vi.fn(function (f) { this._active = { flow: f }; }), end: vi.fn(function () { this._active = null; }) };
    const st = { enabled: false, limits: { social: 60 }, modes: {} };
    globalThis.DistractionBudget = { CATEGORIES: ['social', 'video'], LABELS: {}, state: () => st, save: vi.fn(() => true) };
    const q = { enabled: true, start: '22:00', end: '07:00', inWindow: false };
    const set = vi.fn(async (c) => { Object.assign(q, c); return q; });
    window.vex = { quiet: { get: async () => ({ ...q }), set } };

    await planned({ flowId: 'f1', quiet: true, budget: { categories: ['social', 'video'], minutes: 15, mode: 'block' } });
    await FocusOS.start(b.id, { now: b.start });
    expect(FocusFlows.activate).toHaveBeenCalledTimes(1);
    expect(FocusFlows.activate.mock.calls[0][0].openTabs).toEqual(['https://a.example/']);   // started by hand: its tabs open
    expect(st).toMatchObject({ enabled: true, limits: { social: 15, video: 15 }, modes: { social: 'block', video: 'block' } });
    expect(set).toHaveBeenLastCalledWith({ enabled: true, start: '09:00', end: '09:50' });

    await FocusOS.finish(b.id, { now: b.start + 40 * 60000 });
    expect(FocusFlows.end).toHaveBeenCalledTimes(1);
    expect(st).toMatchObject({ enabled: false, limits: { social: 60 }, modes: {} });
    expect(st.limits.video).toBeUndefined();
    expect(set).toHaveBeenLastCalledWith({ enabled: true, start: '22:00', end: '07:00' });
  });

  it('does not replace a flow the user started, and does not end it', async () => {
    globalThis.FocusFlows = { _active: { flow: { id: 'mine', name: 'Mine' } }, _load: () => [{ id: 'f1', name: 'Deep work' }], activate: vi.fn(), end: vi.fn() };
    await planned({ flowId: 'f1' });
    await FocusOS.start(b.id, { now: b.start });
    await FocusOS.finish(b.id, { now: b.start + 3000000 });
    expect(FocusFlows.activate).not.toHaveBeenCalled();
    expect(FocusFlows.end).not.toHaveBeenCalled();
  });

  it('leaves quiet hours alone when the user is already in them', async () => {
    const set = vi.fn(async () => ({}));
    window.vex = { quiet: { get: async () => ({ enabled: true, start: '08:00', end: '12:00', inWindow: true }), set } };
    await planned({ quiet: true });
    await FocusOS.start(b.id, { now: b.start });
    await FocusOS.finish(b.id, { now: b.start + 3000000 });
    expect(set).not.toHaveBeenCalled();
  });

  it('puts things back when a block is skipped mid-run', async () => {
    const set = vi.fn(async () => ({}));
    window.vex = { quiet: { get: async () => ({ enabled: false, start: '22:00', end: '07:00', inWindow: false }), set } };
    await planned({ quiet: true });
    await FocusOS.start(b.id, { now: b.start });
    await FocusOS.skip(b.id, b.start + 60000);
    expect(set).toHaveBeenLastCalledWith({ enabled: false, start: '22:00', end: '07:00' });
    expect(FocusOS.block(b.id).state).toBe('skipped');
    expect(FocusOS.active()).toBeNull();
  });

  it('puts back what a previous run borrowed if the app was closed mid-block', async () => {
    const set = vi.fn(async () => ({}));
    window.vex = { quiet: { get: async () => ({}), set } };
    FocusOS.state().active = { blockId: 'gone', startedAt: 1, flowId: null, budget: null, quiet: { prev: { enabled: false, start: '21:00', end: '06:00' } } };
    await FocusOS.init();
    expect(set).toHaveBeenCalledWith({ enabled: false, start: '21:00', end: '06:00' });
    expect(FocusOS.state().active).toBeNull();
  });

  it('reports a restore that fails rather than swallowing it', async () => {
    let calls = 0;
    window.vex = { quiet: { get: async () => ({ enabled: false, start: '22:00', end: '07:00', inWindow: false }), set: async () => { if (++calls > 1) throw new Error('main said no'); } } };
    await planned({ quiet: true });
    await FocusOS.start(b.id, { now: b.start });
    await expect(FocusOS.finish(b.id, { now: b.start + 3000000 })).rejects.toThrow(/putting things back failed: quiet hours: main said no/);
    expect(FocusOS.block(b.id).state).toBe('done');
  });
});

describe('the minute check', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at(MON, 8, 30)); });

  async function planFor(extra) {
    const g = goal({ estimateMin: 50, ...extra });
    await FocusOS.propose(g.id, at(MON, 8, 30));
    await FocusOS.confirmGoal(g.id);
    return { g, b: FocusOS.blocks(g.id)[0] };
  }

  it('auto-starts only for a goal that opted in', async () => {
    const { b } = await planFor({ autoStart: true });
    expect((await FocusOS.tick(b.start + 60000)).id).toBe(b.id);
    expect(FocusOS.active().id).toBe(b.id);
  });

  it('never auto-starts while a game runs, and is silent about it', async () => {
    globalThis.GameMode = { gaming: true };
    const { b } = await planFor({ autoStart: true });
    window.showToast.mockClear();
    expect(await FocusOS.tick(b.start + 60000)).toBeNull();
    expect(FocusOS.block(b.id).state).toBe('planned');
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('shows no toast for a manual start or finish during a game', async () => {
    globalThis.GameSession = { active: true };
    const { b } = await planFor({});
    window.showToast.mockClear();
    await FocusOS.start(b.id, { now: b.start });
    await FocusOS.finish(b.id, { now: b.start + 40 * 60000 });
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('lets a block whose time passed lapse without a word or a penalty', async () => {
    const { b } = await planFor({});
    window.showToast.mockClear();
    await FocusOS.tick(b.end + 1);
    const l = FocusOS.block(b.id);
    expect(l.state).toBe('skipped');
    expect(l.lapsed).toBe(true);
    expect(window.showToast).not.toHaveBeenCalled();
    expect(FocusOS.progressLine(b.start)).toBe('No blocks today');
  });

  it('finishes a block that was left running long past its end', async () => {
    const { b } = await planFor({});
    await FocusOS.start(b.id, { now: b.start });
    await FocusOS.tick(b.end + FocusOS.OVERRUN_MS + 1000);
    expect(FocusOS.block(b.id).state).toBe('done');
    expect(FocusOS.active()).toBeNull();
  });
});

describe('milestones', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at(MON, 8, 30)); });

  it('signals the medal engine once per milestone', async () => {
    const seen = [];
    const on = (e) => seen.push(e.detail.id);
    document.addEventListener('vex:medal-signal', on);
    const g = goal({ estimateMin: 50 });
    await FocusOS.propose(g.id, at(MON, 8, 30));
    await FocusOS.confirmGoal(g.id);
    const b = FocusOS.blocks(g.id)[0];
    await FocusOS.start(b.id, { now: b.start });
    await FocusOS.finish(b.id, { now: b.start + 3000000 });
    FocusOS.completeGoal(g.id);
    goal({ title: 'Second' });
    document.removeEventListener('vex:medal-signal', on);
    expect(seen).toEqual(['focus-os-first-goal', 'focus-os-first-plan', 'focus-os-first-block', 'focus-os-day-clear', 'focus-os-goal-done']);
  });
});

describe('joining other modules', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at(MON, 8, 30)); });

  it('init is a no-op for the modules that are not there', async () => {
    const r = await FocusOS.init();
    expect(r).toEqual({ brief: false, review: true, commands: false });   // weekly-review.js is loaded in this file
  });

  it('registers one brief section that is empty without an active goal', async () => {
    const reg = vi.fn();
    globalThis.VexBrief = { register: reg };
    expect(FocusOS.registerBrief()).toBe(true);
    const def = reg.mock.calls[0][0];
    expect(def).toMatchObject({ id: 'focus-os', title: 'Focus' });
    expect(def.isEnabled()).toBe(false);
    expect(def.build()).toBeNull();
    const g = goal({ estimateMin: 50 });
    await FocusOS.propose(g.id, at(MON, 8, 30));
    await FocusOS.confirmGoal(g.id);
    expect(def.isEnabled()).toBe(true);
    const out = def.build();
    expect(out.summary).toBe('0 of 1 block done');
    expect(out.items[0].text).toBe('Ship the release');
    FocusOS.setSettings({ brief: false });
    expect(def.isEnabled()).toBe(false);
  });

  it('is quiet in the brief while a game runs', () => {
    goal();
    globalThis.GameMode = { gaming: true };
    expect(FocusOS.brief.isEnabled()).toBe(false);
  });

  it('adds its section to the weekly review through VexReview', async () => {
    expect(FocusOS.registerReview()).toBe(true);
    const g = goal({ estimateMin: 50 });
    await FocusOS.propose(g.id, at(MON, 8, 30));
    await FocusOS.confirmGoal(g.id);
    const b = FocusOS.blocks(g.id)[0];
    await FocusOS.start(b.id, { now: b.start });
    await FocusOS.finish(b.id, { now: b.start + 50 * 60000, quiet: true });
    window.vex = { reminders: { list: async () => [], onFired: vi.fn() } };
    const data = await VexReview.build(at(MON, 17));
    expect(data.extra['focus-os'].summary).toMatch(/1 of 1 planned blocks done, 50 min of focus/);
    expect(data.extra['focus-os'].items[0]).toMatchObject({ text: 'Ship the release' });
    // and nothing when the person switched it off
    FocusOS.setSettings({ weekly: false });
    expect((await VexReview.build(at(MON, 17))).extra['focus-os']).toBeNull();
  });

  it('a review section that throws is named and never hides the rest', async () => {
    window.vex = { reminders: { list: async () => [], onFired: vi.fn() } };
    VexReview.addSection({ id: 'boom', title: 'Boom', build: () => { throw new Error('nope'); } });
    const data = await VexReview.build(at(MON, 17));
    expect(data.errors.join(' ')).toMatch(/Boom: nope/);
    VexReview.extras = VexReview.extras.filter(x => x.id !== 'boom');
  });

  it('puts its commands in the command bar once, without touching command.js', () => {
    globalThis.CommandBar = { commands: [{ id: 'other' }] };
    FocusOS.registerCommands();
    FocusOS.registerCommands();
    expect(CommandBar.commands.map(c => c.id)).toEqual(['other', 'focus-os', 'focus-os-new', 'focus-os-next', 'focus-os-done']);
  });
});

describe('settings', () => {
  it('validates what is saved', () => {
    expect(() => FocusOS.setSettings({ workFrom: 'early' })).toThrow(/must look like/);
    expect(() => FocusOS.setSettings({ workFrom: '19:00', workTo: '18:00' })).toThrow(/end after/);
    expect(() => FocusOS.setSettings({ blockMin: 5 })).toThrow(/Block length/);
    expect(() => FocusOS.setSettings({ meals: [{ from: '12:00', to: 'x' }] })).toThrow();
    expect(FocusOS.setSettings({ blockMin: 40, meals: [{ from: '12:30', to: '13:15' }] })).toMatchObject({ blockMin: 40, meals: [{ from: '12:30', to: '13:15' }] });
  });
});
