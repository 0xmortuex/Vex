// @vitest-environment jsdom
//
// The Schedules panel was merged into the Clock panel as its "Scheduled tasks"
// sub-tab. What has to stay true:
//   * every old way of opening 'schedules' lands on Clock with that sub-tab,
//   * saved sidebar settings that mention 'schedules' are moved over once,
//   * the sub-tab draws the existing SchedulesPanel UI inside the Clock body,
//   * the Scheduler engine does not depend on any panel being open.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fresh = (p) => { const r = require.resolve(path.join(ROOT, p)); delete require.cache[r]; return require(r); };

function installGlobals() {
  globalThis.TabManager = { tabs: [], activeTabId: null, createTab: vi.fn(), switchTab: vi.fn(), _clampMenuToViewport: vi.fn(), _attachMenuDismissal: vi.fn() };
  globalThis.WebviewManager = { showWebview: vi.fn() };
  globalThis.VexJobs = { every: vi.fn(() => ({ stop: vi.fn() })) };
  for (const name of ['CUSAPanel', 'RobloxPanel', 'GitHubPanel', 'NotesPanel', 'DownloadsPanel', 'HistoryPanel', 'MemoryPanel', 'ShortcutsPanel', 'SyncSettings', 'AISettings', 'PersonasSettings', 'ShortcutEditor', 'ExtensionsSettings', 'PermissionsSettings', 'LocationSettings']) {
    globalThis[name] = { init: vi.fn(), render: vi.fn(), renderPanel: vi.fn(), renderSyncPanel: vi.fn(), renderAISettings: vi.fn() };
  }
  globalThis.isStartPage = () => false;
  globalThis.START_URL = 'vex://start';
  globalThis.VexClock = { _tab: 'alarms', renderPanel: vi.fn() };
}

function buildDOM() {
  document.body.innerHTML = `
    <div id="webviews-container"></div>
    <div id="panels-container">
      <div class="panel" id="panel-clock" style="display:none"></div>
      <div class="panel" id="panel-notes" style="display:none"></div>
    </div>
    <button class="sidebar-icon" data-panel="notes" title="Notes"></button>
    <button class="sidebar-icon" data-panel="clock" title="Clock and schedules — alarms (Ctrl+Shift+L)"></button>
  `;
}

describe('old Schedules entry points route to Clock › Scheduled tasks', () => {
  let SidebarManager;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
    installGlobals();
    buildDOM();
    ({ SidebarManager } = await import('../../src/renderer/js/sidebar.js'));
  });

  it('openPanel("schedules") opens Clock on the Scheduled tasks tab, even after another tab was last used', () => {
    VexClock._tab = 'world';
    SidebarManager.openPanel('schedules');
    expect(SidebarManager.activePanel).toBe('clock');
    expect(VexClock._tab).toBe('schedules');
    expect(VexClock.renderPanel).toHaveBeenCalledWith(document.getElementById('panel-clock'));
    expect(document.getElementById('panel-clock').style.display).toBe('');
  });

  it('showPanel("schedules") does the same', () => {
    SidebarManager.showPanel('schedules');
    expect(SidebarManager.activePanel).toBe('clock');
    expect(VexClock._tab).toBe('schedules');
  });

  it('togglePanel("schedules") (Ctrl+Shift+L, toggle-schedules) opens, then closes', () => {
    SidebarManager.togglePanel('schedules');
    expect(SidebarManager.activePanel).toBe('clock');
    expect(VexClock._tab).toBe('schedules');
    SidebarManager.togglePanel('schedules');
    expect(SidebarManager.activePanel).toBeNull();
  });

  it('togglePanel("schedules") with Clock already open on another tab brings Scheduled tasks forward instead of closing', () => {
    SidebarManager.openPanel('clock');
    VexClock._tab = 'stopwatch';
    VexClock.renderPanel.mockClear();
    SidebarManager.togglePanel('schedules');
    expect(SidebarManager.activePanel).toBe('clock');
    expect(VexClock._tab).toBe('schedules');
    expect(VexClock.renderPanel).toHaveBeenCalledTimes(1);
  });

  it('openBeside("schedules") puts Clock beside the open panel on that tab', () => {
    SidebarManager.openPanel('notes');
    SidebarManager.openBeside('schedules');
    expect(SidebarManager.sidePanel).toBe('clock');
    expect(VexClock._tab).toBe('schedules');
  });

  it('the Clock deep links (timer pill, quick commands) still open Clock on the tab they set', () => {
    VexClock._tab = 'timers';
    SidebarManager.openPanel('clock');
    expect(SidebarManager.activePanel).toBe('clock');
    expect(VexClock._tab).toBe('timers');
  });

  it('plain panels are untouched by the alias table', () => {
    expect(SidebarManager._alias('notes')).toBeNull();
    expect(SidebarManager._alias('constructor')).toBeNull();
    expect(SidebarManager.DEFAULT_HIDDEN_PANELS).not.toContain('schedules');
    expect(SidebarManager.panelConfigs.schedules).toBeUndefined();
  });

  it('the merged icon is titled "Clock and schedules"', () => {
    expect(SidebarManager.panelLabel('clock')).toBe('Clock and schedules');
  });
});

