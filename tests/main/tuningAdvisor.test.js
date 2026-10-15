// @vitest-environment node
// The tuning advisor's rule engine, run on fixture metrics, plus the stored
// samples behind "what slowed Vex down since yesterday".
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { advise, compareSamples, createSampleStore, toSample, ACTION_KINDS } = require('../../src/main/tuning-advisor.js');

const site = (host, memMB, cpuPct, tabs, extra = {}) => ({
  key: 'site:' + host, kind: 'site', label: host, host, memMB, cpuPct, shared: false,
  tabList: tabs.map((t, i) => ({ id: 'tab-' + host + i, active: false, audible: false, muted: false, ...t })), ...extra,
});
const base = (over = {}) => ({
  rows: [], jobs: [], totals: { memMB: 1500, cpuPct: 5 }, onBattery: false, batteryModeOn: false,
  reduceMotionOn: false, recallOn: true, machineMemMB: 16000, startup: { ms: 3000 }, gaming: false, ...over,
});

describe('advise', () => {
  it('recommends sleeping a heavy site and only offers tabs that can sleep', () => {
    const m = base({ rows: [site('video.example', 640, 1, [{}, { active: true }, { audible: true }])] });
    const { recommendations } = advise(m);
    const r = recommendations.find(x => x.rule === 'sleep-tab');
    expect(r.title).toBe('Sleep video.example (640 MB)');
    expect(r.action.kind).toBe('sleep-tab');
    expect(r.action.tabIds).toEqual(['tab-video.example0']);
    expect(r.savesMB).toBe(640);
  });

  it('recommends a hot background tab, and nothing for a quiet light one', () => {
    const hot = advise(base({ rows: [site('hot.example', 120, 18, [{}])] })).recommendations;
    expect(hot[0].detail).toMatch(/18\.0% of a core/);
    const quiet = advise(base({ rows: [site('calm.example', 80, 0.5, [{}])] })).recommendations;
    expect(quiet).toEqual([]);
  });

  it('offers battery mode and reduced motion only on battery and only when they are off', () => {
    const onBat = advise(base({ onBattery: true })).recommendations.map(r => r.action && r.action.kind);
    expect(onBat).toEqual(expect.arrayContaining(['battery-mode-on', 'reduce-motion-on']));
    expect(advise(base({ onBattery: false })).recommendations.length).toBe(0);
    const done = advise(base({ onBattery: true, batteryModeOn: true, reduceMotionOn: true })).recommendations;
    expect(done.length).toBe(0);
    // gaming: nothing is suggested on battery
    expect(advise(base({ onBattery: true, gaming: true })).recommendations.length).toBe(0);
  });

  it('names a feature that cost real interface time and offers its off switch', () => {
    const m = base({ jobs: [{ name: 'Recall by meaning', runs: 40, totalMs: 5400, maxMs: 300, spanMs: 180000 }] });
    const r = advise(m).recommendations.find(x => x.rule === 'feature-cost');
    expect(r.title).toBe('Turn off Recall (page memory) (cost 3.0% CPU)');
    expect(r.action.kind).toBe('recall-off');
    // already off: nothing to turn off
    expect(advise({ ...m, recallOn: false }).recommendations.find(x => x.rule === 'feature-cost')).toBeUndefined();
  });

  it('reports an unmapped job as information without an action', () => {
    const m = base({ jobs: [{ name: 'Mystery job', runs: 10, totalMs: 9000, maxMs: 900, spanMs: 60000 }] });
    const r = advise(m).recommendations[0];
    expect(r.action).toBeNull();
    expect(r.severity).toBe('high');
  });

  it('names a costly extension but never acts on it', () => {
    const m = base({ rows: [{ key: 'ext:x', kind: 'extension', label: 'Big Ext', host: '', memMB: 400, cpuPct: 1, shared: false, tabList: [] }] });
    const r = advise(m).recommendations.find(x => x.rule === 'extension-cost');
    expect(r.action).toBeNull();
  });

  it('never gives a private row a name, a tab or an action', () => {
    const m = base({ rows: [{ key: 'private', kind: 'private', label: 'Private and Tor tabs', host: '', memMB: 900, cpuPct: 30, shared: false, tabList: [] }] });
    const out = advise(m);
    expect(out.recommendations.every(r => !r.action || r.action.kind !== 'sleep-tab')).toBe(true);
    expect(out.table.rows[0].name).toBe('Private and Tor tabs');
  });

  it('every action the engine can emit is in the closed list', () => {
    const m = base({
      onBattery: true,
      rows: [site('a.example', 900, 20, [{}])],
      jobs: [{ name: 'Recall by meaning', runs: 1, totalMs: 9000, maxMs: 9000, spanMs: 60000 }],
    });
    for (const r of advise(m).recommendations) if (r.action) expect(ACTION_KINDS).toContain(r.action.kind);
  });

  it('is deterministic and sorts the biggest saving first', () => {
    const m = base({ rows: [site('a.example', 400, 1, [{}]), site('b.example', 900, 1, [{}])] });
    const a = advise(m), b = advise(m);
    expect(a).toEqual(b);
    expect(a.recommendations[0].title).toMatch(/b\.example/);
  });

  it('warns about slow startup and memory pressure as information', () => {
    const r = advise(base({ startup: { ms: 12000 }, totals: { memMB: 7000, cpuPct: 5 } })).recommendations;
    expect(r.map(x => x.rule)).toEqual(expect.arrayContaining(['startup', 'pressure']));
    expect(r.every(x => x.action === null)).toBe(true);
  });
});

