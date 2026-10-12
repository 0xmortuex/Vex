// @vitest-environment jsdom
//
// A search engine of your own (owner, 2026-10-11): Settings › General ›
// Default search engine › Add your own… takes a name and an address with %s.
// It becomes the default for the address bar, Ctrl+K and the New Tab box
// (all through VexTypedAddress), can be edited and removed (removing the
// default goes back to the built-in engine chosen before, with a toast), asks
// no one for suggestions, and Reset to Defaults clears it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

window.VexTlds = require('../../src/renderer/js/tld-list.js');
window.SearchShortcuts = require('../../src/renderer/js/search-shortcuts.js').SearchShortcuts;
const TA = require('../../src/renderer/js/typed-address.js');
globalThis.VexTypedAddress = TA;
const { CustomSearchEngineUI: UI } = require('../../src/renderer/js/search-engine-custom.js');

const OWN = { name: 'Kagi', q: 'https://kagi.com/search?q=%s' };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `
    <select id="setting-search-engine">
      <option value="google">Google</option><option value="duckduckgo">DuckDuckGo</option><option value="bing">Bing</option>
    </select>
    <div id="setting-search-own" hidden><span data-own-name></span><span data-own-url></span>
      <button data-own-edit>Edit</button><button data-own-remove>Remove</button></div>`;
  window.showToast = vi.fn();
  globalThis.WebviewManager = { webviews: new Map() };
  globalThis._isTrustedStartPage = (u) => /start\.html/.test(u);
  // What app.js does when the list changes: keep the choice.
  document.getElementById('setting-search-engine').addEventListener('change', (e) => {
    if (e.target.value !== UI.ADD) localStorage.setItem('vex.searchEngine', e.target.value);
  });
});

const answers = (...list) => { window.vexPrompt = vi.fn(async () => list.shift()); };

describe('what an engine of your own may be', () => {
  it('takes a name and an http(s) address with %s', () => {
    expect(TA.checkCustomEngine({ name: '  Kagi ', q: ' https://kagi.com/search?q=%s ' })).toEqual(OWN);
    expect(TA.checkCustomEngine({ name: 'Intranet', q: 'http://wiki.corp/find?term=%s&lang=en' }).q).toBe('http://wiki.corp/find?term=%s&lang=en');
  });

  it('refuses javascript:, data:, file:, other schemes, no %s, no name', () => {
    expect(() => TA.checkCustomEngine({ name: 'x', q: 'javascript:alert(%s)' })).toThrow(/web address.*not a javascript: address/);
    expect(() => TA.checkCustomEngine({ name: 'x', q: 'data:text/html,%s' })).toThrow(/not a data: address/);
    expect(() => TA.checkCustomEngine({ name: 'x', q: 'file:///C:/x?%s' })).toThrow(/not a file: address/);
    expect(() => TA.checkCustomEngine({ name: 'x', q: 'ftp://x.example/%s' })).toThrow(/must start with https/);
    expect(() => TA.checkCustomEngine({ name: 'x', q: 'https://x.example/search' })).toThrow(/Put %s/);
    expect(() => TA.checkCustomEngine({ name: ' ', q: OWN.q })).toThrow(/name/);
    expect(() => TA.checkCustomEngine({ name: 'x', q: 'https://x .example/?q=%s' })).toThrow(/no spaces/);
  });
});

