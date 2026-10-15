// @vitest-environment jsdom
//
// New Tab by time of day: which of the four profiles fits, from times the user
// sets, and how the choice is announced.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { VexTimeOfDay } = require('../../src/renderer/js/time-of-day.js');

// A Tuesday (2026-10-13) and a Saturday (2026-10-17), local time.
const tue = (h, m = 0) => new Date(2026, 9, 13, h, m);
const sat = (h, m = 0) => new Date(2026, 9, 17, h, m);

beforeEach(() => { localStorage.clear(); VexTimeOfDay.stop(); });

describe('pick', () => {
  it('follows the default times through a weekday', () => {
    const at = (h, m) => VexTimeOfDay.pick(tue(h, m), {});
    expect(at(4, 59)).toBe('winddown');   // still last night's
    expect(at(5, 0)).toBe('brief');
    expect(at(8, 59)).toBe('brief');
    expect(at(9, 0)).toBe('project');
    expect(at(16, 59)).toBe('project');
    expect(at(17, 0)).toBe('reading');
    expect(at(20, 59)).toBe('reading');
    expect(at(21, 0)).toBe('winddown');
    expect(at(0, 30)).toBe('winddown');
  });

  it('uses the times it is given', () => {
    const prefs = { starts: { brief: '07:30', project: '10:00', reading: '15:00', winddown: '19:00' } };
    expect(VexTimeOfDay.pick(tue(7, 29), prefs)).toBe('winddown');
    expect(VexTimeOfDay.pick(tue(7, 30), prefs)).toBe('brief');
    expect(VexTimeOfDay.pick(tue(15, 0), prefs)).toBe('reading');
  });

  it('works when the user puts them in another order', () => {
    // Night-shift: wind-down at 08:00, brief at 18:00.
    const prefs = { starts: { winddown: '08:00', brief: '18:00', project: '20:00', reading: '02:00' } };
    expect(VexTimeOfDay.pick(tue(3, 0), prefs)).toBe('reading');
    expect(VexTimeOfDay.pick(tue(9, 0), prefs)).toBe('winddown');
    expect(VexTimeOfDay.pick(tue(19, 0), prefs)).toBe('brief');
    expect(VexTimeOfDay.pick(tue(21, 0), prefs)).toBe('project');
    expect(VexTimeOfDay.pick(tue(1, 0), prefs)).toBe('project');   // yesterday's last
  });

  it('shows reading for the project hours at the weekend, or what the user chose', () => {
    expect(VexTimeOfDay.pick(sat(11), {})).toBe('reading');
    expect(VexTimeOfDay.pick(sat(11), { weekendProject: 'brief' })).toBe('brief');
    expect(VexTimeOfDay.pick(sat(7), {})).toBe('brief');            // the morning is still the morning
  });

  it('a pinned profile wins over the clock', () => {
    expect(VexTimeOfDay.pick(tue(11), { pinned: 'winddown' })).toBe('winddown');
    expect(VexTimeOfDay.pick(tue(11), { pinned: 'nonsense' })).toBe('project');
  });

  it('bad times fall back to the default, and bad dates are an error', () => {
    expect(VexTimeOfDay.pick(tue(10), { starts: { project: '25:99' } })).toBe('project');
    expect(VexTimeOfDay.cleanPrefs({ starts: { brief: '7:05' } }).starts.brief).toBe('07:05');
    expect(() => VexTimeOfDay.pick('not a date', {})).toThrow(/date/);
  });

  it('accepts a timestamp', () => {
    expect(VexTimeOfDay.pick(tue(18).getTime(), {})).toBe('reading');
  });
});

describe('snapshot and the event', () => {
  it('says what fits, why, and what is next', () => {
    VexTimeOfDay.savePrefs({ enabled: true });
    const s = VexTimeOfDay.snapshot(tue(10));
    expect(s).toMatchObject({ enabled: true, profile: 'project', label: 'Project', reason: 'clock', since: '09:00', next: { profile: 'reading', at: '17:00' }, weekend: false });
    expect(VexTimeOfDay.snapshot(sat(10))).toMatchObject({ profile: 'reading', reason: 'weekend', weekend: true });
    VexTimeOfDay.savePrefs({ pinned: 'brief' });
    expect(VexTimeOfDay.snapshot(tue(22))).toMatchObject({ profile: 'brief', reason: 'pinned' });
  });

  it('is off until asked for', () => {
    expect(VexTimeOfDay.snapshot(tue(10)).enabled).toBe(false);
  });

  it('announces a change once, and again when it changes or is switched off', () => {
    const seen = [];
    const on = (e) => seen.push(e.detail);
    window.addEventListener('vex:newtab-profile', on);
    try {
      VexTimeOfDay.savePrefs({ enabled: true });
      const first = seen.length;
      expect(first).toBe(1);
      expect(seen[0].enabled).toBe(true);
      VexTimeOfDay.tick(false);
      expect(seen.length).toBe(first);                     // nothing changed
      VexTimeOfDay.savePrefs({ pinned: 'winddown' });
      expect(seen.at(-1).profile).toBe('winddown');
      VexTimeOfDay.savePrefs({ enabled: false });
      expect(seen.at(-1).enabled).toBe(false);
    } finally { window.removeEventListener('vex:newtab-profile', on); }
  });
});
