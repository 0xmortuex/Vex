// @vitest-environment jsdom
//
// Regression test for the "paste twice" bug: opening a new tab then pasting
// into the address bar made the pasted text vanish, forcing a second paste.
//
// Root cause: async webview load events (did-navigate / did-stop-loading / etc.)
// re-ran TabManager.updateUrlBar() AFTER the user had focused + pasted into the
// start-page bar, and updateUrlBar unconditionally blanked the start-page input.
//
// Fix: updateUrlBar() bails out when #url-input is the activeElement (the user
// is mid-edit), and a blur handler re-syncs the bar to the real URL once editing
// ends. These tests exercise updateUrlBar's guard directly and simulate the
// blur re-sync exactly as the app.js handler does (call updateUrlBar on blur).

import { describe, it, expect, vi, beforeEach } from 'vitest';

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs:   vi.fn(async () => []),
    saveTabs:   vi.fn(async () => true),
    loadGroups: vi.fn(async () => []),
    saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []),
    saveStacks: vi.fn(async () => true),
  };
  globalThis.WebviewManager = { destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: new Map() };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  if (!globalThis.window.vex) globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}

async function loadTabManager() {
  vi.resetModules();
  const mod = await import('../../src/renderer/js/tabs.js');
  return mod;
}

beforeEach(() => {
  document.body.innerHTML = `<input id="url-input" placeholder="Search or enter URL...">`;
  installGlobals();
});

// Mirror of the app.js blur handler: on blur, re-sync the bar to the real URL.
function blurAndResync(TabManager, tab) {
  const urlInput = document.getElementById('url-input');
  urlInput.blur(); // activeElement is no longer the input
  if (tab) TabManager.updateUrlBar(tab);
}

describe('url bar — paste guard (new-tab paste bug)', () => {
  it('(a) start-page bar: a late updateUrlBar must NOT wipe the user paste while focused', async () => {
    const { TabManager } = await loadTabManager();
    const urlInput = document.getElementById('url-input');
    const startTab = { url: 'vex://start' };

    // New tab activates -> bar focused (Chrome/Edge behavior).
    urlInput.focus();
    expect(document.activeElement).toBe(urlInput);

    // User pastes once.
    urlInput.value = 'github.com/anthropics';

    // Async webview load events for the still-loading start page now fire,
    // each routing through updateUrlBar. WITHOUT the guard this blanked the bar.
    TabManager.updateUrlBar(startTab);
    TabManager.updateUrlBar(startTab); // did-navigate + did-stop-loading, etc.

    // Paste survives on the FIRST paste now.
    expect(urlInput.value).toBe('github.com/anthropics');
  });

  it('(b) after paste, leaving the bar re-syncs to the real active-tab state (no stale text)', async () => {
    const { TabManager } = await loadTabManager();
    const urlInput = document.getElementById('url-input');
    const startTab = { url: 'vex://start' };

    urlInput.focus();
    urlInput.value = 'half-typed search that was never submitted';

    // Guard holds while focused.
    TabManager.updateUrlBar(startTab);
    expect(urlInput.value).toBe('half-typed search that was never submitted');

    // User clicks away without pressing Enter -> blur re-sync runs.
    blurAndResync(TabManager, startTab);

    // Start page -> bar correctly cleared to placeholder state, not stale text.
    expect(urlInput.value).toBe('');
    expect(urlInput.placeholder).toBe('Search or enter URL...');
  });

  it('(c) loaded page: focus then blur shows the REAL url (guard does not freeze the value)', async () => {
    const { TabManager } = await loadTabManager();
    const urlInput = document.getElementById('url-input');
    const liveTab = { url: 'https://example.com/page' };

    // Bar initially shows the real URL.
    TabManager.updateUrlBar(liveTab);
    expect(urlInput.value).toBe('https://example.com/page');

    // User focuses and starts editing; guard suppresses background repaints.
    urlInput.focus();
    urlInput.value = 'typing something else';
    TabManager.updateUrlBar(liveTab); // background did-navigate repaint — suppressed
    expect(urlInput.value).toBe('typing something else');

    // User blurs without navigating -> re-sync restores the REAL url.
    blurAndResync(TabManager, liveTab);
    expect(urlInput.value).toBe('https://example.com/page');
  });

  it('(d) navigation display path still works when the bar is NOT focused', async () => {
    const { TabManager } = await loadTabManager();
    const urlInput = document.getElementById('url-input');

    // Not focused: a normal did-navigate repaint must update the displayed URL.
    expect(document.activeElement).not.toBe(urlInput);
    TabManager.updateUrlBar({ url: 'https://nav.example/after' });
    expect(urlInput.value).toBe('https://nav.example/after');
  });
});
