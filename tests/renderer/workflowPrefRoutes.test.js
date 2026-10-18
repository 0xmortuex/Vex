// @vitest-environment jsdom
//
// Resume workday, the weekly note, the release radar and focus profiles are switched by a preference in
// VexWorkflow. The Settings row wrote the preference AND called init(); the VexUsage adapter (Library's
// Turn on, Discover, Feature usage, Minimal Vex) wrote the preference only, so their commands and jobs
// were neither registered nor removed. The follow-up now hangs on the preference itself (onPref), so every
// route that writes it brings the feature along.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(JS + p)]; return require(JS + p); };

let WF;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  globalThis.VexProblems = { note: vi.fn() };
  window.VexProblems = globalThis.VexProblems;
  delete globalThis.CommandBar; delete globalThis.VexJobs; delete globalThis.FocusFlows;
  ({ VexWorkflow: WF } = fresh('resume-workday.js'));
  window.VexWorkflow = WF;
});

describe('VexWorkflow.setPref runs the hooks of the preference', () => {
  it('after a successful write, with the new value, for that key only', () => {
    const a = vi.fn(), b = vi.fn();
    WF.onPref('alpha', a); WF.onPref('beta', b);
    expect(WF.setPref('alpha', true)).toBe(true);
    expect(a).toHaveBeenCalledWith(true);
    expect(b).not.toHaveBeenCalled();
  });
  it('reports a hook that throws instead of hiding it, and still saves and returns true', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    WF.onPref('gamma', () => { throw new Error('boom'); });
    expect(WF.setPref('gamma', 1)).toBe(true);
    expect(WF.pref('gamma')).toBe(1);
    expect(VexProblems.note).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
  it('runs no hook when the write failed', () => {
    const fn = vi.fn();
    WF.onPref('delta', fn);
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    try { expect(WF.setPref('delta', true)).toBe(false); } finally { Storage.prototype.setItem = orig; }
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('the four features follow the preference on the adapter route (setPref alone)', () => {
  it('resume workday: the hook calls the module\'s own init() on both on and off', () => {
    const { VexWorkday } = require(JS + 'resume-workday.js');
    const init = vi.spyOn(VexWorkday, 'init').mockImplementation(() => true);
    WF.setPref('workday', true);
    WF.setPref('workday', false);
    expect(init).toHaveBeenCalledTimes(2);
  });

  it('focus profiles: switching on starts the timed check, off starts nothing', () => {
    const { FocusProfiles } = fresh('focus-profiles.js');
    const init = vi.spyOn(FocusProfiles, 'init').mockImplementation(() => true);
    WF.setPref('focusAuto', true);
    expect(init).toHaveBeenCalledTimes(1);
    WF.setPref('focusAuto', false);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('weekly note, release radar and focus profiles register a hook for their key', () => {
    const fs = require('fs');
    const read = (f) => fs.readFileSync(require.resolve(JS + f), 'utf8');
    expect(read('resume-workday.js')).toMatch(/onPref\('workday'/);
    expect(read('weekly-note.js')).toMatch(/onPref\('weeklyNote'/);
    expect(read('patch-radar.js')).toMatch(/onPref\('releaseRadar'/);
    expect(read('focus-profiles.js')).toMatch(/onPref\('focusAuto'/);
    // and the Settings rows no longer repeat the follow-up
    expect(read('weekly-note.js')).not.toMatch(/setPref\('weeklyNote', on\)[^\n]*\n\s*this\.init\(\)/);
    expect(read('patch-radar.js')).not.toMatch(/setPref\('releaseRadar', on\)[^\n]*\n\s*this\.init\(\)/);
  });

  it('weekly note: setPref(weeklyNote) adds the command and a background job, off removes them', () => {
    globalThis.CommandBar = { commands: [] };
    const jobs = { started: 0, stopped: 0 };
    globalThis.VexJobs = { every: () => { jobs.started++; return { stop() { jobs.stopped++; } }; } };
    WF.addCommand = (c) => { globalThis.CommandBar.commands = globalThis.CommandBar.commands.filter(x => x.id !== c.id); globalThis.CommandBar.commands.push(c); };
    fresh('weekly-note.js');
    WF.setPref('weeklyNote', true);
    expect(CommandBar.commands.map(c => c.id)).toContain('weekly-note');
    expect(jobs.started).toBe(1);
    WF.setPref('weeklyNote', false);
    expect(CommandBar.commands.map(c => c.id)).not.toContain('weekly-note');
    expect(jobs.stopped).toBe(1);
  });
});
