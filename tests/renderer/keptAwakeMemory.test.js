// @vitest-environment jsdom
//
// The owner's Vex used 5 GB on 2026-10-09: 3.3 GB was their claude.ai tabs,
// two set to never sleep and open for three days, and nothing said so because
// the memory notice was off. A tab or panel kept awake by choice that passes
// 1.5 GB now gets one toast, Reload or Let it sleep, once per session, even
// with the notice off, and not while a game runs (js/kept-awake-memory.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexJobs } = require('../../src/renderer/js/jobs.js');
const { KeptAwakeMemory } = require('../../src/renderer/js/kept-awake-memory.js');

const NEVER = Number.MAX_SAFE_INTEGER;
const GB = 1024 * 1024;   // KB
let memByWc, pidByWc, toasts, webviews, panelWebviews, keepModes;

function webview(wc) { return { getWebContentsId: () => wc, reload: vi.fn() }; }
function tab(id, url, extra = {}) { return { id, url, title: url, sleeping: false, keepAwakeUntil: 0, ...extra }; }

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('vex.memoryNoticeMB', '0');   // the owner's: notices off
  KeptAwakeMemory._told.clear();
  memByWc = {}; pidByWc = {}; toasts = [];
  webviews = new Map(); panelWebviews = {}; keepModes = {};
  window.vex = {
    tabMemory: vi.fn(async (ids) => ({ byId: Object.fromEntries(ids.filter(id => id in memByWc).map(id => [id, { memKB: memByWc[id], pid: pidByWc[id] || id, shared: false }])) })),
  };
  window.showToast = vi.fn((message, type, duration, opts) => { const t = { message, type, duration, opts }; toasts.push(t); return { el: null, dismiss() {} }; });
  globalThis.WebviewManager = { webviews };
  globalThis.TabManager = {
    tabs: [],
    _neverSleepHosts: () => new Set(JSON.parse(localStorage.getItem('vex.neverSleepHosts') || '[]')),
    isCapturing: () => false,
    _refreshKeepAwakeIndicator: vi.fn(),
    persistTabs: vi.fn(),
  };
  globalThis.SidebarManager = {
    panelWebviews,
    keepAwakeFor: (n) => ({ mode: keepModes[n] || 'off' }),
    keptAwakeNow: (n) => keepModes[n] === 'always',
    panelLabel: (n) => n[0].toUpperCase() + n.slice(1),
    panelBusy: () => '',
    setKeepAwakeMode: vi.fn((n, mode) => { keepModes[n] = mode; return true; }),
  };
  globalThis.SiteProfiles = { setNeverSleep: vi.fn((h, on) => { const s = TabManager._neverSleepHosts(); if (on) s.add(h); else s.delete(h); localStorage.setItem('vex.neverSleepHosts', JSON.stringify([...s])); }) };
  delete globalThis.GameMode;
});
afterEach(() => { KeptAwakeMemory._job?.stop(); KeptAwakeMemory._job = null; vi.useRealTimers(); });

function addTab(t, wc, kb, pid) {
  TabManager.tabs.push(t);
  webviews.set(t.id, webview(wc));
  memByWc[wc] = kb;
  if (pid) pidByWc[wc] = pid;
}

