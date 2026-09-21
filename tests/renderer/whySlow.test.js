// @vitest-environment jsdom
//
// "Why is Vex slow right now?" reads what Vex already knows — the process
// list, the tab list, the route, the graphics card — and puts it in the order
// that matters. The judgement is the feature, so the judgement is what is
// pinned here: what counts as a reason, what order they come in, and that
// nothing wrong is itself an answer rather than an empty screen.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { WhySlow } = require('../../src/renderer/js/why-slow.js');
globalThis.WhySlow = WhySlow;

const proc = (o) => ({ pid: 1, what: 'A page', memMB: 100, cpu: 0, tabs: [], panels: [], ...o });
const base = (o) => ({ rows: [], totalMB: 0, route: null, gpu: null, game: false, sleep: null, error: null, ...o });

beforeEach(() => {
  document.body.innerHTML = '';
  window.showToast = vi.fn();
});

describe('what counts as a reason', () => {
  it('a process holding a quarter of a core does; a quiet one does not', () => {
    expect(WhySlow.reasons(base({ rows: [proc({ cpu: 4 })] }))).toEqual([]);
    const found = WhySlow.reasons(base({ rows: [proc({ cpu: 60, what: 'YouTube', tabs: [7] })] }));
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe('YouTube is using 60% of a processor core');
    expect(found[0].fix).toBe('go-tab');
    expect(found[0].tab).toBe(7);
  });

  it('the processor is named before the memory, because it is what you feel', () => {
    const found = WhySlow.reasons(base({
      rows: [proc({ pid: 1, memMB: 1500, what: 'Discord', panels: ['discord'] }), proc({ pid: 2, cpu: 40, what: 'A page', tabs: [3] })],
    }));
    expect(found.map(f => f.id)).toEqual(['cpu:2', 'mem:1']);
  });

  it('a heavy panel is offered sleep; a heavy tab is offered the tab', () => {
    const found = WhySlow.reasons(base({
      rows: [proc({ pid: 1, memMB: 1400, what: 'Discord', panels: ['discord'] }), proc({ pid: 2, memMB: 900, what: 'A page', tabs: [3] })],
    }));
    expect(found[0]).toMatchObject({ fix: 'panel-sleep', panel: 'discord' });
    expect(found[0].title).toMatch(/1\.4 GB/);
    expect(found[1]).toMatchObject({ fix: 'go-tab', tab: 3 });
  });

  it('names at most three of each, so the screen stays an answer', () => {
    const rows = Array.from({ length: 9 }, (_, i) => proc({ pid: i, cpu: 30 + i }));
    expect(WhySlow.reasons(base({ rows })).filter(f => f.id.startsWith('cpu:'))).toHaveLength(3);
  });

  // A route you forgot about is slow browsing with no explanation. It is not
  // a fault, and the screen says so.
  it('a route that is on is a reason, and direct is not', () => {
    expect(WhySlow.reasons(base({ route: { mode: 'direct' } }))).toEqual([]);
    const tor = WhySlow.reasons(base({ route: { mode: 'tor' } }));
    expect(tor[0].title).toBe('Everything is going through Tor');
    expect(tor[0].fix).toBe('routing');
    const proxy = WhySlow.reasons(base({ route: { mode: 'proxy', custom: 'socks5://10.0.0.5:1080' } }));
    expect(proxy[0].detail).toMatch(/socks5:\/\/10\.0\.0\.5:1080/);
  });

  it('a full graphics card and a game are reasons with nothing to press', () => {
    const found = WhySlow.reasons(base({ game: true, gpu: { name: 'RTX 4060', totalMB: 8188, usedPercent: 94 } }));
    expect(found.map(f => f.id)).toEqual(['game', 'gpu']);
    expect(found.every(f => f.fix === null)).toBe(true);
    expect(WhySlow.reasons(base({ gpu: { name: 'RTX 4060', totalMB: 8188, usedPercent: 40 } }))).toEqual([]);
  });

  it('sleeping turned off outranks a long keep-awake list, and they never both appear', () => {
    const off = WhySlow.reasons(base({ sleep: { enabled: false, exempt: ['A', 'B', 'C', 'D'] } }));
    expect(off.map(f => f.id)).toEqual(['nosleep']);
    const kept = WhySlow.reasons(base({ sleep: { enabled: true, exempt: ['Discord', 'WhatsApp', 'Slack'] } }));
    expect(kept[0].id).toBe('kept');
    expect(kept[0].detail).toMatch(/Discord, WhatsApp, Slack/);
    expect(WhySlow.reasons(base({ sleep: { enabled: true, exempt: ['Discord'] } }))).toEqual([]);
  });

  it('the total only counts once it is worth mentioning', () => {
    expect(WhySlow.reasons(base({ totalMB: 2000 })).map(f => f.id)).toEqual([]);
    expect(WhySlow.reasons(base({ totalMB: 4200 }))[0].title).toMatch(/4\.1 GB altogether/);
  });
});

