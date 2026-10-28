// chrome.tabGroups, chrome.debugger, chrome.sidePanel, chrome.offscreen and chrome.identity, 2026-10-28.
// Electron has none of them. The Claude extension's service worker reads chrome.tabGroups.Color and calls chrome.debugger.onEvent.addListener
// at the top of its script, so in Vex it died on load ("Service worker registration failed. Status code: 15") and every click on its toolbar
// button said "Claude did not get the click: Failed to start service worker". Each is an honest stand-in, there only for an extension that
// asked for the permission, as in Chrome.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/' + f), 'utf8').replace(/\r\n/g, '\n');
const SW_SRC = read('preload-extension-sw.js');
const PAGE_SRC = read('preload-webview.js');
const ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
const OWN = 'chrome-extension://' + ID + '/';
const CLAUDE_PERMS = ['sidePanel', 'storage', 'activeTab', 'scripting', 'debugger', 'tabGroups', 'tabs', 'alarms', 'notifications', 'webNavigation', 'offscreen', 'identity'];

function fakeChrome({ manifest = {} } = {}) {
  return { runtime: { id: ID, getManifest: () => manifest, getURL: (p) => OWN + p }, tabs: { query: () => Promise.resolve([]), get: () => Promise.reject(new Error('No tab')) } };
}
function worker(chrome) {
  const calls = [];
  const listeners = [];
  const ipcRenderer = { invoke: (ch, ...args) => { calls.push([ch, ...args]); return Promise.resolve(ch === 'extensions:open-tab' ? { id: 11, url: args[0].url, active: true } : ch === 'extensions:api' && args[0].op === 'debugger.sendCommand' ? { result: { type: 'string', value: 'ok' } } : null); },
    on: (ch, fn) => { if (ch === 'extensions:event') listeners.push(fn); } };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL,
    require: (m) => {
      if (m !== 'electron') throw new Error('only electron');
      return { ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } };
    } });
  vm.runInContext(SW_SRC, ctx);
  return { c: chrome, calls, emit: (msg) => listeners.forEach(fn => fn({}, msg)) };
}
const withPerms = (permissions, extra = {}) => worker(fakeChrome({ manifest: { permissions, ...extra } }));

describe('chrome.tabGroups', () => {
  it('has the names and colours an extension reads while it starts, even with none of its own permissions', () => {
    const { c } = withPerms(['storage']);
    expect(c.tabGroups.TAB_GROUP_ID_NONE).toBe(-1);
    expect(c.tabGroups.Color.ORANGE).toBe('orange');
    expect(Object.keys(c.tabGroups.Color).sort()).toEqual(['BLUE', 'CYAN', 'GREEN', 'GREY', 'ORANGE', 'PINK', 'PURPLE', 'RED', 'YELLOW']);
    for (const e of ['onCreated', 'onUpdated', 'onMoved', 'onRemoved']) expect(typeof c.tabGroups[e].addListener).toBe('function');
  });

  it('finds no group, and making or changing one fails in words (an extension wraps these in a try/catch)', async () => {
    const { c } = withPerms(['tabGroups']);
    expect(await c.tabGroups.query({})).toEqual([]);
    expect(await new Promise((r) => c.tabGroups.query({}, r))).toEqual([]);
    await expect(c.tabGroups.get(5)).rejects.toThrow('No group with id: 5.');
    await expect(c.tabGroups.update(5, { title: 'x', color: c.tabGroups.Color.ORANGE })).rejects.toThrow('No group with id: 5.');
    await expect(c.tabGroups.move(5, { index: 0 })).rejects.toThrow('No group with id: 5.');
    await expect(c.tabs.group({ tabIds: [1] })).rejects.toThrow('Vex does not let an extension group tabs');
    await expect(c.tabs.ungroup([1])).rejects.toThrow('Vex does not let an extension ungroup tabs');
  });

  it('leaves a real chrome.tabGroups alone if Electron ever gives one', () => {
    const real = { query: () => 'real' };
    const chrome = fakeChrome({ manifest: { permissions: ['tabGroups'] } });
    chrome.tabGroups = real;
    expect(worker(chrome).c.tabGroups).toBe(real);
  });
});

