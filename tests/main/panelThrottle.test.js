// main/panel-throttle.js (T3-024): lowers the priority of ONE panel's own process; nothing else.
import { describe, it, expect, vi } from 'vitest';

const { createPanelThrottle } = require('../../src/main/panel-throttle.js');

const PRI = { PRIORITY_LOW: 19, PRIORITY_BELOW_NORMAL: 10, PRIORITY_NORMAL: 0 };

function setup(pages) {
  const prio = new Map(pages.map(p => [p.pid, p.prio ?? 0]));
  const os = { constants: { priority: PRI }, getPriority: vi.fn(pid => prio.get(pid)), setPriority: vi.fn((pid, v) => { prio.set(pid, v); }) };
  const wcs = pages.map(p => ({ id: p.id, type: p.type || 'webview', destroyed: false, isDestroyed() { return this.destroyed; }, getType() { return this.type; }, getOSProcessId: () => p.pid, setBackgroundThrottling: vi.fn() }));
  const webContents = { fromId: (id) => wcs.find(w => w.id === id) || null, getAllWebContents: () => wcs };
  return { os, wcs, prio, t: createPanelThrottle({ os, webContents, ownPid: 1 }) };
}

describe('lowering one panel', () => {
  it('sets the lowest priority on that panel only, turns background throttling on, and puts it back', () => {
    const { t, os, wcs, prio } = setup([{ id: 5, pid: 500 }, { id: 6, pid: 600 }]);
    expect(t.set(5, true)).toEqual({ throttled: true, pid: 500 });
    expect(os.setPriority).toHaveBeenCalledTimes(1);
    expect(os.setPriority).toHaveBeenCalledWith(500, 19);
    expect(wcs[0].setBackgroundThrottling).toHaveBeenCalledWith(true);
    expect(prio.get(600)).toBe(0);
    t.set(5, false);
    expect(prio.get(500)).toBe(0);
    expect(t.isThrottled(5)).toBe(false);
  });

  it('puts a below-normal process (Game mode lowered it) back to normal, not to the lowered level', () => {
    const { t, prio } = setup([{ id: 5, pid: 500, prio: 10 }]);
    t.set(5, true);
    t.set(5, false);
    expect(prio.get(500)).toBe(0);
  });

  it('refuses a process that another page shares, the Vex window itself, and anything that is not a panel page', () => {
    const shared = setup([{ id: 5, pid: 500 }, { id: 6, pid: 500 }]);
    expect(() => shared.t.set(5, true)).toThrow(/shares its process/);
    expect(shared.os.setPriority).not.toHaveBeenCalled();
    const own = setup([{ id: 5, pid: 1 }]);
    expect(() => own.t.set(5, true)).toThrow(/left alone/);
    const ui = setup([{ id: 5, pid: 500, type: 'window' }]);
    expect(() => ui.t.set(5, true)).toThrow(/Only a panel page/);
    const none = setup([]);
    expect(() => none.t.set(9, true)).toThrow(/not there any more/);
  });

  it('forgets a page that went away instead of failing', () => {
    const { t, wcs, os } = setup([{ id: 5, pid: 500 }]);
    t.set(5, true);
    wcs[0].destroyed = true;
    expect(t.set(5, false)).toEqual({ throttled: false });
    expect(os.setPriority).toHaveBeenCalledTimes(1);
    expect(t.count()).toBe(0);
  });

  it('raises a failure to put the priority back, except for a process that is already gone', () => {
    const { t, os } = setup([{ id: 5, pid: 500 }]);
    t.set(5, true);
    os.setPriority.mockImplementationOnce(() => { throw new Error('EPERM'); });
    expect(() => t.set(5, false)).toThrow(/could not be put back/);
    const b = setup([{ id: 5, pid: 500 }]);
    b.t.set(5, true);
    b.os.setPriority.mockImplementationOnce(() => { throw new Error('ESRCH no such process'); });
    expect(b.t.set(5, false)).toEqual({ throttled: false });
  });
});
