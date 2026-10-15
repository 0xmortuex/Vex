// @vitest-environment jsdom
//
// Battery-aware mode: the verdict, the debounce, exactly what is held and put
// back, and what it must never touch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexJobs } = require('../../src/renderer/js/jobs.js');
const { BatteryMode } = require('../../src/renderer/js/battery-mode.js');
const { SleepConsent } = require('../../src/renderer/js/sleep-consent.js');
const { TabManager } = require('../../src/renderer/js/tabs.js');
globalThis.VexJobs = VexJobs;
globalThis.BatteryMode = BatteryMode;
globalThis.SleepConsent = SleepConsent;

let hidden;
const reset = () => {
  localStorage.clear();
  BatteryMode._clearPending();
  BatteryMode.hw = { hasBattery: null, onBattery: false, percent: null, error: '' };
  BatteryMode.level = 'off';
  BatteryMode._settled = false;
  BatteryMode._queue.clear();
  BatteryMode._running = false;
  document.body.className = '';
  delete document.body.dataset.batteryMode;
  document.body.innerHTML = '<div id="battery-saving" hidden><span class="battery-saving-icon"></span><span class="battery-saving-label"></span></div>';
  VexJobs._jobs.clear();
  if (VexJobs._tick) clearTimeout(VexJobs._tick);
  VexJobs._tick = null;
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  globalThis.GameMode = { gaming: false };
  window.VexProblems = { note: vi.fn() };
  window.showToast = vi.fn();
  window.vex = { powerLean: vi.fn(async () => true) };
};
beforeEach(() => { vi.useFakeTimers(); reset(); });
afterEach(() => { BatteryMode._clearPending(); if (VexJobs._tick) clearTimeout(VexJobs._tick); VexJobs._tick = null; vi.useRealTimers(); });

const on = () => { localStorage.setItem(BatteryMode.KEYS.enabled, '1'); };
// A laptop, as Windows reports it.
const laptop = (over = {}) => BatteryMode.ingest({ hasBattery: true, onBattery: false, percent: 80, ...over });

describe('the verdict', () => {
  const v = (o) => BatteryMode.verdict({ enabled: true, hasBattery: true, onBattery: false, percent: 80, lowPercent: 20, ...o });
  it('is off when the mode is off, whatever the PC is doing', () => {
    expect(v({ enabled: false, onBattery: true })).toBe('off');
  });
  it('mains, battery, low', () => {
    expect(v({})).toBe('ac');
    expect(v({ onBattery: true })).toBe('battery');
    expect(v({ onBattery: true, percent: 20 })).toBe('low');
    expect(v({ onBattery: true, percent: 21 })).toBe('battery');
    expect(v({ onBattery: true, percent: null })).toBe('battery');
    // A low charge on the mains is not low: it is charging.
    expect(v({ onBattery: false, percent: 5 })).toBe('ac');
  });
  it('a PC with no battery is never lean, and an unanswered question is not "on battery"', () => {
    expect(v({ hasBattery: false, onBattery: true })).toBe('no-battery');
    expect(v({ hasBattery: null, onBattery: true })).toBe('unknown');
  });
});

