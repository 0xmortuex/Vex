// @vitest-environment jsdom
//
// "What is slowing my browser?" is attribution maths: who gets the processor
// seconds of a process that several tabs share, where service workers and
// processes nobody can name go, and — the rule that matters most — that a
// private or Tor tab never appears by title, address or count. Those are the
// things worth pinning.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mod = require('../../src/renderer/js/tab-cost.js');
const {
  TabCost, tabCostNewState, tabCostStep, tabCostSnapshot, tabCostToEvent,
  tabCostIsPrivate, tabCostHost, TAB_COST_WINDOW_MS, TAB_COST_MAX_ENTITIES,
} = mod;

const page = (id, o = {}) => ({ id, kind: 'webview', url: 'https://x.test/', title: 'T', net: { bytes: 0, requests: 0, unsized: 0 }, ...o });
const proc = (pid, o = {}) => ({ pid, type: 'Tab', cum: 0, memKB: 100 * 1024, contents: [], ...o });
const tab = (id, host, o = {}) => ({ id: 't' + id, private: false, title: 'Title of ' + host, host, active: false, audible: false, muted: false, ...o });
const ctxOf = (tabs, panels = []) => ({
  tabs: new Map(tabs.map(([wc, t]) => [wc, t])),
  panels: new Map(panels.map(([wc, p]) => [wc, p])),
});

// Run samples at 5 s steps. `frames` is a list of { procs, workers }, each one
// sample; the first is the baseline.
function run(frames, ctx, step = 5000) {
  const st = tabCostNewState(0);
  frames.forEach((f, i) => tabCostStep(st, f, ctx, i * step));
  return st;
}
const row = (snap, key) => snap.rows.find(r => r.key === key);

