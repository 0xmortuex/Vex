// @vitest-environment jsdom
//
// T2-055 / Focus OS (Wave 6): when asked to, Focus OS proposes blocks as long as the person really stays with something
// in the workspace in front (js/focus-calibration.js), for that proposal only; the setting itself is never changed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
require(JS + 'focus-os-planner.js');
const { FocusOS } = require(JS + 'focus-os.js');
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();     // the 19th is a Monday
const MON = 19;
const MIN = 60000;

let F;
function spans(ws, mins) {
  localStorage.setItem('vex.focusCal', JSON.stringify({ v: 1, spans: { [ws]: mins.map((min, i) => ({ min, kind: 'other', at: 1000 + i })) } }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(MON, 8, 30));
  localStorage.clear();
  FocusOS._reload();
  for (const k of ['IcsCalendar', 'Calendar', 'ThemeAuto', 'DistractionBudget', 'FocusFlows', 'GameMode', 'GameSession', 'VexBrief', 'CommandBar', 'VexJobs']) delete globalThis[k];
  delete window.vex;
  window.showToast = vi.fn();
  globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  ({ VexFocusCal: F } = fresh(JS + 'focus-calibration.js'));
  globalThis.VexFocusCal = F;
  globalThis.WorkspaceManager = { activeId: 'ws_school', workspaces: [{ id: 'ws_school', name: 'School' }] };
});
afterEach(() => { vi.useRealTimers(); delete globalThis.VexFocusCal; delete globalThis.WorkspaceManager; delete globalThis.VexPlanKit; });

const goal = () => FocusOS.addGoal({ title: 'Write the report', deadline: at(MON + 4, 18), estimateMin: 120 });
const lengths = (r) => r.blocks.map(b => Math.round((b.end - b.start) / MIN));

describe('proposals with the measured length', () => {
  it('use the setting\'s 50 minutes until the person asks for the measured length', async () => {
    spans('ws_school', [30, 30, 35, 30, 30, 35, 30, 30]);
    expect(F.blockFor()).toBe(0);                       // switched off by default
    const r = await FocusOS.propose(goal().id, at(MON, 8, 30));
    expect(lengths(r)[0]).toBe(50);
    expect(r.calibratedBlockMin).toBe(0);
  });

  it('use the median of the workspace in front when asked, say so, and leave the setting alone', async () => {
    spans('ws_school', [30, 30, 35, 30, 30, 35, 30, 30]);
    F.setPlanWith(true);
    expect(F.blockFor()).toBe(30);
    const r = await FocusOS.propose(goal().id, at(MON, 8, 30));
    expect(lengths(r)[0]).toBe(30);
    expect(r.calibratedBlockMin).toBe(30);
    expect(FocusOS.settings().blockMin).toBe(50);
    const { FocusOSUI } = require(JS + 'focus-os-ui.js');
    expect(FocusOSUI._noteText(r)).toMatch(/Blocks are 30 minutes: how long you really stay with something in this workspace/);
  });

  it('fall back to the setting for a workspace with too few spans, and for another workspace', async () => {
    spans('ws_school', [30, 30, 35]);
    F.setPlanWith(true);
    expect(F.blockFor()).toBe(0);
    expect(lengths(await FocusOS.propose(goal().id, at(MON, 8, 30)))[0]).toBe(50);
    spans('ws_other', [20, 20, 20, 20, 20, 20, 20, 20]);
    expect(F.blockFor('ws_other')).toBe(20);
    expect(F.blockFor('ws_school')).toBe(0);
  });

  it('say nothing when the measured length is the setting\'s own, and do nothing when the module is off', async () => {
    spans('ws_school', [50, 50, 50, 50, 50, 50, 50, 50]);
    F.setPlanWith(true);
    const r = await FocusOS.propose(goal().id, at(MON, 8, 30));
    expect(r.calibratedBlockMin).toBe(0);
    F.setEnabled(false);
    expect(F.blockFor()).toBe(0);
    expect(F.planWith()).toBe(false);
  });

  it('a damaged choice is an error, not an empty one', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => F.planWith()).toThrow(/could not be read/);
    spy.mockRestore();
  });
});