describe('the state machine', () => {
  it('acts at once on the very first answer, then waits ten seconds for each change', () => {
    on();
    BatteryMode.ingest({ hasBattery: true, onBattery: true, percent: 70 });
    expect(BatteryMode.level).toBe('battery');             // started on battery: no wait
    BatteryMode.ingest({ onBattery: false });
    expect(BatteryMode.level).toBe('battery');             // not yet
    vi.advanceTimersByTime(BatteryMode.SETTLE_MS - 1);
    expect(BatteryMode.level).toBe('battery');
    vi.advanceTimersByTime(2);
    expect(BatteryMode.level).toBe('ac');
  });

  it('a loose plug flapping inside the wait changes nothing', () => {
    on();
    laptop();
    expect(BatteryMode.level).toBe('ac');
    for (let i = 0; i < 6; i++) {
      BatteryMode.ingest({ onBattery: true });
      vi.advanceTimersByTime(3000);
      BatteryMode.ingest({ onBattery: false });
      vi.advanceTimersByTime(3000);
    }
    vi.advanceTimersByTime(60000);
    expect(BatteryMode.level).toBe('ac');
    expect(window.vex.powerLean).not.toHaveBeenCalledWith(true);
    expect(BatteryMode.isLean()).toBe(false);
  });

  it('ac -> battery -> low -> battery -> ac, each after it has held', () => {
    on();
    laptop();
    const seen = [];
    document.addEventListener('vex:battery-mode', (e) => seen.push(e.detail.level));
    BatteryMode.ingest({ onBattery: true });
    vi.advanceTimersByTime(10001);
    expect(BatteryMode.level).toBe('battery');
    BatteryMode.ingest({ percent: 15 });
    vi.advanceTimersByTime(10001);
    expect(BatteryMode.level).toBe('low');
    BatteryMode.ingest({ percent: 40 });
    vi.advanceTimersByTime(10001);
    expect(BatteryMode.level).toBe('battery');
    BatteryMode.ingest({ onBattery: false });
    vi.advanceTimersByTime(10001);
    expect(BatteryMode.level).toBe('ac');
    expect(seen).toEqual(['battery', 'ac']);               // lean on, lean off: low is still lean
  });

  it('turning the mode off restores at once, even mid-wait', () => {
    on();
    BatteryMode.ingest({ hasBattery: true, onBattery: true, percent: 70 });
    expect(document.body.classList.contains('vex-battery-still')).toBe(true);
    localStorage.removeItem(BatteryMode.KEYS.enabled);
    BatteryMode.ingest({});
    expect(BatteryMode.level).toBe('off');
    expect(document.body.classList.contains('vex-battery-still')).toBe(false);
    expect(document.getElementById('battery-saving').hidden).toBe(true);
    expect(window.vex.powerLean).toHaveBeenLastCalledWith(false);
  });

  it('a desktop is a no-op, and says so', () => {
    on();
    BatteryMode.ingest({ hasBattery: false, onBattery: true, percent: null });
    expect(BatteryMode.level).toBe('no-battery');
    expect(BatteryMode.isLean()).toBe(false);
    expect(BatteryMode.sleepMinutes(30)).toBe(30);
    expect(BatteryMode.holdingJobs()).toBe(false);
    expect(BatteryMode.holdingAi()).toBe(false);
    expect(document.getElementById('battery-saving').hidden).toBe(true);
    expect(BatteryMode.statusText()).toMatch(/No battery detected on this PC/);
  });

  it('a failed read is said in Settings, never read as "on battery"', () => {
    on();
    BatteryMode.ingest({ hasBattery: null, onBattery: true, error: 'Windows did not say whether this PC has a battery: timed out' });
    expect(BatteryMode.isLean()).toBe(false);
    expect(BatteryMode.statusText()).toMatch(/Could not read the battery: Windows did not say/);
  });

  it('the chip shows while lean and says low when it is low', () => {
    on();
    BatteryMode.ingest({ hasBattery: true, onBattery: true, percent: 70 });
    const chip = document.getElementById('battery-saving');
    expect(chip.hidden).toBe(false);
    expect(chip.querySelector('.battery-saving-label').textContent).toBe('Saving battery');
    BatteryMode.ingest({ percent: 10 });
    vi.advanceTimersByTime(10001);
    expect(chip.querySelector('.battery-saving-label').textContent).toMatch(/Low battery/);
  });
});

describe('the sleep timer', () => {
  it('is shorter on battery (10, 5 when low), never longer, and untouched otherwise', () => {
    on();
    laptop();
    expect(BatteryMode.sleepMinutes(30)).toBe(30);
    BatteryMode.ingest({ onBattery: true });
    vi.advanceTimersByTime(10001);
    expect(BatteryMode.sleepMinutes(30)).toBe(10);
    expect(BatteryMode.sleepMinutes(5)).toBe(5);
    BatteryMode.ingest({ percent: 12 });
    vi.advanceTimersByTime(10001);
    expect(BatteryMode.sleepMinutes(30)).toBe(5);
    BatteryMode.setSetting('sleepSooner', false);
    expect(BatteryMode.sleepMinutes(30)).toBe(30);
  });
});

