// @vitest-environment jsdom
//
// T3-024, the missing parts of the panel guard: a graphics figure (for Vex's one graphics
// process) and a throttle option that keeps the panel loaded instead of sleeping it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VexPanelGuard } = require('../../src/renderer/js/panel-guard.js');

const row = (name, cpuPct) => ({ key: 'panel:' + name, kind: 'panel', label: name, cpuPct });
let snap, notes, undos;

beforeEach(() => {
  localStorage.clear();
  VexPanelGuard._stopLoop();
  VexPanelGuard.slept = [];
  VexPanelGuard.setEnabled(true);
  globalThis.GameSession = { active: true };
  snap = { cpuMeasured: true, spanMs: 120000, rows: [] };
  globalThis.TabCost = { sample: vi.fn(async () => {}), snapshot: () => snap, act: vi.fn(async () => {}) };
  const wv = (id) => ({ getWebContentsId: () => id });
  globalThis.SidebarManager = { activePanel: 'notes', sidePanel: null, panelWebviews: { music: wv(11), discord: wv(12), call: wv(13) }, panelBusy: (n) => (n === 'call' ? 'a call' : ''), panelSleepPrefs: () => ({ exempt: ['discord'] }), panelLabel: (n) => n, openPanel: vi.fn() };
  notes = []; undos = {};
  globalThis.VexLedger = { note: vi.fn((l) => notes.push(l)), registerUndo: vi.fn((k, fn) => { undos[k] = fn; }) };
  delete globalThis.VexAttention;
  window.showToast = vi.fn();
  window.vex = { throttlePanel: vi.fn(async () => ({})), processes: vi.fn(async () => ({ processes: [{ type: 'Tab', cpu: 30, memKB: 1 }, { type: 'GPU', cpu: 12.34, memKB: 512 * 1024 }] })) };
});

describe('the graphics figure', () => {
  it('reads the graphics process of Vex and says it is one process, not per panel', async () => {
    expect(await VexPanelGuard.gpu()).toEqual({ cpuPct: 12.3, memMB: 512 });
  });
  it('raises when there is nothing to read', async () => {
    window.vex.processes = vi.fn(async () => ({ processes: [{ type: 'Tab', cpu: 1, memKB: 1 }] }));
    await expect(VexPanelGuard.gpu()).rejects.toThrow(/no graphics process/);
    delete window.vex.processes;
    await expect(VexPanelGuard.gpu()).rejects.toThrow(/not available/);
  });
  it('goes into the ledger line of what the guard did', async () => {
    snap.rows = [row('music', 40)];
    await VexPanelGuard.step();
    expect(notes[0].why).toMatch(/graphics process was at 12.3% and 512 MB/);
    expect(notes[0].why).toMatch(/not the panel/);
  });
});

describe('throttle instead of sleep', () => {
  it('defaults to sleep and checks the choice', () => {
    expect(VexPanelGuard.prefs().action).toBe('sleep');
    expect(() => VexPanelGuard.setAction('kill')).toThrow(/sleeps a panel or throttles/);
    VexPanelGuard.setAction('throttle');
    VexPanelGuard.setLimit(20);
    expect(VexPanelGuard.prefs()).toEqual({ cpuPct: 20, action: 'throttle' });
  });

  it('lowers the process of the hot panel through the main process and leaves it loaded', async () => {
    VexPanelGuard.setAction('throttle');
    snap.rows = [row('music', 40)];
    const rec = await VexPanelGuard.step();
    expect(rec).toMatchObject({ name: 'music', action: 'throttle' });
    expect(window.vex.throttlePanel).toHaveBeenCalledWith(11, true);
    expect(TabCost.act).not.toHaveBeenCalled();
    expect(notes[0]).toMatchObject({ what: expect.stringContaining('Lowered the priority'), undo: { kind: 'panel-guard-unthrottle', panel: 'music' } });
  });

  it('may throttle a panel you keep awake, but never one in a call or the open one', async () => {
    VexPanelGuard.setAction('throttle');
    snap.rows = [row('call', 90), row('notes', 80), row('discord', 50)];
    const rec = await VexPanelGuard.step();
    expect(rec.name).toBe('discord');
    // sleeping would not have touched Discord
    VexPanelGuard.slept = [];
    VexPanelGuard.setAction('sleep');
    expect(await VexPanelGuard.step()).toBeNull();
  });

  it('gives the priority back when the game ends, and says so', async () => {
    VexPanelGuard.setAction('throttle');
    snap.rows = [row('music', 40)];
    await VexPanelGuard.step();
    window.vex.throttlePanel.mockClear();
    VexPanelGuard.onGame({ active: false });
    await new Promise(r => setTimeout(r, 0));
    expect(window.vex.throttlePanel).toHaveBeenCalledWith(11, false);
    expect(window.showToast.mock.calls[0][0]).toMatch(/slowed music \(40%\) down.*normal speed again/);
  });

  it('the ledger undo puts the priority back; a closed panel is not an error', async () => {
    VexPanelGuard.init();
    expect(typeof undos['panel-guard-unthrottle']).toBe('function');
    expect(await undos['panel-guard-unthrottle']({ panel: 'music' })).toMatch(/normal speed/);
    expect(window.vex.throttlePanel).toHaveBeenCalledWith(11, false);
    expect(await undos['panel-guard-unthrottle']({ panel: 'gone' })).toMatch(/already closed/);
  });

  it('refuses to throttle a panel that is not loaded, or when the bridge is missing', async () => {
    await expect(VexPanelGuard.throttle('nope', true)).rejects.toThrow(/not loaded/);
    delete window.vex.throttlePanel;
    await expect(VexPanelGuard.throttle('music', true)).rejects.toThrow(/not available/);
  });
});
