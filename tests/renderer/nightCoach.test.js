// @vitest-environment jsdom
//
// js/night-coach.js (T1-012): gentle, escalating, never blocking nudges after bedtime,
// counted from real use, silent in Game mode.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.VexIcons = { has: () => true, svg: () => '' };
const { NightCoach } = require('../../src/renderer/js/night-coach.js');

// Tuesday 13 October 2026, 23:45 (bedtime 23:30 by default).
const at = (d, h, m) => new Date(2026, 9, d, h, m, 0, 0);

let clock, said;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  clock = at(13, 23, 45);
  NightCoach._now = () => clock;
  said = [];
  window.showToast = vi.fn((text, kind, ms, opts) => said.push({ text, opts }));
  window.vex = { idleSeconds: vi.fn(async () => 5) };
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  delete globalThis.GameMode; delete globalThis.AttentionState; delete globalThis.VexAttention;
});
afterEach(() => { delete window.vex; delete globalThis.GameMode; delete globalThis.AttentionState; delete globalThis.VexAttention; delete globalThis.ThemeAuto; delete globalThis.TabManager; delete globalThis.DistractionBudget; delete globalThis.TabSnooze; delete globalThis.VexWorkday; });

async function minutes(n, { stepClock = true } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(await NightCoach.tick());
    if (stepClock) clock = new Date(clock.getTime() + 60000);
  }
  return out;
}

describe('the night', () => {
  const bed = 23 * 60 + 30, wake = 6 * 60;
  it('begins at bedtime and ends at the wake-up time, across midnight', () => {
    expect(NightCoach.nightOf(at(13, 23, 29), bed, wake)).toBeNull();
    expect(NightCoach.nightOf(at(13, 23, 30), bed, wake)).toBe('2026-10-13');
    expect(NightCoach.nightOf(at(14, 0, 40), bed, wake)).toBe('2026-10-13');   // after midnight: the same night
    expect(NightCoach.nightOf(at(14, 5, 59), bed, wake)).toBe('2026-10-13');
    expect(NightCoach.nightOf(at(14, 6, 0), bed, wake)).toBeNull();
    expect(NightCoach.nightOf(at(14, 12, 0), bed, wake)).toBeNull();
  });
  it('works for a bedtime after midnight too', () => {
    expect(NightCoach.nightOf(at(14, 1, 30), 60, 6 * 60)).toBe('2026-10-14');
    expect(NightCoach.nightOf(at(14, 0, 30), 60, 6 * 60)).toBeNull();
  });
  it('reads HH:MM and refuses anything else', () => {
    expect(NightCoach.minutesOf('23:30')).toBe(1410);
    expect(NightCoach.minutesOf('6:05')).toBe(365);
    expect(() => NightCoach.minutesOf('24:00')).toThrow(/not a time/);
    expect(() => NightCoach.minutesOf('late')).toThrow();
  });
});

describe('the stages', () => {
  it('gives the first one reached and not yet said', () => {
    expect(NightCoach.nextStage(5, [])).toBeNull();
    expect(NightCoach.nextStage(10, [])).toBe('save');
    expect(NightCoach.nextStage(50, ['save'])).toBe('later');
    expect(NightCoach.nextStage(100, ['save', 'later'])).toBe('last');
    expect(NightCoach.nextStage(100, ['save', 'later', 'last'])).toBeNull();
    expect(NightCoach.nextStage(300, ['save', 'later', 'last', 'more1', 'more2'])).toBe('more3');
  });
  it('grow plainer with the minutes and end after six lines a night', () => {
    expect(NightCoach.STAGES.map(s => s[1])).toEqual([...NightCoach.STAGES.map(s => s[1])].sort((a, b) => a - b));
    expect(NightCoach.STAGES).toHaveLength(6);
  });
});

