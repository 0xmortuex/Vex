// @vitest-environment jsdom
//
// Fixes from the 2026-09-29 sweep, "left" area: a Copy link that failed in
// silence, history rows and days that stayed in the file copy and in Recall,
// a backup that promised sessions and left them out, restored kept-awake tabs
// that stayed unloaded, a daily automation that only fired once by luck, and
// snoozed entries from before the double-open fix.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
});

describe('Send to phone: Copy link', () => {
  it('says so when the copy fails', async () => {
    const { SendToPhone } = require('../../src/renderer/js/send-to-phone.js');
    window.vex = { qrGenerate: vi.fn(async () => null) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('Document is not focused'); }) } });
    await SendToPhone.open('https://example.com/');
    document.getElementById('sp-copy').click();
    await new Promise(r => setTimeout(r, 0));
    expect(window.showToast).toHaveBeenCalledWith('Could not copy the link: Document is not focused', 'error');
  });
});

describe('History: deleting a row or a day reaches every copy', () => {
  const MODULE = '../../src/renderer/js/history-panel.js';
  const load = () => { vi.resetModules(); delete require.cache[require.resolve(MODULE)]; return require(MODULE).HistoryPanel; };
  const iso = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
  const ms = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
  let file;

  beforeEach(() => {
    file = [];
    globalThis.VexStorage = { loadHistory: vi.fn(async () => file), save: vi.fn(async (k, v) => { file = v; return true; }) };
    window.vex = { recallForget: vi.fn(async () => ({ ok: true, removed: 1 })) };
  });

  it('a deleted row leaves the file copy and Recall', async () => {
    const H = load();
    H.renderList = () => {};
    localStorage.setItem('vex.history', JSON.stringify([
      { id: 'a', url: 'https://gone.example/', visitedAt: iso(2026, 9, 28) },
      { id: 'b', url: 'https://stays.example/', visitedAt: iso(2026, 9, 28) },
    ]));
    file = [{ url: 'https://gone.example/', time: ms(2026, 9, 27) }, { url: 'https://gone.example/', time: ms(2026, 9, 28) }, { url: 'https://stays.example/', time: ms(2026, 9, 28) }];
    await H.deleteEntry('a');
    expect(H.entries.map(e => e.id)).toEqual(['b']);
    expect(file).toEqual([{ url: 'https://stays.example/', time: ms(2026, 9, 28) }]);
    expect(window.vex.recallForget).toHaveBeenCalledTimes(1);
    expect(window.vex.recallForget).toHaveBeenCalledWith({ url: 'https://gone.example/' });
  });

  it('Clear day forgets only that day; a page still listed on another day stays in Recall', async () => {
    const H = load();
    H.renderList = () => {};
    localStorage.setItem('vex.history', JSON.stringify([
      { id: 'a', url: 'https://both.example/', visitedAt: iso(2026, 9, 28) },
      { id: 'b', url: 'https://once.example/', visitedAt: iso(2026, 9, 28) },
      { id: 'c', url: 'https://both.example/', visitedAt: iso(2026, 9, 26) },
    ]));
    file = [
      { url: 'https://both.example/', time: ms(2026, 9, 28) },
      { url: 'https://once.example/', time: ms(2026, 9, 28) },
      { url: 'https://file-only.example/', time: ms(2026, 9, 28) },
      { url: 'https://both.example/', time: ms(2026, 9, 26) },
    ];
    const label = H._dayLabel(new Date(iso(2026, 9, 28)));
    await H.deleteDay(label);
    expect(H.entries.map(e => e.id)).toEqual(['c']);
    expect(file).toEqual([{ url: 'https://both.example/', time: ms(2026, 9, 26) }]);
    expect(window.vex.recallForget.mock.calls).toEqual([[{ url: 'https://once.example/' }]]);
    expect(window.showToast).toHaveBeenLastCalledWith('Cleared 2 from ' + label);
  });

  it('says so when Recall could not forget', async () => {
    const H = load();
    H.renderList = () => {};
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.vex = { recallForget: vi.fn(async () => ({ ok: false, error: 'disk full' })) };
    localStorage.setItem('vex.history', JSON.stringify([{ id: 'a', url: 'https://gone.example/', visitedAt: iso(2026, 9, 28) }]));
    await H.deleteEntry('a');
    expect(window.showToast).toHaveBeenLastCalledWith('Removed from the list, but not everywhere: disk full', 'error');
    err.mockRestore();
  });
});

