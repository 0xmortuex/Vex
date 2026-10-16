// @vitest-environment jsdom
//
// The places Vex acts on its own write a line in the "Why did that happen?" ledger
// (js/vex-ledger.js) with a plain-data undo that works later: the theme changing at
// sunset, a snoozed item coming back, a focus block starting by itself, a tab put to
// sleep, a tab joining a group, a tidy-up of downloads. This checks each wiring.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');

const JS = '../../src/renderer/js/';
const read = (f) => fs.readFileSync(path.join(__dirname, JS, f), 'utf8');
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

function ledger() {
  globalThis.VexRegistry = fresh(JS + 'feature-registry.js').VexRegistry;
  globalThis.VexUsage = fresh(JS + 'vex-usage.js').VexUsage;
  globalThis.VexLedger = fresh(JS + 'vex-ledger.js').VexLedger;
  window.VexProblems = globalThis.VexProblems = { note: vi.fn() };
}

beforeEach(() => { localStorage.clear(); ledger(); window.showToast = vi.fn(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('theme changed by itself', () => {
  async function loadTheme() {
    vi.resetModules();
    ledger();
    globalThis.VexStorage = { load: vi.fn(async () => undefined), save: vi.fn(async () => {}) };
    globalThis.VexJobs = { every: vi.fn() };
    const tm = await import('../../src/renderer/js/theme-manager.js');
    globalThis.ThemeManager = tm.ThemeManager;
    const ta = await import('../../src/renderer/js/theme-auto.js');
    globalThis.ThemeAuto = ta.ThemeAuto;
    return { TM: tm.ThemeManager, TA: ta.ThemeAuto };
  }

  it('writes what changed and why, and Undo puts the earlier theme back (also after a restart)', async () => {
    const { TM, TA } = await loadTheme();
    localStorage.setItem('vex.themeAuto', JSON.stringify({ mode: 'schedule', light: 'oxford', dark: 'dracula', from: '19:00', to: '07:00' }));
    TM.applyTheme('oxford');
    TA._clock = () => new Date(2026, 9, 8, 23, 0);
    TA.evaluate({ force: true });
    expect(TM.currentTheme).toBe('dracula');
    const line = VexLedger.list()[0];
    expect(line).toMatchObject({ feature: 'theme-auto', undo: { kind: 'theme-restore', theme: 'oxford' } });
    expect(line.what).toMatch(/Changed the theme to/);
    expect(line.why).toMatch(/Your schedule says dark now/);
    // the next session: the ledger is read back from storage, the module registers its undo again
    vi.resetModules();
    const again = await loadTheme();
    await VexLedger.undo(VexLedger.list()[0].id);
    expect(again.TM.currentTheme).toBe('oxford');
  });

  it('the theme-auto feature can be switched off through the registry and its mode comes back', async () => {
    const { TA } = await loadTheme();
    globalThis.VexUsageRegistry = fresh(JS + 'vex-usage-registry.js').VexUsageRegistry;
    globalThis.VexRegistry = fresh(JS + 'feature-registry.js').VexRegistry;
    fresh(JS + 'feature-manifests.js');
    TA.set({ mode: 'system' });
    VexUsageRegistry.register(VexUsage);
    expect(VexUsage.isEnabled('theme-auto')).toBe(true);
    await VexRegistry.switchOff('theme-auto');
    expect(TA.state().mode).toBe('off');
    await VexRegistry.switchOn('theme-auto');
    expect(TA.state().mode).toBe('system');
  });
});

describe('snoozed items coming back', () => {
  it('writes a line and Undo snoozes them again for an hour', async () => {
    const { VexSnooze } = fresh(JS + 'snooze-anything.js');
    globalThis.VexSnooze = VexSnooze;
    const past = Date.now() - 1000;
    localStorage.setItem(VexSnooze.KEY, JSON.stringify([{ id: 'sz_1', kind: 'story', title: 'An article', at: past }, { id: 'sz_2', kind: 'story', title: 'Another', at: past }]));
    const fresh2 = VexSnooze.checkDue();
    expect(fresh2.length).toBe(2);
    const line = VexLedger.list()[0];
    expect(line).toMatchObject({ feature: 'brief-snooze', what: 'Brought back 2 snoozed items' });
    await VexLedger.undo(line.id);
    const after = VexSnooze._read();
    expect(after.every(e => e.at > Date.now() + 59 * 60000 && e.told === false)).toBe(true);
  });

  it('says so when the items are gone', async () => {
    const { VexSnooze } = fresh(JS + 'snooze-anything.js');
    localStorage.setItem(VexSnooze.KEY, JSON.stringify([{ id: 'sz_1', kind: 'story', title: 'An article', at: Date.now() - 1000 }]));
    VexSnooze.checkDue();
    localStorage.setItem(VexSnooze.KEY, '[]');
    await expect(VexLedger.undo(VexLedger.list()[0].id)).rejects.toThrow(/no longer snoozed/);
  });
});

describe('a focus block that started by itself', () => {
  it('is listed with Undo (finish it) and a stop token (that goal stops starting by itself)', () => {
    const src = read('focus-os.js');
    expect(src).toMatch(/if \(auto && typeof VexLedger !== 'undefined'\)/);
    expect(src).toMatch(/undo: \{ kind: 'focus-finish', blockId \}/);
    expect(src).toMatch(/stop: \{ kind: 'focus-no-autostart', goalId: g\.id \}/);
    const { FocusOS } = fresh(JS + 'focus-os.js');
    globalThis.FocusOS = FocusOS;
    // the handlers are registered where the module loads
    const g = { id: 'g1', autoStart: true };
    FocusOS._state = { goals: [g], blocks: [], active: null, milestones: {}, settings: {} };
    FocusOS._write = vi.fn(); FocusOS._changed = vi.fn();
    return VexLedger.stopDoing(VexLedger.record({ feature: 'focus-os', what: 'Started the focus block "X"', why: 'It was planned for now', stop: { kind: 'focus-no-autostart', goalId: 'g1' } }).id)
      .then(() => { expect(g.autoStart).toBe(false); expect(FocusOS._write).toHaveBeenCalled(); });
  });
});

describe('the other wirings', () => {
  it('auto-sleep notes the tabs it slept, with a wake-tabs undo that finds a tab by id, else by address', async () => {
    expect(read('tabs.js')).toMatch(/feature: 'tab-auto-sleep'/);
    const { TabManager } = fresh(JS + 'tabs.js');
    globalThis.TabManager = TabManager;
    const wake = vi.spyOn(TabManager, 'wakeTab').mockImplementation(() => {});
    TabManager.tabs = [{ id: 't9', url: 'https://b.test/', sleeping: true }, { id: 't2', url: 'https://a.test/', sleeping: false }];
    const e = VexLedger.record({ feature: 'tab-auto-sleep', what: 'Slept 2 idle tabs', why: 'idle', undo: { kind: 'wake-tabs', tabs: [{ id: 't1', url: 'https://b.test/' }] } });
    await VexLedger.undo(e.id);
    expect(wake).toHaveBeenCalledWith('t9');
  });

  it('a tab that joined a group by itself can be taken out again, and only while it is still there', () => {
    const src = read('tab-grouper.js');
    expect((src.match(/_noteAutoGroup\(tab, gid, pd,/g) || []).length).toBe(2);
    expect(src).toMatch(/registerUndo\('ungroup-tab'/);
    expect(src).toMatch(/That tab is no longer in that group/);
  });

  it('a downloads tidy-up is noted, and an older tidy-up cannot be undone over a newer one', async () => {
    expect(read('downloads-panel.js')).toMatch(/feature: 'downloads-tidy'/);
    const { DownloadsPanel } = fresh(JS + 'downloads-panel.js');         // registers its undo with this test's ledger
    window.vex = { downloadsTidyUndo: vi.fn(async () => ({ ok: true, restored: 3, left: [] })) };
    const older = VexLedger.record({ feature: 'downloads-tidy', what: 'Moved 3 old downloads', why: 'asked', undo: { kind: 'downloads-tidy-undo' } });
    const newer = VexLedger.record({ feature: 'downloads-tidy', what: 'Moved 2 old downloads', why: 'asked', undo: { kind: 'downloads-tidy-undo' } });
    expect(DownloadsPanel).toBeTruthy();
    await expect(VexLedger.undo(older.id)).rejects.toThrow(/later tidy-up came after this one/);
    await VexLedger.undo(newer.id);
    expect(window.vex.downloadsTidyUndo).toHaveBeenCalledTimes(1);
    await VexLedger.undo(older.id);
    expect(window.vex.downloadsTidyUndo).toHaveBeenCalledTimes(2);
  });
});
