// @vitest-environment jsdom
//
// T3-066 (Wave 6): a feature whose module loads after start-up joins the usage record late. The staging pass at start-up
// could not hold it off then, so it must not count it as seen, and a second pass after it registers holds it off on a
// profile that already existed, never switches anything on, and leaves a brand-new profile its defaults.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

let R, switches;
function fakeUsage() {
  switches = {};
  return {
    report: () => ({ since: Date.now() }),
    get: (id) => (id in switches ? { id } : null),
    isEnabled: (id) => switches[id],
    disable: async (id) => { switches[id] = false; },
    enable: async (id) => { switches[id] = true; },
    add(id, on = true) { switches[id] = on; },
  };
}

beforeEach(() => {
  localStorage.clear();
  R = fresh('feature-registry.js').VexRegistry;
  R._reset();
  R.defineAll([
    { id: 'early', title: 'Early', maturity: 'new' },
    { id: 'late-a', title: 'Late A', maturity: 'new' },
    { id: 'late-passive', title: 'Late passive', maturity: 'new', existingProfileDefault: 'on' },
    { id: 'late-stable', title: 'Late stable', maturity: 'stable' },
  ]);
  globalThis.VexRegistry = R;
  const u = fakeUsage();
  globalThis.VexUsage = u;
  u.add('early');
});

describe('an existing profile', () => {
  beforeEach(() => { localStorage.setItem('vex.tabs', '[]'); });

  it('does not count a feature as seen while it is not in the usage record', async () => {
    expect(await R.stage()).toEqual(['early']);
    expect(R._load().staged['late-a']).toBeUndefined();
    expect(R._load().staged.early).toMatchObject({ off: true });
  });

  it('holds the late feature off once it registers, and a profile that was staged before is not turned on', async () => {
    await R.stage();
    globalThis.VexUsage.add('late-a');
    globalThis.VexUsage.add('late-passive');
    globalThis.VexUsage.add('late-stable');
    const held = await R.restageLate();
    expect(held).toEqual(['late-a']);
    expect(switches['late-a']).toBe(false);
    expect(switches['late-passive']).toBe(true);       // a named passive feature stays on
    expect(switches['late-stable']).toBe(true);
    expect(switches.early).toBe(false);                // nothing was switched back on
    expect(R._load().staged['late-a'].off).toBe(true);
    expect(await R.restageLate()).toEqual([]);         // idempotent
  });

  it('waits for a staging run that is still going before it runs', async () => {
    const order = [];
    const u = globalThis.VexUsage;
    const slow = u.disable;
    u.disable = async (id) => { await new Promise(r => setTimeout(r, 20)); order.push('disable ' + id); return slow(id); };
    const first = R.stage();
    u.add('late-a');
    await R.restageLate();
    order.push('restage done');
    await first;
    expect(order[order.length - 1]).toBe('restage done');
    expect(order).toContain('disable early');
    expect(switches['late-a']).toBe(false);
  });
});

describe('a brand-new profile', () => {
  it('keeps the defaults of a late feature too', async () => {
    expect(R.hasProfileEvidence()).toBe(false);
    expect(await R.stage()).toEqual([]);
    globalThis.VexUsage.add('late-a');
    expect(await R.restageLate()).toEqual([]);
    expect(switches['late-a']).toBe(true);
  });
});

describe('VexLazy.afterIdle with usage ids', () => {
  it('registers the ids, then runs the staging pass again, and reports a missing registry instead of skipping it', async () => {
    document.head.innerHTML = '';
    const lazy = fresh('lazy.js').VexLazy;
    lazy.ensure = vi.fn(async () => true);
    const order = [];
    globalThis.VexUsageRegistry = { register: vi.fn((u, ids) => { order.push('register ' + ids.join(',')); }) };
    globalThis.VexRegistry = { restageLate: vi.fn(async () => { order.push('restage'); return []; }) };
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' });
    window.requestIdleCallback = (fn) => fn();
    expect(await lazy.afterIdle('js/x.js', { delayMs: 0, usage: ['late-a'] })).toBe(true);
    expect(order).toEqual(['register late-a', 'restage']);

    delete globalThis.VexRegistry;
    await expect(lazy.afterIdle('js/y.js', { delayMs: 0, usage: ['late-b'] })).rejects.toThrow(/feature registry is not loaded/);
    delete globalThis.VexUsageRegistry;
  });
});
