// @vitest-environment jsdom
//
// Web suggestions are fetched by main over Vex's own route, so a site
// routed through Tor or a proxy never asks for them (suggestRoute.test.js).
// A container tab still did, a Tor container included: typed in its address
// bar or on the New Tab page inside it, what you typed went out directly
// (found 2026-10-11). A container with a route of its own is skipped the same
// way; an ordinary one, which goes the way Vex's own route goes, is not.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/data-contracts.js');
window.VexTypedAddress = require('../../src/renderer/js/typed-address.js');
const { SmartSearchbar } = require('../../src/renderer/js/smart-searchbar.js');
const routing = require('../../src/main/routing.js');

let input;
beforeAll(() => {
  window.escapeHtml = (s) => String(s);
  document.body.innerHTML = '<div id="url-bar-wrapper"><input id="url-input"></div>';
  input = document.getElementById('url-input');
  SmartSearchbar.init(input, {});
  window.vex = { routingGet: vi.fn(async (p) => (p === 'persist:container-secret' ? { mode: 'tor' } : { mode: 'direct' })) };
  require('../../src/renderer/js/tab-policy.js');
});
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  globalThis.isStartPage = () => false;
  window.vex.webSuggest = vi.fn(async () => []);
});
afterEach(() => { vi.useRealTimers(); });

function typeIn(partition, text) {
  const tab = { id: 't1', url: 'https://a.example/', partition };
  globalThis.TabManager = { tabs: [tab], activeTabId: 't1', getActiveTab: () => tab };
  input.value = text;
  input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
  vi.advanceTimersByTime(500);
}

describe('web suggestions in container tabs', () => {
  it('not from a Tor container', () => {
    typeIn('persist:container-tor-kq3z', 'secret plans');
    expect(window.vex.webSuggest).not.toHaveBeenCalled();
  });
  it('not from a container routed its own way, and from an ordinary one once main has said it is direct', async () => {
    window.VexTabPolicy.isRouted('persist:container-work');
    window.VexTabPolicy.isRouted('persist:container-secret');
    await vi.runAllTimersAsync();
    typeIn('persist:container-secret', 'routed container plans');
    expect(window.vex.webSuggest).not.toHaveBeenCalled();
    typeIn('persist:container-work', 'weather');
    expect(window.vex.webSuggest).toHaveBeenCalledWith('weather');
  });
});

describe('main asks for a New Tab page only from a session without a route of its own', () => {
  it('knows which sessions have one', () => {
    const routes = { 'persist:container-work': { mode: 'proxy', custom: 'socks5://127.0.0.1:1080' }, 'persist:container-shopping': { mode: 'direct' }, __all__: { mode: 'tor' } };
    expect(routing.hasOwnRoute(routes, 'persist:container-work')).toBe(true);
    expect(routing.hasOwnRoute(routes, 'persist:container-shopping')).toBe(false);
    expect(routing.hasOwnRoute(routes, 'persist:main')).toBe(false);
  });
  it('web-suggest checks it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    const fn = src.slice(src.indexOf('function _suggestAllowedFrom'), src.indexOf('const _suggestCache'));
    expect(fn).toMatch(/hasOwnRoute\(readRouting\(\), partition\)/);
  });
});
