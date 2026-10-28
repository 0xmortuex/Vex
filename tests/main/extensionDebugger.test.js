// chrome.debugger for an extension (src/main/extension-debugger.js), 2026-10-28: the rules around handing an extension Electron's debugger.
import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const { createExtensionDebugger, DENIED } = createRequire(import.meta.url)('../../src/main/extension-debugger.js');

function fakePage(id, url = 'https://example.com/') {
  const dbg = new EventEmitter();
  dbg.attachedBy = null;
  dbg.sent = [];
  dbg.isAttached = () => dbg.attachedBy !== null;
  dbg.attach = (v) => { if (dbg.attachedBy) throw new Error('Debugger is already attached to the target.'); dbg.attachedBy = v; };
  dbg.detach = () => { dbg.attachedBy = null; dbg.emit('detach', {}, 'target closed'); };
  dbg.sendCommand = async (method, params, sessionId) => { dbg.sent.push([method, params, sessionId]); if (method === 'Bad.command') throw new Error('Bad.command wasn\'t found'); return { method, ok: true }; };
  return { id, debugger: dbg, getURL: () => url, getTitle: () => 'Title ' + id };
}

let pages, allow, told, changes, d;
const ses = { name: 'persist:main' };
const KEY = 'persist:main|ext1';
const who = { ses, key: KEY, extId: 'ext1', folder: 'claude-1' };
beforeEach(() => {
  pages = new Map([[6, fakePage(6)], [7, fakePage(7, 'file:///C:/x.html')], [8, fakePage(8, 'chrome-extension://abc/page.html')]]);
  allow = true; told = []; changes = [];
  d = createExtensionDebugger({
    pageOf: (s, id) => (s === ses ? pages.get(id) || null : null),
    usable: (p) => /^https?:/.test(p.getURL()),
    allowed: (folder) => allow && folder === 'claude-1',
    emit: (s, extId, type, args) => told.push([extId, type, args]),
    changed: (rows) => changes.push(rows),
    pagesOf: () => [...pages.values()],
  });
});

describe('the person\'s switch', () => {
  it('refuses an extension that was not allowed, in words that say where to allow it', () => {
    allow = false;
    expect(() => d.attach({ ...who, tabId: 6 })).toThrow(DENIED);
    expect(DENIED).toMatch(/Settings > Extensions/);
    expect(pages.get(6).debugger.isAttached()).toBe(false);
  });
  it('allows the one extension that was switched on, and not another', () => {
    expect(() => d.attach({ ...who, folder: 'other-2', tabId: 6 })).toThrow(DENIED);
    expect(d.attach({ ...who, tabId: 6 })).toBeUndefined();
  });
});

describe('what it may attach to', () => {
  it('a web page of the session, and not a tab that is not there', () => {
    d.attach({ ...who, tabId: 6, version: '1.3' });
    expect(pages.get(6).debugger.attachedBy).toBe('1.3');
    expect(() => d.attach({ ...who, tabId: 99 })).toThrow('No tab with id: 99.');
  });
  it('not a file page, nor an extension\'s own page (Chrome refuses chrome:// and other extensions\' pages)', () => {
    expect(() => d.attach({ ...who, tabId: 7 })).toThrow('Cannot access a chrome:// URL');
    expect(() => d.attach({ ...who, tabId: 8 })).toThrow('Cannot access a chrome:// URL');
  });
  it('not a tab another debugger (DevTools, another extension) holds, nor one it holds already', () => {
    pages.get(6).debugger.attachedBy = '1.3';
    expect(() => d.attach({ ...who, tabId: 6 })).toThrow('Another debugger is already attached to the tab with id: 6.');
    pages.get(6).debugger.attachedBy = null;
    d.attach({ ...who, tabId: 6 });
    expect(() => d.attach({ ...who, tabId: 6 })).toThrow('Another debugger is already attached to the tab with id: 6.');
  });
  it('another session never reaches it', () => {
    expect(() => d.attach({ ...who, ses: { name: 'persist:other' }, tabId: 6 })).toThrow('No tab with id: 6.');
  });
});

