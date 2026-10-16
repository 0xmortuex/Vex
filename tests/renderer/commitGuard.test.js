// T0-018, the part that acts: shedding Vex's own load when Windows is short of
// memory during Game mode, with the same protections as Game mode itself.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommitGuard } from '../../src/renderer/js/commit-guard.js';

const P = (level, availMB) => ({ level, previous: 'ok', availMB, limitMB: 33587, usedMB: 33587 - availMB });

function setup({ gaming = true, allowSleep = true } = {}) {
  const store = {};
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const tabs = [
    { id: 'front', sleeping: false },
    { id: 'bg1', sleeping: false },
    { id: 'bg2', sleeping: false },
    { id: 'pinned', sleeping: false, pinned: true },
    { id: 'music', sleeping: false, audible: true, muted: false },
    { id: 'call', sleeping: false, capturing: true },
    { id: 'asleep', sleeping: true },
  ];
  globalThis.TabManager = {
    tabs, activeTabId: 'front',
    isCapturing: (t) => !!t.capturing,
    sleepTab: vi.fn(async (id) => { tabs.find(t => t.id === id).sleeping = true; }),
  };
  globalThis.GameMode = { gaming, _gamingReport: { sleptIds: [] } };
  globalThis.GameSession = { active: gaming, sleepAllowed: () => allowSleep };
  globalThis.SidebarManager = { sleepHiddenPanels: vi.fn(() => ['discord']) };
  globalThis.ModelManager = { freeGpu: vi.fn(async () => ({ freed: 5500, models: ['qwen3.5:latest'] })) };
  globalThis.window = { showToast: vi.fn(), VexProblems: { note: vi.fn() } };
  CommitGuard.level = 'ok'; CommitGuard._report = null; CommitGuard._last = null; CommitGuard._stopRepeat();
  return { tabs, store };
}
function teardown() {
  for (const k of ['localStorage', 'TabManager', 'GameMode', 'GameSession', 'SidebarManager', 'ModelManager', 'window']) delete globalThis[k];
  CommitGuard._stopRepeat();
}

describe('CommitGuard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); teardown(); delete globalThis.VexJobs; });

  it('is the memory pressure source of VexJobs.heavy: heavy work waits only while it is holding', async () => {
    setup();
    let fn = null;
    globalThis.VexJobs = { setMemoryPressure: vi.fn((f) => { fn = f; }) };
    CommitGuard.init();
    expect(VexJobs.setMemoryPressure).toHaveBeenCalledTimes(1);
    expect(fn()).toBe('');                                   // no pressure yet
    await CommitGuard.onPressure(P('high', 6000));
    expect(fn()).toMatch(/short of memory/);                 // short during Game mode: heavy work waits
    CommitGuard.setEnabled(false);
    expect(fn()).toBe('');                                   // switched off: never holds
    CommitGuard.setEnabled(true);
    GameMode.gaming = false; GameSession.active = false;
    expect(fn()).toBe('');                                   // not gaming: never holds
  });

  it('sleeps only ordinary background tabs, unloads the model and the panels, and holds background work', async () => {
    const { tabs } = setup();
    await CommitGuard.onPressure(P('high', 6000));
    expect(tabs.filter(t => t.sleeping).map(t => t.id).sort()).toEqual(['asleep', 'bg1', 'bg2']);   // front, pinned, music and call stay awake
    expect(ModelManager.freeGpu).toHaveBeenCalledTimes(1);
    expect(SidebarManager.sleepHiddenPanels).toHaveBeenCalled();
    expect(CommitGuard.holding()).toBe(true);
    expect(GameMode._gamingReport.sleptIds.sort()).toEqual(['bg1', 'bg2']);   // so Game mode wakes them after the game
  });

  it('does nothing outside Game mode', async () => {
    const { tabs } = setup({ gaming: false });
    await CommitGuard.onPressure(P('critical', 2000));
    expect(tabs.filter(t => t.sleeping).length).toBe(1);
    expect(ModelManager.freeGpu).not.toHaveBeenCalled();
    expect(CommitGuard.holding()).toBe(false);
  });

  it('does nothing when switched off', async () => {
    const { tabs } = setup();
    CommitGuard.setEnabled(false);
    await CommitGuard.onPressure(P('high', 6000));
    expect(tabs.filter(t => t.sleeping).length).toBe(1);
    expect(CommitGuard.holding()).toBe(false);
  });

  it('leaves the tabs awake when sleeping on its own is not allowed, and still frees the model', async () => {
    const { tabs } = setup({ allowSleep: false });
    await CommitGuard.onPressure(P('high', 6000));
    expect(tabs.filter(t => t.sleeping).length).toBe(1);
    expect(SidebarManager.sleepHiddenPanels).not.toHaveBeenCalled();
    expect(ModelManager.freeGpu).toHaveBeenCalled();
    expect(CommitGuard._report.tabsLeft).toBe(true);
  });

  it('looks again every 30 s while short, and stops when the headroom is back', async () => {
    setup();
    await CommitGuard.onPressure(P('high', 6000));
    TabManager.tabs.push({ id: 'woke', sleeping: false });
    await vi.advanceTimersByTimeAsync(30500);
    expect(TabManager.tabs.find(t => t.id === 'woke').sleeping).toBe(true);
    await CommitGuard.onPressure(P('ok', 20000));
    TabManager.tabs.push({ id: 'later', sleeping: false });
    await vi.advanceTimersByTimeAsync(60000);
    expect(TabManager.tabs.find(t => t.id === 'later').sleeping).toBe(false);
    expect(CommitGuard.holding()).toBe(false);
  });

  it('says what it did once, when the game ends, never during it', async () => {
    setup();
    await CommitGuard.onPressure(P('critical', 3000));
    expect(window.showToast).not.toHaveBeenCalled();
    const msg = CommitGuard.onGameEnded();
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(msg).toMatch(/down to 2\.9 GB of 33 GB/);
    expect(msg).toMatch(/slept 2 tabs/);
    expect(CommitGuard.onGameEnded()).toBeNull();
  });

  it('never reaches for another program: its source has no way to', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../src/renderer/js/commit-guard.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/kill|taskkill|setPriority|terminate/i);
  });
});