describe('who a tab is', () => {
  it('a persistent session is a normal tab; anything else is private', () => {
    expect(tabCostIsPrivate({ partition: 'persist:default' }, false)).toBe(false);
    expect(tabCostIsPrivate({ partition: 'private-abc' }, false)).toBe(true);
    expect(tabCostIsPrivate({ partition: 'tor-1' }, false)).toBe(true);
    expect(tabCostIsPrivate({ partition: 'persist:default' }, true)).toBe(true);   // a private window
    expect(tabCostIsPrivate({}, false)).toBe(false);
  });

  it('reads the site from the address, dropping www; non-web pages have none', () => {
    expect(tabCostHost('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(tabCostHost('file:///C:/x/start.html')).toBe('');
    expect(tabCostHost('nonsense')).toBe('');
  });
});

describe('processor time since the last sample', () => {
  it('the first sample is a baseline: a process that has run for an hour is not charged for it', () => {
    const st = run([{ procs: [proc(1, { cum: 3600, contents: [page(10)] })] }], ctxOf([[10, tab(1, 'a.test')]]));
    const snap = tabCostSnapshot(st, { now: 0 });
    expect(snap.totals.cpuSec).toBe(0);
  });

  it('charges the difference, and a rate over the span', () => {
    const ctx = ctxOf([[10, tab(1, 'a.test')]]);
    const frames = [0, 5, 10].map(s => ({ procs: [proc(1, { cum: 100 + s * 0.5, contents: [page(10)] })] }));   // 50% of a core
    const snap = tabCostSnapshot(run(frames, ctx), { now: 10000 });
    const r = row(snap, 'site:a.test');
    expect(r.cpuSec).toBeCloseTo(5, 5);
    expect(r.cpuPct).toBeCloseTo(50, 3);
    expect(r.cpuShare).toBeCloseTo(1, 5);
  });

  it('a process that appeared after the baseline counts all its time', () => {
    const ctx = ctxOf([[10, tab(1, 'a.test')], [11, tab(2, 'b.test')]]);
    const frames = [
      { procs: [proc(1, { cum: 10, contents: [page(10)] })] },
      { procs: [proc(1, { cum: 10, contents: [page(10)] }), proc(2, { cum: 2, contents: [page(11)] })] },
    ];
    const snap = tabCostSnapshot(run(frames, ctx), { now: 5000 });
    expect(row(snap, 'site:b.test').cpuSec).toBeCloseTo(2, 5);
    expect(row(snap, 'site:a.test').cpuSec).toBe(0);   // idle, still holding its memory
  });

  it('a counter that went backwards (a reused pid) is not a negative cost', () => {
    const ctx = ctxOf([[10, tab(1, 'a.test')]]);
    const frames = [
      { procs: [proc(1, { cum: 50, contents: [page(10)] })] },
      { procs: [proc(1, { cum: 3, contents: [page(10)] })] },
    ];
    const snap = tabCostSnapshot(run(frames, ctx), { now: 5000 });
    expect(row(snap, 'site:a.test').cpuSec).toBeCloseTo(3, 5);
  });

  it('says it cannot measure when Electron gives no CPU seconds, rather than "nothing is wrong"', () => {
    const ctx = ctxOf([[10, tab(1, 'a.test')]]);
    const frames = [0, 1, 2, 3].map(() => ({ procs: [proc(1, { cum: null, contents: [page(10)] })] }));
    const snap = tabCostSnapshot(run(frames, ctx, 5000), { now: 15000 });
    expect(snap.cpuMeasured).toBe(false);
    expect(snap.verdict.headline).toMatch(/cannot read processor time/);
  });
});

describe('a renderer shared by several tabs', () => {
  it('is split equally between them, summing to what the process used, and flagged shared', () => {
    const ctx = ctxOf([[10, tab(1, 'a.test')], [11, tab(2, 'b.test')]]);
    const shared = (cum) => proc(1, { cum, memKB: 400 * 1024, contents: [page(10), page(11)] });
    const snap = tabCostSnapshot(run([{ procs: [shared(0)] }, { procs: [shared(8)] }], ctx), { now: 5000 });
    const a = row(snap, 'site:a.test'), b = row(snap, 'site:b.test');
    expect(a.cpuSec).toBeCloseTo(4, 5);
    expect(b.cpuSec).toBeCloseTo(4, 5);
    expect(a.cpuSec + b.cpuSec).toBeCloseTo(8, 5);
    expect(a.memMB).toBeCloseTo(200, 3);
    expect(a.shared).toBe(true);
  });

  it('two tabs of one site are one row, with both tabs available to act on', () => {
    const ctx = ctxOf([[10, tab(1, 'a.test')], [11, tab(2, 'a.test', { audible: true })]]);
    const f = (cum) => ({ procs: [proc(1, { cum, contents: [page(10)] }), proc(2, { cum, contents: [page(11)] })] });
    const snap = tabCostSnapshot(run([f(0), f(5)], ctx), { now: 5000 });
    const r = row(snap, 'site:a.test');
    expect(r.cpuSec).toBeCloseTo(10, 5);
    expect(r.tabCount).toBe(2);
    expect(r.actions).toEqual(expect.arrayContaining(['sleep', 'mute', 'close', 'always-sleep-site']));
  });

  it('the tab in front cannot be put to sleep from here', () => {
    const ctx = ctxOf([[10, tab(1, 'a.test', { active: true })]]);
    const f = (cum) => ({ procs: [proc(1, { cum, contents: [page(10)] })] });
    const r = row(tabCostSnapshot(run([f(0), f(5)], ctx), { now: 5000 }), 'site:a.test');
    expect(r.actions).not.toContain('sleep');
    expect(r.actions).not.toContain('always-sleep-site');
    expect(r.actions).toContain('close');
  });
});

describe('everything that is not a tab', () => {
  it('panels, extensions, the interface, GPU and services each get their own row', () => {
    const ctx = ctxOf([], [[20, { name: 'discord', label: 'Discord' }]]);
    const frames = (c) => ({
      procs: [
        proc(1, { cum: c, contents: [page(20)] }),
        proc(2, { cum: c, contents: [{ id: 30, kind: 'backgroundPage', extension: 'uBlock Origin' }] }),
        proc(3, { cum: c, contents: [{ id: 31, kind: 'window' }] }),
        proc(4, { type: 'GPU', cum: c }),
        proc(5, { type: 'Utility', name: 'Network Service', cum: c }),
        proc(6, { type: 'Browser', cum: c }),
      ],
    });
    const snap = tabCostSnapshot(run([frames(0), frames(2)], ctx), { now: 5000 });
    expect(row(snap, 'panel:discord').kind).toBe('panel');
    expect(row(snap, 'ext:uBlock Origin').kind).toBe('extension');
    for (const k of ['system:ui', 'system:gpu', 'system:services', 'system:main']) expect(row(snap, k).kind).toBe('system');
    expect(snap.totals.cpuSec).toBeCloseTo(12, 5);
  });

  it('a renderer with no page is "service workers" when some are running, and named by them', () => {
    const f = (c) => ({
      procs: [proc(1, { cum: c, contents: [] })],
      workers: [{ url: 'chrome-extension://abc/sw.js', extension: 'Dark Reader' }, { url: 'https://mail.test/sw.js', extension: null }],
    });
    const snap = tabCostSnapshot(run([f(0), f(3)], ctxOf([])), { now: 5000 });
    const w = row(snap, 'workers');
    expect(w.label).toMatch(/Dark Reader/);
    expect(w.label).toMatch(/mail\.test/);
    expect(w.cpuSec).toBeCloseTo(3, 5);
  });

  it('with no workers either, it is "unidentified" and never guessed at', () => {
    const f = (c) => ({ procs: [proc(1, { cum: c, contents: [] }), proc(2, { cum: c, contents: [page(99)] })] });
    const snap = tabCostSnapshot(run([f(0), f(4)], ctxOf([])), { now: 5000 });
    const u = row(snap, 'unknown');
    expect(u.label).toMatch(/Unidentified|cannot match/);
    expect(u.cpuSec).toBeCloseTo(8, 5);   // the page Vex has no tab for lands there too
  });
});

describe('private and Tor tabs are one anonymous total', () => {
  const secretTab = { id: 'tSECRET', private: true };
  const ctx = ctxOf([[10, secretTab], [11, { id: 'tTOR', private: true }], [12, tab(3, 'open.test')]]);
  const f = (c, b) => ({
    procs: [
      proc(1, { cum: c, contents: [page(10, { url: 'https://secret-bank.example/account', title: 'My Secret Bank', net: { bytes: b, requests: 1, unsized: 0 } })] }),
      proc(2, { cum: c, contents: [page(11, { url: 'http://hiddenservice.onion/', title: 'Hidden', net: { bytes: b, requests: 1, unsized: 0 } })] }),
      proc(3, { cum: c, contents: [page(12)] }),
    ],
  });
  const st = run([f(0, 0), f(5, 1000)], ctx);

  it('is a single row with no title, address, host or tab list', () => {
    const snap = tabCostSnapshot(st, { now: 5000 });
    const p = row(snap, 'private');
    expect(p.cpuSec).toBeCloseTo(10, 5);
    expect(p.netBytes).toBe(2000);
    expect(p.label).toBe('Private and Tor tabs');
    expect(p.host).toBe('');
    expect(p.tabList).toEqual([]);
    expect(p.tabCount).toBe(0);
    expect(p.actions).toEqual([]);
  });

  it('appears nowhere in anything that can be shown, exported or stored', () => {
    const snap = tabCostSnapshot(st, { now: 5000, scope: 'session' });
    const everything = JSON.stringify([snap, tabCostSnapshot(st, { now: 5000 }), tabCostToEvent(snap)]);
    for (const leak of ['secret-bank', 'My Secret Bank', 'hiddenservice', 'onion', 'tSECRET', 'tTOR', 'Hidden']) {
      expect(everything).not.toContain(leak);
    }
    // ...nor in the ledger itself
    const ledger = JSON.stringify([...st.session.values()]) + JSON.stringify(st.recent);
    for (const leak of ['secret-bank', 'My Secret Bank', 'hiddenservice', 'tSECRET', 'tTOR']) expect(ledger).not.toContain(leak);
  });

  it('the live context never lets a private tab through with its details', () => {
    document.body.innerHTML = '';
    globalThis.TabManager = {
      activeTabId: 'a',
      tabs: [
        { id: 'a', url: 'https://open.test/', title: 'Open', partition: 'persist:default' },
        { id: 'p', url: 'https://secret.test/', title: 'Secret', partition: 'private-1' },
      ],
    };
    globalThis.WebviewManager = { webviews: new Map([['a', { getWebContentsId: () => 1 }], ['p', { getWebContentsId: () => 2 }]]) };
    const ctx2 = TabCost._context();
    expect(ctx2.tabs.get(2)).toEqual({ id: 'p', private: true });
    expect(ctx2.tabs.get(1).host).toBe('open.test');
    delete globalThis.TabManager; delete globalThis.WebviewManager;
  });
});

describe('the window and the session', () => {
  it('"recent" forgets what is older than five minutes; "session" keeps it', () => {
    const ctx = ctxOf([[10, tab(1, 'a.test')], [11, tab(2, 'b.test')]]);
    const st = tabCostNewState(0);
    const at = (t, a, b) => tabCostStep(st, { procs: [proc(1, { cum: a, contents: [page(10)] }), proc(2, { cum: b, contents: [page(11)] })] }, ctx, t);
    at(0, 0, 0);
    at(60000, 30, 0);              // a.test burns early
    at(TAB_COST_WINDOW_MS + 120000, 30, 20);   // b.test burns late; a.test quiet since
    const now = TAB_COST_WINDOW_MS + 120000;
    const recent = tabCostSnapshot(st, { now, scope: 'recent' });
    const session = tabCostSnapshot(st, { now, scope: 'session' });
    expect(row(recent, 'site:a.test')?.cpuSec || 0).toBe(0);
    expect(row(recent, 'site:b.test').cpuSec).toBeCloseTo(20, 5);
    expect(row(session, 'site:a.test').cpuSec).toBeCloseTo(30, 5);
  });

  it('the table is bounded: a day of closed sites folds into one row', () => {
    const st = tabCostNewState(0);
    let t = 0;
    const N = TAB_COST_MAX_ENTITIES + 50;
    for (let i = 0; i < N; i++) {
      const ctx = ctxOf([[10, tab(i, 'site' + i + '.test')]]);
      tabCostStep(st, { procs: [proc(1, { cum: i + 1, contents: [page(10)] })] }, ctx, t += 5000);
    }
    expect(st.session.size).toBeLessThanOrEqual(TAB_COST_MAX_ENTITIES + 1);
    expect(st.session.get('closed').cpuSec).toBeGreaterThan(0);
    expect(st.recent.length).toBeLessThanOrEqual(240);
  });
});

describe('downloads', () => {
  it('counts the difference per page, and says when sizes were unknown', () => {
    const ctx = ctxOf([[10, tab(1, 'a.test')]]);
    const f = (c, b, u) => ({ procs: [proc(1, { cum: c, contents: [page(10, { net: { bytes: b, requests: 10, unsized: u } })] })] });
    const snap = tabCostSnapshot(run([f(0, 5000, 0), f(1, 105000, 3)], ctx), { now: 5000 });
    const r = row(snap, 'site:a.test');
    expect(r.netBytes).toBe(100000);
    expect(r.netUnsized).toBe(3);
  });
});

describe('the sentence', () => {
  const busy = (pct, extra = {}) => {
    const ctx = ctxOf([[10, tab(1, 'burn.test')], [11, tab(2, 'calm.test')]]);
    const f = (s) => ({ procs: [
      proc(1, { cum: s * pct / 100, contents: [page(10)] }),
      proc(2, { cum: s * 0.01, contents: [page(11)] }),
    ] });
    const frames = Array.from({ length: 13 }, (_, i) => f(i * 5));   // 60 s of samples
    return tabCostSnapshot(run(frames, ctx), { now: 60000, ...extra });
  };

  it('names a site holding a core as the problem, with its share', () => {
    const v = busy(60).verdict;
    expect(v.level).toBe('heavy');
    expect(v.top).toBe('site:burn.test');
    expect(v.headline).toMatch(/^burn\.test used 98% of the processor time/);
    expect(v.headline).toMatch(/about 60% of one core/);
  });

  it('a quiet browser says so, and still names the busiest', () => {
    const v = busy(2).verdict;
    expect(v.level).toBe('ok');
    expect(v.headline).toMatch(/Nothing is using the processor/);
    expect(v.lines.join(' ')).toMatch(/burn\.test/);
  });

  it('does not judge before it has measured anything', () => {
    const snap = tabCostSnapshot(tabCostNewState(0), { now: 1000 });
    expect(snap.verdict.headline).toBe('Vex is still measuring');
  });

  it('exports a reduced event with the documented shape and at most eight rows', () => {
    const ev = tabCostToEvent(busy(60));
    expect(ev).toMatchObject({ kind: 'perf.tabcost', v: 1, cpuMeasured: true, verdict: 'heavy' });
    expect(ev.top.length).toBeLessThanOrEqual(8);
    expect(ev.top[0]).toMatchObject({ kind: 'site', name: 'burn.test', shared: false });
    expect(Object.keys(ev.top[0]).sort()).toEqual(['cpuPct', 'cpuSec', 'cpuShare', 'kind', 'memMB', 'name', 'netBytes', 'netUnsized', 'shared', 'tabs']);
    expect(JSON.stringify(ev)).not.toContain('Title of');
  });
});

describe('the buttons only call what Vex already has', () => {
  beforeEach(() => {
    globalThis.TabManager = { sleepTab: vi.fn(async () => {}), toggleMuteTab: vi.fn(), closeTabsWithUndo: vi.fn(), activeTabId: 'x' };
    globalThis.VexTasks = { hold: vi.fn(), enforce: vi.fn() };
  });
  const r = { key: 'site:a.test', host: 'a.test', tabList: [{ id: 'a', active: true }, { id: 'b', active: false, audible: true, muted: false }] };

  it('sleep skips the tab in front', async () => {
    await TabCost.act('sleep', r);
    expect(TabManager.sleepTab).toHaveBeenCalledTimes(1);
    expect(TabManager.sleepTab).toHaveBeenCalledWith('b', true);
  });
  it('mute only touches tabs that are playing', async () => {
    await TabCost.act('mute', r);
    expect(TabManager.toggleMuteTab).toHaveBeenCalledWith('b');
  });
  it('close goes through the undo path', async () => {
    await TabCost.act('close', r);
    expect(TabManager.closeTabsWithUndo).toHaveBeenCalled();
  });
  it('always sleep this site is the Running tasks hold, enforced at once', async () => {
    await TabCost.act('always-sleep-site', r);
    expect(VexTasks.hold).toHaveBeenCalledWith('site:a.test', null, 'a.test', 'tab');
    expect(VexTasks.enforce).toHaveBeenCalled();
  });
  it('refuses, loudly, what it cannot do', async () => {
    await expect(TabCost.act('mute', { tabList: [{ id: 'a', active: true }] })).rejects.toThrow(/sound/);
    await expect(TabCost.act('nope', r)).rejects.toThrow(/Unknown action/);
  });
});

describe('sampling is cheap', () => {
  it('does not ask again inside the minimum gap', async () => {
    const processes = vi.fn(async () => ({ processes: [], workers: [] }));
    window.vex = { processes };
    TabCost.state = null;
    await TabCost.sample({ minGapMs: 5000 });
    await TabCost.sample({ minGapMs: 5000 });
    expect(processes).toHaveBeenCalledTimes(1);
  });

  it('is registered as a job that VexJobs holds while a game runs', () => {
    const every = vi.fn();
    globalThis.VexJobs = { every };
    TabCost.start();
    expect(every).toHaveBeenCalledWith('Tab cost', 60000, expect.any(Function), { when: 'ui' });
    delete globalThis.VexJobs;
  });

  it('says so when it cannot sample, instead of recording nothing', async () => {
    window.vex = {};
    TabCost.state = null;
    await expect(TabCost.sample()).rejects.toThrow(/not available/);
  });
});