describe('searching with it', () => {
  beforeEach(() => {
    localStorage.setItem(TA.CUSTOM_KEY, JSON.stringify({ ...OWN, previous: 'duckduckgo' }));
    localStorage.setItem('vex.searchEngine', TA.CUSTOM_ID);
  });

  it('is the engine of the address bar, Ctrl+K and the New Tab box (one resolve)', () => {
    expect(TA.currentEngine()).toBe('custom');
    expect(TA.searchUrl('cats & dogs')).toBe('https://kagi.com/search?q=cats%20%26%20dogs');
    expect(TA.resolve('cats')).toEqual({ kind: 'search', url: 'https://kagi.com/search?q=cats', name: 'Kagi', query: 'cats' });
    expect(TA.engineInfo().name).toBe('Kagi');
  });

  it('fills every %s', () => {
    localStorage.setItem(TA.CUSTOM_KEY, JSON.stringify({ name: 'Two', q: 'https://x.example/?a=%s&b=%s' }));
    expect(TA.searchUrl('hi')).toBe('https://x.example/?a=hi&b=hi');
  });

  it('asks nobody for suggestions, Google least of all', () => {
    expect(TA.suggestUrl('cats', 'custom')).toBeNull();
    const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(main).toMatch(/if \(chosen === _typedAddress\.CUSTOM_ID\) return \[\];\s+const engine = _typedAddress\.engineOf\(chosen\);/);
  });

  it('a stored engine that is no longer valid is not used (Google instead), and says why', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(TA.CUSTOM_KEY, JSON.stringify({ name: 'Bad', q: 'javascript:%s' }));
    expect(TA.currentEngine()).toBe('google');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('hands the New Tab page the engine and its name and address', () => {
    expect(TA.startPageEngineJs()).toBe('window.__vexSetEngine ? window.__vexSetEngine("custom", {"name":"Kagi","q":"https://kagi.com/search?q=%s"}) : false');
  });
});

describe('Settings › General', () => {
  it('lists "Add your own…", and adding makes it the default', async () => {
    localStorage.setItem('vex.searchEngine', 'bing');
    UI.init();
    const sel = document.getElementById('setting-search-engine');
    expect([...sel.options].map(o => o.textContent)).toEqual(['Google', 'DuckDuckGo', 'Bing', 'Add your own…']);
    answers('Kagi', 'https://kagi.com/search?q=%s');
    expect(await UI.add('bing')).toBe(true);
    expect(TA.currentEngine()).toBe('custom');
    expect(JSON.parse(localStorage.getItem(TA.CUSTOM_KEY))).toEqual({ ...OWN, previous: 'bing' });
    expect([...sel.options].map(o => o.textContent)).toEqual(['Google', 'DuckDuckGo', 'Bing', 'Kagi']);
    expect(sel.value).toBe('custom');
    expect(document.getElementById('setting-search-own').hidden).toBe(false);
    expect(document.querySelector('[data-own-url]').textContent).toBe(OWN.q);
  });

  it('asks again, saying why, when the address is wrong; Cancel keeps the engine you had', async () => {
    localStorage.setItem('vex.searchEngine', 'bing');
    UI.init();
    answers('Mine', 'javascript:alert(%s)', 'Mine', null);
    expect(await UI.add('bing')).toBe(false);
    expect(window.vexPrompt.mock.calls[2][0].message).toMatch(/^A search engine’s address must be a web address/);
    expect(localStorage.getItem(TA.CUSTOM_KEY)).toBeNull();
    expect(TA.currentEngine()).toBe('bing');
    expect(document.getElementById('setting-search-engine').value).toBe('bing');
  });

  it('can be edited', async () => {
    localStorage.setItem(TA.CUSTOM_KEY, JSON.stringify({ ...OWN, previous: 'bing' }));
    localStorage.setItem('vex.searchEngine', 'custom');
    UI.init();
    answers('Kagi Pro', 'https://kagi.com/search?q=%s&pro=1');
    expect(await UI.edit()).toBe(true);
    expect(TA.customEngine()).toEqual({ name: 'Kagi Pro', q: 'https://kagi.com/search?q=%s&pro=1', previous: 'bing' });
    expect(TA.currentEngine()).toBe('custom');
    expect(document.querySelector('#setting-search-engine option[value="custom"]').textContent).toBe('Kagi Pro');
  });

  it('removing the default goes back to the built-in engine chosen before, and says so', () => {
    localStorage.setItem(TA.CUSTOM_KEY, JSON.stringify({ ...OWN, previous: 'duckduckgo' }));
    localStorage.setItem('vex.searchEngine', 'custom');
    UI.init();
    document.querySelector('[data-own-remove]').click();
    expect(localStorage.getItem(TA.CUSTOM_KEY)).toBeNull();
    expect(TA.currentEngine()).toBe('duckduckgo');
    expect(document.getElementById('setting-search-engine').value).toBe('duckduckgo');
    expect(window.showToast).toHaveBeenCalledWith('Removed Kagi — searching with DuckDuckGo again');
    expect(document.getElementById('setting-search-own').hidden).toBe(true);
  });

  it('tells every open New Tab page', () => {
    const run = vi.fn(async () => true);
    WebviewManager.webviews.set('a', { getURL: () => 'file:///x/renderer/start.html', executeJavaScript: run });
    WebviewManager.webviews.set('b', { getURL: () => 'https://example.com/', executeJavaScript: vi.fn() });
    localStorage.setItem(TA.CUSTOM_KEY, JSON.stringify(OWN));
    localStorage.setItem('vex.searchEngine', 'custom');
    UI.pushStartPages();
    expect(run).toHaveBeenCalledWith(TA.startPageEngineJs());
    expect(WebviewManager.webviews.get('b').executeJavaScript).not.toHaveBeenCalled();
  });

  it('Reset to Defaults clears it, and the settings list and the New Tab page accept it', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
    expect(app).toMatch(/SETTINGS_PREF_KEYS = \[[\s\S]*'vex\.customSearchEngine',[\s\S]*?\];/);
    expect(app).toMatch(/VexTypedAddress\.engineOf\(id\) !== id/);
    const wv = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/webview.js'), 'utf8');
    expect(wv).toMatch(/VexTypedAddress\.engineOf\(cmd\.id\) === cmd\.id/);
  });
});
