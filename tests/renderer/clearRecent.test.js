// @vitest-environment jsdom
// Clear the last 15 minutes / hour / day, and the clear-when-Vex-closes switch (js/clear-recent.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let C;
beforeEach(() => {
  localStorage.clear();
  delete globalThis.HistoryPanel;
  C = fresh('../../src/renderer/js/clear-recent.js').VexClearRecent;
});

describe('pure parts', () => {
  it('works out the start of each range', () => {
    expect(C.cutoff('15m', 1000000)).toBe(1000000 - 15 * 60000);
    expect(C.cutoff('1h', 1000000)).toBe(1000000 - 3600000);
    expect(C.cutoff('1d', 1000000)).toBe(1000000 - 86400000);
    expect(() => C.cutoff('week')).toThrow(/15 minutes/);
  });
  it('splits the closed tabs by the time they were closed', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    const list = [{ url: 'a', closedAt: '2026-11-01T11:55:00Z' }, { url: 'b', closedAt: '2026-11-01T09:00:00Z' }, { url: 'c' }];
    const s = C.splitClosed(list, now - 15 * 60000);
    expect(s.removed.map(e => e.url)).toEqual(['a']);
    expect(s.kept.map(e => e.url)).toEqual(['b', 'c']);
  });
  it('turns what you type into a bare host, or refuses', () => {
    expect(C.normalizeHost('https://www.Example.com/path?x=1')).toBe('example.com');
    expect(C.normalizeHost('bank.example.org')).toBe('bank.example.org');
    expect(() => C.normalizeHost('')).toThrow(/Type a site/);
    expect(() => C.normalizeHost('nodots')).toThrow(/not a site/);
  });
});

describe('the range clear', () => {
  it('asks the history to drop the range and trims the closed-tab list', async () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    localStorage.setItem('vex.recentlyClosed', JSON.stringify([{ url: 'a', closedAt: '2026-11-01T11:55:00Z' }, { url: 'b', closedAt: '2026-11-01T08:00:00Z' }]));
    globalThis.HistoryPanel = { deleteSince: vi.fn(async () => 3) };
    const r = await C.clear('15m', now);
    expect(r).toEqual({ visits: 3, closed: 1 });
    expect(globalThis.HistoryPanel.deleteSince).toHaveBeenCalledWith(now - 15 * 60000);
    expect(JSON.parse(localStorage.getItem('vex.recentlyClosed')).map(e => e.url)).toEqual(['b']);
  });
  it('says so when history is not there, and does not guess when the closed list is damaged', async () => {
    await expect(C.clear('1h')).rejects.toThrow(/not available/);
    globalThis.HistoryPanel = { deleteSince: vi.fn(async () => 0) };
    localStorage.setItem('vex.recentlyClosed', '{nope');
    await expect(C.clear('1h')).rejects.toThrow(/damaged/);
    expect(globalThis.HistoryPanel.deleteSince).not.toHaveBeenCalled();
  });
});

describe('the clear-when-closing switch and keep list', () => {
  it('is off until turned on, and stores the switch and the sites in one key', () => {
    expect(C.enabled()).toBe(false);
    expect(C.config()).toEqual({ on: false, keep: [] });
    C.setEnabled(true);
    C.addKeep('https://www.Bank.example.org/login');
    C.addKeep('bank.example.org');
    expect(JSON.parse(localStorage.getItem('vex.autoClear'))).toEqual({ on: true, keep: ['bank.example.org'] });
    C.removeKeep('bank.example.org');
    expect(C.config().keep).toEqual([]);
    expect(C.enabled()).toBe(true);
  });
  it('reports a damaged saved value instead of replacing it', () => {
    localStorage.setItem('vex.autoClear', '{nope');
    expect(() => C.config()).toThrow(/damaged/);
    expect(localStorage.getItem('vex.autoClear')).toBe('{nope');
  });
});

describe('HistoryPanel.deleteSince', () => {
  it('removes the visits since a time and tells Recall for pages no longer listed', async () => {
    vi.resetModules();
    window.escapeHtml = (s) => String(s == null ? '' : s);
    delete require.cache[require.resolve('../../src/renderer/js/history-panel.js')];
    localStorage.setItem('vex.history', JSON.stringify([
      { id: 'h1', url: 'https://a.example/1', title: 'A', visitedAt: '2026-11-01T11:58:00.000Z' },
      { id: 'h2', url: 'https://b.example/2', title: 'B', visitedAt: '2026-11-01T08:00:00.000Z' },
    ]));
    const H = require('../../src/renderer/js/history-panel.js').HistoryPanel;
    window.vex = { recallForget: vi.fn(async () => ({ ok: true })) };
    const n = await H.deleteSince(Date.parse('2026-11-01T11:45:00Z'));
    expect(n).toBe(1);
    expect(JSON.parse(localStorage.getItem('vex.history')).map(e => e.id)).toEqual(['h2']);
    expect(window.vex.recallForget).toHaveBeenCalledWith({ url: 'https://a.example/1' });
    expect(await H.deleteSince(Date.parse('2026-11-01T11:45:00Z'))).toBe(0);
  });
});

describe('wiring', () => {
  const fs = require('fs'), path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');
  it('is a late module with a Ctrl+K command and a Settings button, and no start-up script tag', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toMatch(/src: 'js\/clear-recent\.js', usage: \['clear-recent'\]/);
    expect(read('src/renderer/js/command.js')).toMatch(/\{ id: 'clear-recent', label: 'Clear Recent Browsing Data'/);
    expect(read('src/renderer/index.html')).not.toMatch(/clear-recent\.js/);
    expect(read('src/renderer/index.html')).toMatch(/id="setting-clear-recent"/);
    expect(read('src/renderer/js/app.js')).toMatch(/getElementById\('setting-clear-recent'\)/);
  });
});
