// @vitest-environment jsdom
//
// One answer for a typed line, in the address bar, Ctrl+K and the New Tab box
// (found 2026-10-10): keywords worked in the address bar only, Ctrl+K's
// Search opened a second tab beside the empty New Tab you were in, and a name
// typed without a scheme was tried over https only, so printer.lan or
// myapp.test:3000 with only http failed (Chrome tries http next).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const TA = require('../../src/renderer/js/typed-address.js');

describe('VexTypedAddress.resolve', () => {
  beforeEach(() => { localStorage.clear(); });
  it('an address typed without a scheme says https was guessed', () => {
    expect(TA.resolve('printer.lan')).toEqual({ kind: 'address', url: 'https://printer.lan', guessedHttps: true });
    expect(TA.resolve('https://example.com').guessedHttps).toBe(false);
    expect(TA.resolve('localhost:3000').guessedHttps).toBe(false);
  });
  it('a keyword, a keyword of your own, and plain words', () => {
    expect(TA.resolve('@yt cats')).toEqual({ kind: 'keyword', url: 'https://www.youtube.com/results?search_query=cats', name: 'YouTube', query: 'cats' });
    localStorage.setItem('vex.searchKeywords', JSON.stringify({ jira: 'https://my.jira/?q=%s' }));
    expect(TA.resolve('jira PROJ-1').url).toBe('https://my.jira/?q=PROJ-1');
    localStorage.setItem('vex.searchEngine', 'bing');
    expect(TA.resolve('hello world')).toEqual({ kind: 'search', url: 'https://www.bing.com/search?q=hello%20world', name: 'Bing', query: 'hello world' });
  });
  it('nothing typed is nothing', () => { expect(TA.resolve('  ')).toBe(null); });
});

describe('the New Tab box hands what was typed to the address bar', () => {
  it('sends the words, not an address it worked out itself', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/start.html'), 'utf8');
    expect(html).toMatch(/type: 'typed', query, newTab: !!newTab/);
    expect(html).not.toMatch(/TA\.addressFor\(query\) \|\| TA\.searchUrl\(query, engineId\)/);
  });
});

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function fakePage() {
  const p = { calls: [], _attached: true, addEventListener() {} };
  p.loadURL = (url) => new Promise((resolve, reject) => { p.calls.push(url); p.resolve = resolve; p.reject = reject; });
  return p;
}

describe('pages loaded from what was typed', () => {
  let TabManager, WebviewManager, CommandBar, page;
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<input id="url-input"><div id="command-bar"><div id="command-results"></div></div>';
    globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true), loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true), loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true) };
    globalThis.SidebarManager = { hideActivePanel: vi.fn() };
    window.showToast = vi.fn();
    if (!window.vex) window.vex = { getStartPageUrl: () => new Promise(() => {}) };
    delete globalThis.PrivacyPack;
    window.VexTypedAddress = TA;
    await import('../../src/renderer/js/vex-icons.js');
    await import('../../src/renderer/js/vex-utils.js');
    ({ TabManager } = await import('../../src/renderer/js/tabs.js'));
    ({ WebviewManager } = await import('../../src/renderer/js/webview.js'));
    ({ CommandBar } = await import('../../src/renderer/js/command.js'));
    globalThis.TabManager = TabManager;
    globalThis.WebviewManager = WebviewManager;
    TabManager.tabs = [{ id: 't1', url: 'https://old.example/', title: 'Old' }];
    TabManager.activeTabId = 't1';
    TabManager.persistTabs = vi.fn();
    TabManager.renderTabUpdate = vi.fn();
    page = fakePage();
    WebviewManager.webviews = new Map([['t1', page]]);
  });

  it('an https guess that fails to connect is tried over http', async () => {
    WebviewManager.navigate('https://printer.lan', { httpFallback: true });
    page.reject(new Error("ERR_SSL_PROTOCOL_ERROR (-107) loading 'https://printer.lan/'"));
    await flush();
    expect(page.calls).toEqual(['https://printer.lan', 'http://printer.lan']);
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('not for an address typed with https, nor with HTTPS-Only on', async () => {
    WebviewManager.navigate('https://printer.lan');
    page.reject(new Error('ERR_CONNECTION_REFUSED (-102)'));
    await flush();
    expect(page.calls).toEqual(['https://printer.lan']);
    globalThis.PrivacyPack = { cfg: { httpsOnly: true } };
    WebviewManager.navigate('https://nas.lan', { httpFallback: true });
    page.reject(new Error('ERR_CONNECTION_REFUSED (-102)'));
    await flush();
    expect(page.calls).toEqual(['https://printer.lan', 'https://nas.lan']);
  });

  it('nor for a page that is simply not there', async () => {
    WebviewManager.navigate('https://nowhere.example', { httpFallback: true });
    page.reject(new Error('ERR_NAME_NOT_RESOLVED (-105)'));
    await flush();
    expect(page.calls).toEqual(['https://nowhere.example']);
  });

  it('Ctrl+K searches a keyword where the address bar would, in the New Tab you are on', async () => {
    globalThis.isStartPage = (u) => u === 'vex://start';
    TabManager.tabs[0].url = 'vex://start';
    TabManager.createTab = vi.fn();
    const nav = vi.spyOn(WebviewManager, 'navigate').mockImplementation(() => {});
    CommandBar.search('@yt cats');
    const row = CommandBar.results.find(r => r.id === 'search');
    expect(row.hint).toBe('YouTube Search');
    row.action();
    expect(nav).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=cats');
    expect(TabManager.createTab).not.toHaveBeenCalled();
  });
});
