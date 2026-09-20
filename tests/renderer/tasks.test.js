// @vitest-environment jsdom
//
// Running tasks: what is using the memory, and ending it. The parts worth
// pinning down are the ones that touch real state — which process is which
// tab or panel, what "end" does to each kind, and that a hold never does
// anything worse than putting something back to sleep.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { VexTasks } = require('../../src/renderer/js/tasks.js');
const { MemoryPanel } = require('../../src/renderer/js/memory-panel.js');

// One process per kind, shaped like main's app:processes rows.
const PROCS = [
  { pid: 11, type: 'Tab', memKB: 1024 * 900, cpu: 3, contents: [{ id: 501, kind: 'webview', url: 'https://discord.com/channels/@me', title: 'Discord' }] },
  { pid: 12, type: 'Tab', memKB: 1024 * 300, cpu: 1, contents: [{ id: 601, kind: 'webview', url: 'https://www.youtube.com/watch?v=x', title: 'A video' }] },
  { pid: 13, type: 'Browser', memKB: 1024 * 120, cpu: 0, contents: [] },
  { pid: 14, type: 'Tab', memKB: 1024 * 80, cpu: 0, contents: [{ id: 701, kind: 'backgroundPage', url: 'chrome-extension://abc/bg.html', extension: 'uBlock Origin', partition: 'persist:main' }] },
];

let slept, panelSlept, extEnabled;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  VexTasks.close();
  slept = []; panelSlept = []; extEnabled = [];
  globalThis.MemoryPanel = MemoryPanel;
  globalThis.VexTasks = VexTasks;
  globalThis.TabManager = {
    activeTabId: 'tab-other',
    tabs: [{ id: 'tab-discord', title: 'Discord', url: 'https://discord.com/channels/@me' },
      { id: 'tab-yt', title: 'A video', url: 'https://www.youtube.com/watch?v=x' }],
    sleepTab: (id) => { slept.push(id); return Promise.resolve(); },
  };
  globalThis.WebviewManager = {
    webviews: new Map([
      ['tab-discord', { getWebContentsId: () => 501 }],
      ['tab-yt', { getWebContentsId: () => 601 }],
    ]),
  };
  globalThis.SidebarManager = {
    activePanel: null, sidePanel: null, panelWebviews: {},
    panelLabel: (n) => n[0].toUpperCase() + n.slice(1),
    sleepPanel: (n) => panelSlept.push(n),
    hideActivePanel: () => { globalThis.SidebarManager.activePanel = null; },
  };
  window.vex = {
    processes: () => Promise.resolve({ processes: PROCS, workers: [] }),
    extensionsList: () => Promise.resolve([{ folder: 'ublock', name: 'uBlock Origin', enabled: true }]),
    extensionsSetEnabled: (folder, on) => { extEnabled.push([folder, on]); return Promise.resolve({ ok: true }); },
  };
  window.showToast = () => {};
  Element.prototype.scrollIntoView = () => {};   // jsdom has no layout
});

describe('what is running', () => {
  it('names each process by what it really is, biggest first', async () => {
    const rows = await VexTasks.rows();
    expect(rows.map(r => r.memMB)).toEqual([900, 300, 120, 80]);
    expect(rows[0].what).toBe('Tab: Discord');
    expect(rows[0].tabs).toEqual(['tab-discord']);
    expect(rows[0].key).toBe('site:discord.com');
    expect(rows[2].kind).toBe('main');
    expect(rows[3].kind).toBe('extension');
    expect(rows[3].folder).toBe('ublock');
  });

  it('will not end Vex itself, and says why', async () => {
    const rows = await VexTasks.rows();
    const main = rows.find(r => r.kind === 'main');
    expect(main.endable).toBe(false);
    expect(main.why).toMatch(/ending it is quitting/);
    await expect(VexTasks.end(main)).rejects.toThrow(/quitting/);
  });

  it('will not end the page you are looking at', async () => {
    globalThis.TabManager.activeTabId = 'tab-discord';
    const rows = await VexTasks.rows();
    const row = rows.find(r => r.tabs.includes('tab-discord'));
    expect(row.endable).toBe(false);
    expect(row.why).toMatch(/looking at/);
  });

  it('a panel is named as a panel and ended as one', async () => {
    globalThis.SidebarManager.panelWebviews = { discord: { getWebContentsId: () => 501 } };
    globalThis.WebviewManager.webviews = new Map([['tab-yt', { getWebContentsId: () => 601 }]]);
    globalThis.TabManager.tabs = [{ id: 'tab-yt', title: 'A video', url: 'https://www.youtube.com/watch?v=x' }];
    const rows = await VexTasks.rows();
    const panel = rows.find(r => r.kind === 'panel');
    expect(panel.what).toBe('Panel: Discord');
    expect(panel.key).toBe('panel:discord');
    expect(await VexTasks.end(panel)).toBe('Discord closed');
    expect(panelSlept).toEqual(['discord']);
  });
});

