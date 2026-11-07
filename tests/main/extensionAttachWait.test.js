// A tab an extension has just opened has no address until its first page commits (getURL() is '' then, measured on Electron 42): attach
// waits for it, bounded, instead of answering "Cannot access a chrome:// URL" (2026-11-07). Pure logic, a fake clock and fake pages.
import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const { createExtensionDebugger, describeUrl } = createRequire(import.meta.url)('../../src/main/extension-debugger.js');

function fakePage(id, state) {
  const dbg = new EventEmitter();
  dbg.attachedBy = null;
  dbg.isAttached = () => dbg.attachedBy !== null;
  dbg.attach = (v) => { dbg.attachedBy = v; };
  dbg.detach = () => { dbg.attachedBy = null; };
  return { id, debugger: dbg, state, getURL: () => state.url, isLoading: () => !!state.loading, isDestroyed: () => !!state.destroyed };
}

const ses = { name: 'persist:main' };
const who = { ses, key: 'persist:main|ext1', extId: 'ext1', folder: 'claude-1' };
let pages, clock, logs, waits, onWait, d;
beforeEach(() => {
  pages = new Map(); clock = 0; logs = []; waits = 0; onWait = () => {};
  d = createExtensionDebugger({
    pageOf: (s, id) => (s === ses ? pages.get(id) || null : null),
    usable: (p) => !p.isDestroyed() && !p.state.private && /^https?:\/\//i.test(p.getURL()),
    pending: (p) => !p.isDestroyed() && !p.state.private && /^(?:about:blank)?$/i.test(p.getURL()),
    allowed: () => true,
    emit: () => {},
    log: (line) => logs.push(line),
    now: () => clock,
    wait: async (ms) => { waits++; clock += ms; onWait(); },
  });
});
const add = (id, state) => { pages.set(id, fakePage(id, state)); return pages.get(id); };

describe('attachWhenReady', () => {
  it('attaches at once to a page that is already http(s), without waiting', async () => {
    const p = add(1, { url: 'https://github.com/someone' });
    await d.attachWhenReady({ ...who, tabId: 1 });
    expect(p.debugger.attachedBy).toBe('1.3');
    expect(waits).toBe(0);
  });
  it('waits while the first page has not committed (empty address), then attaches', async () => {
    const st = { url: '', loading: true };
    const p = add(2, st);
    onWait = () => { if (waits === 3) st.url = 'https://github.com/someone'; };
    await d.attachWhenReady({ ...who, tabId: 2 });
    expect(waits).toBe(3);
    expect(p.debugger.attachedBy).toBe('1.3');
  });
  it('waits through about:blank on its way to https', async () => {
    const st = { url: 'about:blank', loading: true };
    const p = add(3, st);
    onWait = () => { if (waits === 2) st.url = 'https://github.com/x'; };
    await d.attachWhenReady({ ...who, tabId: 3 });
    expect(p.debugger.isAttached()).toBe(true);
  });
  it('gives up after the time limit, with the message Chrome gives, and says why in the log', async () => {
    const p = add(4, { url: '', loading: true });
    await expect(d.attachWhenReady({ ...who, tabId: 4 }, { timeoutMs: 1000, pollMs: 100 })).rejects.toThrow('Cannot access a chrome:// URL');
    expect(waits).toBe(10);
    expect(p.debugger.isAttached()).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/tab 4/);
    expect(logs[0]).toMatch(/no address yet/);
    expect(logs[0]).toMatch(/still loading/);
  });
  it.each([
    ['a Vex page', 'vex://settings/'],
    ['a file', 'file:///C:/x.html'],
    ['an extension page', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/page.html'],
  ])('refuses %s at once, without waiting', async (_n, url) => {
    add(5, { url });
    await expect(d.attachWhenReady({ ...who, tabId: 5 })).rejects.toThrow('Cannot access a chrome:// URL');
    expect(waits).toBe(0);
  });
  it('refuses a private page at once even when it has no address yet', async () => {
    add(6, { url: '', private: true });
    await expect(d.attachWhenReady({ ...who, tabId: 6 })).rejects.toThrow('Cannot access a chrome:// URL');
    expect(waits).toBe(0);
  });
  it('refuses a destroyed page and a missing tab in words, without waiting', async () => {
    add(7, { url: '', destroyed: true });
    await expect(d.attachWhenReady({ ...who, tabId: 7 })).rejects.toThrow('Cannot access a chrome:// URL');
    await expect(d.attachWhenReady({ ...who, tabId: 99 })).rejects.toThrow('No tab with id: 99.');
    expect(waits).toBe(0);
    expect(logs[0]).toMatch(/the tab is gone/);
  });
  it('still needs the switch: a tab that is not allowed is never waited for', async () => {
    const off = createExtensionDebugger({ pageOf: () => fakePage(1, { url: '' }), usable: () => false, pending: () => true, allowed: () => false, emit: () => {}, wait: async () => { waits++; } });
    await expect(off.attachWhenReady({ ...who, tabId: 1 })).rejects.toThrow(/Allow it to control other tabs/);
    expect(waits).toBe(0);
  });
  it('the old synchronous attach keeps refusing an empty page at once', () => {
    add(8, { url: '' });
    expect(() => d.attach({ ...who, tabId: 8 })).toThrow('Cannot access a chrome:// URL');
  });
});

describe('what the log says about a refused page', () => {
  it('names the scheme and host, never the path, query or fragment', () => {
    expect(describeUrl('vex://settings/privacy?token=secret#x')).toBe('vex://settings');
    expect(describeUrl('file:///C:/Users/me/secret.html')).toBe('file:');
    expect(describeUrl('https://user:pw@github.com/me/repo?tab=1')).toBe('https://github.com');
    expect(describeUrl('')).toMatch(/no address yet/);
    expect(describeUrl('not a url')).toBe('an address that is not a URL');
  });
  it('a refusal line has no path or query of the page', () => {
    add(9, { url: 'file:///C:/Users/me/secret.html?x=1' });
    expect(() => d.attach({ ...who, tabId: 9 })).toThrow();
    expect(logs[0]).toContain('tab 9');
    expect(logs[0]).not.toMatch(/secret|Users|x=1/);
  });
});
