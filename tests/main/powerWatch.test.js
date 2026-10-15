// Battery-aware mode, main side: Electron's powerMonitor says mains or
// battery; one read of Win32_Battery says whether there is a battery at all.
import { describe, it, expect, vi } from 'vitest';
const { EventEmitter } = require('events');
const { createPowerWatch, parseProbe } = require('../../src/main/power-watch.js');
const upd = require('../../src/main/extension-updates.js');

const monitor = (onBattery = false) => {
  const m = new EventEmitter();
  m.onBattery = onBattery;
  m.isOnBatteryPower = () => m.onBattery;
  return m;
};

describe('the watcher', () => {
  it('forwards on-battery and on-ac while it listens, and nothing after stop', () => {
    const m = monitor();
    const send = vi.fn();
    const w = createPowerWatch({ powerMonitor: m, send, probe: async () => ({ hasBattery: true, percent: 80, charging: true }) });
    m.emit('on-battery');
    expect(send).not.toHaveBeenCalled();           // not asked yet
    w.start();
    w.start();                                     // twice is the same as once
    m.emit('on-battery');
    m.emit('on-ac');
    expect(send.mock.calls).toEqual([['power:state', { onBattery: true }], ['power:state', { onBattery: false }]]);
    w.stop();
    m.emit('on-battery');
    expect(send).toHaveBeenCalledTimes(2);
    expect(m.listenerCount('on-battery')).toBe(0);
    expect(m.listenerCount('on-ac')).toBe(0);
  });

  it('reads Win32_Battery once, and the live mains state every time', async () => {
    const m = monitor(false);
    const probe = vi.fn(async () => ({ hasBattery: true, percent: 64, charging: false }));
    const w = createPowerWatch({ powerMonitor: m, send: () => {}, probe });
    expect(await w.status()).toEqual({ onBattery: false, hasBattery: true, percent: 64, charging: false });
    m.onBattery = true;
    expect(await w.status()).toMatchObject({ onBattery: true, hasBattery: true });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('says so when Windows will not answer, and asks again next time', async () => {
    const probe = vi.fn()
      .mockRejectedValueOnce(new Error('Windows did not say whether this PC has a battery: timed out'))
      .mockResolvedValueOnce({ hasBattery: false, percent: null, charging: null });
    const w = createPowerWatch({ powerMonitor: monitor(), send: () => {}, probe });
    await expect(w.status()).rejects.toThrow(/did not say whether this PC has a battery/);
    expect(await w.status()).toMatchObject({ hasBattery: false });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('keeps the lean flag the interface sets, and clears it on request', () => {
    const w = createPowerWatch({ powerMonitor: monitor(), send: () => {} });
    expect(w.lean()).toBe(false);
    w.setLean(true);
    expect(w.lean()).toBe(true);
    w.setLean(false);
    expect(w.lean()).toBe(false);
  });

  it('refuses a powerMonitor that cannot answer', () => {
    expect(() => createPowerWatch({ powerMonitor: {}, send: () => {} })).toThrow(/powerMonitor/);
    expect(() => createPowerWatch({ powerMonitor: monitor() })).toThrow(/send is required/);
  });
});

describe('what Windows says about the battery', () => {
  it('a desktop has no Win32_Battery row', () => {
    expect(parseProbe('none\r\n')).toEqual({ hasBattery: false, percent: null, charging: null });
  });
  it('a laptop on its battery, plugged in, and one that did not say its charge', () => {
    expect(parseProbe('battery 63 1')).toEqual({ hasBattery: true, percent: 63, charging: false });
    expect(parseProbe('battery 100 2')).toEqual({ hasBattery: true, percent: 100, charging: true });
    expect(parseProbe('battery -1 -1')).toEqual({ hasBattery: true, percent: null, charging: null });
  });
  it('refuses an answer it cannot read instead of guessing', () => {
    expect(() => parseProbe('')).toThrow(/cannot read/);
    expect(() => parseProbe('Get-CimInstance : Access denied')).toThrow(/cannot read/);
  });
});

describe('extension updates while battery-aware mode is saving power', () => {
  const manifest = (over = {}) => ({ manifest_version: 3, name: 'Tester', version: '1.0.0', permissions: ['storage'], ...over });
  const make = (onBattery, over = {}) => {
    let state = upd.defaultState();
    const find = vi.fn(async () => null);
    const updater = upd.createExtensionUpdater({
      list: () => [{ folder: 't', name: 'T', version: '1.0.0', manifest: manifest(), source: { webstore: 'a'.repeat(32) } }],
      find, install: async () => ({ ok: true, version: '2.0.0' }),
      readState: () => JSON.parse(JSON.stringify(state)), writeState: (s) => { state = JSON.parse(JSON.stringify(s)); },
      isOnline: () => true, isMetered: async () => false, staggerMs: 0,
      isOnBattery: () => onBattery(),
      ...over,
    });
    return { updater, find, state: () => state };
  };

  it('a scheduled check waits and says why; "Check now" still goes ahead', async () => {
    let lean = true;
    const { updater, find, state } = make(() => lean);
    expect(await updater.checkNow({ manual: false })).toEqual({ skipped: 'battery' });
    expect(find).not.toHaveBeenCalled();
    expect(state().lastOutcome).toMatch(/saving battery/);
    await updater.checkNow({ manual: true });
    expect(find).toHaveBeenCalledTimes(1);
    lean = false;
    await updater.checkNow({ manual: false });
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('looks again soon, not in six hours', async () => {
    vi.useFakeTimers();
    try {
      const waits = [];
      const { updater } = make(() => true, { setTimeout: (fn, ms) => { waits.push(ms); return setTimeout(fn, ms); } });
      updater.start();
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 10);
      expect(waits).toContain(20 * 60 * 1000);
      expect(waits).not.toContain(6 * 60 * 60 * 1000);
      updater.stop();
    } finally { vi.useRealTimers(); }
  });
});