describe('the one-time settings migration', () => {
  let SidebarManager;
  const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const get = (k) => JSON.parse(localStorage.getItem(k));

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
    installGlobals();
    buildDOM();
    ({ SidebarManager } = await import('../../src/renderer/js/sidebar.js'));
  });

  it('default install state (Schedules hidden by lean default, Clock untouched): Clock stays shown, Schedules override is gone', () => {
    localStorage.setItem('vex.sidebarLeanV1', '1');
    set('vex.panelOverrides', { schedules: { hidden: true }, queue: { hidden: true } });
    SidebarManager._mergeSchedulesIntoClockOnce();
    const ov = get('vex.panelOverrides');
    expect(ov.schedules).toBeUndefined();
    expect(ov.clock).toBeUndefined();
    expect(ov.queue).toEqual({ hidden: true });
  });

  it('Clock hidden + Schedules hidden: the merged one stays hidden', () => {
    localStorage.setItem('vex.sidebarLeanV1', '1');
    set('vex.panelOverrides', { schedules: { hidden: true }, clock: { hidden: true, name: 'Time' } });
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(get('vex.panelOverrides')).toEqual({ clock: { hidden: true, name: 'Time' } });
  });

  it('Clock hidden + Schedules shown: the merged one is shown, Clock keeps its own name', () => {
    localStorage.setItem('vex.sidebarLeanV1', '1');
    set('vex.panelOverrides', { schedules: { hidden: false, name: 'Jobs' }, clock: { hidden: true, name: 'Time' } });
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(get('vex.panelOverrides')).toEqual({ clock: { hidden: false, name: 'Time' } });
  });

  it('Clock hidden + Schedules reset to default after the lean default ran (no override): shown', () => {
    localStorage.setItem('vex.sidebarLeanV1', '1');
    set('vex.panelOverrides', { clock: { hidden: true } });
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(get('vex.panelOverrides').clock.hidden).toBe(false);
  });

  it('Clock hidden, lean default never ran (Schedules would have been hidden by it): stays hidden', () => {
    set('vex.panelOverrides', { clock: { hidden: true } });
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(get('vex.panelOverrides').clock.hidden).toBe(true);
  });

  it('sidebar order: Schedules is dropped and Clock keeps its slot', () => {
    set('vex.sidebarOrder', ['notes', 'schedules', 'work', 'clock', 'history']);
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(get('vex.sidebarOrder')).toEqual(['notes', 'work', 'clock', 'history']);
  });

  it('sidebar order: Clock takes Schedules\' place when it had none', () => {
    set('vex.sidebarOrder', ['notes', 'schedules', 'history']);
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(get('vex.sidebarOrder')).toEqual(['notes', 'clock', 'history']);
  });

  it('an order without Schedules is left exactly as it was', () => {
    set('vex.sidebarOrder', ['history', 'notes']);
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(get('vex.sidebarOrder')).toEqual(['history', 'notes']);
  });

  it('a panel remembered beside Schedules is remembered beside Clock', () => {
    set('vex.panelPairs', { schedules: 'notes', notes: 'schedules', history: 'downloads', downloads: 'history' });
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(get('vex.panelPairs')).toEqual({ history: 'downloads', downloads: 'history', clock: 'notes', notes: 'clock' });
  });

  it('usage: Clock gets the later of the two timestamps', () => {
    set('vex.panelUsage', { schedules: 500, clock: 100, notes: 7 });
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(get('vex.panelUsage')).toEqual({ clock: 500, notes: 7 });
  });

  it('runs once: a second call (or a later Show of Clock) is not undone', () => {
    localStorage.setItem('vex.sidebarLeanV1', '1');
    set('vex.panelOverrides', { schedules: { hidden: false }, clock: { hidden: true } });
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(localStorage.getItem('vex.sidebarSchedulesMergedV1')).toBe('1');
    set('vex.panelOverrides', { clock: { hidden: true } });   // the user hides Clock again
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(get('vex.panelOverrides')).toEqual({ clock: { hidden: true } });
  });

  it('a corrupt saved value raises and leaves every setting and the flag untouched', () => {
    set('vex.sidebarOrder', ['schedules', 'notes']);
    localStorage.setItem('vex.panelPairs', '{not json');
    expect(() => SidebarManager._mergeSchedulesIntoClockOnce()).toThrow();
    expect(get('vex.sidebarOrder')).toEqual(['schedules', 'notes']);
    expect(localStorage.getItem('vex.sidebarSchedulesMergedV1')).toBeNull();
  });

  it('nothing saved at all just sets the flag', () => {
    SidebarManager._mergeSchedulesIntoClockOnce();
    expect(localStorage.getItem('vex.panelOverrides')).toBeNull();
    expect(localStorage.getItem('vex.sidebarSchedulesMergedV1')).toBe('1');
  });
});

