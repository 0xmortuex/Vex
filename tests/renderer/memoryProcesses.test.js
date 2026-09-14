// @vitest-environment jsdom
//
// Memory panel › Processes: every OS process Vex runs, named. The list main
// returns (app.getAppMetrics joined with webContents by pid) is bare —
// "Tab", "Utility" — and the panel says what each one really is: the Discord
// panel, a tab, uBlock Origin's background page in some partition, the GPU.

import { describe, it, expect, beforeEach } from 'vitest';

window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const { MemoryPanel } = require('../../src/renderer/js/memory-panel.js');

const ctx = { tabs: new Map([[11, 'Hacker News']]), panels: new Map([[7, 'Discord']]) };
const proc = (over) => ({ pid: 1, type: 'Tab', name: '', sandboxed: true, cpu: 0, memKB: 0, privKB: 0, contents: [], ...over });

describe('naming a process', () => {
  it('the fixed ones', () => {
    expect(MemoryPanel.describeProcess(proc({ type: 'Browser' }), ctx).what).toBe('Vex — main process');
    expect(MemoryPanel.describeProcess(proc({ type: 'GPU' }), ctx).kind).toBe('gpu');
    expect(MemoryPanel.describeProcess(proc({ type: 'Utility', name: 'Network Service' }), ctx).what).toBe('Utility — Network Service');
  });

  it('a panel, a tab, and a shared same-site renderer', () => {
    const panel = MemoryPanel.describeProcess(proc({ contents: [{ id: 7, kind: 'webview', url: 'https://discord.com/app' }] }), ctx);
    expect(panel).toMatchObject({ kind: 'panel', what: 'Panel: Discord', detail: 'https://discord.com/app' });
    const tab = MemoryPanel.describeProcess(proc({ contents: [{ id: 11, kind: 'webview', url: 'https://news.ycombinator.com/' }] }), ctx);
    expect(tab).toMatchObject({ kind: 'tab', what: 'Tab: Hacker News' });
    const shared = MemoryPanel.describeProcess(proc({ contents: [
      { id: 11, kind: 'webview', url: 'https://news.ycombinator.com/' },
      { id: 12, kind: 'webview', url: 'https://news.ycombinator.com/item?id=1', title: 'A thread' },
    ] }), ctx);
    expect(shared.what).toBe('Tab: Hacker News + 1 more (same site, shared)');
  });

  it('an extension background page, with its partition', () => {
    const d = MemoryPanel.describeProcess(proc({ sandboxed: false, contents: [{ id: 3, kind: 'backgroundPage', url: 'chrome-extension://abc/background.html', extension: 'uBlock Origin', partition: 'persist:spotify' }] }), ctx);
    expect(d).toEqual({ kind: 'extension', what: 'uBlock Origin — background', detail: 'persist:spotify' });
  });

  it('the interface, and a renderer with nothing in it', () => {
    expect(MemoryPanel.describeProcess(proc({ contents: [{ id: 1, kind: 'window', url: 'file:///index.html' }] }), ctx).kind).toBe('ui');
    expect(MemoryPanel.describeProcess(proc({}), ctx)).toMatchObject({ kind: 'other', what: 'Renderer with no page' });
  });

  // An MV3 extension's background is a service worker in a renderer of its
  // own, one per session; Electron reports it by child id, not pid, so the
  // row can only say what such a renderer most likely is.
  it('names a page-less renderer after the running service workers', () => {
    const workers = [
      { url: 'chrome-extension://abc/background.js', partition: 'default', extension: 'RoSuite' },
      { url: 'chrome-extension://abc/background.js', partition: 'persist:main', extension: 'RoSuite' },
      { url: 'https://discord.com/sw.js', partition: 'persist:discord', extension: null },
    ];
    const d = MemoryPanel.describeProcess(proc({}), { ...ctx, workers });
    expect(d.what).toMatch(/service worker/);
    expect(d.detail).toBe('3 running: RoSuite ×2, discord.com; or a spare renderer');
  });

  it('reads both the old array and the new { processes, workers } shape', async () => {
    document.body.innerHTML = '<div id="memory-procs"></div><div id="memory-summary"></div>';
    window.vex = { processes: async () => ({ processes: [proc({ pid: 9, type: 'GPU', memKB: 100 * 1024 })], workers: [] }) };
    await MemoryPanel.renderProcesses(ctx);
    expect(document.querySelector('.memory-proc-what').textContent).toBe('GPU process');
    expect(document.getElementById('memory-summary').textContent).toContain('1 processes');
    window.vex = { processes: async () => [proc({ pid: 9, type: 'Browser' })] };
    await MemoryPanel.renderProcesses(ctx);
    expect(document.querySelector('.memory-proc-what').textContent).toBe('Vex — main process');
  });
});

