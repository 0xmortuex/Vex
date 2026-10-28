// @vitest-environment node
//
// chrome.tabs said index 0, window 0 and group 0 (Chrome: -1 for none) for
// every tab, and tabs.update answered active: false for the tab in front
// (found 2026-10-10). Main says where each tab is (_activeTabsFor's layout).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SW_SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-extension-sw.js'), 'utf8');
const TABS = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/tabs.js'), 'utf8').replace(/\r\n/g, '\n');
const OWN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';

function worker(native, front) {
  const ipcRenderer = { invoke: (ch) => Promise.resolve(ch === 'extensions:active-tabs' ? front : null), on: () => {} };
  const chrome = {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', getManifest: () => ({}), getURL: (p) => OWN + p },
    tabs: {
      query: () => Promise.resolve(native.map(t => ({ ...t }))),
      get: (id) => Promise.resolve(native.find(t => t.id === id) || null),
      update: (id, props) => Promise.resolve({ ...native.find(t => t.id === id), ...props }),
    },
  };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL, console,
    require: () => ({ ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } }) });
  vm.runInContext(SW_SRC, ctx);
  return chrome;
}
const NATIVE = [
  { id: 4, index: 0, windowId: 0, groupId: 0, active: false, url: 'https://a.example/' },
  { id: 5, index: 0, windowId: 0, groupId: 0, active: false, url: 'https://b.example/' },
  { id: 6, index: 0, windowId: 0, groupId: 0, active: false, url: 'https://c.example/' },
];
const FRONT = { ids: [5], current: 5, currentWindow: 1,
  layout: { 4: { index: 1, windowId: 1, groupId: 2, pinned: false }, 5: { index: 0, windowId: 1, groupId: -1, pinned: true }, 6: { index: 0, windowId: 3, groupId: -1, pinned: false } } };

describe('where a tab is', () => {
  it('tabs.query answers each tab\'s place, window and group, in window order', async () => {
    const c = worker(NATIVE, FRONT);
    const tabs = await c.tabs.query({});
    expect(tabs.map(t => [t.id, t.windowId, t.index, t.groupId, t.active])).toEqual([[5, 1, 0, -1, true], [4, 1, 1, 2, false], [6, 3, 0, -1, false]]);
  });
  it('filters by window (the current one too), group, index and pinned', async () => {
    const c = worker(NATIVE, FRONT);
    expect((await c.tabs.query({ currentWindow: true })).map(t => t.id)).toEqual([5, 4]);
    expect((await c.tabs.query({ windowId: -2 })).map(t => t.id)).toEqual([5, 4]);
    expect((await c.tabs.query({ windowId: 3 })).map(t => t.id)).toEqual([6]);
    expect((await c.tabs.query({ groupId: 2 })).map(t => t.id)).toEqual([4]);
    expect((await c.tabs.query({ groupId: -1 })).map(t => t.id)).toEqual([5, 6]);
    expect((await c.tabs.query({ pinned: true })).map(t => t.id)).toEqual([5]);
  });
  it('tabs.update answers the tab as it is, in front or not', async () => {
    const c = worker(NATIVE, FRONT);
    expect(await c.tabs.update(5, { muted: true })).toMatchObject({ id: 5, active: true, index: 0, windowId: 1, groupId: -1, muted: true });
    expect(await c.tabs.update(4, {})).toMatchObject({ id: 4, active: false, groupId: 2 });
  });
  it('the window lays its tabs out for main', () => {
    expect(TABS).toMatch(/extensionTabLayout\(\) \{/);
    // A group is told by a number of its own that stays (TabManager.extGroupNumber), not by its place in a list, which shifted when a group went.
    expect(TABS).toMatch(/groupId: grp \? this\.extGroupNumber\(grp\) : -1/);
  });
});
