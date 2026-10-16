// @vitest-environment jsdom
//
// js/panel-guard.js (T3-024): sleeps a hot Vex panel during a game; never anything else.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VexPanelGuard } = require('../../src/renderer/js/panel-guard.js');

const row = (name, cpuPct) => ({ key: 'panel:' + name, kind: 'panel', label: name, cpuPct });
let snap, acts, notes;

beforeEach(() => {
  localStorage.clear();
  VexPanelGuard._stopLoop();
  VexPanelGuard.slept = [];
  VexPanelGuard.setEnabled(true);
  globalThis.GameSession = { active: true };
  snap = { cpuMeasured: true, spanMs: 120000, rows: [] };
  acts = [];
  globalThis.TabCost = { sample: vi.fn(async () => {}), snapshot: () => snap, act: vi.fn(async (a, r) => { acts.push([a, r.key]); }) };
  globalThis.SidebarManager = { activePanel: 'notes', sidePanel: null, panelWebviews: { music: {}, call: {}, discord: {} }, panelBusy: (n) => (n === 'call' ? 'a call' : ''), panelSleepPrefs: () => ({ exempt: ['discord'] }), panelLabel: (n) => n };
  notes = [];
  globalThis.VexLedger = { note: vi.fn((l) => notes.push(l)) };
  delete globalThis.VexAttention;
  window.showToast = vi.fn();
});

describe('which panel', () => {
  it('picks the hottest panel above the limit, never one that must stay', () => {
    const rows = [row('music', 40), row('call', 90), row('discord', 80), row('notes', 70), { key: 'site:x', kind: 'site', cpuPct: 99 }, row('mild', 5)];
    expect(VexPanelGuard.pick(rows, { cpuPct: 15, keep: ['call', 'discord', 'notes'] }).key).toBe('panel:music');
    expect(VexPanelGuard.pick(rows, { cpuPct: 15, keep: ['call', 'discord', 'notes'], already: ['music'] })).toBeNull();
    expect(VexPanelGuard.pick([row('mild', 5)], { cpuPct: 15 })).toBeNull();
  });
  it('keeps the open panels, the kept-awake ones and those in a call', () => {
    expect(VexPanelGuard._keep().sort()).toEqual(['call', 'discord', 'notes']);
  });
});

describe('one look during a game', () => {
  it('sleeps the hot panel, writes a ledger line with an undo, and only the limit per game', async () => {
    snap.rows = [row('music', 40), row('call', 90), row('discord', 80)];
    const r = await VexPanelGuard.step();
    expect(r).toMatchObject({ name: 'music', cpuPct: 40 });
    expect(acts).toEqual([['sleep-panel', 'panel:music']]);
    expect(notes[0]).toMatchObject({ feature: 'panel-guard', undo: { kind: 'panel-guard-open', panel: 'music' } });
    expect(await VexPanelGuard.step()).toBeNull();
    snap.rows = [row('a', 50)];
    globalThis.SidebarManager.panelWebviews.a = {};
    await VexPanelGuard.step();
    expect(VexPanelGuard.slept).toHaveLength(2);
    snap.rows = [row('b', 60)];
    expect(await VexPanelGuard.step()).toBeNull();
  });
  it('does nothing outside a game, when off, or on too little measuring', async () => {
    snap.rows = [row('music', 40)];
    globalThis.GameSession.active = false;
    expect(await VexPanelGuard.step()).toBeNull();
    globalThis.GameSession.active = true;
    snap.spanMs = 20000;
    expect(await VexPanelGuard.step()).toBeNull();
    snap.spanMs = 120000;
    VexPanelGuard.setEnabled(false);
    expect(await VexPanelGuard.step()).toBeNull();
    expect(acts).toEqual([]);
  });
  it('lets a refusal from the sidebar be the answer instead of pretending it slept', async () => {
    snap.rows = [row('music', 40)];
    globalThis.TabCost.act = vi.fn(async () => { throw new Error('music is in use'); });
    await expect(VexPanelGuard.step()).rejects.toThrow(/in use/);
    expect(VexPanelGuard.slept).toEqual([]);
  });
  it('says what it did once, when the game ends', () => {
    VexPanelGuard.slept = [{ name: 'music', label: 'Music', cpuPct: 40, at: 1 }];
    const msg = VexPanelGuard.report();
    expect(msg).toMatch(/put Music \(40%\) to sleep/);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(VexPanelGuard.report()).toBeNull();
  });
  it('limits are checked', () => {
    expect(() => VexPanelGuard.setLimit(1)).toThrow(/3 to 90/);
    VexPanelGuard.setLimit(25);
    expect(VexPanelGuard.prefs().cpuPct).toBe(25);
  });
});