describe('a tab kept awake that grows', () => {
  it('says so once, with Reload and Let it sleep, though memory notices are off', async () => {
    addTab(tab('t1', 'https://claude.ai/chat/1', { keepAwakeUntil: NEVER }), 11, 3.3 * GB);
    await KeptAwakeMemory.check();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('claude.ai is using 3.3 GB and never sleeps.');
    expect(toasts[0].opts.actions.map(a => a.label)).toEqual(['Reload', 'Let it sleep']);
    await KeptAwakeMemory.check();
    expect(toasts).toHaveLength(1);
  });

  it('names same-site tabs sharing one process together, in one toast', async () => {
    addTab(tab('t1', 'https://claude.ai/chat/1', { keepAwakeUntil: NEVER }), 11, 3.3 * GB, 500);
    addTab(tab('t2', 'https://claude.ai/chat/2', { keepAwakeUntil: NEVER }), 12, 3.3 * GB, 500);
    await KeptAwakeMemory.check();
    expect(toasts.map(t => t.message)).toEqual(['2 claude.ai tabs are using 3.3 GB together and never sleep.']);
    toasts[0].opts.actions[0].run();
    expect(webviews.get('t1').reload).toHaveBeenCalled();
    expect(webviews.get('t2').reload).toHaveBeenCalled();
  });

  it('leaves alone a heavy tab nobody kept awake, and a kept-awake one under 1.5 GB', async () => {
    addTab(tab('t1', 'https://heavy.example/'), 11, 3 * GB);
    addTab(tab('t2', 'https://light.example/', { keepAwakeUntil: NEVER }), 12, 1.4 * GB);
    await KeptAwakeMemory.check();
    expect(toasts).toEqual([]);
  });

  it('counts a never-sleep site, and Let it sleep takes the site off that list', async () => {
    localStorage.setItem('vex.neverSleepHosts', JSON.stringify(['claude.ai']));
    addTab(tab('t1', 'https://www.claude.ai/new'), 11, 2 * GB);
    await KeptAwakeMemory.check();
    expect(toasts[0].message).toBe('claude.ai is using 2.0 GB and never sleeps.');
    toasts[0].opts.actions[1].run();
    expect(SiteProfiles.setNeverSleep).toHaveBeenCalledWith('claude.ai', false);
    expect(TabManager._neverSleepHosts().has('claude.ai')).toBe(false);
    expect(TabManager.persistTabs).toHaveBeenCalled();
  });

  it('Let it sleep ends a tab\'s keep-awake timer', async () => {
    const t = tab('t1', 'https://claude.ai/chat/1', { keepAwakeUntil: Date.now() + 3600000 });
    addTab(t, 11, 2 * GB);
    await KeptAwakeMemory.check();
    expect(toasts[0].message).toBe('claude.ai is using 2.0 GB and is kept awake.');
    toasts[0].opts.actions[1].run();
    expect(t.keepAwakeUntil).toBe(0);
    expect(TabManager._refreshKeepAwakeIndicator).toHaveBeenCalledWith(t);
  });

  it('waits while it is playing, and says it once it is quiet', async () => {
    const t = tab('t1', 'https://claude.ai/chat/1', { keepAwakeUntil: NEVER, audible: true });
    addTab(t, 11, 2 * GB);
    await KeptAwakeMemory.check();
    expect(toasts).toEqual([]);
    t.audible = false;
    await KeptAwakeMemory.check();
    expect(toasts).toHaveLength(1);
  });
});

describe('a panel kept awake that grows', () => {
  it('offers Reload and Let it sleep for the panel', async () => {
    keepModes.discord = 'always';
    panelWebviews.discord = webview(21);
    memByWc[21] = 1.6 * GB;
    await KeptAwakeMemory.check();
    expect(toasts[0].message).toBe('Discord is using 1.6 GB and never sleeps.');
    toasts[0].opts.actions[0].run();
    expect(panelWebviews.discord.reload).toHaveBeenCalled();
    toasts[0].opts.actions[1].run();
    expect(SidebarManager.setKeepAwakeMode).toHaveBeenCalledWith('discord', 'off');
  });

  it('says nothing for a panel only awake for calls', async () => {
    keepModes.discord = 'call';
    panelWebviews.discord = webview(21);
    memByWc[21] = 1.6 * GB;
    await KeptAwakeMemory.check();
    expect(toasts).toEqual([]);
  });
});

describe('on the shared job timer', () => {
  it('checks every five minutes, and not while a game is running', async () => {
    vi.useFakeTimers();
    addTab(tab('t1', 'https://claude.ai/chat/1', { keepAwakeUntil: NEVER }), 11, 3.3 * GB);
    globalThis.GameMode = { gaming: true };
    KeptAwakeMemory.init();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
    expect(window.vex.tabMemory).not.toHaveBeenCalled();
    GameMode.gaming = false;
    VexJobs.resume();
    await vi.advanceTimersByTimeAsync(10);
    expect(toasts).toHaveLength(1);
  });
});
