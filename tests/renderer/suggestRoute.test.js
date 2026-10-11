// @vitest-environment jsdom
//
// Web suggestions are fetched by main over Vex's own route. Typed in the
// address bar of a tab routed through a proxy (or on the New Tab page inside
// one), what you typed went out directly, outside that tab's route (found
// 2026-10-10). They are not asked for from such a tab at all.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
require('../../src/renderer/js/vex-utils.js');
window.VexTypedAddress = require('../../src/renderer/js/typed-address.js');
const { SmartSearchbar } = require('../../src/renderer/js/smart-searchbar.js');

let input;
beforeAll(() => {
  window.escapeHtml = (s) => String(s);
  document.body.innerHTML = '<div id="url-bar-wrapper"><input id="url-input"></div>';
  input = document.getElementById('url-input');
  SmartSearchbar.init(input, {});
});
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  globalThis.isStartPage = () => false;
  window.vex = { webSuggest: vi.fn(async () => []) };
});
afterEach(() => { vi.useRealTimers(); });

function typeIn(partition, text) {
  const tab = { id: 't1', url: 'https://a.example/', partition };
  globalThis.TabManager = { tabs: [tab], activeTabId: 't1', getActiveTab: () => tab };
  input.value = text;
  input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
  vi.advanceTimersByTime(500);
}

describe('web suggestions follow the tab’s route', () => {
  it('asked from an ordinary tab', () => {
    typeIn('persist:main', 'weather');
    expect(window.vex.webSuggest).toHaveBeenCalledWith('weather');
  });
  it('not from a proxy-routed tab', () => {
    typeIn('persist:route-proxy-work', 'secret plans');
    expect(window.vex.webSuggest).not.toHaveBeenCalled();
  });
  it('not from a Tor-routed tab', () => {
    typeIn('persist:route-tor', 'secret plans');
    expect(window.vex.webSuggest).not.toHaveBeenCalled();
  });
  it('main refuses a page in any session but the ordinary browsing ones', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    const fn = src.slice(src.indexOf('function _suggestAllowedFrom'), src.indexOf('const _suggestCache'));
    expect(fn).toMatch(/BROWSING_SESSIONS\.find\(p => secureSessions\.fromPartition\(p\) === sender\.session\)/);
  });
});
