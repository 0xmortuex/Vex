// @vitest-environment jsdom
//
// The Clock panel's Reminders tab (js/reminders-tab.js) is a front door over stores that stay where
// they are. What has to stay true:
//   * the list is built from each store through that store's own API, and a store that cannot be
//     read is named while the others still answer,
//   * adding goes to the function that already adds that kind (no new storage, no new scheduler),
//   * every old way in still resolves: the Remind me command, the schedules alias, the page and
//     follow-up commands, the Alarms tab.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../src/renderer/js');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { VexRemindersTab } = require('../../src/renderer/js/reminders-tab.js');

// Sunday 13 September 2026, 14:30 local.
const NOW = new Date(2026, 8, 13, 14, 30, 0, 0).getTime();
const DAY = 86400000;

const fakeSources = (over = {}) => ({
  reminders: async () => [
    { id: 'r1', message: 'Call the dentist', at: NOW + 3600000, kind: 'reminder', repeat: 'daily' },
    { id: 'r2', message: 'Check the order', site: 'shop.example', at: null },
    { id: 'r3', message: 'Wake up', at: NOW + 7200000, kind: 'alarm' },
    { id: 'r4', message: 'Tea', at: NOW + 60000, kind: 'timer' },
    { id: 'r5', message: 'Already rang', at: NOW - 1000, firedAt: NOW - 500 },
  ],
  pages: () => [{ id: 'p1', text: 'Reply before leaving', trigger: 'close', scope: 'url', url: 'https://mail.example/inbox', host: 'mail.example' }, { id: 'p2', text: 'old', trigger: 'visit', firedAt: 5, url: 'x', host: 'x' }],
  followUps: () => [
    { id: 'f1', dir: 'owe', what: 'Send the form', due: NOW + 2 * DAY, doneAt: 0 },
    { id: 'f2', dir: 'waiting', who: 'Selin', what: 'The signed paper', since: NOW - 4 * DAY, doneAt: 0 },
    { id: 'f3', dir: 'owe', what: 'Done already', doneAt: 5 },
  ],
  deadlines: () => [{ id: 'd1', title: 'Exam', due: '2026-09-20', doneAt: 0 }, { id: 'd2', title: 'Old', due: '2026-09-01', doneAt: 9 }],
  game: () => [{ id: 'w1', cond: 'game-end', text: 'fri 17:00 after the game' }],
  ...over,
});

describe('what the list holds', () => {
  it('gathers each store, leaves out alarms, timers, fired and finished ones', async () => {
    const { rows, errors } = await VexRemindersTab.collect(NOW, fakeSources());
    expect(errors).toEqual([]);
    const keys = rows.map(r => r.key);
    expect(keys).toEqual(['reminder:r1', 'owe:f1', 'deadline:d1', 'reminder:r2', 'page:p1', 'waiting:f2', 'game:w1']);
    expect(rows.find(r => r.key === 'reminder:r2').kind).toBe('site');
    expect(keys).not.toContain('reminder:r3');   // an alarm: the Alarms tab
    expect(keys).not.toContain('reminder:r4');   // a timer: the Timer tab
    expect(keys).not.toContain('reminder:r5');   // fired
    expect(keys).not.toContain('page:p2');
    expect(keys).not.toContain('owe:f3');
    expect(keys).not.toContain('deadline:d2');
  });

  it('puts timed rows first, soonest first, and the rest in a fixed order', async () => {
    const { rows } = await VexRemindersTab.collect(NOW, fakeSources());
    const timed = rows.filter(r => r.at != null).map(r => r.at);
    expect(timed).toEqual([...timed].sort((a, b) => a - b));
    expect(rows.slice(0, timed.length).every(r => r.at != null)).toBe(true);
    expect(rows.slice(timed.length).map(r => r.kind)).toEqual(['site', 'page', 'waiting', 'game']);
  });

  it('names a store that cannot be read and still answers with the others', async () => {
    const { rows, errors } = await VexRemindersTab.collect(NOW, fakeSources({ pages: () => { throw new Error('Your page reminders could not be read: bad JSON'); } }));
    expect(errors).toEqual(['page reminders: Your page reminders could not be read: bad JSON']);
    expect(rows.some(r => r.kind === 'reminder')).toBe(true);
    expect(rows.some(r => r.kind === 'page')).toBe(false);
  });

  it('skips a feature that is switched off (its reader answers null)', async () => {
    const { rows, errors } = await VexRemindersTab.collect(NOW, fakeSources({ followUps: () => null, deadlines: () => null }));
    expect(errors).toEqual([]);
    expect(rows.some(r => r.kind === 'owe' || r.kind === 'waiting' || r.kind === 'deadline')).toBe(false);
  });
});