describe('the Scheduled tasks sub-tab', () => {
  let VexClock, SchedulesPanel;

  beforeEach(() => {
    document.body.innerHTML = '<div id="panel-clock"></div>';
    window.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.showToast = vi.fn();
    window.vex = { reminders: { list: async () => [] } };
    globalThis.VexIcons = { has: () => true, svg: () => '<svg></svg>' };
    globalThis.Scheduler = {
      getAllTasks: () => [{ id: 't1', name: 'Morning reading', enabled: true, runCount: 0 }],
      getHistory: () => [],
      isRunning: () => false,
      isQueued: () => false,
      describeNextRun: () => 'tomorrow 08:30',
      describeSchedule: () => 'Every weekday at 08:30',
      describeAction: () => 'Open 2 pages',
    };
    ({ SchedulesPanel } = fresh('src/renderer/js/schedules-panel.js'));
    globalThis.SchedulesPanel = SchedulesPanel;
    ({ VexClock } = fresh('src/renderer/js/clock-panel.js'));
  });

  it('draws the Schedules UI inside the Clock body, as one more role=tab button', () => {
    VexClock._tab = 'schedules';
    const host = document.getElementById('panel-clock');
    VexClock.renderPanel(host);
    const tabs = [...host.querySelectorAll('.ck-tabs [role="tab"]')];
    expect(tabs.map(t => t.dataset.tab)).toEqual(['alarms', 'timers', 'stopwatch', 'world', 'schedules']);
    expect(tabs.find(t => t.dataset.tab === 'schedules').textContent.trim()).toBe('Scheduled tasks');
    expect(tabs.map(t => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'false', 'true']);
    expect(host.querySelector('.ck-tabs').getAttribute('role')).toBe('tablist');
    expect(host.querySelector('#clock-body').getAttribute('role')).toBe('tabpanel');
    // The existing Schedules UI, unchanged: its own tabs, New Task and the cards.
    expect(host.querySelector('#clock-body .sched-container')).not.toBeNull();
    expect([...host.querySelectorAll('.sched-tab')].map(b => b.dataset.tab)).toEqual(['active', 'history', 'templates']);
    expect(host.querySelector('#sched-new-btn')).not.toBeNull();
    expect(host.querySelector('.sched-card-name').textContent).toBe('Morning reading');
    expect(host.querySelectorAll('h2')).toHaveLength(1);
  });

  it('clicking the sub-tab shows it; clicking another leaves it and a timer tick does not rebuild it', () => {
    VexClock._tab = 'alarms';
    window.vex.reminders = undefined;
    const host = document.getElementById('panel-clock');
    VexClock.renderPanel(host);
    host.querySelector('.ck-tab[data-tab="schedules"]').click();
    expect(VexClock._tab).toBe('schedules');
    expect(host.querySelector('.ck-tab[data-tab="schedules"]').getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('.sched-card')).not.toBeNull();

    const marker = host.querySelector('.sched-container');
    VexClock._rerender();
    expect(host.querySelector('.sched-container')).toBe(marker);

    host.querySelector('.ck-tab[data-tab="world"]').click();
    expect(VexClock._tab).toBe('world');
    expect(host.querySelector('.sched-container')).toBeNull();
  });

  it('its own inner tab survives leaving and coming back', () => {
    VexClock._tab = 'schedules';
    const host = document.getElementById('panel-clock');
    VexClock.renderPanel(host);
    host.querySelector('.sched-tab[data-tab="history"]').click();
    expect(SchedulesPanel._activeTab).toBe('history');
    VexClock.renderPanel(host);
    expect(host.querySelector('.sched-tab[data-tab="history"]').getAttribute('aria-selected')).toBe('true');
  });

  it('SchedulesPanel.init without an element raises instead of doing nothing', () => {
    expect(() => SchedulesPanel.init()).toThrow(/element to draw into/);
  });
});