describe('the summary and the report', () => {
  const rows = [
    { ...proc({ pid: 5, type: 'Tab', memKB: 1013 * 1024, privKB: 1462 * 1024, cpu: 35.2 }), kind: 'panel', what: 'Panel: Discord', detail: 'https://discord.com/app' },
    { ...proc({ pid: 6, type: 'Tab', memKB: 35 * 1024, privKB: 38 * 1024, sandboxed: false }), kind: 'extension', what: 'uBlock Origin — background', detail: 'persist:spotify' },
    { ...proc({ pid: 7, type: 'Tab', memKB: 36 * 1024, privKB: 40 * 1024, sandboxed: false }), kind: 'extension', what: 'uBlock Origin — background', detail: 'persist:claude' },
    { ...proc({ pid: 8, type: 'GPU', memKB: 150 * 1024, privKB: 452 * 1024 }), kind: 'gpu', what: 'GPU process', detail: '' },
  ];

  it('totals resident and committed, and counts each kind', () => {
    const chips = MemoryPanel.summarize(rows);
    expect(chips[0]).toBe('4 processes');
    expect(chips[1]).toBe('resident 1.21 GB');
    expect(chips[2]).toBe('private 1.95 GB');   // 1462 + 38 + 40 + 452 MB
    expect(chips).toContain('1 panels · 1013 MB');
    expect(chips).toContain('2 extension hosts · 71 MB');
    expect(chips).toContain('1 GPU · 150 MB');
  });

  it('writes a report that can be pasted anywhere', () => {
    const text = MemoryPanel.report(rows);
    expect(text).toMatch(/^Vex processes — /);
    expect(text).toMatch(/pid\s+resident\s+private\s+cpu\s+what/);
    expect(text).toContain('    5   1013 MB    1462 MB   35%  Panel: Discord — https://discord.com/app');
    expect(text).toContain('uBlock Origin — background — persist:claude');
  });
});

describe('a panel row', () => {
  it('says asleep, starting, or its measurement', () => {
    expect(MemoryPanel.describePanel({ loaded: false }, null)).toEqual({ mb: 0, text: '0 MB · asleep' });
    expect(MemoryPanel.describePanel({ loaded: true }, null)).toEqual({ mb: null, text: 'starting…' });
    expect(MemoryPanel.describePanel({ loaded: true, open: true }, { memKB: 300 * 1024 })).toEqual({ mb: 300, text: '300 MB · open' });
  });
});