describe('ending', () => {
  it('a tab is put to sleep, not closed — nothing is lost', async () => {
    const rows = await VexTasks.rows();
    const row = rows.find(r => r.tabs.includes('tab-discord'));
    expect(await VexTasks.end(row)).toBe('Tab put to sleep');
    expect(slept).toEqual(['tab-discord']);
    expect(VexTasks.holds()).toEqual({});        // "end now" leaves no hold
  });

  it('“and keep it off” records how long, in words', async () => {
    const rows = await VexTasks.rows();
    const row = rows.find(r => r.tabs.includes('tab-yt'));
    const said = await VexTasks.end(row, 60 * 60 * 1000);
    expect(said).toMatch(/held until \d/);
    const hold = VexTasks.holds()['site:youtube.com'];
    expect(hold.until).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
  });

  it('an extension is switched off, and always leaves something to undo', async () => {
    const rows = await VexTasks.rows();
    const ext = rows.find(r => r.kind === 'extension');
    const said = await VexTasks.end(ext);
    expect(extEnabled).toEqual([['ublock', false]]);
    expect(said).toMatch(/let it back/);
    expect(VexTasks.holds()['ext:ublock'].until).toBeNull();
  });

  it('letting an extension back switches it on again', async () => {
    const rows = await VexTasks.rows();
    await VexTasks.end(rows.find(r => r.kind === 'extension'));
    extEnabled.length = 0;
    VexTasks.release('ext:ublock');
    expect(extEnabled).toEqual([['ublock', true]]);
    expect(VexTasks.holds()).toEqual({});
  });

  it('a hold that has run out is dropped, and the extension comes back on', () => {
    VexTasks.hold('ext:ublock', 1000, 'uBlock Origin', 'extension');
    vi.setSystemTime(new Date(Date.now() + 2000));
    expect(VexTasks.holds()).toEqual({});
    expect(extEnabled).toEqual([['ublock', true]]);
    vi.useRealTimers();
  });
});

describe('keeping a hold', () => {
  it('puts a held site back to sleep, and never closes it', () => {
    VexTasks.hold('site:youtube.com', 60000, 'Tab: A video', 'tab');
    expect(VexTasks.enforce()).toEqual(['youtube.com']);
    expect(slept).toEqual(['tab-yt']);
  });

  it('leaves the tab you are actually on alone', () => {
    globalThis.TabManager.activeTabId = 'tab-yt';
    VexTasks.hold('site:youtube.com', 60000, 'Tab: A video', 'tab');
    expect(VexTasks.enforce()).toEqual([]);
    expect(slept).toEqual([]);
  });

  it('waits rather than snatching away a panel you have just opened', () => {
    globalThis.SidebarManager.panelWebviews = { discord: {} };
    globalThis.SidebarManager.activePanel = 'discord';
    VexTasks.hold('panel:discord', 60000, 'Panel: Discord', 'panel');
    expect(VexTasks.enforce()).toEqual([]);
    globalThis.SidebarManager.activePanel = null;
    expect(VexTasks.enforce()).toEqual(['Panel: Discord']);
    expect(panelSlept).toEqual(['discord']);
  });

  it('does nothing at all when nothing is held', () => {
    expect(VexTasks.enforce()).toEqual([]);
    expect(slept).toEqual([]);
  });
});

describe('the window', () => {
  it('lists every process with a way to end the ones that can be', async () => {
    VexTasks.open();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const rows = document.querySelectorAll('.vextasks-row');
    expect(rows.length).toBe(4);
    expect(document.querySelectorAll('[data-end]').length).toBe(3);   // not the main process
    expect(document.getElementById('vextasks-total').textContent).toBe('1.4 GB');
    VexTasks.close();
    expect(document.querySelector('.vextasks-backdrop')).toBeNull();
  });

  it('picks out the row the right-clicked tab is running in', async () => {
    VexTasks.open({ tab: 'tab-yt' });
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const on = document.querySelector('.vextasks-row.on');
    expect(on.textContent).toContain('A video');
    VexTasks.close();
  });

  it('says what is held, with a way to let it back', async () => {
    VexTasks.hold('site:youtube.com', null, 'Tab: A video', 'tab');
    VexTasks.open();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const held = document.getElementById('vextasks-held');
    expect(held.hidden).toBe(false);
    expect(held.textContent).toMatch(/until you let it back/);
    held.querySelector('[data-release]').click();
    expect(VexTasks.holds()).toEqual({});
    VexTasks.close();
  });
});
