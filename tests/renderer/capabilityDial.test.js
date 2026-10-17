// @vitest-environment jsdom
//
// T3-083: the Simple / Standard / Power dial built on the usage counts. Off by default; Simple switches off
// only what was never used, only after two weeks of counting, only with the list accepted, and Standard puts
// back exactly that.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const DAY = 24 * 3600 * 1000;

let state;       // feature id -> on?
function register(id, over = {}) {
  state[id] = true;
  VexUsage.register({ id, title: 'Feature ' + id, group: '', disable: async () => { state[id] = false; }, enable: async () => { state[id] = true; }, isEnabled: () => state[id], ...over });
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  delete window.__vexUsageQueue;
  state = {};
  window.showToast = vi.fn();
  globalThis.VexRegistry = fresh(JS + 'feature-registry.js').VexRegistry;
  globalThis.VexUsage = fresh(JS + 'vex-usage.js').VexUsage;
  globalThis.VexUsageCounters = fresh(JS + 'usage-counters.js').VexUsageCounters;
  delete globalThis.VexMinimalMode;
  delete globalThis.VexLedger;
  globalThis.VexLedger = { record: vi.fn(), registerUndo: vi.fn() };
  globalThis.VexCapabilityDial = fresh(JS + 'capability-dial.js').VexCapabilityDial;
});

function oldCounters(days = 20) {
  VexUsageCounters._rec = { v: 1, since: Date.now() - days * DAY, days: {} };
}
function age(id, days) { VexUsage._load().seen[id] = Date.now() - days * DAY; }

describe('off by default', () => {
  it('does nothing and reports Standard until it is switched on', async () => {
    expect(VexCapabilityDial.enabled()).toBe(false);
    expect(VexCapabilityDial.level()).toBe('standard');
    await expect(VexCapabilityDial.setLevel('simple')).rejects.toThrow(/off/);
  });
});

describe('what Simple would switch off', () => {
  it('keeps anything with a trace of use, anything pinned, anything that cannot be switched off, and anything new', () => {
    const D = VexCapabilityDial;
    const rows = [
      { id: 'never', title: 'Never', on: true, uses: 0, lastUsed: 0, catalogUsed: false, daysSeen: 40 },
      { id: 'used-once', title: 'Used once', on: true, uses: 1, lastUsed: 5, catalogUsed: false, daysSeen: 40 },
      { id: 'catalog', title: 'Catalog', on: true, uses: 0, lastUsed: 0, catalogUsed: true, daysSeen: 40 },
      { id: 'counted', title: 'Counted', on: true, uses: 0, lastUsed: 0, catalogUsed: false, daysSeen: 40 },
      { id: 'young', title: 'Young', on: true, uses: 0, lastUsed: 0, catalogUsed: false, daysSeen: 3 },
      { id: 'off-already', title: 'Off', on: false, uses: 0, lastUsed: 0, catalogUsed: false, daysSeen: 40 },
      { id: 'usage-counters', title: 'Counters', on: true, uses: 0, lastUsed: 0, catalogUsed: false, daysSeen: 40 },
    ];
    const counters = { KEEP_DAYS: 35, total: (id) => (id === 'counted' ? 2 : 0), daysUsed: (id) => (id === 'counted' ? 1 : 0) };
    const p = D.plan(rows, { counters, pinned: [] });
    expect(p.hide.map(h => h.id)).toEqual(['never']);
    const why = Object.fromEntries(p.kept.map(k => [k.id, k.why]));
    expect(why['used-once']).toMatch(/used/);
    expect(why.catalog).toMatch(/used/);
    expect(why.counted).toMatch(/used/);
    expect(why.young).toMatch(/new/);
    expect(why['usage-counters']).toMatch(/dial/);
  });

  it('a feature whose command you pinned stays', () => {
    VexRegistry.define({ id: 'pinned-one', title: 'Pinned', maturity: 'stable', commands: ['pin-cmd'], permissions: { reads: ['x'], writes: ['x'], sends: [] } });
    const p = VexCapabilityDial.plan([{ id: 'pinned-one', title: 'Pinned', on: true, uses: 0, lastUsed: 0, catalogUsed: false, daysSeen: 40 }], { pinned: ['pin-cmd'] });
    expect(p.hide).toEqual([]);
    expect(p.kept[0].why).toMatch(/pinned/);
  });
});

