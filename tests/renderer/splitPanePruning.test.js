// @vitest-environment jsdom
//
// Split-screen regressions.
//
// Reproduced in the real app before the fix: with a 2-way split, closing the
// tab shown in the right pane left SplitScreen.panes holding the dead id. The
// container stayed in .split-2 with a live webview on the left and a blank
// half on the right that nothing could repair — every later applySplit() laid
// the same dead pane out again.
//
// Also covered: handleTabClick, which existed but had no caller, so clicking a
// tab while split was on marked it active while its webview stayed
// display:none behind the panes.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let SplitScreen;

function makeWebview(id) {
  const wv = document.createElement('webview');
  wv.dataset.tabId = id;
  document.getElementById('webviews-container').appendChild(wv);
  return wv;
}

function installGlobals(tabIds) {
  const webviews = new Map();
  globalThis.TabManager = {
    tabs: tabIds.map(id => ({ id, url: `https://${id}.example/`, title: id })),
    activeTabId: tabIds[0],
    switchTab: vi.fn(),
    wakeTab: vi.fn(),
    _materializeTab: vi.fn(),
    _escapeHtml: (s) => String(s),
  };
  globalThis.WebviewManager = { webviews };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.window.showToast = vi.fn();
  for (const id of tabIds) webviews.set(id, makeWebview(id));
}

async function load() {
  vi.resetModules();
  const mod = await import('../../src/renderer/js/split.js');
  return mod.SplitScreen;
}

beforeEach(async () => {
  document.body.innerHTML = `
    <button id="btn-split"></button>
    <div id="webviews-container"><div id="split-divider"></div></div>
    <div class="split-url-bar" id="split-url-left"><span class="split-url-text"></span></div>
    <div class="split-url-bar" id="split-url-right"><span class="split-url-text"></span></div>
    <div id="split-picker"><div id="split-picker-content"></div></div>
  `;
  SplitScreen = await load();
});

function startSplit(ids) {
  SplitScreen.panes = ids.slice();
  SplitScreen.active = true;
  SplitScreen.applySplit();
}

describe('pruneClosedPanes', () => {
  it('drops a pane whose tab was closed and re-lays out the rest', () => {
    installGlobals(['a', 'b', 'c']);
    SplitScreen.init();
    startSplit(['a', 'b', 'c']);
    expect(document.querySelectorAll('webview.split-pane')).toHaveLength(3);

    // Close 'b' the way TabManager does: remove it from the tab list.
    TabManager.tabs = TabManager.tabs.filter(t => t.id !== 'b');
    WebviewManager.webviews.delete('b');

    expect(SplitScreen.pruneClosedPanes()).toBe(true);
    expect(SplitScreen.panes).toEqual(['a', 'c']);
    expect(SplitScreen.active).toBe(true);
    expect(document.getElementById('webviews-container').classList.contains('split-2')).toBe(true);
    expect(document.querySelectorAll('webview.split-pane')).toHaveLength(2);
  });

  it('leaves split mode entirely once fewer than 2 panes survive', () => {
    installGlobals(['a', 'b']);
    SplitScreen.init();
    startSplit(['a', 'b']);

    TabManager.tabs = TabManager.tabs.filter(t => t.id !== 'b');
    WebviewManager.webviews.delete('b');
    SplitScreen.pruneClosedPanes();

    expect(SplitScreen.active).toBe(false);
    expect(SplitScreen.panes).toEqual([]);
    const container = document.getElementById('webviews-container');
    expect(container.classList.contains('split-mode')).toBe(false);
    expect(container.style.gridTemplateColumns).toBe('');
    expect(document.querySelectorAll('webview.split-pane')).toHaveLength(0);
  });

  it('runs automatically on vex-tabs-changed', () => {
    installGlobals(['a', 'b', 'c']);
    SplitScreen.init();
    startSplit(['a', 'b', 'c']);

    TabManager.tabs = TabManager.tabs.filter(t => t.id !== 'c');
    WebviewManager.webviews.delete('c');
    window.dispatchEvent(new CustomEvent('vex-tabs-changed'));

    expect(SplitScreen.panes).toEqual(['a', 'b']);
  });

  it('is a no-op when split is off', () => {
    installGlobals(['a', 'b']);
    SplitScreen.init();
    expect(SplitScreen.pruneClosedPanes()).toBe(false);
  });

  it('is a no-op when every pane is still live', () => {
    installGlobals(['a', 'b']);
    SplitScreen.init();
    startSplit(['a', 'b']);
    expect(SplitScreen.pruneClosedPanes()).toBe(false);
    expect(SplitScreen.panes).toEqual(['a', 'b']);
  });
});

