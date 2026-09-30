// @vitest-environment node
//
// Main-side fixes from the r2 tabs sweep (2026-09-30):
//   * a tab built without JavaScript that left for a site with it was built
//     again and lost its back list; the new guest now takes the old one's
//     history before its first page commits (session-security.js);
//   * chrome.tabs.remove did not exist; main now closes a Vex tab by its
//     page's webContents id, only a tab in the extension's own session, and
//     says "No tab with id: N." of anything else (main.js).
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const { createSessionSecurity } = require('../../src/main/session-security.js');
const { validate } = require('../../src/main/ipc-schemas.js');

function harness() {
  const sessions = new Map();
  const session = { fromPartition: (p) => { if (!sessions.has(p)) sessions.set(p, { partition: p }); return sessions.get(p); } };
  const handlers = {};
  const win = { on: vi.fn(), once: vi.fn(), webContents: { id: 1, on: (ev, fn) => { handlers[ev] = fn; }, send: vi.fn(), isDestroyed: () => false } };
  const security = createSessionSecurity({ session, webContents: { getAllWebContents: () => [], fromId: () => null }, root: process.cwd() + '/src' });
  security.registerHost(win);
  let nextId = 10;
  const guest = ({ javascript = true, entries = [], index = -1, partition = 'persist:main' } = {}) => {
    const on = {};
    const g = {
      id: nextId++, session: session.fromPartition(partition),
      isDestroyed: () => false,
      getLastWebPreferences: () => ({ javascript }),
      on: (ev, fn) => { (on[ev] = on[ev] || []).push(fn); },
      once: (ev, fn) => { (on[ev] = on[ev] || []).push(fn); },
      emit: (ev, ...a) => (on[ev] || []).forEach(fn => fn(...a)),
      navigationHistory: {
        entries, index,
        getAllEntries: () => g.navigationHistory.entries,
        getActiveIndex: () => g.navigationHistory.index,
        restore: vi.fn(() => Promise.reject(new Error("ERR_ABORTED (-3) loading 'https://on.example/'"))),
      },
    };
    return g;
  };
  const attach = (prefs, g, params = { partition: 'persist:main' }) => {
    const event = { preventDefault: vi.fn() };
    handlers['will-attach-webview'](event, prefs, params);
    handlers['did-attach-webview']({}, g);
    return event;
  };
  return { attach, guest };
}

describe('a tab built again on leaving a JavaScript-off site keeps its back list', () => {
  it('the new guest takes the old guest\'s entries before its first load', () => {
    const h = harness();
    const old = h.guest({ javascript: false });
    h.attach({ javascript: false }, old);
    old.navigationHistory.entries = [{ url: 'https://off.example/1' }, { url: 'https://off.example/2' }];
    old.navigationHistory.index = 1;
    old.emit('did-navigate');
    old.emit('destroyed');
    const next = h.guest();
    const prefs = { vexHistoryFrom: String(old.id) };
    h.attach(prefs, next);
    expect(prefs.vexHistoryFrom).toBeUndefined();       // never reaches the guest's preferences
    expect(next.navigationHistory.restore).toHaveBeenCalledWith({ index: 1, entries: old.navigationHistory.entries });
  });

  it('only once, only for a guest that was built without JavaScript, and not across partitions', () => {
    const h = harness();
    const on = h.guest({ javascript: true });
    h.attach({}, on);
    on.navigationHistory.entries = [{ url: 'https://on.example/' }]; on.navigationHistory.index = 0;
    on.emit('did-navigate');
    const a = h.guest();
    h.attach({ vexHistoryFrom: String(on.id) }, a);
    expect(a.navigationHistory.restore).not.toHaveBeenCalled();

    const off = h.guest({ javascript: false });
    h.attach({}, off);
    off.navigationHistory.entries = [{ url: 'https://off.example/' }]; off.navigationHistory.index = 0;
    off.emit('did-navigate');
    const other = h.guest({ partition: 'persist:work' });
    h.attach({ vexHistoryFrom: String(off.id) }, other, { partition: 'persist:work' });
    expect(other.navigationHistory.restore).not.toHaveBeenCalled();
    const again = h.guest();
    h.attach({ vexHistoryFrom: String(off.id) }, again);
    expect(again.navigationHistory.restore).not.toHaveBeenCalled();   // the list was taken (and refused) once
  });

  it('a restore cut short by the guest\'s own first load is expected; any other failure is logged', async () => {
    const h = harness();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const off = h.guest({ javascript: false });
    h.attach({}, off);
    off.navigationHistory.entries = [{ url: 'https://off.example/' }]; off.navigationHistory.index = 0;
    off.emit('did-navigate');
    const next = h.guest();
    h.attach({ vexHistoryFrom: String(off.id) }, next);
    await Promise.resolve(); await Promise.resolve();
    expect(err).not.toHaveBeenCalled();

    off.emit('did-navigate');
    const broken = h.guest();
    broken.navigationHistory.restore = vi.fn(() => { throw new Error('Cannot restore'); });
    h.attach({ vexHistoryFrom: String(off.id) }, broken);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('back list'), 'Cannot restore');
    err.mockRestore();
  });
});