describe('Simple, Standard and Power', () => {
  beforeEach(() => { VexCapabilityDial.setPref(true); });

  it('waits for two weeks of counting and says how long', async () => {
    register('a'); age('a', 40);
    VexUsageCounters._rec = { v: 1, since: Date.now() - 3 * DAY, days: {} };
    await expect(VexCapabilityDial.setLevel('simple', { confirmed: true })).rejects.toThrow(/3 days.*needs 14/);
    expect(state.a).toBe(true);
  });

  it('will not switch anything off until the list was accepted', async () => {
    register('a'); age('a', 40); oldCounters();
    await expect(VexCapabilityDial.setLevel('simple')).rejects.toThrow(/list first/);
    expect(state.a).toBe(true);
  });

  it('Simple switches off what was never used, leaves what was, records one ledger line', async () => {
    register('never'); register('used'); age('never', 40); age('used', 40); oldCounters();
    VexUsage.touch('used');
    const r = await VexCapabilityDial.setLevel('simple', { confirmed: true });
    expect(r.hidden).toEqual(['never']);
    expect(state).toEqual({ never: false, used: true });
    expect(VexCapabilityDial.level()).toBe('simple');
    expect(VexLedger.record).toHaveBeenCalledTimes(1);
    expect(VexLedger.record.mock.calls[0][0].undo).toEqual({ kind: 'capability-dial:restore' });
  });

  it('Standard and Power put back exactly what Simple switched off, and nothing else', async () => {
    register('never'); register('manual'); age('never', 40); age('manual', 40); oldCounters();
    state.manual = false;                      // the person switched this one off themselves, before the dial
    await VexCapabilityDial.setLevel('simple', { confirmed: true });
    expect(state.never).toBe(false);
    await VexCapabilityDial.setLevel('standard');
    expect(state).toEqual({ never: true, manual: false });
    expect(VexCapabilityDial.level()).toBe('standard');
    expect(VexCapabilityDial.hidden()).toEqual([]);
    await VexCapabilityDial.setLevel('power');
    expect(VexCapabilityDial.level()).toBe('power');
  });

  it('a feature the person switched back on themselves is left on when Standard comes', async () => {
    register('never'); age('never', 40); oldCounters();
    await VexCapabilityDial.setLevel('simple', { confirmed: true });
    state.never = true;
    await VexCapabilityDial.setLevel('standard');
    expect(state.never).toBe(true);
  });

  it('turning the dial off from its own button puts everything back', async () => {
    register('never'); age('never', 40); oldCounters();
    await VexCapabilityDial.setLevel('simple', { confirmed: true });
    await VexCapabilityDial.setEnabled(false);
    expect(state.never).toBe(true);
    expect(VexCapabilityDial.enabled()).toBe(false);
  });

  it('the bare switch (Minimal Vex) leaves the list in place so nothing is forgotten', async () => {
    register('never'); age('never', 40); oldCounters();
    await VexCapabilityDial.setLevel('simple', { confirmed: true });
    VexCapabilityDial.setPref(false);
    expect(VexCapabilityDial.hidden()).toEqual(['never']);
    expect(VexCapabilityDial.level()).toBe('standard');
    await VexCapabilityDial.restore();
    expect(state.never).toBe(true);
  });

  it('refuses while Minimal Vex is on', async () => {
    register('a'); age('a', 40); oldCounters();
    globalThis.VexMinimalMode = { isOn: () => true };
    await expect(VexCapabilityDial.setLevel('simple', { confirmed: true })).rejects.toThrow(/Minimal Vex is on/);
  });

  it('refuses when the usage counts are off, because it could not tell what is unused', async () => {
    register('a'); age('a', 40); oldCounters();
    VexUsageCounters.setEnabled(false);
    await expect(VexCapabilityDial.setLevel('simple', { confirmed: true })).rejects.toThrow(/counts are switched off/);
  });

  it('an unknown level raises', async () => {
    await expect(VexCapabilityDial.setLevel('turbo')).rejects.toThrow(/Simple, Standard or Power/);
  });

  it('a damaged note raises instead of guessing', () => {
    localStorage.setItem(VexCapabilityDial.KEY, '{nope');
    expect(() => VexCapabilityDial.level()).toThrow(/not readable/);
  });
});

describe('Power brings the suggestions weekly', () => {
  it('the usage suggestions come every 30 days normally and every 7 on Power', async () => {
    const D = VexCapabilityDial;
    expect(D.SUGGEST_EVERY_MS.power).toBe(7 * DAY);
    D.setPref(true);
    expect(D.suggestEveryMs()).toBe(30 * DAY);
    register('a'); age('a', 40); oldCounters();
    await D.setLevel('power');
    expect(D.suggestEveryMs()).toBe(7 * DAY);

    globalThis.VexAttention = { suggest: vi.fn(() => true) };
    const C = VexUsageCounters;
    C.state().lastAt = Date.now() - 10 * DAY;
    expect(C.suggest()).not.toBeNull();            // ten days is enough on Power
    delete globalThis.VexAttention;
  });

  it('on Standard ten days is not enough', async () => {
    VexCapabilityDial.setPref(true);
    register('a'); age('a', 40); oldCounters();
    globalThis.VexAttention = { suggest: vi.fn(() => true) };
    VexUsageCounters.state().lastAt = Date.now() - 10 * DAY;
    expect(VexUsageCounters.suggest()).toBeNull();
    delete globalThis.VexAttention;
  });
});
