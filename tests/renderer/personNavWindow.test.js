// @vitest-environment jsdom
//
// The window's half of "a page the person opened themselves may hand off to another program" (main/person-nav.js,
// tests/main/personNav.test.js). The window tells main only when a click or key press in Vex is behind the call, or
// when the caller knows the person did it (a link from another program, a link they clicked in a page). Found
// 2026-11-11: a Roblox invite link pasted into the address bar did nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');

require('../../src/renderer/js/vex-utils.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');

const src = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
function acting(on) { Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: on } }); }

describe('telling main', () => {
  let navigated, opening;
  beforeEach(() => {
    navigated = vi.fn(() => Promise.resolve(true));
    opening = vi.fn(() => Promise.resolve(true));
    window.vex = { tabPersonNavigated: navigated, tabPersonOpening: opening };
  });
  afterEach(() => { delete window.vex; delete navigator.userActivation; });

  it('a page sent somewhere with a key press or click in Vex behind it is named by its page id', () => {
    acting(true);
    WebviewManager.personNavigated({ getWebContentsId: () => 41 }, 'https://www.roblox.com/share?code=abc');
    expect(navigated).toHaveBeenCalledWith(41);
    expect(opening).not.toHaveBeenCalled();
  });
  it('nothing is said when Vex does it by itself (a restored session, a page watch, a timer)', () => {
    acting(false);
    WebviewManager.personNavigated({ getWebContentsId: () => 41 }, 'https://www.roblox.com/share?code=abc');
    WebviewManager.personOpening('https://www.roblox.com/share?code=abc');
    expect(navigated).not.toHaveBeenCalled();
    expect(opening).not.toHaveBeenCalled();
    delete navigator.userActivation;                    // a window with no such thing at all says nothing either
    expect(WebviewManager.personActing()).toBe(false);
  });
  it('a tab with no page in it yet: the address is expected instead', () => {
    acting(true);
    WebviewManager.personNavigated({ getWebContentsId: () => { throw new Error('The WebView must be attached to the DOM'); } }, 'https://www.roblox.com/share?code=abc');
    expect(navigated).not.toHaveBeenCalled();
    expect(opening).toHaveBeenCalledWith('https://www.roblox.com/share?code=abc');
  });
  it('a caller that knows the person did it needs no click in Vex; only web addresses are sent', () => {
    acting(false);
    WebviewManager.personOpening('https://www.roblox.com/share?code=abc', true);
    expect(opening).toHaveBeenCalledTimes(1);
    for (const u of ['roblox-player:1', 'file:///C:/x.html', 'vex://start', '', null, undefined]) WebviewManager.personOpening(u, true);
    expect(opening).toHaveBeenCalledTimes(1);
  });
  it('a refusal from main is a console line, never an uncaught rejection', async () => {
    acting(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.vex.tabPersonNavigated = () => Promise.reject(new Error('not this window\'s tab'));
    WebviewManager.personNavigated({ getWebContentsId: () => 41 });
    await Promise.resolve(); await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not tell main'), 'not this window\'s tab');
    warn.mockRestore();
  });
});

describe('where it is called from', () => {
  const WEBVIEW = src('renderer/js/webview.js');
  const TABS = src('renderer/js/tabs.js');
  const APP = src('renderer/js/app.js');
  const PRELOAD = src('preload.js');
  it('the address bar\'s navigation, before the page is asked to load', () => {
    const i = WEBVIEW.indexOf('  navigate(url, opts = {}) {');
    const body = WEBVIEW.slice(i, WEBVIEW.indexOf('  folderOriginal(url) {', i));
    expect(body.indexOf('this.personNavigated(wv, this.viewerAddress(url));')).toBeGreaterThan(-1);
    expect(body.indexOf('this.personNavigated(wv, this.viewerAddress(url));')).toBeLessThan(body.indexOf('const load = () => wv.loadURL('));
  });
  it('Reload', () => {
    const i = WEBVIEW.indexOf('  reload() {');
    expect(WEBVIEW.slice(i, i + 140)).toContain('this.personNavigated(wv);');
  });
  it('a new tab, with what its caller knows', () => {
    expect(TABS).toContain('window.WebviewManager.personOpening(resolvedUrl, !!(opts && opts.byPerson));');
    expect(APP).toContain('TabManager.createTab(link, true, null, { byPerson: true });');     // a link from another program
    expect(APP).toContain('byPerson: data.clicked === true }');                                // a link clicked in a page
  });
  it('the window can reach both channels', () => {
    expect(PRELOAD).toContain("tabPersonNavigated:   (pageId) => ipcRenderer.invoke('tabs:person-navigated', pageId),");
    expect(PRELOAD).toContain("tabPersonOpening:     (url) => ipcRenderer.invoke('tabs:person-opening', url),");
  });
});