describe('chrome.debugger, offscreen and identity', () => {
  it('exist only for an extension that asked, as in Chrome', () => {
    const none = withPerms(['storage']).c;
    expect(none.debugger).toBeUndefined();
    expect(none.sidePanel).toBeUndefined();
    expect(none.offscreen).toBeUndefined();
    expect(none.identity).toBeUndefined();
    const all = withPerms(CLAUDE_PERMS).c;
    for (const n of ['debugger', 'sidePanel', 'offscreen', 'identity']) expect(all[n]).toBeTruthy();
  });

  it('debugger: the listener the Claude worker adds at the top of its script works, and the real calls go to main', async () => {
    const { c, calls } = withPerms(CLAUDE_PERMS);
    expect(() => { c.debugger.onEvent.addListener(() => {}); c.debugger.onDetach.addListener(() => {}); }).not.toThrow();
    await c.debugger.attach({ tabId: 6 }, '1.3');
    expect(await c.debugger.sendCommand({ tabId: 6, sessionId: 's1' }, 'Runtime.evaluate', { expression: '1' })).toEqual({ result: { type: 'string', value: 'ok' } });
    await c.debugger.detach({ tabId: 6 });
    await c.debugger.getTargets();
    expect(calls.filter(x => x[0] === 'extensions:api').map(x => [x[1].op, x[1].args])).toEqual([
      ['debugger.attach', { tabId: 6, version: '1.3' }],
      ['debugger.sendCommand', { tabId: 6, method: 'Runtime.evaluate', params: { expression: '1' }, sessionId: 's1' }],
      ['debugger.detach', { tabId: 6 }],
      ['debugger.getTargets', {}],
    ]);
  });

  it('debugger: a callback form works, and a target with no tab id is refused in words', async () => {
    const { c } = withPerms(CLAUDE_PERMS);
    await new Promise((r) => c.debugger.attach({ tabId: 6 }, '1.3', () => r()));
    await expect(c.debugger.attach({ extensionId: 'x' }, '1.3')).rejects.toThrow('with its tabId');
    await expect(c.debugger.sendCommand({}, 'Page.enable')).rejects.toThrow('with its tabId');
  });

  it('debugger: the events main sends reach the listeners, with the tab, the method and the parameters', () => {
    const { c, emit } = withPerms(CLAUDE_PERMS);
    const events = []; const detaches = [];
    c.debugger.onEvent.addListener((src, method, params) => events.push([src, method, params]));
    c.debugger.onDetach.addListener((src, reason) => detaches.push([src, reason]));
    emit({ type: 'debugger.onEvent', args: [{ tabId: 6 }, 'Page.loadEventFired', { timestamp: 1 }] });
    emit({ type: 'debugger.onDetach', args: [{ tabId: 6 }, 'canceled_by_user'] });
    expect(events).toEqual([[{ tabId: 6 }, 'Page.loadEventFired', { timestamp: 1 }]]);
    expect(detaches).toEqual([[{ tabId: 6 }, 'canceled_by_user']]);
  });

  it('offscreen: the reasons exist, there is never a document, and making one is refused in words', async () => {
    const { c } = withPerms(CLAUDE_PERMS);
    expect(c.offscreen.Reason.USER_MEDIA).toBe('USER_MEDIA');
    expect(await c.offscreen.hasDocument()).toBe(false);
    await expect(c.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'x' })).rejects.toThrow('Vex does not let an extension open an offscreen page');
  });

  it('identity: a redirect address and an empty profile, and signing in through a window is refused in words', async () => {
    const { c } = withPerms(CLAUDE_PERMS);
    expect(c.identity.getRedirectURL('cb')).toBe('https://' + ID + '.chromiumapp.org/cb');
    expect(await c.identity.getProfileUserInfo()).toEqual({ email: '', id: '' });
    await expect(c.identity.launchWebAuthFlow({ url: 'https://example.com/', interactive: true })).rejects.toThrow('sign in through a browser window');
  });
});