describe('main: an extension\'s tabs.remove', () => {
  const MAIN = fs.readFileSync(path.resolve('src/main.js'), 'utf8').replace(/\r\n/g, '\n');
  const from = MAIN.indexOf('async function _closeTabsForExtension(');
  const code = MAIN.slice(from, MAIN.indexOf('\n}\n', from) + 3);
  const OWN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/bg.html';
  const extSession = { name: 'ext' };

  function mainSide(pages, { missing = null } = {}) {
    const calls = [];
    const win = { isDestroyed: () => false, webContents: { executeJavaScript: vi.fn(async (js) => { calls.push(js); return /\.missing$/.test(js) ? missing : 1; }) } };
    const host = { win };
    const ctx = vm.createContext({
      webContents: { fromId: (id) => pages[id] || null },
      secureSessions: { owner: (page) => (page.vexOwned ? host : null) },
      JSON, Array, Number, Map, Error, String,
    });
    vm.runInContext(code + '\nthis.close = _closeTabsForExtension;', ctx);
    return { close: ctx.close, calls };
  }
  const tab = (over = {}) => ({ isDestroyed: () => false, getType: () => 'webview', session: extSession, vexOwned: true, ...over });

  it('closes the tabs named, in the window that has them, after checking every id', async () => {
    const m = mainSide({ 7: tab(), 8: tab() });
    await expect(m.close(OWN, extSession, { ids: [7, 8] })).resolves.toBeUndefined();
    expect(m.calls).toEqual(['TabManager.tabsByPageId([7,8]).missing', 'TabManager.closeTabsByPageId([7,8])']);
  });

  it('"No tab with id: N." for anything that is not a Vex tab in the extension\'s session', async () => {
    const m = mainSide({ 1: tab({ getType: () => 'window' }), 2: tab({ session: { name: 'private' } }), 3: tab({ vexOwned: false }), 4: tab() });
    for (const id of [1, 2, 3, 99, -5]) await expect(m.close(OWN, extSession, { ids: [4, id] })).rejects.toThrow(`No tab with id: ${id}.`);
    expect(m.calls).toEqual([]);   // nothing closed when one id is wrong
  });

  it('a page of the window that is not one of its tabs (a peek, a panel) is refused by the interface', async () => {
    const m = mainSide({ 5: tab() }, { missing: 5 });
    await expect(m.close(OWN, extSession, { ids: [5] })).rejects.toThrow('No tab with id: 5.');
    expect(m.calls).toHaveLength(1);
  });

  it('only an extension asks', async () => {
    const m = mainSide({ 7: tab() });
    await expect(m.close('https://example.com/', extSession, { ids: [7] })).rejects.toThrow('Only an extension');
    await expect(m.close(OWN, extSession, { ids: [] })).rejects.toThrow('tab id');
  });

  it('is wired for pages and workers, with a schema and the extension-page policy', () => {
    expect(MAIN).toContain("ipcMain.handle('extensions:close-tab', (event, request) => _closeTabsForExtension(event.senderFrame?.url, event.sender.session, request));");
    expect(MAIN).toContain("worker.ipc.handle('extensions:close-tab', (_event, request) => _closeTabsForExtension(worker.scriptURL, ses, request));");
    expect(() => validate('extensions:close-tab', [{ ids: [3, 4] }])).not.toThrow();
    expect(() => validate('extensions:close-tab', [{ ids: ['3'] }])).toThrow();
    expect(() => validate('extensions:close-tab', [{ ids: [] }])).toThrow();
    const security = createSessionSecurity({ session: { fromPartition: () => ({}) }, webContents: { getAllWebContents: () => [], fromId: () => null }, root: process.cwd() + '/src' });
    const frame = (url) => { const mainFrame = { url }; return { sender: { mainFrame }, senderFrame: mainFrame }; };
    expect(security.isAuxiliary(frame('chrome-extension://abcdefghijklmnopabcdefghijklmnop/bg.html'), 'extensions:close-tab')).toBe(true);
    expect(security.isAuxiliary(frame('https://example.com/'), 'extensions:close-tab')).toBe(false);
  });
});