describe('the bedtime', () => {
  it('is the one chosen, else the wind-down start when that is on, else 23:30', () => {
    expect(NightCoach.bedtime()).toBe('23:30');
    globalThis.ThemeAuto = { windState: () => ({ on: true, start: '22:15' }) };
    expect(NightCoach.bedtime()).toBe('22:15');
    globalThis.ThemeAuto = { windState: () => ({ on: false, start: '22:15' }) };
    expect(NightCoach.bedtime()).toBe('23:30');
    NightCoach.savePrefs({ bedtime: '00:30' });
    expect(NightCoach.bedtime()).toBe('00:30');
  });
  it('refuses a bedtime that is not a time', () => {
    expect(() => NightCoach.savePrefs({ bedtime: '25:00' })).toThrow();
    expect(() => NightCoach.savePrefs({ wake: 'dawn' })).toThrow();
  });
  it('a damaged saved choice starts again, said on the console', () => {
    localStorage.setItem('vex.nightCoach', '{nope');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(NightCoach.prefs()).toEqual(NightCoach.DEFAULTS);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('counting real use', () => {
  it('counts a minute only inside the night', async () => {
    clock = at(13, 20, 0);
    expect(await NightCoach.tick()).toBeNull();
    expect(NightCoach.log().nights).toEqual({});
    clock = at(13, 23, 40);
    await NightCoach.tick();
    expect(NightCoach.log().nights['2026-10-13'].min).toBe(1);
  });
  it('does not count while the computer is idle, or the window is hidden', async () => {
    window.vex.idleSeconds = vi.fn(async () => 600);
    await NightCoach.tick();
    expect(NightCoach.log().nights['2026-10-13']).toBeUndefined();
    window.vex.idleSeconds = vi.fn(async () => 3);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    await NightCoach.tick();
    expect(NightCoach.log().nights['2026-10-13']).toBeUndefined();
  });
  it('remembers when you were last active', async () => {
    await NightCoach.tick();
    expect(NightCoach.log().nights['2026-10-13'].last).toBe(clock.getTime());
  });
  it('does nothing when switched off', async () => {
    NightCoach.setEnabled(false);
    expect(await NightCoach.tick()).toBeNull();
    expect(NightCoach.log().nights).toEqual({});
  });
  it('says so when the window bridge is missing', async () => {
    delete window.vex;
    await expect(NightCoach.tick()).rejects.toThrow(/window bridge/);
  });
  it('keeps two weeks of nights', () => {
    const log = { nights: {} };
    for (let d = 1; d <= 20; d++) log.nights['2026-09-' + String(d).padStart(2, '0')] = { min: 1, last: 1, fired: [], off: false };
    NightCoach._saveLog(log);
    expect(Object.keys(NightCoach.log().nights)).toHaveLength(NightCoach.KEEP_NIGHTS);
  });
});

describe('what it says', () => {
  it('says nothing for the first minutes, then one gentle line with a way to act on it', async () => {
    globalThis.VexWorkday = { endOfDay: vi.fn(() => ({ tabs: 4 })) };
    const out = await minutes(10);
    expect(out.slice(0, 9).every(x => x === null)).toBe(true);
    expect(out[9]).toBe('save');
    expect(said).toHaveLength(1);
    expect(said[0].text).toMatch(/past your bedtime \(23:30\)/);
    expect(said[0].opts.action.label).toBe('Save session');
    said[0].opts.action.run();
    await Promise.resolve();
    expect(globalThis.VexWorkday.endOfDay).toHaveBeenCalled();
  });
  it('says each line once a night, in order, up to six', async () => {
    const out = (await minutes(300)).filter(Boolean);
    expect(out).toEqual(['save', 'later', 'last', 'more1', 'more2', 'more3']);
    expect(said).toHaveLength(6);
  });
  it('the second line offers the social and video tabs, and sends them to the next 09:00 when you accept', async () => {
    const tabs = [
      { id: 'a', url: 'https://youtube.com/watch', title: 'Video' },
      { id: 'b', url: 'https://docs.example/', title: 'Docs' },
      { id: 'c', url: 'https://twitter.com/', title: 'Feed' },
      { id: 'd', url: 'https://reddit.com/', title: 'Active', pinned: false },
    ];
    globalThis.TabManager = { tabs, activeTabId: 'd' };
    globalThis.DistractionBudget = { categoryOf: (u) => (/youtube|twitter|reddit/.test(u) ? (/youtube/.test(u) ? 'video' : 'social') : null) };
    globalThis.TabSnooze = { canSnooze: () => true, snooze: vi.fn() };
    await minutes(40);
    const line = said[1];
    expect(line.text).toMatch(/Send the 2 social and video tabs to tomorrow morning/);
    line.opts.action.run();
    expect(globalThis.TabSnooze.snooze).toHaveBeenCalledTimes(2);
    expect(globalThis.TabSnooze.snooze.mock.calls.map(c => c[0])).toEqual(['a', 'c']);
    const when = new Date(globalThis.TabSnooze.snooze.mock.calls[0][1]);
    expect([when.getDate(), when.getHours(), when.getMinutes()]).toEqual([14, 9, 0]);
  });
  it('the second line is only a kind word when there is nothing to send', async () => {
    globalThis.TabManager = { tabs: [{ id: 'a', url: 'https://docs.example/', title: 'Docs' }], activeTabId: 'a' };
    globalThis.DistractionBudget = { categoryOf: () => null };
    globalThis.TabSnooze = { canSnooze: () => true, snooze: vi.fn() };
    await minutes(40);
    expect(said[1].text).toMatch(/good moment to stop/);
    expect(said[1].opts).toBeUndefined();
  });
  it('is silent in Game mode and counts nothing then', async () => {
    globalThis.GameMode = { gaming: true };
    await minutes(60);
    expect(said).toHaveLength(0);
    expect(NightCoach.log().nights['2026-10-13']).toBeUndefined();
  });
  it('is silent in a meeting, by the attention state', async () => {
    globalThis.AttentionState = { get: () => ({ quiet: true, reason: 'meeting', sources: [{ id: 'meeting' }] }) };
    await minutes(30);
    expect(said).toHaveLength(0);
  });
  it('is not stopped by quiet hours or the wind-down (it is what you set up to hear), but by "Never for this"', async () => {
    globalThis.AttentionState = { get: () => ({ quiet: true, reason: 'wind-down', sources: [{ id: 'wind-down' }] }) };
    globalThis.VexAttention = { isMuted: () => false, request: vi.fn(() => ({ allow: true })), suggest: vi.fn() };
    await minutes(10);
    expect(said).toHaveLength(1);
    expect(globalThis.VexAttention.request).toHaveBeenCalledWith({ feature: 'night-coach', urgency: 'asked', id: 'save' });
    said.length = 0;
    localStorage.clear();
    globalThis.VexAttention = { isMuted: () => true, request: vi.fn(() => ({ allow: true })), suggest: vi.fn() };
    clock = at(13, 23, 45);
    await minutes(40);
    expect(said).toHaveLength(0);
  });
  it('"quiet for tonight" silences the rest of the night but still counts', async () => {
    await minutes(5);
    NightCoach.quietTonight();
    const out = (await minutes(120)).filter(Boolean);
    expect(out).toEqual([]);
    expect(NightCoach.log().nights['2026-10-13'].min).toBe(125);
  });
  it('the first line offers the wind-down once when it is off', async () => {
    globalThis.ThemeAuto = { windState: () => ({ on: false, start: '22:00' }), windSet: vi.fn() };
    globalThis.VexAttention = { isMuted: () => false, request: () => ({ allow: true }), suggest: vi.fn() };
    await minutes(10);
    expect(globalThis.VexAttention.suggest).toHaveBeenCalledTimes(1);
    expect(globalThis.VexAttention.suggest.mock.calls[0][0].action.key).toBe('wind-on');
  });
  it('never blocks: it only shows toasts with one optional action', async () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/night-coach.js'), 'utf8');
    expect(src).not.toMatch(/vexConfirm|vexPrompt|vexAlert\(|alert\(|\.close\(|lock\(/);
  });
});

describe('last week', () => {
  it('lists seven nights, oldest first, with the minutes and the last time', async () => {
    const log = NightCoach.log();
    log.nights['2026-10-12'] = { min: 55, last: at(13, 0, 25).getTime(), fired: [], off: false };
    log.nights['2026-10-10'] = { min: 20, last: at(11, 0, 5).getTime(), fired: [], off: false };
    NightCoach._saveLog(log);
    const rows = NightCoach.week(7, at(13, 12, 0));
    expect(rows).toHaveLength(7);
    expect(rows[0].night).toBe('2026-10-07');
    expect(rows[6].night).toBe('2026-10-13');
    expect(rows.find(r => r.night === '2026-10-12').min).toBe(55);
    expect(rows.find(r => r.night === '2026-10-11').min).toBe(0);
  });
  it('the usual cutoff averages across midnight the right way round', () => {
    const rows = [{ last: at(13, 23, 50).getTime() }, { last: at(14, 0, 40).getTime() }];
    // 23:30 bedtime: 20 and 70 minutes after it, mean 45 -> 00:15
    expect(NightCoach.usualCutoff(rows)).toBe('00:15');
    expect(NightCoach.usualCutoff([{ last: 0 }])).toBe('');
  });
  it('is registered with the Ctrl+K commands and a Settings group by init', () => {
    const regs = [];
    globalThis.VexJobs = { every: vi.fn() };
    globalThis.VexSettingsGroups = { register: (d) => regs.push(d) };
    globalThis.CommandBar = { commands: [] };
    NightCoach.init();
    expect(globalThis.VexJobs.every).toHaveBeenCalledWith('Night coach', 60000, expect.any(Function), { when: 'ui', feature: 'night-coach' });
    expect(regs.map(r => r.id)).toEqual(['night-coach']);
    expect(globalThis.CommandBar.commands.map(c => c.id)).toEqual(['nightcoach-quiet', 'nightcoach-week']);
    delete globalThis.VexJobs; delete globalThis.VexSettingsGroups; delete globalThis.CommandBar;
  });
});
