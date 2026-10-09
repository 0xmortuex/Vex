// @vitest-environment jsdom
//
// vex-persist.json was 1.3 MB and rewritten about once a minute (found
// 2026-10-09). Half of it was workspace snapshots: each kept every saved tab
// whole, and `sig` kept all of it a second time as a JSON string. A snapshot
// now keeps what restore and the list use, an old store is cut down once, and
// the preference file is not rewritten when nothing in it changed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
req('../../src/renderer/js/tab-policy.js');
globalThis.VexJobs = { every: () => ({ stop() {} }) };
const { WorkspaceSnapshots } = req('../../src/renderer/js/workspace-snapshots.js');
const { createPreferenceStore } = req('../../src/main/storage.js');

const KEY = 'vex.workspaceSnapshots';
const fatTab = (n, extra = {}) => ({
  id: 'tab-' + n, url: 'https://site' + n + '.example/page', title: 'Site ' + n, favicon: 'https://site' + n + '.example/favicon.ico',
  partition: 'persist:main', pinned: n === 0, groupId: 'grp_1', stackId: null, sleeping: true,
  originalUrl: 'https://site' + n + '.example/page', scrollPosition: { x: 0, y: 120 * n }, keepAwakeUntil: 0, note: '',
  memBeforeSleep: { mb: 200 + n, shared: false }, ...extra,
});
const fatSnap = (ts, tabs, split = null) => ({ ts, sig: JSON.stringify([tabs, split && split.urls]), tabs, split });

beforeEach(() => {
  localStorage.clear();
  globalThis.TabManager = { tabs: [], createTab: vi.fn((url) => ({ id: 'new-' + url })), switchTab: vi.fn(), rebuildAllTabs: vi.fn(), persistTabs: vi.fn() };
  delete globalThis.SplitScreen;
  globalThis.WorkspaceManager = { activeId: 'ws_personal' };
  window.showToast = vi.fn();
});
afterEach(() => { WorkspaceSnapshots.dispose(); });

describe('workspace snapshots keep only what they use', () => {
  it('cuts an old store down to url, title, session and pin, once', () => {
    const tabs = Array.from({ length: 18 }, (_, n) => fatTab(n));
    // The same tab set three times, differing only in sleep state and scroll:
    // one snapshot. Then a different set.
    const awake = tabs.map(t => ({ ...t, sleeping: false, scrollPosition: { x: 0, y: 1 } }));
    const fewer = tabs.slice(0, 10);
    const store = { ws_personal: [fatSnap(4000, tabs), fatSnap(3000, awake), fatSnap(2000, tabs), fatSnap(1000, fewer)] };
    localStorage.setItem(KEY, JSON.stringify(store));
    const before = localStorage.getItem(KEY).length;

    expect(WorkspaceSnapshots.compact()).toBe(true);
    const after = JSON.parse(localStorage.getItem(KEY));
    expect(after.ws_personal.map(s => s.ts)).toEqual([4000, 1000]);
    for (const s of after.ws_personal) {
      expect(s.sig).toBeUndefined();
      for (const t of s.tabs) expect(Object.keys(t).sort()).toEqual(['partition', 'pinned', 'title', 'url']);
    }
    expect(after.ws_personal[0].tabs[0]).toEqual({ url: 'https://site0.example/page', title: 'Site 0', partition: 'persist:main', pinned: true });
    expect(localStorage.getItem(KEY).length).toBeLessThan(before / 5);

    // Again: nothing to do, nothing written.
    const set = vi.spyOn(Storage.prototype, 'setItem');
    expect(WorkspaceSnapshots.compact()).toBe(false);
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });

  it('still restores a cut-down snapshot, with its session and pin', () => {
    localStorage.setItem(KEY, JSON.stringify({ ws_personal: [fatSnap(5000, [fatTab(0), fatTab(1, { partition: 'persist:work' })])] }));
    WorkspaceSnapshots.compact();
    WorkspaceSnapshots.restore(5000);
    expect(TabManager.createTab).toHaveBeenCalledWith('https://site0.example/page', false, null, { partition: 'persist:main' });
    expect(TabManager.createTab).toHaveBeenCalledWith('https://site1.example/page', false, null, { partition: 'persist:work' });
  });

  it('saves a new snapshot small, and not again when only sleep state changed', () => {
    TabManager.tabs = [fatTab(0, { sleeping: false }), fatTab(1, { sleeping: false })];
    WorkspaceSnapshots.snapshot(true);
    let list = JSON.parse(localStorage.getItem(KEY)).ws_personal;
    expect(list).toHaveLength(1);
    expect(list[0].sig).toBeUndefined();
    expect(Object.keys(list[0].tabs[0]).sort()).toEqual(['partition', 'pinned', 'title', 'url']);

    TabManager.tabs = [fatTab(0, { sleeping: true }), fatTab(1, { sleeping: true, scrollPosition: { x: 0, y: 900 } })];
    WorkspaceSnapshots.snapshot(true);
    list = JSON.parse(localStorage.getItem(KEY)).ws_personal;
    expect(list).toHaveLength(1);

    TabManager.tabs = [fatTab(0), fatTab(1), fatTab(2)];
    WorkspaceSnapshots.snapshot(true);
    expect(JSON.parse(localStorage.getItem(KEY)).ws_personal).toHaveLength(2);
  });
});

describe('the preference file', () => {
  const dirs = [];
  afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });

  it('is not rewritten when a value is set to what it already is, or a missing key deleted', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-pref-test-'));
    dirs.push(dir);
    const file = path.join(dir, 'vex-persist.json');
    const store = createPreferenceStore(file);
    await store.set('vex.a', 'one');
    // A marker only a real write would replace.
    const marked = JSON.stringify({ 'vex.a': 'one', __vexPreferenceStore: 1, marker: true });
    await fs.writeFile(file, marked);
    await store.set('vex.a', 'one');
    await store.delete('vex.never');
    expect(await fs.readFile(file, 'utf8')).toBe(marked);
    await store.set('vex.a', 'two');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ 'vex.a': 'two', __vexPreferenceStore: 1 });
  });

  it('compares with a write still waiting ahead of it, not the file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-pref-test-'));
    dirs.push(dir);
    const file = path.join(dir, 'vex-persist.json');
    const store = createPreferenceStore(file);
    await store.set('vex.k', 'a');
    await Promise.all([store.set('vex.k', 'b'), store.set('vex.k', 'a')]);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))['vex.k']).toBe('a');
    expect(createPreferenceStore(file).load()['vex.k']).toBe('a');
  });
});