describe('the trend since launch', () => {
  beforeEach(() => { MemoryPanel._history = []; document.body.innerHTML = '<div id="memory-trend"></div>'; });

  it('samples the total, keeps notes, and draws a line with a dot per note', async () => {
    let kb = 1000 * 1024;
    window.vex = { appMetrics: vi.fn(async () => [{ memKB: kb }, { memKB: 0 }]) };
    expect(await MemoryPanel.sample()).toBe(1000);
    kb = 1300 * 1024;
    await MemoryPanel.sample();
    MemoryPanel.note('Slept panel: Claude AI');
    kb = 900 * 1024;
    MemoryPanel._history[MemoryPanel._history.length - 1].t += 1;   // notes never share an instant with the next sample
    await MemoryPanel.sample();
    MemoryPanel.renderTrend();
    const host = document.getElementById('memory-trend');
    expect(host.querySelector('polyline')).not.toBe(null);
    expect(host.querySelectorAll('circle').length).toBe(1);
    expect(host.querySelector('circle title').textContent).toBe('Slept panel: Claude AI');
    expect(host.querySelector('.memory-trend-label').textContent).toMatch(/900 MB now · −100 MB over \d+ min · low 900 MB, high 1.27 GB/);
  });

  it('keeps six hours and says so before there is a line', async () => {
    window.vex = { appMetrics: vi.fn(async () => [{ memKB: 1024 }]) };
    for (let i = 0; i < MemoryPanel.TREND_KEEP + 5; i++) await MemoryPanel.sample();
    expect(MemoryPanel._history.length).toBe(MemoryPanel.TREND_KEEP);
    MemoryPanel._history = [];
    MemoryPanel.renderTrend();
    expect(document.getElementById('memory-trend').textContent).toMatch(/after a minute/);
  });

  it('takes notes from anywhere through the document event', () => {
    MemoryPanel.startTrend();
    document.dispatchEvent(new CustomEvent('vex:memory-event', { detail: { note: 'High memory — slept 2 idle tabs' } }));
    expect(MemoryPanel._history.some(h => h.note === 'High memory — slept 2 idle tabs')).toBe(true);
    clearInterval(MemoryPanel._trendTimer); MemoryPanel._trendTimer = null;
  });
});

describe('Free memory now', () => {
  it('does everything at once and says what it did', async () => {
    document.body.innerHTML = '<div id="memory-list"></div><div id="memory-panels"></div><div id="memory-trend"></div><div id="memory-procs"></div><div id="memory-summary"></div>';
    const now = Date.now();
    globalThis.TabManager = {
      activeTabId: 'a',
      tabs: [{ id: 'a', pinned: true, lastViewedAt: now }, { id: 'p', pinned: true, lastViewedAt: now - 40 * 60000 }, { id: 'q', pinned: true, lastViewedAt: now - 5 * 60000 }],
      sleepAllInactive: vi.fn(async () => {}),
      sleepTab: vi.fn(async () => {}),
      isCapturing: () => false,
    };
    globalThis.WebviewManager = { webviews: new Map() };
    globalThis.SidebarManager = { sleepHiddenPanels: vi.fn(() => ['claude']), panelLabel: (n) => 'Claude AI', panelConfigs: {}, isWebPanel: () => false, panelCapture: {}, panelSleepPrefs: () => ({ exempt: [] }) };
    window.vex = { tabMemory: vi.fn(async () => ({ totalKB: 0, byId: {} })), processes: vi.fn(async () => ({ processes: [], workers: [] })), extensionsReleaseIdle: vi.fn(async () => ({ ok: true, released: ['persist:container-work'] })), appMetrics: vi.fn(async () => []) };
    window.showToast = vi.fn();
    MemoryPanel._history = [];
    const done = await MemoryPanel.freeNow();
    expect(TabManager.sleepAllInactive).toHaveBeenCalled();
    expect(TabManager.sleepTab).toHaveBeenCalledWith('p', true);
    expect(TabManager.sleepTab).toHaveBeenCalledTimes(1);
    expect(done).toEqual(['idle tabs slept', '1 pinned tab idle over 30 min', 'panels slept: Claude AI', 'extensions unloaded from persist:container-work']);
    expect(MemoryPanel._history.some(h => /Free memory now/.test(h.note))).toBe(true);
  });
});

describe('who holds the capture services', () => {
  it('is named on the Video Capture and Audio rows', () => {
    const c = { ...ctx, captures: ['Tab: Claude (mic)'] };
    expect(MemoryPanel.describeProcess(proc({ type: 'Utility', name: 'Video Capture' }), c).detail).toMatch(/in use by Tab: Claude \(mic\)$/);
    expect(MemoryPanel.describeProcess(proc({ type: 'Utility', name: 'Network Service' }), c).detail).not.toMatch(/in use by/);
  });
});

describe('without the bridge', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="memory-procs"></div><div id="memory-summary"></div>'; window.vex = {}; });
  it('says the list is unavailable instead of pretending', async () => {
    await MemoryPanel.renderProcesses(ctx);
    expect(document.getElementById('memory-procs').textContent).toMatch(/not available/);
  });
});
