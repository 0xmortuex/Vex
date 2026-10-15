// @vitest-environment jsdom
//
// Focus profiles (js/focus-profiles.js): a rule on a Focus Flow — weekdays, a
// time window, a running game — switches it on and off by itself, without
// opening tabs and without replacing a flow the person started.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let P;
let flows;
let active;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  window.showToast = vi.fn();
  window.VexTabPolicy = { isPrivateWindow: false, canShareTab: () => true };
  active = null;
  flows = [{ id: 'w', name: 'Work', openTabs: ['https://docs.test'], blockSites: [], dimUI: false }];
  globalThis.FocusFlows = {
    _load: () => flows,
    _save: (a) => { flows = a; },
    _host: (u) => { try { return new URL(u).hostname; } catch { return String(u); } },
    get _active() { return active; },
    activate: vi.fn((flow, opts) => { active = { flow }; window.FocusProfiles.applyExtras(flow, (opts && opts.source) || flow); }),
    end: vi.fn(() => { const a = active; active = null; window.FocusProfiles.onEnded(a.flow.id); }),
  };
  await import('../../src/renderer/js/resume-workday.js');
  await import('../../src/renderer/js/focus-profiles.js');
  P = window.FocusProfiles;
});

afterEach(() => { delete globalThis.FocusFlows; vi.restoreAllMocks(); });

const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi); // 2030-01-07 is a Monday

describe('rule matching', () => {
  it('a weekday time window', () => {
    const r = { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' };
    expect(P.matches(r, at(2030, 0, 7, 10, 0))).toBe(true);
    expect(P.matches(r, at(2030, 0, 7, 17, 0))).toBe(false);
    expect(P.matches(r, at(2030, 0, 6, 10, 0))).toBe(false);
  });

  it('a window past midnight belongs to the day it began', () => {
    const r = { days: [5], from: '22:00', to: '02:00' };   // Friday night
    expect(P.matches(r, at(2030, 0, 11, 23, 0))).toBe(true);   // Fri 23:00
    expect(P.matches(r, at(2030, 0, 12, 1, 0))).toBe(true);    // Sat 01:00
    expect(P.matches(r, at(2030, 0, 12, 23, 0))).toBe(false);  // Sat 23:00
  });

  it('a game rule needs a game, and a named one needs that game', () => {
    expect(P.matches({ anyGame: true }, new Date(), { game: false, app: '' })).toBe(false);
    expect(P.matches({ anyGame: true }, new Date(), { game: true, app: 'Foo' })).toBe(true);
    expect(P.matches({ apps: ['foo'] }, new Date(), { game: true, app: 'Foo' })).toBe(true);
    expect(P.matches({ apps: ['bar'] }, new Date(), { game: true, app: 'Foo' })).toBe(false);
  });

  it('a rule that names nothing never matches', () => {
    expect(P.matches({}, new Date())).toBe(false);
  });
});

describe('switching', () => {
  beforeEach(() => {
    P.setRule('w', { anyGame: true });
    window.VexWorkflow.setPref('focusAuto', true);
  });

  it('does nothing while the setting is off', () => {
    window.VexWorkflow.setPref('focusAuto', false);
    P._game = true;
    expect(P.evaluate()).toBeNull();
    expect(FocusFlows.activate).not.toHaveBeenCalled();
  });

  it('switches on with no tabs opened, and off when the rule stops', () => {
    P._game = true;
    expect(P.evaluate().id).toBe('w');
    expect(FocusFlows.activate.mock.calls[0][0].openTabs).toEqual([]);
    P._game = false;
    P.evaluate();
    expect(FocusFlows.end).toHaveBeenCalled();
    expect(active).toBeNull();
  });

  it('leaves a flow the person started alone', () => {
    active = { flow: { id: 'other' } };
    P._game = true;
    expect(P.evaluate()).toBeNull();
    expect(FocusFlows.activate).not.toHaveBeenCalled();
  });

  it('is not switched on again after the person ended it, until the rule has stopped', () => {
    P._game = true;
    P.evaluate();
    FocusFlows.end();                 // by hand
    expect(P.evaluate()).toBeNull();
    P._game = false;
    P.evaluate();
    P._game = true;
    expect(P.evaluate().id).toBe('w');
  });
});

describe('data hook', () => {
  it('snapshot lists the profiles with their rules', () => {
    P.setRule('w', { days: [1], from: '09:00', to: '10:00' });
    const s = window.VexWorkflow.snapshot().focus;
    expect(s.profiles[0].name).toBe('Work');
    expect(s.autoSwitch).toBe(false);
  });
});
