// @vitest-environment jsdom
//
// js/vex-cost.js: timers, fetches, DOM nodes and storage attributed to the feature
// that caused them, compared with the budget its manifest declared; a sustained
// overrun trips the feature's breaker; the tuning advisor and Why-is-Vex-slow show it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let clock, origFetch;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  clock = 5_000_000;
  window.VexProblems = globalThis.VexProblems = { note: vi.fn() };
  globalThis.GameMode = { gaming: false };
  globalThis.VexRegistry = fresh(JS + 'feature-registry.js').VexRegistry;
  globalThis.VexUsage = fresh(JS + 'vex-usage.js').VexUsage;
  globalThis.VexLedger = fresh(JS + 'vex-ledger.js').VexLedger;
  globalThis.VexBreaker = fresh(JS + 'vex-breaker.js').VexBreaker;
  origFetch = vi.fn(async () => ({ ok: true }));
  window.fetch = origFetch;
  globalThis.VexCost = fresh(JS + 'vex-cost.js').VexCost;
  VexCost._now = () => clock;
  VexBreaker._now = () => clock;
  VexLedger._now = () => clock;
  VexRegistry.define({ id: 'demo', title: 'Demo', jobs: ['Demo job'], panels: ['demo'], storageKeys: ['vex.demo', 'vex.demo.items.'], budget: { jobMsPerMin: 100, fetchesPerHour: 3, domNodes: 5, storageKB: 0.1 } });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('attribution', () => {
  it('attributes work done inside run() to that feature, and nothing outside it', () => {
    VexCost.run('demo', () => { VexCost.run('inner', () => { expect(VexCost.current()).toBe('inner'); }); expect(VexCost.current()).toBe('demo'); });
    expect(VexCost.current()).toBeNull();
  });

  it('counts fetches made while a feature runs, without changing the fetch', async () => {
    const real = origFetch;
    expect(window.fetch.__vexCounted).toBe(true);        // installed when the module loaded
    expect(window.fetch).not.toBe(real);
    expect(VexCost.install()).toBe(false);               // and only once
    const res = await VexCost.run('demo', () => window.fetch('https://example.com/a', { method: 'POST' }));
    expect(res).toEqual({ ok: true });
    expect(real).toHaveBeenCalledWith('https://example.com/a', { method: 'POST' });
    await window.fetch('https://example.com/b');                      // not in a feature: not counted
    expect(VexCost.report().find(r => r.id === 'demo').fetches).toBe(1);
  });

  it('adds up the time jobs held the interface thread', () => {
    VexCost.job('demo', 12); VexCost.job('demo', 30);
    const row = VexCost.report().find(r => r.id === 'demo');
    expect(row).toMatchObject({ runs: 2, totalMs: 42, maxMs: 30 });
  });

  it('measures DOM nodes in the feature’s panels and the storage it owns', () => {
    document.body.innerHTML = '<div id="panel-demo"><p><b>x</b></p><i></i></div>';
    localStorage.setItem('vex.demo', 'abcdef');
    localStorage.setItem('vex.demo.items.1', 'zz');
    localStorage.setItem('vex.other', 'q'.repeat(500));
    expect(VexCost.domNodes('demo')).toBe(3);
    const bytes = VexCost.storageBytes('demo');
    expect(bytes).toBe(2 * ('vex.demo'.length + 6 + 'vex.demo.items.1'.length + 2));
  });
});