describe('samples and the comparison since yesterday', () => {
  const HOUR = 3600 * 1000;
  const NOW = 1_800_000_000_000;
  const sample = (ts, mem, entries, jobs = []) => ({ ts, mem, cpu: 5, startup: 4000, top: entries.map(([k, m, c]) => ({ k, mem: m, cpu: c })), jobs });

  it('says there is no baseline until a day of samples exists', () => {
    const c = compareSamples([sample(NOW - HOUR, 1000, [])], NOW);
    expect(c.haveBaseline).toBe(false);
  });

  it('finds what grew, flags new entries, and says so when nothing changed', () => {
    const base = [sample(NOW - 24 * HOUR, 1500, [['site:news.example', 200, 1], ['site:old.example', 100, 0]])];
    const recent = [sample(NOW - HOUR, 2600, [['site:news.example', 900, 1], ['site:old.example', 100, 0], ['extension:Shiny', 300, 4]], [{ n: 'Recall by meaning', pct: 3 }])];
    const c = compareSamples([...base, ...recent], NOW);
    expect(c.haveBaseline).toBe(true);
    const names = c.items.map(i => i.name);
    expect(names[0]).toBe('news.example');
    expect(c.items.find(i => i.name === 'news.example').dMem).toBe(700);
    expect(c.items.find(i => i.name === 'Shiny').isNew).toBe(true);
    expect(c.items.find(i => i.kind === 'job').dCpu).toBe(3);
    expect(names).not.toContain('old.example');
    const same = compareSamples([base[0], sample(NOW - HOUR, 1550, [['site:news.example', 210, 1], ['site:old.example', 100, 0]])], NOW);
    expect(same.summary).toBe('Nothing has slowed Vex down since yesterday.');
  });

  it('a sample holds names and numbers only: no private row, no address, no title', () => {
    const s = toSample({
      totals: { memMB: 1000, cpuPct: 3 },
      rows: [
        { kind: 'site', host: 'a.example', label: 'A page title', memMB: 300, cpuPct: 2, tabList: [{ id: 'tab-1', title: 'Secret title' }] },
        { kind: 'private', host: '', label: 'Private and Tor tabs', memMB: 500, cpuPct: 9 },
      ],
    }, NOW);
    expect(JSON.stringify(s)).not.toMatch(/Secret title|Private and Tor|tab-1/);
    expect(s.top.map(t => t.k)).toEqual(['site:a.example']);
  });

  it('the store is bounded by count and age, spaced, and forgettable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-tune-'));
    const clock = { now: NOW };
    const store = createSampleStore({ dir, now: () => clock.now, maxSamples: 5, keepDays: 2, minGapMs: 10 * 60 * 1000 });
    const metrics = { totals: { memMB: 1, cpuPct: 1 }, rows: [], jobs: [] };
    expect((await store.add(metrics)).stored).toBe(true);
    clock.now += 60 * 1000;
    expect((await store.add(metrics)).stored).toBe(false);       // too soon
    for (let i = 0; i < 8; i++) { clock.now += 15 * 60 * 1000; await store.add(metrics); }
    expect((await store.all()).length).toBe(5);                   // count cap
    clock.now += 3 * 24 * HOUR;
    await store.add(metrics);
    expect((await store.all()).length).toBe(1);                   // age cap
    await store.forget();
    expect(fs.existsSync(path.join(dir, 'tuning-samples.json'))).toBe(false);
    expect(await store.all()).toEqual([]);
  });
});
