// @vitest-environment jsdom
//
// Settings › General: the Edit / Remove row of a search engine of your own was
// on screen with no engine of your own (its `hidden` lost to the row class's
// display: flex), so Edit only said "There is no search engine of your own to
// edit", and after Remove it stayed, showing the removed engine (release
// check, 2026-10-11).
import { describe, it, expect, vi, beforeEach } from 'vitest';

window.VexTlds = require('../../src/renderer/js/tld-list.js');
window.SearchShortcuts = require('../../src/renderer/js/search-shortcuts.js').SearchShortcuts;
const TA = require('../../src/renderer/js/typed-address.js');
globalThis.VexTypedAddress = TA;
const { CustomSearchEngineUI: UI } = require('../../src/renderer/js/search-engine-custom.js');

beforeEach(() => {
  localStorage.clear();
  // The row as index.html has it, with the app's own rule for its class.
  document.head.innerHTML = '<style>.setting-toggle-row { display: flex; }</style>';
  document.body.innerHTML = `
    <select id="setting-search-engine"><option value="google">Google</option><option value="duckduckgo">DuckDuckGo</option></select>
    <div id="setting-search-own" class="setting-toggle-row" hidden><span data-own-name></span><span data-own-url></span>
      <button data-own-edit>Edit</button><button data-own-remove>Remove</button></div>`;
  window.showToast = vi.fn();
  globalThis.WebviewManager = { webviews: new Map() };
  globalThis._isTrustedStartPage = () => false;
  document.getElementById('setting-search-engine').addEventListener('change', (e) => {
    if (e.target.value !== UI.ADD) localStorage.setItem('vex.searchEngine', e.target.value);
  });
});

// In Chromium the row class's display: flex beats the browser's own [hidden]
// rule, so `hidden` alone leaves it on screen (jsdom does not model that);
// only the row's own display: none takes it away.
const shown = () => document.getElementById('setting-search-own').style.display !== 'none';

describe('the Edit / Remove row', () => {
  it('is not shown without an engine of your own', () => {
    UI.init();
    expect(shown()).toBe(false);
  });

  it('shows with one, and goes away when it is removed', () => {
    localStorage.setItem(TA.CUSTOM_KEY, JSON.stringify({ name: 'Kagi', q: 'https://kagi.com/search?q=%s', previous: 'google' }));
    localStorage.setItem('vex.searchEngine', TA.CUSTOM_ID);
    UI.init();
    expect(shown()).toBe(true);
    UI.remove();
    expect(shown()).toBe(false);
    expect(localStorage.getItem('vex.searchEngine')).toBe('google');
  });
});