describe('budgets', () => {
  it('lists what is over, with what it used against what it declared', () => {
    document.body.innerHTML = '<div id="panel-demo">' + '<span></span>'.repeat(8) + '</div>';
    for (let i = 0; i < 4; i++) { clock += 60_000 * 0.1; VexCost.run('demo', () => VexCost.fetch('demo')); }
    localStorage.setItem('vex.demo', 'x'.repeat(400));
    const row = VexCost.overruns().find(r => r.id === 'demo');
    const items = row.over.map(o => o.item);
    expect(items).toContain('requests');
    expect(items).toContain('page elements');
    expect(items).toContain('storage');
    expect(row.over.find(o => o.item === 'requests')).toMatchObject({ used: 4, budget: 3 });
  });

  it('reports nothing over for a feature inside its budget', () => {
    VexCost.job('demo', 1);
    expect(VexCost.overruns().find(r => r.id === 'demo')).toBeUndefined();
  });

  it('trips the breaker after three minutes in a row over the processor budget, not before', async () => {
    let on = true;
    VexUsage.register({ id: 'demo', title: 'Demo', isEnabled: () => on, disable: () => { on = false; }, enable: () => { on = true; } });
    for (let minute = 0; minute < 3; minute++) {
      VexCost.job('demo', 150);                 // over 100 ms a minute
      expect(VexBreaker.isTripped('demo'), 'minute ' + minute).toBe(false);
      clock += 60_001;
      VexCost.tick();
    }
    expect(VexBreaker.isTripped('demo')).toBe(true);
    await Promise.resolve();
    expect(VexLedger.list()[0].why).toMatch(/processor budget \(100 ms a minute\) for 3 minutes in a row/);
  });

  it('a quiet minute breaks the streak', () => {
    for (let minute = 0; minute < 2; minute++) { VexCost.job('demo', 150); clock += 60_001; VexCost.tick(); }
    VexCost.job('demo', 5); clock += 60_001; VexCost.tick();
    VexCost.job('demo', 150); clock += 60_001; VexCost.tick();
    expect(VexBreaker.isTripped('demo')).toBe(false);
  });

  it('allows no background request during a game when the budget says none, and trips on the third', () => {
    globalThis.GameMode = { gaming: true };
    VexCost.fetch('demo'); VexCost.fetch('demo');
    expect(VexBreaker.isTripped('demo')).toBe(false);
    expect(VexCost.report().find(r => r.id === 'demo').over.map(o => o.item)).toContain('requests in a game');
    VexCost.fetch('demo');
    expect(VexBreaker.isTripped('demo')).toBe(true);
  });

  it('does not count requests outside a game against the game budget', () => {
    VexCost.fetch('demo'); VexCost.fetch('demo'); VexCost.fetch('demo');
    expect(VexCost.report().find(r => r.id === 'demo').gameFetches).toBe(0);
  });
});

describe('VexJobs feeds the meter', () => {
  it('charges a job’s time and fetches to its feature', async () => {
    const { VexJobs } = fresh(JS + 'jobs.js');
    VexCost.install();
    VexJobs._jobs.clear();
    let r;
    VexJobs.every('Demo job', 1000, () => { window.fetch('https://example.com/x'); });
    VexJobs.tick(Date.now() + 1001);
    r = VexCost.report().find(x => x.id === 'demo');
    expect(r.runs).toBe(1);
    expect(r.fetches).toBe(1);
    clearTimeout(VexJobs._tick);
  });
});

describe('the screens', () => {
  it('Why is Vex slow lists a feature over its declared budget, and one that was switched off', () => {
    const { WhySlow } = fresh(JS + 'why-slow.js');
    const found = WhySlow.reasons({
      rows: [],
      over: [{ id: 'demo', title: 'Demo', over: [{ item: 'requests', used: 9, budget: 3, unit: 'an hour' }] }],
      tripped: [{ id: 'other', reason: 'it failed 5 times in a row' }],
    });
    expect(found.map(f => f.id)).toEqual(['budget:demo', 'tripped:other']);
    expect(found[0].title).toBe('Demo is using more than it declared');
    expect(found[0].detail).toContain('requests 9 against 3 an hour');
  });

  it('the tuning advisor prints the budget section from the report', () => {
    const { VexTuning } = fresh(JS + 'tuning-advisor-ui.js');
    const e = (s) => String(s);
    const html = VexTuning.budgetSection(e,
      [{ id: 'demo', title: 'Demo', totalMs: 400, fetches: 2, ipc: 0, jobMsPerMin: 30, fetchesLastHour: 2, gameFetches: 1, domNodes: 12, storageKB: 1.2, over: [{ item: 'requests in a game', used: 1, budget: 0, unit: '' }] }],
      [{ id: 'sick', state: 'open', reason: 'it failed 5 times in a row' }]);
    expect(html).toContain('What each feature costs, against what it declared');
    expect(html).toContain('Demo is over what it declared');
    expect(html).toContain('requests in a game: 1 against 0');
    expect(html).toContain('sick is switched off for now');
    expect(VexTuning.budgetSection(e, [], [])).toBe('');
  });
});