describe('structure: one icon, no empty container, the engine independent of the panel', () => {
  const html = read('src/renderer/index.html');

  it('index.html has the Clock icon and no Schedules icon or panel container', () => {
    expect(html).toContain('data-panel="clock"');
    expect(html).toMatch(/data-panel="clock" title="Clock and schedules/);
    expect(html).not.toContain('data-panel="schedules"');
    expect(html).not.toContain('id="panel-schedules"');
  });

  it('the Scheduler engine and the agent do not touch SchedulesPanel (jobs run with the panel closed)', () => {
    expect(read('src/renderer/js/scheduler.js')).not.toMatch(/SchedulesPanel|panel-schedules/);
    expect(read('src/renderer/js/agent-executor.js')).not.toMatch(/SchedulesPanel|panel-schedules/);
    expect(read('src/renderer/js/schedules-panel.js')).not.toContain('panel-schedules');
  });

  it('every old entry point still exists and goes through SidebarManager', () => {
    expect(read('src/renderer/js/app.js')).toMatch(/ShortcutsRegistry\.register\('schedules',\s+\(\) => SidebarManager\?\.openPanel\('schedules'\)\)/);
    expect(read('src/renderer/js/app.js')).toMatch(/onToggleSchedules\?\.\(\(\) => SidebarManager\.togglePanel\('schedules'\)\)/);
    expect(read('src/renderer/js/command.js')).toMatch(/id: 'schedules', label: 'Schedules'[^\n]*SidebarManager\.openPanel\('schedules'\)/);
    expect(read('src/main/guest-shortcuts.js')).toContain("l: 'toggle-schedules'");
  });
});