describe('applySplit', () => {
  it('never lays out a pane whose tab is gone', () => {
    installGlobals(['a', 'b', 'c']);
    SplitScreen.init();
    SplitScreen.active = true;
    SplitScreen.panes = ['a', 'ghost', 'c'];
    SplitScreen.applySplit();

    expect(SplitScreen.panes).toEqual(['a', 'c']);
    expect(document.querySelectorAll('webview.split-pane')).toHaveLength(2);
  });

  it('leaves split mode rather than painting a blank window with 1 pane', () => {
    // Reproduces the workspace-switch failure: closeAllTabs destroys both pane
    // tabs, then switchTab hands the new workspace's only tab to
    // handleTabClick, which reaches applySplit with a single pane. Returning
    // quietly left .split-mode.split-2 on the container with nothing marked
    // .split-pane — every webview display:none, a blank window.
    installGlobals(['a', 'b']);
    SplitScreen.init();
    startSplit(['a', 'b']);

    TabManager.tabs = [{ id: 'fresh', url: 'https://fresh.example/', title: 'fresh' }];
    WebviewManager.webviews.clear();
    WebviewManager.webviews.set('fresh', makeWebview('fresh'));
    SplitScreen.handleTabClick('fresh');

    expect(SplitScreen.active).toBe(false);
    const container = document.getElementById('webviews-container');
    expect(container.classList.contains('split-mode')).toBe(false);
    expect(container.className).toBe('');
  });

  it('places 4 panes in a 2x2 grid', () => {
    installGlobals(['a', 'b', 'c', 'd']);
    SplitScreen.init();
    startSplit(['a', 'b', 'c', 'd']);
    const cells = [...document.querySelectorAll('webview.split-pane')]
      .map(w => `${w.style.gridColumn}/${w.style.gridRow}`);
    expect(cells).toEqual(['1/1', '2/1', '1/2', '2/2']);
  });

  it('shows the mini URL bars only for a 2-way split', () => {
    installGlobals(['a', 'b', 'c']);
    SplitScreen.init();
    startSplit(['a', 'b']);
    expect(document.querySelectorAll('.split-url-bar.visible')).toHaveLength(2);

    startSplit(['a', 'b', 'c']);
    expect(document.querySelectorAll('.split-url-bar.visible')).toHaveLength(0);
  });
});

describe('handleTabClick', () => {
  it('swaps a newly activated tab into the last pane', () => {
    installGlobals(['a', 'b', 'c']);
    SplitScreen.init();
    startSplit(['a', 'b']);

    expect(SplitScreen.handleTabClick('c')).toBe(true);
    expect(SplitScreen.panes).toEqual(['a', 'c']);
    expect([...document.querySelectorAll('webview.split-pane')].map(w => w.dataset.tabId))
      .toEqual(['a', 'c']);
  });

  it('does nothing when the tab is already in a pane', () => {
    installGlobals(['a', 'b', 'c']);
    SplitScreen.init();
    startSplit(['a', 'b']);
    expect(SplitScreen.handleTabClick('b')).toBe(true);
    expect(SplitScreen.panes).toEqual(['a', 'b']);
  });

  it('refuses a tab that does not exist', () => {
    installGlobals(['a', 'b']);
    SplitScreen.init();
    startSplit(['a', 'b']);
    expect(SplitScreen.handleTabClick('ghost')).toBe(false);
    expect(SplitScreen.panes).toEqual(['a', 'b']);
  });

  it('reports false when split is off, so switchTab keeps its normal path', () => {
    installGlobals(['a', 'b']);
    SplitScreen.init();
    expect(SplitScreen.handleTabClick('b')).toBe(false);
  });
});

describe('deactivate', () => {
  it('clears the grid, the pane classes and the inline divider override', () => {
    installGlobals(['a', 'b', 'c']);
    SplitScreen.init();
    startSplit(['a', 'b', 'c']);          // 3-way hides the divider inline
    expect(document.getElementById('split-divider').style.display).toBe('none');

    SplitScreen.deactivate();

    const container = document.getElementById('webviews-container');
    expect(container.className).toBe('');
    expect(container.style.gridTemplateColumns).toBe('');
    expect(document.getElementById('split-divider').style.display).toBe('');
    expect(TabManager.switchTab).toHaveBeenCalledWith('a');
  });
});