describe('commands and events', () => {
  it('sends a command and answers with what the page answered, passing the session id on', async () => {
    d.attach({ ...who, tabId: 6 });
    expect(await d.sendCommand({ key: KEY, tabId: 6, method: 'Runtime.evaluate', params: { expression: '1+1' } })).toEqual({ method: 'Runtime.evaluate', ok: true });
    await d.sendCommand({ key: KEY, tabId: 6, method: 'Page.enable', params: undefined, sessionId: 's1' });
    expect(pages.get(6).debugger.sent).toEqual([['Runtime.evaluate', { expression: '1+1' }, undefined], ['Page.enable', {}, 's1']]);
  });
  it('says so when the tab was never attached, and when the page refuses a command', async () => {
    await expect(d.sendCommand({ key: KEY, tabId: 6, method: 'Page.enable' })).rejects.toThrow('Debugger is not attached to the tab with id: 6.');
    d.attach({ ...who, tabId: 6 });
    await expect(d.sendCommand({ key: KEY, tabId: 6, method: 'Bad.command' })).rejects.toThrow('wasn\'t found');
    await expect(d.sendCommand({ key: KEY, tabId: 6, method: 'not a method' })).rejects.toThrow('Invalid debugger command');
  });
  it('another extension cannot send to a tab this one holds', async () => {
    d.attach({ ...who, tabId: 6 });
    await expect(d.sendCommand({ key: 'persist:main|ext2', tabId: 6, method: 'Page.enable' })).rejects.toThrow('not attached');
  });
  it('the page\'s events reach the extension that holds it, with the tab (and the session when there is one)', () => {
    d.attach({ ...who, tabId: 6 });
    pages.get(6).debugger.emit('message', {}, 'Runtime.consoleAPICalled', { type: 'log' });
    pages.get(6).debugger.emit('message', {}, 'Page.frameNavigated', { frame: {} }, 'sess9');
    expect(told).toEqual([
      ['ext1', 'debugger.onEvent', [{ tabId: 6 }, 'Runtime.consoleAPICalled', { type: 'log' }]],
      ['ext1', 'debugger.onEvent', [{ tabId: 6, sessionId: 'sess9' }, 'Page.frameNavigated', { frame: {} }]],
    ]);
  });
});

describe('detaching', () => {
  it('the extension detaching itself is silent, frees the tab and reports the change', () => {
    d.attach({ ...who, tabId: 6 });
    d.detach({ key: KEY, tabId: 6 });
    expect(pages.get(6).debugger.isAttached()).toBe(false);
    expect(told).toEqual([]);
    expect(d.rows()).toEqual([]);
    expect(changes.at(-1)).toEqual([]);
    expect(() => d.detach({ key: KEY, tabId: 6 })).toThrow('not attached');
  });
  it('the tab closing tells the extension "target_closed"', () => {
    d.attach({ ...who, tabId: 6 });
    pages.get(6).debugger.attachedBy = null;
    pages.get(6).debugger.emit('detach', {}, 'target closed');
    expect(told).toEqual([['ext1', 'debugger.onDetach', [{ tabId: 6 }, 'target_closed']]]);
    expect(d.rows()).toEqual([]);
  });
  it('DevTools taking the tab tells it "replaced_with_devtools"', () => {
    d.attach({ ...who, tabId: 6 });
    pages.get(6).debugger.emit('detach', {}, 'replaced with devtools');
    expect(told[0][2][1]).toBe('replaced_with_devtools');
  });
  it('the person pressing Stop (or switching it off) tells it "canceled_by_user" and frees the tab', () => {
    d.attach({ ...who, tabId: 6 });
    expect(d.stop({ tabId: 6, extId: 'ext1' })).toBe(1);
    expect(told).toEqual([['ext1', 'debugger.onDetach', [{ tabId: 6 }, 'canceled_by_user']]]);
    expect(pages.get(6).debugger.isAttached()).toBe(false);
    expect(d.stop({ extId: 'ext1' })).toBe(0);
  });
  it('stop by folder detaches every tab the extension holds', () => {
    pages.set(9, fakePage(9, 'https://b.test/'));
    d.attach({ ...who, tabId: 6 }); d.attach({ ...who, tabId: 9 });
    expect(d.stop({ folder: 'claude-1' })).toBe(2);
    expect(told.map(t => t[2][1])).toEqual(['canceled_by_user', 'canceled_by_user']);
  });
});

describe('what the window is told', () => {
  it('every attach and detach reports who holds which tab, so the bar can be drawn and removed', () => {
    d.attach({ ...who, tabId: 6 });
    expect(changes.at(-1)).toEqual([{ tabId: 6, extId: 'ext1', folder: 'claude-1' }]);
    d.stop({ tabId: 6 });
    expect(changes.at(-1)).toEqual([]);
  });
});

describe('getTargets', () => {
  it('lists the web tabs with whether each is attached, and leaves out the pages an extension may not debug', () => {
    d.attach({ ...who, tabId: 6 });
    expect(d.targets({ ses, key: KEY })).toEqual([{ type: 'page', id: '6', tabId: 6, title: 'Title 6', url: 'https://example.com/', faviconUrl: '', attached: true }]);
  });
});