describe('adding goes to the function that already adds', () => {
  let quick, pages, followUps, deps;
  beforeEach(() => {
    quick = {
      parseTrigger: vi.fn((t) => { const m = /^when I open (.+)$/.exec(t); return m ? { site: m[1] } : { at: new Date(NOW + 3600000) }; }),
      create: vi.fn(async () => ({ id: 'new' })),
      _hostsChanged: vi.fn(),
    };
    pages = { enabled: () => true, normalize: (u) => (/^https?:/.test(u || '') ? u : ''), add: vi.fn((f) => ({ id: 'pr', ...f })) };
    followUps = { enabled: () => true, add: vi.fn((f) => ({ id: 'fu', ...f })) };
    deps = { quick, pages, followUps, activeTab: () => ({ url: 'https://example.com/a', partition: 'persist:main' }) };
  });

  it('a timed reminder -> VexQuickReminder.create with the parsed time and the repeat', async () => {
    await VexRemindersTab.add('time', { text: 'Pay rent', when: 'in 1 hour', repeat: 'weekly' }, deps);
    expect(quick.create).toHaveBeenCalledWith('Pay rent', new Date(NOW + 3600000), { repeat: 'weekly' });
  });

  it('"when I open x" typed in the time box becomes a site reminder', async () => {
    await VexRemindersTab.add('time', { text: 'Pay rent', when: 'when I open bank.example' }, deps);
    expect(quick.create).toHaveBeenCalledWith('Pay rent', { site: 'bank.example' });
    expect(quick._hostsChanged).toHaveBeenCalled();
  });

  it('a site reminder -> create with { site }', async () => {
    await VexRemindersTab.add('site', { text: 'Check mail', site: 'github.com' }, deps);
    expect(quick.create).toHaveBeenCalledWith('Check mail', { site: 'github.com' });
    await expect(VexRemindersTab.add('site', { text: 'x', site: '  ' }, deps)).rejects.toThrow(/Type the site/);
  });

  it('a page reminder -> VexPageReminders.add for the page in front', async () => {
    await VexRemindersTab.add('page', { text: 'Reply first', trigger: 'close' }, deps);
    expect(pages.add).toHaveBeenCalledWith({ text: 'Reply first', url: 'https://example.com/a', scope: 'url', trigger: 'close', action: null });
  });

  it('a page reminder is refused in a private or Tor tab, and when no page is open', async () => {
    deps.activeTab = () => ({ url: 'https://example.com/', partition: 'private-1' });
    await expect(VexRemindersTab.add('page', { text: 'x' }, deps)).rejects.toThrow(/Private and Tor/);
    deps.activeTab = () => ({ url: 'vex://start' });
    await expect(VexRemindersTab.add('page', { text: 'x' }, deps)).rejects.toThrow(/Open a web page/);
    expect(pages.add).not.toHaveBeenCalled();
  });

  it('something owed or waited on -> VexFollowUps.add with the day as local midnight', async () => {
    await VexRemindersTab.add('owe', { text: 'Send the form', due: '2026-09-20' }, deps);
    expect(followUps.add).toHaveBeenLastCalledWith({ dir: 'owe', who: '', what: 'Send the form', due: new Date(2026, 8, 20).getTime() });
    await VexRemindersTab.add('waiting', { text: 'The paper', who: 'Selin' }, deps);
    expect(followUps.add).toHaveBeenLastCalledWith({ dir: 'waiting', who: 'Selin', what: 'The paper', due: 0 });
    await expect(VexRemindersTab.add('owe', { text: 'x', due: '2026-13-40' }, deps)).rejects.toThrow(/not a day/);
  });

  it('a switched-off feature or an unknown kind raises, it is not skipped', async () => {
    followUps.enabled = () => false;
    await expect(VexRemindersTab.add('owe', { text: 'x' }, deps)).rejects.toThrow(/switched off/);
    await expect(VexRemindersTab.add('nope', { text: 'x' }, deps)).rejects.toThrow(/Unknown kind/);
    await expect(VexRemindersTab.add('time', { text: 'x', when: 'soon' }, { ...deps, quick: null })).rejects.toThrow(/did not load/);
  });

  it('removing goes to the store each row came from', async () => {
    quick.remove = vi.fn(async () => true); pages.remove = vi.fn();
    await VexRemindersTab.remove({ kind: 'reminder', id: 'a' }, deps);
    await VexRemindersTab.remove({ kind: 'site', id: 'b' }, deps);
    await VexRemindersTab.remove({ kind: 'page', id: 'c' }, deps);
    expect(quick.remove.mock.calls.map(c => c[0])).toEqual(['a', 'b']);
    expect(pages.remove).toHaveBeenCalledWith('c');
    await expect(VexRemindersTab.remove({ kind: 'deadline', id: 'd' }, deps)).rejects.toThrow(/own screen/);
  });
});

