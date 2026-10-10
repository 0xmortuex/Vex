// @vitest-environment node
//
// Sleeping a tab, reopening a closed one (Ctrl+Shift+T) and restoring tabs at
// start built the tab's page again from its address alone, so Back and Forward
// went nowhere (audit B4, 2026-10-10). The window now keeps each tab's back
// list with the tab and hands it to main before the page is made again; main
// checks it and restores it on the new page, the way a JavaScript-off tab's
// list already was (session-security.js).
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { createSessionSecurity } = require('../../src/main/session-security.js');
const { validate } = require('../../src/main/ipc-schemas.js');

const ROOT = path.resolve('src');
const START = pathToFileURL(path.join(ROOT, 'renderer/start.html')).href + '?theme=oxford';

function harness() {
  const sessions = new Map();
  const session = { fromPartition: (p) => { if (!sessions.has(p)) sessions.set(p, { partition: p }); return sessions.get(p); } };
  const handlers = {};
  const win = { on: vi.fn(), once: vi.fn(), webContents: { id: 1, on: (ev, fn) => { handlers[ev] = fn; }, send: vi.fn(), setWindowOpenHandler: vi.fn(), isDestroyed: () => false } };
  const all = [{ id: 1, isDestroyed: () => false, getType: () => 'window' }];
  const security = createSessionSecurity({ session, webContents: { getAllWebContents: () => all, fromId: () => null }, root: ROOT });
  security.registerHost(win);
  let nextId = 10;
  const guest = ({ entries = [], index = -1, partition = 'persist:main' } = {}) => ({
    id: nextId++, session: session.fromPartition(partition),
    isDestroyed: () => false, getType: () => 'webview', hostWebContents: win.webContents,
    getLastWebPreferences: () => ({ javascript: true }),
    on: vi.fn(), once: vi.fn(),
    navigationHistory: {
      getAllEntries: () => entries, getActiveIndex: () => index,
      restore: vi.fn(() => Promise.resolve()),
    },
  });
  // As Electron does it (guest-view-manager): will-attach-webview may change
  // params; on attach the guest loads params.src, then did-attach-webview.
  const attach = async (prefs, g, params) => {
    const event = { preventDefault: vi.fn() };
    handlers['will-attach-webview'](event, prefs, params);
    if (!event.preventDefault.mock.calls.length) all.push(g);
    await Promise.resolve();
    handlers['did-attach-webview']({}, g);
    return event;
  };
  return { security, attach, guest };
}

const web = (n) => ({ url: `https://site.example/${n}`, title: `Page ${n}` });

describe('trimHistory: what is kept of a back list', () => {
  const { security } = harness();
  it('nothing for a tab with one page, or for a list that is not one', () => {
    expect(security.trimHistory({ entries: [web(1)], index: 0 })).toBeNull();
    expect(security.trimHistory({ entries: [web(1), web(2)], index: 2 })).toBeNull();
    expect(security.trimHistory({ entries: 'x', index: 0 })).toBeNull();
    expect(security.trimHistory(null)).toBeNull();
  });

  it('an address and a short title per page, no page state', () => {
    const list = security.trimHistory({ entries: [{ ...web(1), pageState: 'A'.repeat(5000) }, { url: web(2).url, title: 'T'.repeat(500) }], index: 1 });
    expect(list).toEqual({ entries: [web(1), { url: web(2).url, title: 'T'.repeat(120) }], index: 1 });
  });

  it('only web pages and the New Tab page; the current page follows its entry', () => {
    const list = security.trimHistory({ entries: [{ url: START, title: 'New Tab' }, { url: 'file:///C:/Windows/win.ini' }, web(1),
      { url: 'chrome://settings' }, { url: 'data:text/html,x' }, web(2)], index: 5 });
    expect(list.entries.map(e => e.url)).toEqual([START, web(1).url, web(2).url]);
    expect(list.index).toBe(2);
    // On a reading-mode data: page, the tab keeps the real page as current.
    const reading = security.trimHistory({ entries: [web(1), web(2), { url: 'data:text/html,article' }], index: 2 });
    expect(reading).toEqual({ entries: [web(1), web(2)], index: 1 });
  });

  it('at most 12 pages: up to 4 forward, the rest back', () => {
    const entries = Array.from({ length: 40 }, (_, n) => web(n));
    const list = security.trimHistory({ entries, index: 30 });
    expect(list.entries).toHaveLength(12);
    expect(list.entries[list.index].url).toBe(web(30).url);
    expect(list.entries.at(-1).url).toBe(web(34).url);
    const atEnd = security.trimHistory({ entries, index: 39 });
    expect(atEnd.entries.map(e => e.url)).toEqual(entries.slice(28).map(e => e.url));
    expect(atEnd.index).toBe(11);
  });

  it('a long address is left out rather than saved', () => {
    const list = security.trimHistory({ entries: [{ url: 'https://login.example/?state=' + 'x'.repeat(3000) }, web(1), web(2)], index: 2 });
    expect(list.entries.map(e => e.url)).toEqual([web(1).url, web(2).url]);
  });
});