describe('the screen', () => {
  const stub = (over = {}) => {
    window.vex = {
      processes: vi.fn(async () => over.procs || []),
      routingGetAll: vi.fn(async () => over.route || { mode: 'direct' }),
      gpu: vi.fn(async () => over.gpu || null),
    };
    globalThis.VexTasks = {
      rows: async () => (over.procs || []).map(p => proc({ pid: p.pid, what: p.name, memMB: Math.round(p.memKB / 1024), cpu: p.cpu, tabs: p.tabs || [], panels: p.panels || [] })),
      open: vi.fn(),
    };
  };

  it('says so plainly when nothing is wrong, with the figures it checked', async () => {
    stub({ procs: [{ pid: 1, name: 'Vex', memKB: 200 * 1024, cpu: 1 }] });
    await WhySlow.open();
    const text = document.getElementById('ws-body').textContent;
    expect(text).toMatch(/Nothing here is slowing Vex down/);
    expect(text).toMatch(/200 MB/);
  });

  it('lists what it found, with a button that does something', async () => {
    stub({ procs: [{ pid: 4, name: 'Discord', memKB: 1500 * 1024, cpu: 2, panels: ['discord'] }] });
    globalThis.SidebarManager = { sleepPanel: vi.fn(), panelLabel: () => 'Discord', panelSleepPrefs: () => ({ enabled: true, minutes: 30, exempt: [] }) };
    await WhySlow.open();
    expect(document.getElementById('ws-body').textContent).toMatch(/Discord is holding 1\.5 GB/);
    const sleep = [...document.querySelectorAll('#ws-body button')].find(b => b.textContent === 'Let it sleep now');
    sleep.click();
    expect(SidebarManager.sleepPanel).toHaveBeenCalledWith('discord');
    expect(document.getElementById('vex-whyslow')).toBe(null);
    delete globalThis.SidebarManager;
  });

  // A process list that cannot be read must not become "nothing is wrong".
  it('admits it when the process list could not be read', async () => {
    stub();
    globalThis.VexTasks.rows = async () => { throw new Error('not available'); };
    await WhySlow.open();
    const text = document.getElementById('ws-body').textContent;
    expect(text).toMatch(/Vex could not measure itself/);
    expect(text).toMatch(/could not be read: not available/);
    expect(text).not.toMatch(/Nothing here is slowing Vex down/);
  });
});

// A diagnosis screen only helps the people who think to open it — and if you
// knew to look, you half knew the answer. So Vex watches and says it once.
// The rules that stop it becoming a nag are the whole design, so they are
// what is pinned here.
describe('saying it without being asked', () => {
  const found = (over = {}) => ({ id: 'cpu:9', title: 'YouTube is using 80% of a processor core', detail: '', fix: 'go-tab', tab: 7, ...over });

  beforeEach(() => {
    WhySlow._said = {};
    WhySlow._strikes = {};
    WhySlow._quietUntil = 0;
    globalThis.TabManager = { activeTabId: 'other', switchTab: vi.fn() };
  });

  it('waits for a second sighting: a page that is busy while it loads is not a fault', () => {
    expect(WhySlow.worthSaying([found()])).toBe(null);
    WhySlow._strikes['cpu:9'] = 2;
    expect(WhySlow.worthSaying([found()])).toBeTruthy();
  });

  it('says one thing once an hour, and nothing at all for four after "not now"', () => {
    WhySlow._strikes['cpu:9'] = 2;
    const now = Date.now();
    WhySlow._said['cpu:9'] = now - 60000;
    expect(WhySlow.worthSaying([found()], now)).toBe(null);
    expect(WhySlow.worthSaying([found()], now + 3700000)).toBeTruthy();
    WhySlow._quietUntil = now + WhySlow.QUIET_MS;
    expect(WhySlow.worthSaying([found()], now + 3700000)).toBe(null);
  });

  // A route being on, a game running, panels kept awake: all things the user
  // chose. A browser that comments on your choices is one people switch off.
  it('only speaks about the processor and a really heavy panel', () => {
    WhySlow._strikes['cpu:9'] = 2;
    expect(WhySlow.worthSaying([{ id: 'route', title: 'Everything is going through Tor' }])).toBe(null);
    expect(WhySlow.worthSaying([{ id: 'game', title: 'A game has the screen' }])).toBe(null);
    expect(WhySlow.worthSaying([{ id: 'kept', title: '3 panels are kept awake' }])).toBe(null);
    expect(WhySlow.worthSaying([{ id: 'mem:2', title: 'A page is holding 900 MB' }])).toBe(null);
    expect(WhySlow.worthSaying([{ id: 'mem:2', title: 'Discord is holding 1.9 GB' }])).toBeTruthy();
  });

  it('never about the tab you are looking at', async () => {
    TabManager.activeTabId = 7;
    expect(WhySlow._isActive(found())).toBe(true);
  });

  it('the notice carries the fix, the whole picture, and a way to stop it', () => {
    const bar = WhySlow._notice(found());
    const labels = [...bar.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).toEqual(['Go to that tab', 'Why', 'Not now']);
    bar.querySelector('button').click();
    expect(TabManager.switchTab).toHaveBeenCalledWith(7);
    labels.length = 0;
    const again = WhySlow._notice(found());
    [...again.querySelectorAll('button')].find(b => b.textContent === 'Not now').click();
    expect(WhySlow._quietUntil).toBeGreaterThan(Date.now());
    expect(document.getElementById('vex-slow-notice')).toBe(null);
  });
});