describe('the tab in the Clock panel', () => {
  it('draws the list, the form and the old screens, with tab-panel labelling kept by the Clock', async () => {
    window.showToast = vi.fn();
    const body = document.createElement('div');
    document.body.appendChild(body);
    const src = fakeSources();
    const orig = VexRemindersTab._sources;
    VexRemindersTab._sources = () => src;
    VexRemindersTab.render(body);
    await new Promise(r => setTimeout(r, 20));
    VexRemindersTab._sources = orig;
    expect(body.querySelector('#rt-kind').options.length).toBe(5);
    expect(body.querySelector('label[for="rt-kind"]')).not.toBeNull();
    expect(body.querySelector('#rt-list').getAttribute('role')).toBe('list');
    expect(body.querySelectorAll('#rt-list [role="listitem"]').length).toBe(7);
    // Only the rows a store lets you take back have a button, and each names what it removes.
    const xs = [...body.querySelectorAll('#rt-list .ck-x')];
    expect(xs.length).toBe(3);
    expect(xs[0].getAttribute('aria-label')).toMatch(/^Remove: /);
    // Changing the kind shows only its own fields.
    const kind = body.querySelector('#rt-kind');
    kind.value = 'waiting'; kind.dispatchEvent(new Event('change'));
    expect(body.querySelector('[data-for="owe waiting"]').hidden).toBe(false);
    expect(body.querySelector('[data-for="time"]').hidden).toBe(true);
  });

  it('is a tab of the Clock, loaded on first use, and a missing file is reported, not hidden', () => {
    const clock = read('clock-panel.js');
    expect(clock).toMatch(/\['reminders', 'Reminders', 'bell'\]/);
    expect(clock).toMatch(/VexLazy\.ensure\('js\/reminders-tab\.js'\)/);
    expect(clock).toMatch(/The Reminders tab could not be shown/);
    expect(read('lazy-boot.js')).toMatch(/js\/reminders-tab\.js/);
    expect(fs.readFileSync(path.join(ROOT, '../index.html'), 'utf8')).not.toMatch(/reminders-tab\.js/);
  });
});

describe('every old way in still resolves', () => {
  it('Ctrl+K Remind me and the schedules alias are untouched; "reminders" opens the new tab', () => {
    const cmd = read('command.js');
    expect(cmd).toMatch(/id: 'remind', label: 'Remind me'/);
    expect(cmd).toMatch(/VexQuickReminder\.open\(prefill\)/);
    const side = read('sidebar.js');
    expect(side).toMatch(/schedules: \{ panel: 'clock', tab: 'schedules' \}/);
    expect(side).toMatch(/reminders: \{ panel: 'clock', tab: 'reminders' \}/);
  });

  it('the page, follow-up and deadline commands and saved keys are where they were', () => {
    expect(read('page-reminders.js')).toMatch(/id: 'page-reminders', label: 'Page reminders'/);
    expect(read('page-reminders.js')).toMatch(/KEY: 'vex\.pageReminders'/);
    expect(read('follow-ups.js')).toMatch(/KEY: 'vex\.followUps'/);
    expect(read('deadline-ledger.js')).toMatch(/id: 'deadline-ledger', label: 'Deadlines with countdown'/);
    expect(read('clock-panel.js')).toMatch(/\['alarms', 'Alarms', 'alarm'\]/);
  });

  it('reads and writes no key of its own and never touches the scheduler or the notification path', () => {
    const src = read('reminders-tab.js');
    expect(src).not.toMatch(/localStorage|new Notification|osScheduler|os-schedule|schtasks/);
  });

  it('registers the Ctrl+K command "Reminders" when it loads, which opens the Clock tab', () => {
    const registerCommand = vi.fn();
    globalThis.VexExtras = { registerCommand };
    globalThis.SidebarManager = { openPanel: vi.fn() };
    VexRemindersTab._cmd = false;
    VexRemindersTab.init();
    expect(registerCommand).toHaveBeenCalledTimes(1);
    const c = registerCommand.mock.calls[0][0];
    expect(c).toMatchObject({ id: 'reminders', label: 'Reminders' });
    c.action();
    expect(SidebarManager.openPanel).toHaveBeenCalledWith('reminders');
    VexRemindersTab.init();
    expect(registerCommand).toHaveBeenCalledTimes(1);
  });
});
