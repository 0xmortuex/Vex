// @vitest-environment jsdom
//
// Workspace metrics: time, tabs opened and notes written per workspace and
// project, kept locally as numbers per day, exported as CSV.
import { beforeEach, describe, expect, it, vi } from 'vitest';
// VexJobs.every stand-in for a module that now registers its timers there (T0-020): same timers, same fake clocks.
globalThis.VexJobs ??= { every: (_name, ms, fn) => { const id = setInterval(fn, ms); return { stop: () => clearInterval(id) }; } };
require('../../src/renderer/js/vex-utils.js');
globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
const { VexSettingsGroups } = require('../../src/renderer/js/settings-groups.js');
globalThis.VexSettingsGroups = VexSettingsGroups;
const { WorkspaceMetrics } = require('../../src/renderer/js/workspace-metrics.js');

function setup({ ws = { id: 'ws_work', name: 'Work' }, project = null } = {}) {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.VexTabPolicy = { isPrivateWindow: false };
  globalThis.WorkspaceManager = { activeId: ws.id, getActive: () => ws };
  if (project) globalThis.ResearchProjects = { active: () => project };
  else delete globalThis.ResearchProjects;
  WorkspaceMetrics.data = WorkspaceMetrics._clean(null);
  WorkspaceMetrics._last = 0;
  WorkspaceMetrics._lastInput = Date.now();
  WorkspaceMetrics._noteStamps = null;
  WorkspaceMetrics._noteTick = 0;
  WorkspaceMetrics._dirty = false;
}
beforeEach(() => setup());

describe('recording', () => {
  it('credits time to the active workspace and the active project', () => {
    setup({ project: { id: 'p1', name: 'Thesis' } });
    WorkspaceMetrics.addSeconds(120);
    const totals = WorkspaceMetrics.totals(7);
    expect(totals.map(t => [t.name, t.kind, t.seconds])).toEqual([['Work', 'workspace', 120], ['Thesis', 'project', 120]].sort((a, b) => 0));
  });

  it('counts a tick only while the window is focused and not idle', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const t0 = Date.now();
    WorkspaceMetrics._last = t0;
    WorkspaceMetrics._lastInput = t0;
    expect(WorkspaceMetrics.tick(t0 + 10000)).toBe(10);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    expect(WorkspaceMetrics.tick(t0 + 20000)).toBe(0);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    WorkspaceMetrics._lastInput = t0 - 10 * 60 * 1000;   // nobody touched Vex for ten minutes
    expect(WorkspaceMetrics.tick(t0 + 30000)).toBe(0);
    expect(WorkspaceMetrics.totals(0)[0].seconds).toBe(10);
  });

  it('records nothing in a private window or when switched off', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    WorkspaceMetrics._last = Date.now();
    window.VexTabPolicy.isPrivateWindow = true;
    expect(WorkspaceMetrics.tick(Date.now() + 10000)).toBe(0);
    window.VexTabPolicy.isPrivateWindow = false;
    WorkspaceMetrics.setEnabled(false);
    expect(WorkspaceMetrics.enabled()).toBe(false);
    WorkspaceMetrics._last = Date.now();
    expect(WorkspaceMetrics.tick(Date.now() + 10000)).toBe(0);
    expect(WorkspaceMetrics.totals(0)).toEqual([]);
  });

  it('counts a note once per day however often it is edited', () => {
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n1', updatedAt: '1', content: 'a' }]));
    WorkspaceMetrics.sampleNotes();                          // first look: nothing counted
    expect(WorkspaceMetrics.totals(0)).toEqual([]);
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n1', updatedAt: '2', content: 'ab' }, { id: 'n2', updatedAt: '2', content: 'x' }]));
    WorkspaceMetrics.sampleNotes();
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n1', updatedAt: '3', content: 'abc' }, { id: 'n2', updatedAt: '2', content: 'x' }]));
    WorkspaceMetrics.sampleNotes();
    expect(WorkspaceMetrics.totals(0)[0].notes).toBe(2);
  });

  it('counts tabs opened, but not the ones restored at start or private ones', () => {
    const calls = [];
    globalThis.TabManager = { createTab: (url) => { calls.push(url); return 'id' + calls.length; } };
    WorkspaceMetrics._started = Date.now();
    WorkspaceMetrics._wrapTabs();
    TabManager.createTab('https://a.com');                    // inside the restore grace period
    expect(WorkspaceMetrics.totals(0)).toEqual([]);
    WorkspaceMetrics._started = Date.now() - 60000;
    TabManager.createTab('https://b.com');
    TabManager.createTab('https://c.com', true, null, { partition: 'tor-1' });
    expect(calls).toHaveLength(3);
    expect(WorkspaceMetrics.totals(0)[0].tabs).toBe(1);
    delete globalThis.TabManager;
  });
});