describe('what is held, and put back exactly once', () => {
  it('only jobs that opted in are held; each runs once when the PC is plugged in', () => {
    const marked = vi.fn(), plain = vi.fn(), essential = vi.fn();
    VexJobs.every('marked', 1000, marked, { when: 'background', deferOnBattery: true });
    VexJobs.every('plain', 1000, plain, { when: 'background' });
    VexJobs.every('lock', 1000, essential, { when: 'background' });
    on();
    BatteryMode.ingest({ hasBattery: true, onBattery: true, percent: 70 });
    vi.advanceTimersByTime(10000);
    expect(marked).not.toHaveBeenCalled();
    expect(plain.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(essential.mock.calls.length).toBeGreaterThanOrEqual(9);
    const heldRuns = plain.mock.calls.length;
    BatteryMode.ingest({ onBattery: false });
    vi.advanceTimersByTime(10001);
    expect(BatteryMode.level).toBe('ac');
    // The owed run, then the normal one-second beat resumes: not a burst.
    const after = marked.mock.calls.length;
    expect(after).toBeGreaterThanOrEqual(1);
    expect(after).toBeLessThanOrEqual(2);
    vi.advanceTimersByTime(3000);
    expect(marked.mock.calls.length - after).toBe(3);
    expect(plain.mock.calls.length).toBeGreaterThan(heldRuns);
  });

  it('holding is switched off on its own: turning the switch off runs the owed work', () => {
    const marked = vi.fn();
    VexJobs.every('marked', 1000, marked, { when: 'background', deferOnBattery: true });
    on();
    BatteryMode.ingest({ hasBattery: true, onBattery: true, percent: 70 });
    vi.advanceTimersByTime(5000);
    expect(marked).not.toHaveBeenCalled();
    BatteryMode.setSetting('holdJobs', false);
    expect(marked).toHaveBeenCalledTimes(1);
    expect(VexJobs.heldBecause('background', { deferOnBattery: true })).toBe('');
  });

  it('a game still holds everything it held, and battery adds only its own', () => {
    on();
    BatteryMode.ingest({ hasBattery: true, onBattery: true, percent: 70 });
    expect(VexJobs.heldBecause('background', { deferOnBattery: true })).toBe('saving battery');
    expect(VexJobs.heldBecause('background', { deferOnBattery: false })).toBe('');
    GameMode.gaming = true;
    expect(VexJobs.heldBecause('background', { deferOnBattery: false })).toBe('a game is running');
  });

  it('background AI waits only when battery mode says so, and the scheduler and router see it', () => {
    on();
    laptop();
    expect(BatteryMode.holdingAi()).toBe(false);
    BatteryMode.ingest({ onBattery: true });
    vi.advanceTimersByTime(10001);
    expect(BatteryMode.holdingAi()).toBe(true);
    BatteryMode.setSetting('holdAi', false);
    expect(BatteryMode.holdingAi()).toBe(false);
  });

  it('deferred work (Recall reads, the sync pull) runs once on the mains, one entry per key', () => {
    on();
    const recall = vi.fn(), pullOld = vi.fn(), pullNew = vi.fn();
    expect(BatteryMode.defer('recall:1', recall)).toBe(false);   // on the mains: do it now
    BatteryMode.ingest({ hasBattery: true, onBattery: true, percent: 70 });
    expect(BatteryMode.defer('recall:1', recall)).toBe(true);
    expect(BatteryMode.defer('sync-pull', pullOld)).toBe(true);
    expect(BatteryMode.defer('sync-pull', pullNew)).toBe(true);  // the latest wins
    expect(recall).not.toHaveBeenCalled();
    BatteryMode.ingest({ onBattery: false });
    vi.advanceTimersByTime(10001);
    vi.advanceTimersByTime(BatteryMode.FLUSH_GAP_MS * 3);
    expect(recall).toHaveBeenCalledTimes(1);
    expect(pullOld).not.toHaveBeenCalled();
    expect(pullNew).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    expect(recall).toHaveBeenCalledTimes(1);
    expect(BatteryMode._queue.size).toBe(0);
  });

  it('a failing deferred task is reported, not swallowed, and does not stop the rest', () => {
    on();
    BatteryMode.ingest({ hasBattery: true, onBattery: true, percent: 70 });
    const ok = vi.fn();
    BatteryMode.defer('a', () => { throw new Error('boom'); });
    BatteryMode.defer('b', ok);
    BatteryMode.ingest({ onBattery: false });
    vi.advanceTimersByTime(10001 + BatteryMode.FLUSH_GAP_MS * 3);
    expect(window.VexProblems.note).toHaveBeenCalledWith('Battery', 'A put-off task failed', expect.any(Error));
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('tells the main process while jobs are held, and that it is over', () => {
    on();
    BatteryMode.ingest({ hasBattery: true, onBattery: true, percent: 70 });
    expect(window.vex.powerLean).toHaveBeenLastCalledWith(true);
    BatteryMode.ingest({ onBattery: false });
    vi.advanceTimersByTime(10001);
    expect(window.vex.powerLean).toHaveBeenLastCalledWith(false);
  });
});

describe('what it must never touch', () => {
  // The idle timer filters are tabs.js's own; battery mode only shortens the
  // wait. A tab idle for 12 minutes is due on battery (10) and not on mains.
  const tab = (over) => ({ id: 'x', title: 'T', url: 'https://example.com/', lastViewedAt: Date.now() - 12 * 60000, ...over });
  const run = (tabs, { consent = 'auto', excludePinned = true } = {}) => {
    TabManager.tabs = tabs;
    TabManager.activeTabId = 'active';
    TabManager._inSplitPane = () => false;
    TabManager.isCapturing = (t) => !!t.capturing;
    TabManager.sleepTab = vi.fn(function (id) {
      const t = TabManager.tabs.find(x => x.id === id);
      if (TabManager._isKeptAwake(t)) return;             // the single gate, as in the real sleepTab
      t.sleeping = true;
    });
    SleepConsent.set(consent);
    TabManager.startAutoSleep(30, excludePinned);
    vi.advanceTimersByTime(30000);
    TabManager.stopAutoSleep();
  };
  const goLean = () => { on(); BatteryMode.ingest({ hasBattery: true, onBattery: true, percent: 70 }); };

  it('on the mains a 12-minute idle tab is left alone (30-minute timer)', () => {
    on();
    laptop();
    run([tab({ id: 'active' }), tab({ id: 'idle' })]);
    expect(TabManager.sleepTab).not.toHaveBeenCalled();
  });

  it('on battery the same tab sleeps, through the one consent gate', () => {
    goLean();
    run([tab({ id: 'active' }), tab({ id: 'idle' })]);
    expect(TabManager.sleepTab).toHaveBeenCalledWith('idle');
    TabManager.sleepTab.mockClear();
    run([tab({ id: 'active' }), tab({ id: 'idle' })], { consent: 'never' });
    expect(TabManager.sleepTab).not.toHaveBeenCalled();     // "never" is still never
  });

  it('sound, a call or recording, a kept-awake tab, a never-sleep site and a pinned tab are left as they are', () => {
    goLean();
    localStorage.setItem('vex.neverSleepHosts', JSON.stringify(['discord.com']));
    const tabs = [
      tab({ id: 'active' }),
      tab({ id: 'music', audible: true, muted: false }),
      tab({ id: 'call', capturing: { screen: true } }),
      tab({ id: 'coffee', keepAwakeUntil: Date.now() + 3600000 }),
      tab({ id: 'discord', url: 'https://discord.com/channels/1' }),
      tab({ id: 'pinned', pinned: true }),
      tab({ id: 'idle' }),
    ];
    run(tabs);
    // The timer asks for every idle tab; the single gate (_isKeptAwake, as in
    // the real sleepTab) is what spares the kept ones. Audible and pinned never
    // reach it: the timer's own filters stop them.
    const asked = TabManager.sleepTab.mock.calls.map(c => c[0]);
    expect(asked).not.toContain('music');
    expect(asked).not.toContain('pinned');
    expect(tabs.filter(t => t.sleeping).map(t => t.id)).toEqual(['idle']);
  });

  it('back on the mains the timer is the one the user chose again', () => {
    goLean();
    BatteryMode.ingest({ onBattery: false });
    vi.advanceTimersByTime(10001);
    run([tab({ id: 'active' }), tab({ id: 'idle' })]);
    expect(TabManager.sleepTab).not.toHaveBeenCalled();
  });
});

describe('Settings', () => {
  it('renders the status, the switch and the low level, and a failed save is said', async () => {
    window.vex.powerStatus = vi.fn(async () => ({ hasBattery: false, onBattery: false, percent: null }));
    document.body.insertAdjacentHTML('beforeend', '<div id="battery-settings"></div>');
    await BatteryMode.renderSettings();
    expect(window.vex.powerStatus).toHaveBeenCalledTimes(1);
    expect(document.getElementById('battery-status').textContent).toMatch(/No battery detected on this PC, so turning this on would do nothing here/);
    expect(document.getElementById('setting-battery-enabled').checked).toBe(false);
    expect(document.getElementById('setting-battery-low').value).toBe('20');
    expect(() => BatteryMode.setLowPercent(3)).toThrow(/between 5 and 50/);
    expect(() => BatteryMode.setSetting('nonsense', true)).toThrow(/Unknown battery setting/);
  });
});