describe('Backup carries saved sessions', () => {
  it('includes vex.sessions, not the bare vex.session', () => {
    const { VexBackup } = require('../../src/renderer/js/backup.js');
    localStorage.setItem('vex.sessions', '[{"id":"s1","name":"Work","tabs":[]}]');
    localStorage.setItem('vex.session', '{"now":1}');
    localStorage.setItem('vex.tabs', '[]');
    const items = VexBackup.collect().items;
    expect(items['vex.sessions']).toBe('[{"id":"s1","name":"Work","tabs":[]}]');
    expect(items).not.toHaveProperty('vex.session');
    expect(items).not.toHaveProperty('vex.tabs');
  });
});

describe('Restoring a session loads its kept-awake tabs', () => {
  it('materializes kept-awake lazy tabs other than the active one, like start-up does', async () => {
    const { SessionManager } = await import('../../src/renderer/js/sessions.js');
    const made = [];
    globalThis.TabManager = {
      tabs: [], groups: [], activeTabId: null,
      createTab: vi.fn(),
      createLazyTab: vi.fn((url, groupId, title, opts) => { const t = { id: 't' + made.length, url, title, ...opts, _lazy: true }; made.push(t); TabManager.tabs.push(t); return t; }),
      _persistableFavicon: (f) => f || null,
      renderTabUpdate: vi.fn(), persistTabs: vi.fn(async () => {}),
      switchTab: vi.fn((id) => { TabManager.activeTabId = id; }),
      _isKeptAwake: (t) => t.keepAwakeUntil > Date.now(),
      _materializeTab: vi.fn((t) => { t._lazy = false; }),
    };
    window.VexTabPolicy = { canRestore: () => true };
    SessionManager.hideOverlay = vi.fn();
    const later = Date.now() + 3600000;
    SessionManager.sessions = [{ id: 's1', name: 'S', activeTabIndex: 0, tabs: [
      { url: 'https://active.example/', title: 'Active', keepAwakeUntil: later },
      { url: 'https://awake.example/', title: 'Awake', keepAwakeUntil: later },
      { url: 'https://asleep.example/', title: 'Asleep' },
    ] }];
    await SessionManager.restoreSession('s1', false);
    expect(TabManager._materializeTab.mock.calls.map(c => c[0].title)).toEqual(['Awake']);
    expect(made.find(t => t.title === 'Asleep')._lazy).toBe(true);
    delete globalThis.TabManager; delete window.VexTabPolicy;
  });
});

describe('Automations: a daily rule runs once a day', () => {
  it('does not run twice in its minute, even when the rule list is rewritten between ticks', async () => {
    vi.resetModules();
    window.vexId = (p) => p + Math.random().toString(36).slice(2);
    await import('../../src/renderer/js/automations.js?sweep-left');
    const A = window.Automations;
    A._firedDate = {};
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const rules = JSON.stringify([{ id: 'r1', name: 'Daily', enabled: true, trigger: { type: 'time', value: hhmm }, action: { type: 'open', value: 'https://daily.example/' } }]);
    localStorage.setItem(A.KEY, rules);
    A._runAction = vi.fn();
    A._tickTime();
    localStorage.setItem(A.KEY, rules);   // edited elsewhere, or the save never landed
    A._tickTime();
    expect(A._runAction).toHaveBeenCalledTimes(1);
    // The tick no longer writes the rules back at all.
    expect(localStorage.getItem(A.KEY)).toBe(rules);
  });
});

describe('Snooze: an entry saved before the double-open fix', () => {
  it('does not open a second copy of a page you already brought back', async () => {
    const { TabSnooze } = await import('../../src/renderer/js/tab-snooze.js');
    // Reopened by hand before forgetUrl existed, so the entry is still listed.
    globalThis.TabManager = { tabs: [{ id: 'x', url: 'https://old.example/' }], createTab: vi.fn() };
    localStorage.setItem(TabSnooze.KEY, JSON.stringify([{ id: 'sn_old', url: 'https://old.example/', title: 'Old', at: 1 }]));
    expect(TabSnooze.checkDue(10)).toEqual([]);
    expect(TabManager.createTab).not.toHaveBeenCalled();
    expect(TabSnooze.list()).toEqual([]);
    delete globalThis.TabManager;
  });
});
