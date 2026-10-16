// @vitest-environment jsdom
//
// js/quiet-defaults.js: the rarely used parts a NEW profile keeps out of sight. An existing profile
// sees what it always saw, a choice is never overwritten, and everything comes back on request.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

let Q;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  for (const n of ['VexDefaults', 'VexMigrations', 'VexQuietDefaults', 'Onboarding', 'VexAttention', 'VexLedger', 'SidebarManager']) delete globalThis[n];
  const d = fresh('vex-defaults.js');
  globalThis.VexDefaults = d.VexDefaults; globalThis.VexMigrations = d.VexMigrations;
  Q = fresh('quiet-defaults.js').VexQuietDefaults; globalThis.VexQuietDefaults = Q;
});

const profile = (used) => { globalThis.Onboarding = { done: () => false, _usedBefore: () => used }; };

describe('who starts quiet', () => {
  it('a new profile starts quiet: timer, stopwatch, site dark mode and boosts are out of sight', () => {
    profile(false);
    expect(Q._migrateBody()).toBe('quiet');
    for (const id of ['clock-timer', 'clock-stopwatch', 'site-dark', 'site-boosts']) expect(Q.hidden(id), id).toBe(true);
    expect(Q.isExplicit()).toBe(false);          // Vex's default, not the person's choice
  });

  it('a profile that already existed sees everything, as before', () => {
    profile(true);
    expect(Q._migrateBody()).toBe('all');
    for (const id of ['clock-timer', 'clock-stopwatch', 'site-dark', 'site-boosts']) expect(Q.hidden(id), id).toBe(false);
  });

  it('before anything has run, nothing is hidden', () => {
    expect(Q.hidden('clock-timer')).toBe(false);
  });

  it('never overrides a choice', () => {
    profile(false);
    VexDefaults.set('quietDefaults', { mode: 'all', revealed: [] });
    expect(Q._migrateBody()).toBe('kept');
    expect(Q.hidden('clock-timer')).toBe(false);
  });

  it('runs once through the migration list', () => {
    profile(false);
    expect(Q.migrate().ran).toBe(true);
    profile(true);
    expect(Q.migrate().ran).toBe(false);
    expect(Q.state().mode).toBe('quiet');
  });
});

describe('bringing one back', () => {
  beforeEach(() => { profile(false); Q._migrateBody(); });

  it('reveal keeps it shown for good, records a choice and an undo', () => {
    const notes = [];
    globalThis.VexLedger = { note: (l) => notes.push(l) };
    expect(Q.reveal('clock-stopwatch', { by: 'you opened it' })).toBe(true);
    expect(Q.hidden('clock-stopwatch')).toBe(false);
    expect(Q.hidden('clock-timer')).toBe(true);
    expect(Q.isExplicit()).toBe(true);
    expect(notes[0]).toMatchObject({ feature: 'quiet-defaults', undo: { kind: 'quiet-defaults-hide', id: 'clock-stopwatch' } });
    Q.hideAgain('clock-stopwatch');
    expect(Q.hidden('clock-stopwatch')).toBe(true);
  });

  it('refuses a name it does not know', () => {
    expect(() => Q.reveal('nonsense')).toThrow(/not something/);
  });

  it('showAll and quietAgain are choices', () => {
    Q.showAll();
    expect(Q.hiddenItems().filter(i => i.kind !== 'panel')).toEqual([]);
    Q.quietAgain();
    expect(Q.hidden('site-boosts')).toBe(true);
  });

  it('a hidden sidebar panel comes back by clearing its hidden flag and marking it chosen', () => {
    localStorage.setItem('vex.panelOverrides', JSON.stringify({ feeds: { hidden: true } }));
    const applied = vi.fn();
    globalThis.SidebarManager = { applyPanelOverrides: applied };
    expect(Q.hidden('panel-feeds')).toBe(true);
    Q.reveal('panel-feeds');
    expect(JSON.parse(localStorage.getItem('vex.panelOverrides')).feeds).toEqual({ hidden: false, chosen: true });
    expect(applied).toHaveBeenCalled();
    expect(Q.hidden('panel-feeds')).toBe(false);
  });
});

describe('the "try it" offer', () => {
  beforeEach(() => { profile(false); Q._migrateBody(); });

  it('offers one through the Attention Inbox, at most one a week, never the same twice', () => {
    const suggest = vi.fn(() => true);
    globalThis.VexAttention = { suggest };
    const t0 = 1e12;
    expect(Q.offer(t0).id).toBe('clock-timer');
    expect(suggest.mock.calls[0][0]).toMatchObject({ feature: 'quiet-defaults', action: { key: 'reveal:clock-timer' } });
    expect(Q.offer(t0 + 3 * 86400000)).toBeNull();
    expect(Q.offer(t0 + 8 * 86400000).id).toBe('clock-stopwatch');
  });

  it('offers nothing on a profile that sees everything', () => {
    globalThis.VexAttention = { suggest: vi.fn(() => true) };
    Q.showAll();
    expect(Q.offer(1e12)).toBeNull();
  });
});

describe('the surfaces that use it', () => {
  const read = (rel) => require('fs').readFileSync(path.join(JS, rel), 'utf8');
  it('the Clock panel drops the tab and opens it when asked for directly', () => {
    const s = read('clock-panel.js');
    expect(s).toContain('QUIET_TAB');
    expect(s).toContain("VexQuietDefaults.reveal(this.QUIET_TAB[this._tab]");
    expect(s).toContain("['alarms', 'Alarms', 'alarm']");     // reminders are not hideable
  });
  it('the site panel never hides a row that is in use', () => {
    expect(read('site-panel.js')).toContain("quiet('site-dark', dark || darkGlobal)");
    expect(read('site-panel.js')).toContain("quiet('site-boosts', boost)");
  });
});