describe('chrome.sidePanel: the page the extension chose opens as a tab of Vex', () => {
  it('opens the page set for that tab (Claude sets sidepanel.html?tabId=N, then opens it) in a tab of its own', async () => {
    const { c, calls } = withPerms(CLAUDE_PERMS);
    await c.sidePanel.setOptions({ tabId: 6, path: 'sidepanel.html?tabId=6', enabled: true });
    expect(await c.sidePanel.open({ tabId: 6 })).toBeUndefined();
    expect(calls.filter(x => x[0] === 'extensions:open-tab')).toEqual([['extensions:open-tab', { url: OWN + 'sidepanel.html?tabId=6', active: true }]]);
  });

  it('a path set for every tab is the default, and one for a tab wins', async () => {
    const { c, calls } = withPerms(CLAUDE_PERMS);
    await c.sidePanel.setOptions({ path: 'panel.html' });
    await c.sidePanel.setOptions({ tabId: 3, path: 'other.html' });
    await c.sidePanel.open({ tabId: 9 });
    await c.sidePanel.open({ tabId: 3 });
    expect(calls.filter(x => x[0] === 'extensions:open-tab').map(x => x[1].url)).toEqual([OWN + 'panel.html', OWN + 'other.html']);
    expect(await c.sidePanel.getOptions({ tabId: 3 })).toMatchObject({ enabled: true, path: 'other.html' });
  });

  it('uses the manifest\'s own side panel page when no options were set', async () => {
    const { c, calls } = withPerms(CLAUDE_PERMS, { side_panel: { default_path: 'side/index.html' } });
    await c.sidePanel.open({ windowId: 1 });
    expect(calls.filter(x => x[0] === 'extensions:open-tab').map(x => x[1].url)).toEqual([OWN + 'side/index.html']);
  });

  it('is refused in words when there is no page, or the extension switched it off for that tab', async () => {
    const { c, calls } = withPerms(CLAUDE_PERMS);
    await expect(c.sidePanel.open({ tabId: 1 })).rejects.toThrow('Vex does not let an extension open a side panel');
    await c.sidePanel.setOptions({ tabId: 1, path: 'x.html', enabled: false });
    await expect(c.sidePanel.open({ tabId: 1 })).rejects.toThrow('open a side panel');
    expect(calls.filter(x => x[0] === 'extensions:open-tab')).toEqual([]);
  });

  it('remembers the panel behaviour it was given', async () => {
    const { c } = withPerms(CLAUDE_PERMS);
    expect(await c.sidePanel.getPanelBehavior()).toEqual({ openPanelOnActionClick: false });
    await c.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    expect(await c.sidePanel.getPanelBehavior()).toEqual({ openPanelOnActionClick: true });
  });
});

describe('the Claude extension\'s service worker, as far as it gets while loading', () => {
  it('reads what it reads at the top of its script without throwing', () => {
    const { c } = withPerms(CLAUDE_PERMS);
    const colours = [c.tabGroups.Color.RED, c.tabGroups.Color.YELLOW, c.tabGroups.Color.PURPLE, c.tabGroups.Color.PINK, c.tabGroups.Color.GREY, c.tabGroups.Color.GREEN, c.tabGroups.Color.CYAN];
    expect(colours.every(Boolean)).toBe(true);
    expect(c.tabGroups.TAB_GROUP_ID_NONE).toBe(-1);
    expect(() => c.debugger.onEvent.addListener(() => {})).not.toThrow();
  });
});

describe('both copies of the stand-ins carry it', () => {
  it('the page preload and the worker preload have the same new code', () => {
    for (const marker of ['c.tabGroups = {', 'c.debugger = {', 'c.sidePanel = {', 'c.offscreen = {', 'c.identity = {', 'c.tabs.group = refuse(']) {
      expect(PAGE_SRC).toContain(marker);
      expect(SW_SRC).toContain(marker);
    }
  });
});