describe('a tab built again takes the list it carried', () => {
  it('restores it on the new page, which then loads nothing else', async () => {
    const h = harness();
    expect(h.security.carryHistory(1, 'c1', 'persist:main', { entries: [web(1), web(2), web(3)], index: 1 })).toBe(true);
    const g = h.guest();
    const prefs = { vexHistoryFrom: 'c1' };
    const params = { partition: 'persist:main', src: web(2).url };
    await h.attach(prefs, g, params);
    expect(prefs.vexHistoryFrom).toBeUndefined();
    expect(g.navigationHistory.restore).toHaveBeenCalledWith({ index: 1, entries: [web(1), web(2), web(3)] });
    // The restore loads page 2 itself; a second load of it went after the
    // restored pages and cut off page 3.
    expect(params.src).toBe('');
  });

  it('built for another address, that page still loads after the restored ones', async () => {
    const h = harness();
    h.security.carryHistory(1, 'c1', 'persist:main', { entries: [web(1), web(2)], index: 1 });
    const g = h.guest();
    const params = { partition: 'persist:main', src: web(9).url };
    await h.attach({ vexHistoryFrom: 'c1' }, g, params);
    expect(g.navigationHistory.restore).toHaveBeenCalled();
    expect(params.src).toBe(web(9).url);
  });

  it('once, in its own session, and only a list main would keep', async () => {
    const h = harness();
    h.security.carryHistory(1, 'c1', 'persist:main', { entries: [web(1), web(2)], index: 1 });
    const other = h.guest({ partition: 'persist:work' });
    const params = { partition: 'persist:work', src: web(2).url };
    await h.attach({ vexHistoryFrom: 'c1' }, other, params);
    expect(other.navigationHistory.restore).not.toHaveBeenCalled();
    expect(params.src).toBe(web(2).url);
    const again = h.guest();
    await h.attach({ vexHistoryFrom: 'c1' }, again, { partition: 'persist:main', src: web(2).url });
    expect(again.navigationHistory.restore).not.toHaveBeenCalled();

    // Edited by hand in the saved file: pages it cannot go back to are dropped.
    expect(h.security.carryHistory(1, 'c2', 'persist:main', { entries: [{ url: 'file:///C:/secret.txt' }, web(1)], index: 1 })).toBe(false);
    expect(() => h.security.carryHistory(1, 'x', 'persist:main', { entries: [web(1), web(2)], index: 1 })).toThrow('Invalid history token');
  });

  it('a JavaScript-off tab built again still takes its old page\'s list (unchanged)', async () => {
    const h = harness();
    const g = h.guest();
    const params = { partition: 'persist:main', src: web(5).url };
    await h.attach({ vexHistoryFrom: '77' }, g, params);
    expect(g.navigationHistory.restore).not.toHaveBeenCalled();   // no such page noted
    expect(params.src).toBe(web(5).url);
  });

  it('readHistory reads a page\'s list the same way', () => {
    const h = harness();
    const g = h.guest({ entries: [web(1), web(2)], index: 0 });
    expect(h.security.readHistory(g)).toEqual({ entries: [web(1), web(2)], index: 0 });
  });
});

describe('wiring', () => {
  const MAIN = fs.readFileSync(path.resolve('src/main.js'), 'utf8');
  const PRELOAD = fs.readFileSync(path.resolve('src/preload.js'), 'utf8');
  const POLICY = fs.readFileSync(path.resolve('src/main/ipc-policy.js'), 'utf8');
  it('has channels with schemas, and reading a page is limited to the window\'s own', () => {
    expect(MAIN).toContain("ipcMain.handle('tabs:history',");
    expect(MAIN).toContain("ipcMain.on('tabs:carry-history',");
    expect(PRELOAD).toContain("ipcRenderer.invoke('tabs:history', pageId)");
    expect(PRELOAD).toContain("ipcRenderer.send('tabs:carry-history', token, partition, list)");
    expect(POLICY).toMatch(/TARGET_CHANNELS = new Set\([\s\S]*'tabs:history'[\s\S]*?\]\);/);
    expect(() => validate('tabs:history', [12])).not.toThrow();
    expect(() => validate('tabs:history', ['12'])).toThrow();
    expect(() => validate('tabs:carry-history', ['c3', 'persist:main', { entries: [web(1), web(2)], index: 1 }])).not.toThrow();
    expect(() => validate('tabs:carry-history', ['3', 'persist:main', { entries: [web(1)], index: 0 }])).toThrow();
    expect(() => validate('tabs:carry-history', ['c3', 'persist:main', { entries: Array(51).fill(web(1)), index: 0 }])).toThrow();
  });
});
