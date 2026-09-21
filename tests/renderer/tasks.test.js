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

let slept, panelSlept, extEnabled, reloaded;

// A <webview> that answers the measurement script with a plausible reading.
const READING = {
  url: 'https://discord.com/channels/@me', heapMB: 480, heapLimitMB: 2048,
  nodes: 38402, images: 120, media: 2, playing: 1,
  frames: ['youtube.com', 'discord.com', 'discord.com'], workers: 1,
  storeMB: 1200, storeDetail: [['caches', 900], ['indexedDB', 280]], vencord: 34,
};
const guest = (id, url) => ({
  getWebContentsId: () => id,
  executeJavaScript: () => Promise.resolve({ ...READING, url }),
  reload: () => reloaded.push(id),
  focus: () => {},
});

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  VexTasks.close();
  slept = []; panelSlept = []; extEnabled = []; reloaded = [];
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
      ['tab-discord', guest(501, 'https://discord.com/channels/@me')],
      ['tab-yt', guest(601, 'https://www.youtube.com/watch?v=x')],
    ]),
  };
  globalThis.SidebarManager = {
    activePanel: null, sidePanel: null, panelWebviews: {},
    panelLabel: (n) => n[0].toUpperCase() + n.slice(1),
    panelSleepPrefs: () => ({ exempt: [] }),
    setKeepAwake: () => {},
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

describe('what is inside one app', () => {
  it('asks the page itself, and turns the reading into plain rows', async () => {
    globalThis.SidebarManager.panelWebviews = { discord: guest(501, 'https://discord.com/channels/@me') };
    const d = await VexTasks.inside({ panel: 'discord' });
    expect(d.name).toBe('Discord');
    const rows = VexTasks.insideRows(d);
    const find = (s) => rows.find(r => r.what.includes(s));
    expect(find('JavaScript').n).toBe('480 MB');
    expect(find('grown').n).toBe('38,402 elements');
    expect(find('grown').detail).toMatch(/never been reloaded/);        // 38k is "very large"
    expect(find('embedded').n).toBe('3 frames');
    expect(find('embedded').detail).toMatch(/discord\.com ×2/);
    expect(find('disk').n).toBe('1.2 GB');
    expect(find('Vencord').n).toBe('34');
  });

  it('says so plainly when the app is not loaded', async () => {
    globalThis.SidebarManager.panelWebviews = {};
    await expect(VexTasks.inside({ panel: 'discord' })).rejects.toThrow(/not loaded/);
  });

  it('offers the things that really lower it, and they do something', async () => {
    globalThis.SidebarManager.panelWebviews = { discord: guest(501, 'https://discord.com/channels/@me') };
    window.vex.hardReloadWebview = (id) => { reloaded.push('hard:' + id); return Promise.resolve({ ok: true }); };
    const d = await VexTasks.inside({ panel: 'discord' });
    const acts = VexTasks.insideActions({ panel: 'discord' }, d);
    const labels = acts.map(a => a.label);
    expect(labels).toContain('Reload it');
    expect(labels).toContain('Clear its cache and reload');
    expect(labels).not.toContain('Make emoji and avatars still');   // Lighter Discord is already on
    await acts.find(a => a.label === 'Reload it').run();
    expect(reloaded).toEqual([501]);
    await acts.find(a => a.label.startsWith('Clear')).run();
    expect(reloaded).toEqual([501, 'hard:501']);
  });

  it('says what Vex is already doing about animated emoji, and offers it when it is off', async () => {
    globalThis.SidebarManager.panelWebviews = { discord: guest(501, 'https://discord.com/channels/@me') };
    let lite = true;
    globalThis.DiscordMemory = { lite: () => lite, setLite: async (on) => { lite = on; } };
    const d = await VexTasks.inside({ panel: 'discord' });
    const row = VexTasks.insideRows(d).find(r => r.what.includes('Animated'));
    expect(row.n).toBe('already still');
    expect(row.detail).toMatch(/GIFs people post still play/);
    expect(VexTasks.insideActions({ panel: 'discord' }, d).map(a => a.label)).not.toContain('Make emoji and avatars still');

    lite = false;
    const off = VexTasks.insideRows(d).find(r => r.what.includes('Animated'));
    expect(off.n).toBe('animating');
    const act = VexTasks.insideActions({ panel: 'discord' }, d).find(a => a.label === 'Make emoji and avatars still');
    expect(act).toBeTruthy();
    await act.run();
    expect(lite).toBe(true);
    expect(reloaded).toContain(501);
  });

  it('never sleeps a panel that is in a call or making a sound', async () => {
    globalThis.SidebarManager.panelWebviews = { discord: guest(501, 'https://discord.com/channels/@me') };
    globalThis.SidebarManager.panelBusy = () => 'it is using the microphone or camera';
    const d = await VexTasks.inside({ panel: 'discord' });
    const act = VexTasks.insideActions({ panel: 'discord' }, d).find(a => a.label === 'Sleep it now');
    expect(act.why).toMatch(/Not now: it is using the microphone/);
    await expect(act.run()).rejects.toThrow(/would cut that off/);
    expect(panelSlept).toEqual([]);
    // And a hold does not sneak past it either.
    VexTasks.hold('panel:discord', 60000, 'Panel: Discord', 'panel');
    expect(VexTasks.enforce()).toEqual([]);
    expect(panelSlept).toEqual([]);
    delete globalThis.SidebarManager.panelBusy;
  });

  it('names the keep-awake setting as the reason a hidden panel never gives its memory back', async () => {
    globalThis.SidebarManager.panelWebviews = { discord: guest(501, 'https://discord.com/channels/@me') };
    let keptAwake = true;
    globalThis.SidebarManager.panelSleepPrefs = () => ({ exempt: keptAwake ? ['discord'] : [] });
    globalThis.SidebarManager.setKeepAwake = (n, on) => { keptAwake = on; };
    const d = await VexTasks.inside({ panel: 'discord' });
    let act = VexTasks.insideActions({ panel: 'discord' }, d).find(a => /sleep/i.test(a.label));
    expect(act.label).toBe('Let it sleep when you are not looking');
    expect(act.why).toMatch(/stay awake/);
    await act.run();
    expect(keptAwake).toBe(false);
    // Once it can sleep, the offer becomes sleeping it now.
    act = VexTasks.insideActions({ panel: 'discord' }, d).find(a => /sleep/i.test(a.label));
    expect(act.label).toBe('Sleep it now');
    await act.run();
    expect(panelSlept).toEqual(['discord']);
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

  it('opens on the app you asked about, not on a list of processes', async () => {
    VexTasks.open({ tab: 'tab-yt' });
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById('vextasks-title').textContent).toBe('A video');
    expect(document.querySelector('.vextasks-inside')).toBeTruthy();
    expect(document.body.textContent).toContain('What actually lowers it');
    // And the whole process list is still one click away.
    document.querySelector('[data-all]').click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById('vextasks-title').textContent).toBe('Running tasks');
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

// "34 plugins running" is a fact with no consequence. PluginProfiler wraps
// every plugin's start, event handlers and context menus and times them; when
// it is there, this row becomes a name and a number.
describe('what the Vencord plugins cost', () => {
  const row = (d) => VexTasks.insideRows({ ...READING, ...d }).find(r => r.what === 'Vencord plugins running');

  it('without the profiler, says how to get the figures', () => {
    expect(row({ plugins: null }).n).toBe('34');
    expect(row({ plugins: null }).detail).toMatch(/PluginProfiler/);
  });

  it('with it, names the dearest ones and over how long', () => {
    const detail = row({
      plugins: {
        seconds: 600,
        measured: 2,
        rows: [
          { name: 'MessageLogger', totalMs: 4200, fluxCalls: 18000, worstEvent: 'MESSAGE_CREATE' },
          { name: 'Translate', totalMs: 60, fluxCalls: 12, worstEvent: '' },
          { name: 'Quiet', totalMs: 0, fluxCalls: 0, worstEvent: '' },
        ],
      },
    }).detail;
    expect(detail).toMatch(/Measured over 10 minutes/);
    expect(detail).toMatch(/MessageLogger 4\.2 s across 18,000 events/);
    expect(detail).toMatch(/Translate 60 ms/);
    expect(detail).not.toMatch(/Quiet/);          // nothing measurable, not named
  });

  // A plugin that patches Discord once at startup costs nothing afterwards,
  // and the row has to be able to say that rather than imply guilt.
  it('says plainly when nothing has cost anything', () => {
    const detail = row({ plugins: { seconds: 120, measured: 0, rows: [{ name: 'Quiet', totalMs: 0, fluxCalls: 0, worstEvent: '' }] } }).detail;
    expect(detail).toMatch(/none of them has cost anything measurable/);
  });
});
