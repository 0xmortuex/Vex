// The chrome.* stand-ins preload-webview.js gives extension pages (2026-09-27):
// Electron has no chrome.permissions or browserAction, and every
// chrome.storage.sync call fails. Dark Reader crashed on all three while
// starting and left every site under its crude fallback coat.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
const START = SRC.indexOf('// === chrome.permissions for extensions ===');
const END = SRC.indexOf("(function () {\n  'use strict';\n  var ipcRenderer;");
const SHIMS = SRC.slice(START, END);

function storage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function run({ protocol = 'chrome-extension:', manifest, chrome: extra = {} } = {}) {
  const listeners = [];
  const chrome = {
    runtime: { getManifest: () => manifest },
    storage: { local: {}, onChanged: { addListener: (fn) => listeners.push(fn) } },
    tabs: {},
    alarms: {},
    ...extra,
  };
  const win = { chrome, localStorage: storage(), addEventListener() {} };
  const ctx = vm.createContext({ window: win, location: { protocol }, setTimeout, Promise, JSON, Object, Array, String });
  vm.runInContext(SHIMS, ctx);
  return { chrome, listeners };
}

describe('chrome.* stand-ins for extensions', () => {
  it('the shims are found in the preload', () => {
    expect(START).toBeGreaterThan(0);
    expect(END).toBeGreaterThan(START);
  });

  it('chrome.permissions reports what the manifest grants and Vex provides, and grants nothing new', async () => {
    const { chrome } = run({ manifest: { permissions: ['storage', 'tabs', 'contextMenus', 'alarms', 'unlimitedStorage', '<all_urls>'] } });
    chrome.storage.sync; // defined by the storage shim
    expect(await chrome.permissions.contains({ permissions: ['tabs', 'alarms'] })).toBe(true);
    expect(await chrome.permissions.contains({ permissions: ['unlimitedStorage'] })).toBe(true);
    // Granted in the manifest, but Electron has no chrome.contextMenus.
    expect(await chrome.permissions.contains({ permissions: ['contextMenus'] })).toBe(false);
    expect(await chrome.permissions.contains({ origins: ['https://example.com/*'] })).toBe(true);
    expect(await chrome.permissions.request({ permissions: ['history'] })).toBe(false);
    expect(await chrome.permissions.remove({ permissions: ['tabs'] })).toBe(false);
    // The line Dark Reader crashed on.
    expect(typeof chrome.permissions.onRemoved.addListener).toBe('function');
    await new Promise((resolve) => chrome.permissions.contains({ permissions: ['tabs'] }, (v) => { expect(v).toBe(true); resolve(); }));
  });

  it('chrome.storage.sync keeps values on this machine, with defaults and change events', async () => {
    const { chrome, listeners } = run({ manifest: {} });
    const seen = [];
    chrome.storage.sync.onChanged.addListener((ch) => seen.push(ch));
    const global = [];
    chrome.storage.onChanged.addListener((ch, area) => global.push(area));
    expect(listeners).toHaveLength(1); // still registered with the real event too
    expect(await chrome.storage.sync.get(null)).toEqual({});
    await chrome.storage.sync.set({ theme: { mode: 1 }, n: 2 });
    expect(await chrome.storage.sync.get('theme')).toEqual({ theme: { mode: 1 } });
    expect(await chrome.storage.sync.get({ n: 0, missing: 'default' })).toEqual({ n: 2, missing: 'default' });
    await chrome.storage.sync.remove('n');
    expect(await chrome.storage.sync.get(null)).toEqual({ theme: { mode: 1 } });
    expect(seen[0]).toEqual({ theme: { newValue: { mode: 1 } }, n: { newValue: 2 } });
    expect(seen[1]).toEqual({ n: { oldValue: 2 } });
    expect(global).toEqual(['sync', 'sync']);
    expect(chrome.storage.sync.QUOTA_BYTES_PER_ITEM).toBe(8192);
    await new Promise((resolve) => chrome.storage.sync.get(null, (all) => { expect(all).toEqual({ theme: { mode: 1 } }); resolve(); }));
  });

  it('browserAction or action, whichever the manifest declares, accepts calls and changes nothing', async () => {
    const mv2 = run({ manifest: { name: 'X', browser_action: {} } }).chrome;
    expect(await mv2.browserAction.setBadgeText({ text: '1' })).toBeUndefined();
    expect(await mv2.browserAction.getBadgeText({})).toBe('');
    expect(mv2.action).toBeUndefined();
    const mv3 = run({ manifest: { action: {} } }).chrome;
    expect(typeof mv3.action.setIcon).toBe('function');
    expect(mv3.browserAction).toBeUndefined();
  });

  it('only extension pages get them, and a real API is never replaced', () => {
    const site = run({ protocol: 'https:', manifest: { browser_action: {} } }).chrome;
    expect(site.permissions).toBeUndefined();
    expect(site.storage.sync).toBeUndefined();
    expect(site.browserAction).toBeUndefined();
    const real = { contains: () => 'native' };
    const ext = run({ manifest: {}, chrome: { permissions: real } }).chrome;
    expect(ext.permissions).toBe(real);
  });
});
