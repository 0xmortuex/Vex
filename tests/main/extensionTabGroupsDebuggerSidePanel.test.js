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
  const realInvoke = ipcRenderer.invoke;
  ipcRenderer.invoke = (ch, ...args) => {
    const op = ch === 'extensions:api' ? args[0].op : null;
    if (op === 'tabs.group') { calls.push([ch, ...args]); return Promise.resolve(1); }
    if (op === 'tabs.ungroup') { calls.push([ch, ...args]); return Promise.resolve(null); }
    if (op && op.startsWith('tabGroups.')) { calls.push([ch, ...args]); return op === 'tabGroups.query' ? Promise.resolve([{ id: 1, title: 'Claude' }]) : Promise.resolve({ id: 1, windowId: 1, title: 'Claude', color: 'orange', collapsed: false }); }
    if (op === 'tabs.navigate') { calls.push([ch, ...args]); return Promise.resolve(6); }
    if (op === 'tabs.goBack' || op === 'tabs.goForward') { calls.push([ch, ...args]); return Promise.resolve(undefined); }
    if (op === 'tabs.captureVisibleTab') { calls.push([ch, ...args]); return Promise.resolve('data:image/png;base64,AAAA'); }
    if (ch === 'extensions:active-tabs') return Promise.resolve({ ids: [], current: null });
    if (ch === 'extensions:popup-tab') return Promise.resolve(null);
    return realInvoke(ch, ...args);
  };
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

  it('groups are Vex\'s own: every call goes to main with what Chrome\'s API takes, and the answers come back', async () => {
    const { c, calls } = withPerms(['tabGroups', 'tabs']);
    expect(await c.tabs.group({ tabIds: [6, 7] })).toBe(1);
    expect(await c.tabs.group({ tabIds: 8, groupId: 1 })).toBe(1);
    expect(await c.tabGroups.update(1, { title: 'Claude', color: 'orange', collapsed: false })).toMatchObject({ id: 1, title: 'Claude' });
    expect(await c.tabGroups.get(1)).toMatchObject({ color: 'orange' });
    expect(await c.tabGroups.query({ title: 'Claude' })).toEqual([{ id: 1, title: 'Claude' }]);
    expect(await new Promise((r) => c.tabGroups.query({}, r))).toEqual([{ id: 1, title: 'Claude' }]);
    await c.tabGroups.move(1, { index: 0 });
    expect(await c.tabs.ungroup([6, 7])).toBeNull();
    expect(await c.tabs.ungroup(8)).toBeNull();
    expect(calls.filter(x => x[0] === 'extensions:api').map(x => [x[1].op, x[1].args])).toEqual([
      ['tabs.group', { tabIds: [6, 7], groupId: undefined }],
      ['tabs.group', { tabIds: [8], groupId: 1 }],
      ['tabGroups.update', { groupId: 1, props: { title: 'Claude', color: 'orange', collapsed: false } }],
      ['tabGroups.get', { groupId: 1 }],
      ['tabGroups.query', { query: { title: 'Claude' } }],
      ['tabGroups.query', { query: {} }],
      ['tabGroups.move', { groupId: 1, props: { index: 0 } }],
      ['tabs.ungroup', { tabIds: [6, 7] }],
      ['tabs.ungroup', { tabIds: [8] }],
    ]);
  });

  it('tabs.update with a web address goes through main (a new history entry, as in Chrome), and the rest stays Electron\'s', async () => {
    const nativeCalls = [];
    const chrome = fakeChrome({ manifest: { permissions: ['tabs'] } });
    chrome.tabs.update = (id, props, cb) => { nativeCalls.push([id, props]); const t = { id: id || 6, url: 'https://native.example/' }; if (typeof cb === 'function') setTimeout(() => cb(t), 0); return Promise.resolve(t); };
    chrome.tabs.get = (id, cb) => { const t = { id, url: 'https://example.com/' }; if (typeof cb === 'function') { setTimeout(() => cb(t), 0); return undefined; } return Promise.resolve(t); };
    const { c, calls } = worker(chrome);
    expect(await c.tabs.update(6, { url: 'https://example.com/two' })).toMatchObject({ id: 6, url: 'https://example.com/' });
    expect(await c.tabs.update({ url: 'https://example.com/front' })).toMatchObject({ id: 6 });
    await c.tabs.update(6, { url: 'https://example.com/three', active: true });
    await c.tabs.update(6, { active: true });
    await c.tabs.update(6, { url: 'javascript:alert(1)' });
    expect(calls.filter(x => x[0] === 'extensions:api').map(x => [x[1].op, x[1].args])).toEqual([
      ['tabs.navigate', { tabId: 6, url: 'https://example.com/two' }],
      ['tabs.navigate', { tabId: undefined, url: 'https://example.com/front' }],
      ['tabs.navigate', { tabId: 6, url: 'https://example.com/three' }],
    ]);
    expect(nativeCalls).toEqual([[6, { active: true }], [6, { active: true }], [6, { url: 'javascript:alert(1)' }]]);
  });

  it('tabs.goBack, goForward and captureVisibleTab exist and ask main', async () => {
    const { c, calls } = withPerms(['tabs', 'activeTab']);
    await c.tabs.goBack(6);
    await c.tabs.goForward();
    expect(await c.tabs.captureVisibleTab(undefined, { format: 'png' })).toBe('data:image/png;base64,AAAA');
    expect(await c.tabs.captureVisibleTab({ format: 'jpeg', quality: 50 })).toBe('data:image/png;base64,AAAA');
    expect(calls.filter(x => x[0] === 'extensions:api').map(x => [x[1].op, x[1].args])).toEqual([
      ['tabs.goBack', { tabId: 6 }],
      ['tabs.goForward', { tabId: undefined }],
      ['tabs.captureVisibleTab', { windowId: undefined, options: { format: 'png' } }],
      ['tabs.captureVisibleTab', { windowId: undefined, options: { format: 'jpeg', quality: 50 } }],
    ]);
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
    for (const marker of ['c.tabGroups = {', 'c.debugger = {', 'c.sidePanel = {', 'c.offscreen = {', 'c.identity = {', 'c.tabs.group = groupCall(', 'c.tabs.update = vexNavigatingUpdate', 'c.tabs.goBack = navCall(', 'c.tabs.captureVisibleTab = navCall(']) {
      expect(PAGE_SRC).toContain(marker);
      expect(SW_SRC).toContain(marker);
    }
  });
});
