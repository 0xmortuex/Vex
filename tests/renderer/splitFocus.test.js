// @vitest-environment jsdom
//
// Split screen (found 2026-10-10):
//  - the toolbar (address bar, Back, Forward, Reload, Ctrl+W) always worked on
//    the first pane, whichever pane you clicked into: Reload reloaded the
//    other page and Ctrl+W closed the other tab. It follows the pane with the
//    focus now;
//  - a split came back as one tab after a restart. It is put back now.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let SplitScreen;

function installGlobals(tabIds) {
  const webviews = new Map();
  globalThis.TabManager = {
    tabs: tabIds.map(id => ({ id, url: `https://${id}.example/`, title: id })),
    activeTabId: tabIds[0],
    switchTab: vi.fn((id) => { TabManager.activeTabId = id; }),
    wakeTab: vi.fn(),
    _materializeTab: vi.fn(),
    _escapeHtml: (s) => String(s),
  };
  globalThis.WebviewManager = { webviews };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  window.showToast = vi.fn();
  for (const id of tabIds) {
    const wv = document.createElement('webview');
    wv.tabIndex = 0;   // focusable in jsdom, as a real <webview> is
    document.getElementById('webviews-container').appendChild(wv);
    webviews.set(id, wv);
  }
}
async function load() { vi.resetModules(); return (await import('../../src/renderer/js/split.js')).SplitScreen; }

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = `
    <button id="btn-split"></button>
    <div id="webviews-container"><div id="split-divider"></div></div>
    <div class="split-url-bar" id="split-url-left"><span class="split-url-text"></span></div>
    <div class="split-url-bar" id="split-url-right"><span class="split-url-text"></span></div>
    <div id="split-picker"><div id="split-picker-content"></div></div>`;
  installGlobals(['a', 'b', 'c']);
  SplitScreen = await load();
});

describe('the toolbar follows the pane in use', () => {
  it('clicking into the second pane puts its tab in front, leaving the focus in the page', () => {
    SplitScreen.restore(['a', 'b'], 0.5);
    WebviewManager.webviews.get('b').focus();
    expect(TabManager.switchTab).toHaveBeenLastCalledWith('b', { keepFocus: true });
    expect(TabManager.activeTabId).toBe('b');
    WebviewManager.webviews.get('a').focus();
    expect(TabManager.activeTabId).toBe('a');
  });

  it('a page not in a pane does nothing', () => {
    SplitScreen.restore(['a', 'b'], 0.5);
    TabManager.switchTab.mockClear();
    WebviewManager.webviews.get('c').focus();
    expect(TabManager.switchTab).not.toHaveBeenCalled();
  });

  it('leaving the split keeps the pane in use in front', () => {
    SplitScreen.restore(['a', 'b'], 0.5);
    WebviewManager.webviews.get('b').focus();
    SplitScreen.deactivate();
    expect(TabManager.activeTabId).toBe('b');
  });
});

describe('the split comes back after a restart', () => {
  it('is saved while on and forgotten when turned off', () => {
    SplitScreen.restore(['a', 'b'], 0.3);
    expect(JSON.parse(localStorage.getItem('vex.splitLayout'))).toEqual({ tabIds: ['a', 'b'], ratio: 0.3 });
    SplitScreen.deactivate();
    expect(localStorage.getItem('vex.splitLayout')).toBeNull();
  });

  it('is put back at start with its first pane in front', async () => {
    localStorage.setItem('vex.splitLayout', JSON.stringify({ tabIds: ['c', 'a'], ratio: 0.6 }));
    SplitScreen = await load();
    expect(SplitScreen.restoreSaved()).toBe(true);
    expect(SplitScreen.active).toBe(true);
    expect(SplitScreen.panes).toEqual(['c', 'a']);
    expect(SplitScreen.splitRatio).toBe(0.6);
    expect(TabManager.activeTabId).toBe('c');
  });

  it('is dropped when its tabs are gone', async () => {
    localStorage.setItem('vex.splitLayout', JSON.stringify({ tabIds: ['gone', 'a'], ratio: 0.5 }));
    SplitScreen = await load();
    expect(SplitScreen.restoreSaved()).toBe(false);
    expect(localStorage.getItem('vex.splitLayout')).toBeNull();
  });

  it('app.js puts it back after the tabs', () => {
    const src = require('node:fs').readFileSync(require('node:path').resolve('src/renderer/js/app.js'), 'utf8');
    expect(src).toMatch(/await TabManager\.init\(\);[\s\S]{0,400}SplitScreen\.restoreSaved\(\)/);
  });
});