describe('storage and reading it back', () => {
  it('survives a round trip and drops junk', () => {
    WorkspaceMetrics.addSeconds(60);
    WorkspaceMetrics.addTab();
    expect(WorkspaceMetrics.save()).toBe(true);
    const again = WorkspaceMetrics._clean(JSON.parse(localStorage.getItem(WorkspaceMetrics.KEY)));
    expect(Object.keys(again.spaces)).toEqual(['ws:ws_work']);
    const junk = WorkspaceMetrics._clean({ spaces: { 'ws:a': 'A', '../x': 'bad' }, days: { '2026-01-01': { 'ws:a': { s: -5, t: 'x', n: [1, 'ok'] }, 'ws:zzz': { s: 9 } }, 'bad-day': {} } });
    expect(junk.days['2026-01-01']['ws:a']).toEqual({ s: 0, t: 0, n: ['ok'] });
    expect(junk.days['2026-01-01']['ws:zzz']).toBeUndefined();
    expect(junk.days['bad-day']).toBeUndefined();
  });

  it('exports CSV a spreadsheet cannot turn into a formula', () => {
    const csv = WorkspaceMetrics.toCsv([
      { date: '2026-10-01', kind: 'workspace', name: '=HYPERLINK("http://x")', seconds: 90, tabs: 3, notes: 1 },
      { date: '2026-10-01', kind: 'project', name: 'A, "B"', seconds: 30, tabs: 0, notes: 0 },
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('date,space_type,space,seconds,minutes,tabs_opened,notes_written');
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(lines[1]).toContain(',90,1.5,3,1');
    expect(lines[2]).toContain('"A, ""B"""');
  });

  it('sends the CSV through the save dialog and refuses when there is nothing', async () => {
    await expect(WorkspaceMetrics.exportCsv()).rejects.toThrow(/Nothing has been recorded/);
    WorkspaceMetrics.addSeconds(30);
    window.vex = { saveTextFile: vi.fn(async () => ({ ok: true })) };
    await WorkspaceMetrics.exportCsv();
    const [name, text, kind] = window.vex.saveTextFile.mock.calls[0];
    expect(name).toMatch(/^vex-workspace-metrics-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(kind).toBe('csv');
    expect(text).toContain('Work');
    delete window.vex;
  });

  it('prunes old days and resets', () => {
    WorkspaceMetrics.addSeconds(10, new Date(Date.now() - 500 * 86400000));
    WorkspaceMetrics.addSeconds(10);
    WorkspaceMetrics.save();
    expect(Object.keys(WorkspaceMetrics.data.days)).toHaveLength(1);
    WorkspaceMetrics.reset();
    expect(WorkspaceMetrics.totals(0)).toEqual([]);
  });

  it('is excluded from sync, and its settings group is registered', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/js/sync-engine.js'), 'utf8');
    expect(src).not.toContain('vex.workspaceMetrics');
    expect(VexSettingsGroups.ids()).toContain('workspace-metrics');
  });

  it('draws a table and resets after a confirmation', async () => {
    WorkspaceMetrics.addSeconds(3600);
    const box = document.createElement('div');
    WorkspaceMetrics.renderSettings(box);
    expect(box.textContent).toContain('1 h 00 min');
    globalThis.vexConfirm = vi.fn(async () => true);
    box.querySelector('#wm-reset').click();
    await new Promise(r => setTimeout(r, 0));
    expect(globalThis.vexConfirm).toHaveBeenCalled();
    expect(WorkspaceMetrics.totals(0)).toEqual([]);
  });
});
