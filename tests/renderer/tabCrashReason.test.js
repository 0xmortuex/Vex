// @vitest-environment jsdom
//
// Audit A11: webview.js ignored the event details when a tab's page process died. The reason Electron gives
// is now used: out of memory says so and offers to sleep the heaviest other tabs; a failed launch points at
// safe mode; killed / crashed say what is honestly known. The crash-loop counters stay.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs');
const path = require('path');

require('../../src/renderer/js/vex-utils.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');

describe('crashAdvice', () => {
  it('says out of memory and offers to sleep tabs', () => {
    const a = WebviewManager.crashAdvice('oom');
    expect(a.text).toMatch(/ran out of memory/);
    expect(a.sleepOffer).toBe(true);
    expect(a.again).toMatch(/keeps running out of memory/);
  });
  it('a failed launch suggests safe mode', () => {
    const a = WebviewManager.crashAdvice('launch-failed');
    expect(a.text).toMatch(/safe mode/);
    expect(a.safeModeHint).toBe(true);
    expect(a.sleepOffer).toBeFalsy();
  });
  it('killed and crashed are told apart and stay honest', () => {
    expect(WebviewManager.crashAdvice('killed').text).toMatch(/Something ended this page/);
    expect(WebviewManager.crashAdvice('crashed').text).toBe('This page crashed — Vex is reloading it.');
    expect(WebviewManager.crashAdvice(undefined).text).toBe('This tab stopped working — Vex is reloading it');
    expect(WebviewManager.crashAdvice('abnormal-exit').again).toBe('This tab keeps crashing. Reload it manually to retry.');
  });
});

describe('_tellCrash', () => {
  beforeEach(() => { delete globalThis.TabManager; window.showToast = vi.fn(); });
  it('a plain crash is one warn toast', () => {
    WebviewManager._tellCrash({ id: 1 }, WebviewManager.crashAdvice('crashed'));
    expect(window.showToast).toHaveBeenCalledWith('This page crashed — Vex is reloading it.', 'warn');
  });
  it('out of memory with heavy tabs: a toast with a button that sleeps exactly those tabs', async () => {
    const slept = [];
    globalThis.TabManager = { heaviestSleepable: vi.fn(async () => [{ tab: { id: 'a' }, mb: 500 }, { tab: { id: 'b' }, mb: 300 }]), sleepTab: vi.fn(async (id) => { slept.push(id); }) };
    WebviewManager._tellCrash({ id: 'crashed' }, WebviewManager.crashAdvice('oom'));
    await new Promise(r => setTimeout(r, 0));
    const call = window.showToast.mock.calls[0];
    expect(call[0]).toMatch(/ran out of memory/);
    expect(call[3].action.label).toBe('Sleep the heaviest other tabs');
    expect(globalThis.TabManager.heaviestSleepable).toHaveBeenCalledWith(3, 'crashed');
    call[3].action.run();
    await new Promise(r => setTimeout(r, 0));
    expect(slept).toEqual(['a', 'b']);
  });
  it('out of memory with nothing to sleep: just the sentence', async () => {
    globalThis.TabManager = { heaviestSleepable: vi.fn(async () => []) };
    WebviewManager._tellCrash({ id: 1 }, WebviewManager.crashAdvice('oom'));
    await new Promise(r => setTimeout(r, 0));
    expect(window.showToast).toHaveBeenCalledWith('This page ran out of memory — Vex is reloading it.', 'warn');
  });
  it('a failed look at the tabs is reported and the sentence still shown', async () => {
    const note = vi.fn();
    window.VexProblems = { note };
    globalThis.TabManager = { heaviestSleepable: vi.fn(async () => { throw new Error('ipc down'); }) };
    WebviewManager._tellCrash({ id: 1 }, WebviewManager.crashAdvice('oom'));
    await new Promise(r => setTimeout(r, 0));
    expect(note).toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('This page ran out of memory — Vex is reloading it.', 'warn');
    delete window.VexProblems;
  });
});

describe('TabManager.heaviestSleepable', () => {
  const fakeTab = (id, over = {}) => ({ id, url: `https://${id}.example/`, title: id, pinned: false, groupId: null, stackId: null, ...over });
  async function load(mem) {
    globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true), loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true), loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true) };
    const ids = new Map();
    globalThis.WebviewManager = { destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: { get: (id) => { if (!ids.has(id)) ids.set(id, ids.size + 1); return { getWebContentsId: () => ids.get(id) }; } } };
    globalThis.SidebarManager = { hideActivePanel: vi.fn() };
    globalThis.HorizontalTabs = undefined;
    globalThis.TabGrouper = undefined;
    window.vex = { getStartPageUrl: () => new Promise(() => {}), tabMemory: vi.fn(async (wcs) => { const byId = {}; for (const [id, wc] of ids) if (wcs.includes(wc) && mem[id]) byId[wc] = mem[id]; return { totalKB: 0, byId }; }) };
    document.body.innerHTML = '<input id="url-input"><div id="tabs-list"></div><div id="tab-groups-container"></div><button id="btn-new-tab"></button>';
    vi.resetModules();
    await import('../../src/renderer/js/vex-utils.js');
    return (await import('../../src/renderer/js/tabs.js')).TabManager;
  }
  it('takes the heaviest sleepable tabs, not the crashed one, the front one, sound, or one sharing a process', async () => {
    const TM = await load({ a: { memKB: 100 * 1024, pid: 1 }, b: { memKB: 600 * 1024, pid: 2 }, c: { memKB: 500 * 1024, pid: 2 }, d: { memKB: 30 * 1024, pid: 4 }, e: { memKB: 400 * 1024, pid: 5 }, front: { memKB: 900 * 1024, pid: 6 }, crashed: { memKB: 800 * 1024, pid: 7 }, loud: { memKB: 700 * 1024, pid: 8 } });
    TM.tabs = ['a', 'b', 'c', 'd', 'e', 'front', 'crashed'].map(id => fakeTab(id)).concat([fakeTab('loud', { audible: true, muted: false })]);
    TM.activeTabId = 'front';
    const r = await TM.heaviestSleepable(3, 'crashed');
    expect(r.map(x => x.tab.id)).toEqual(['b', 'e', 'a']);          // c shares b's process, d is under 50 MB
    expect(Math.round(r[0].mb)).toBe(600);
  });
  it('is empty when memory cannot be read', async () => {
    const TM = await load({});
    TM.tabs = [fakeTab('a')];
    TM.activeTabId = 'x';
    expect(await TM.heaviestSleepable(3, 'y')).toEqual([]);
  });
});

describe('the handler keeps its loop counters', () => {
  const web = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/webview.js'), 'utf8');
  it('passes the event reason in and still stops after four', () => {
    const block = web.slice(web.indexOf("onWebview('render-process-gone'"), web.indexOf("onWebview('new-window'"));
    expect(block).toContain('crashAdvice(e && e.reason)');
    expect(block).toContain('if (++crashCount > 4)');
    expect(block).toContain('Date.now() - lastCrash > 120000');
    expect(block).toContain('400 * 2 ** (crashCount - 1)');
  });
});
