// @vitest-environment jsdom
//
// Regression tests for the tab/window bug sweep.
//
// Each describe block corresponds to a fault that was reproduced in the real
// app (Electron + CDP) before being fixed:
//   - "Pin Tab" from the tab context menu changed nothing on screen
//   - a pinned tab could sit in a stack and be drawn twice
//   - closeAllTabs (workspace switch) leaked stacks, expand state and the
//     pinned row into the next workspace
//   - renderTabUpdate never refreshed the audio / sleep / keep-awake badges
//   - collapsing a group in one strip left the other strip expanded
//   - SplitScreen kept panes pointing at closed tabs
//   - no emoji anywhere in the tab UI these files render

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Matches any emoji-range codepoint that would render as a colour glyph.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]/u;

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []),
    saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []),
    saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []),
    saveStacks: vi.fn(async () => true),
  };
  globalThis.WebviewManager = {
    destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: new Map(),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  globalThis.SplitScreen = undefined;
  if (!globalThis.window.vex) globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}

async function loadTabManager() {
  vi.resetModules();
  await import('../../src/renderer/js/vex-utils.js'); // installs window.escapeHtml
  const mod = await import('../../src/renderer/js/tabs.js');
  return mod.TabManager;
}

function fakeTab(id, over = {}) {
  return {
    id,
    url: `https://${id}.example/`,
    title: `Tab ${id}`,
    favicon: null,
    loading: false,
    pinned: false,
    unread: false,
    groupId: null,
    stackId: null,
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = `
    <input id="url-input">
    <div id="sidebar-wrap"><div id="tabs-list"></div></div>
    <div id="tab-groups-container"></div>
    <button id="btn-new-tab"></button>
  `;
});

// ===========================================================================
// "Pin Tab" in the tab context menu
// ===========================================================================
describe('tab context menu — Pin Tab', () => {
  async function openMenuFor(TM, tab) {
    TM.showContextMenu({ clientX: 10, clientY: 10, preventDefault() {} }, tab);
    return document.querySelector('.tab-context-menu');
  }

  it('actually renders the pinned row (not just flipping the flag)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    TM.activeTabId = 't1';
    TM.rebuildAllTabs();
    expect(document.querySelectorAll('.pinned-tabs-container .pinned-tab')).toHaveLength(0);

    const menu = await openMenuFor(TM, TM.tabs[1]);
    const pin = [...menu.querySelectorAll('.tab-context-item')]
      .find(i => i.textContent.trim() === 'Pin Tab');
    expect(pin).toBeTruthy();
    pin.click();

    expect(TM.tabs[1].pinned).toBe(true);
    expect(document.querySelectorAll('.pinned-tabs-container .pinned-tab')).toHaveLength(1);
  });

  it('unpins again from the same menu', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2', { pinned: true })];
    TM.activeTabId = 't1';
    TM.rebuildAllTabs();

    const menu = await openMenuFor(TM, TM.tabs[1]);
    const unpin = [...menu.querySelectorAll('.tab-context-item')]
      .find(i => i.textContent.trim() === 'Unpin Tab');
    unpin.click();

    expect(TM.tabs[1].pinned).toBe(false);
    expect(document.querySelectorAll('.pinned-tabs-container .pinned-tab')).toHaveLength(0);
  });
});

// ===========================================================================
// pin / stack mutual exclusion
// ===========================================================================
describe('pinTab vs stacks', () => {
  it('pinning a stack member pulls it out of the stack first', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];
    TM.createStack(['t1', 't2', 't3'], 'S', '#fff');
    expect(TM.tabs.every(t => t.stackId)).toBe(true);

    TM.pinTab('t2');

    expect(TM.tabs.find(t => t.id === 't2').stackId).toBeNull();
    expect(TM.tabs.find(t => t.id === 't2').pinned).toBe(true);
  });

  it('a pinned tab is never drawn twice (pinned row + stack member)', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2'), fakeTab('t3')];
    TM.createStack(['t1', 't2', 't3'], 'S', '#fff');
    TM.pinTab('t2');
    TM.rebuildAllTabs();

    // Exactly one element represents t2 — the pinned chip. It must not ALSO
    // appear as a member row under the stack header.
    expect(document.querySelectorAll('[data-tab-id="t2"]')).toHaveLength(1);
    expect(document.querySelectorAll('.pinned-tabs-container .pinned-tab[data-tab-id="t2"]')).toHaveLength(1);
    expect(document.querySelectorAll('#tabs-list .tab-item[data-tab-id="t2"]')).toHaveLength(0);
  });
});

// ===========================================================================
// closeAllTabs — the workspace-switch teardown
// ===========================================================================
describe('closeAllTabs', () => {
  it('drops stacks and their expand state so they cannot leak into the next workspace', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    const stack = TM.createStack(['t1', 't2'], 'Reading', '#fff');
    TM._expandedStackIds.add(stack.id);

    TM.closeAllTabs();

    expect(TM.stacks).toEqual([]);
    expect(TM._expandedStackIds.size).toBe(0);
  });

  it('removes the pinned row, which lives outside #tabs-list', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1', { pinned: true }), fakeTab('t2')];
    TM.activeTabId = 't1';
    TM.rebuildAllTabs();
    expect(document.querySelector('.pinned-tabs-container')).toBeTruthy();

    TM.closeAllTabs();

    expect(document.querySelector('.pinned-tabs-container')).toBeNull();
    expect(document.getElementById('tabs-list').innerHTML).toBe('');
  });
});

// ===========================================================================
// renderTabUpdate — badges
// ===========================================================================
describe('renderTabUpdate badges', () => {
  async function mount() {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    TM.activeTabId = 't1';
    TM.rebuildAllTabs();
    return TM;
  }
  const row = () => document.querySelector('.tab-item[data-tab-id="t2"]');

  it('shows the speaker badge when a tab starts playing and drops it when it stops', async () => {
    const TM = await mount();
    const tab = TM.tabs[1];
    expect(row().querySelector('.tab-audio')).toBeNull();

    tab.audible = true;
    TM.renderTabUpdate(tab);
    expect(row().querySelector('.tab-audio')).toBeTruthy();
    expect(row().querySelector('.tab-audio svg')).toBeTruthy(); // inline SVG, not an emoji

    tab.audible = false;
    TM.renderTabUpdate(tab);
    expect(row().querySelector('.tab-audio')).toBeNull();
  });

  it('swaps the speaker badge for the muted one', async () => {
    const TM = await mount();
    const tab = TM.tabs[1];
    tab.audible = true;
    TM.renderTabUpdate(tab);
    expect(row().querySelector('.tab-audio.muted')).toBeNull();

    tab.muted = true;
    TM.renderTabUpdate(tab);
    expect(row().querySelectorAll('.tab-audio')).toHaveLength(1);
    expect(row().querySelector('.tab-audio.muted')).toBeTruthy();
  });

  it('keeps the sleeping class and badge in sync', async () => {
    const TM = await mount();
    const tab = TM.tabs[1];

    tab.sleeping = true;
    TM.renderTabUpdate(tab);
    expect(row().classList.contains('sleeping')).toBe(true);
    expect(row().querySelector('.sleep-indicator')).toBeTruthy();

    tab.sleeping = false;
    TM.renderTabUpdate(tab);
    expect(row().classList.contains('sleeping')).toBe(false);
    expect(row().querySelector('.sleep-indicator')).toBeNull();
  });

  it('keeps the kept-awake class in sync', async () => {
    const TM = await mount();
    const tab = TM.tabs[1];
    expect(row().classList.contains('kept-awake')).toBe(false);

    tab.keepAwakeUntil = Date.now() + 60_000;
    TM.renderTabUpdate(tab);
    expect(row().classList.contains('kept-awake')).toBe(true);

    tab.keepAwakeUntil = 0;
    TM.renderTabUpdate(tab);
    expect(row().classList.contains('kept-awake')).toBe(false);
  });

  it('does not add a second badge when called repeatedly', async () => {
    const TM = await mount();
    const tab = TM.tabs[1];
    tab.audible = true;
    TM.renderTabUpdate(tab);
    TM.renderTabUpdate(tab);
    TM.renderTabUpdate(tab);
    expect(row().querySelectorAll('.tab-audio')).toHaveLength(1);
    expect(row().querySelectorAll('.sleep-indicator')).toHaveLength(0);
  });
});

// ===========================================================================
// favicon screening — one bad icon used to stop ALL tab persistence
// ===========================================================================
describe('favicon screening', () => {
  // Mirrors the saved-tab contract in data-contracts.js: anything else makes
  // VexStorage.saveTabs reject, which silently lost the whole session.
  it('keeps the schemes the saved-tab contract accepts', async () => {
    installGlobals();
    const TM = await loadTabManager();
    for (const ok of [
      'https://x.test/favicon.ico',
      'http://x.test/favicon.ico',
      'data:image/png;base64,AAA',
      'file:///C:/icon.png',
      'vex://start/icon.png',
    ]) expect(TM._persistableFavicon(ok)).toBe(ok);
  });

  it('drops anything the contract would reject', async () => {
    installGlobals();
    const TM = await loadTabManager();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of [
      'blob:https://x.test/abc',
      'chrome-error://chromewebdata/favicon.ico',
      'javascript:alert(1)',
      '/favicon.ico',
      'data:text/html,<b>',
    ]) expect(TM._persistableFavicon(bad)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(5);   // rejection is reported, not silent
    warn.mockRestore();
  });

  it('treats null/empty as no favicon without complaining', async () => {
    installGlobals();
    const TM = await loadTabManager();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(TM._persistableFavicon(null)).toBeNull();
    expect(TM._persistableFavicon(undefined)).toBeNull();
    expect(TM._persistableFavicon('')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never lets a page store an unsavable favicon on a tab', async () => {
    installGlobals();
    const TM = await loadTabManager();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    TM.tabs = [fakeTab('t1', { favicon: 'https://x.test/a.ico' })];
    TM.activeTabId = 't1';

    TM.updateTab('t1', { favicon: 'blob:https://x.test/abc' });

    expect(TM.tabs[0].favicon).toBeNull();
    warn.mockRestore();
  });
});

// ===========================================================================
// a page that never loads must not stay labelled "Loading..."
// ===========================================================================
describe('title fallback', () => {
  it('falls back to the host once loading ends with no title', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1', { title: 'Loading...', url: 'https://www.unreachable.test/x' })];
    TM.activeTabId = 't1';

    TM.updateTab('t1', { loading: false });

    expect(TM.tabs[0].title).toBe('unreachable.test');
  });

  it('leaves a real title alone', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1', { title: 'Real Page', url: 'https://x.test/' })];
    TM.activeTabId = 't1';

    TM.updateTab('t1', { loading: false });

    expect(TM.tabs[0].title).toBe('Real Page');
  });

  it('names a start page "New Tab"', async () => {
    installGlobals();
    const TM = await loadTabManager();
    expect(TM._fallbackTitle('vex://start')).toBe('New Tab');
  });

  it('uses the last path segment when there is no host', async () => {
    installGlobals();
    const TM = await loadTabManager();
    expect(TM._fallbackTitle('file:///C:/notes/report.html')).toBe('report.html');
  });
});

// ===========================================================================
// group collapse must reach both strips
// ===========================================================================
describe('group collapse', () => {
  it('fires vex-tabs-changed so the horizontal strip re-renders too', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'g1', name: 'Docs', color: '#fff', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'g1' }), fakeTab('t2', { groupId: 'g1' })];
    TM.rebuildAllTabs();

    const seen = [];
    window.addEventListener('vex-tabs-changed', () => seen.push(TM.groups[0].collapsed));

    document.querySelector('.tab-group[data-group-id="g1"] .tab-group-header').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(TM.groups[0].collapsed).toBe(true);
    expect(seen).toContain(true);
  });
});

// ===========================================================================
// no emoji in anything these renderers emit
// ===========================================================================
describe('tab UI carries no emoji', () => {
  it('renders private, Tor, audio and sleep badges as inline SVG', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [
      fakeTab('t1', { partition: 'tor-1' }),
      fakeTab('t2', { partition: 'ephemeral-1' }),
      fakeTab('t3', { audible: true }),
      fakeTab('t4', { muted: true }),
      fakeTab('t5', { sleeping: true }),
    ];
    TM.activeTabId = 't1';
    TM.rebuildAllTabs();

    const html = document.getElementById('tabs-list').innerHTML;
    expect(html).not.toMatch(EMOJI_RE);
    expect(document.querySelectorAll('.tab-private svg')).toHaveLength(2);
    expect(document.querySelectorAll('.tab-audio svg')).toHaveLength(2);
    expect(document.querySelectorAll('.sleep-indicator svg')).toHaveLength(1);
  });

  it('renders the group context menu with SVG icons and no emoji', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'g1', name: 'Docs', color: '#fff', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'g1' }), fakeTab('t2', { groupId: 'g1' })];

    TM.showGroupContextMenu({ clientX: 1, clientY: 1, preventDefault() {}, stopPropagation() {} }, 'g1');
    const menu = document.querySelector('.tab-group-context-menu');

    expect(menu.textContent).not.toMatch(EMOJI_RE);
    expect(menu.querySelectorAll('.tab-context-item')).toHaveLength(6);
    expect(menu.querySelectorAll('.tab-context-item > svg.ctx-icon')).toHaveLength(6);
  });

  it('renders the stack context menu with SVG icons and no emoji', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1'), fakeTab('t2')];
    const stack = TM.createStack(['t1', 't2'], 'Reading', '#fff');

    TM.showStackContextMenu({ clientX: 1, clientY: 1, preventDefault() {}, stopPropagation() {} }, stack.id);
    const menu = document.querySelector('.tab-stack-context-menu');

    expect(menu.textContent).not.toMatch(EMOJI_RE);
    expect(menu.querySelectorAll('.tab-context-item > svg.ctx-icon')).toHaveLength(2);
  });

  it('renders the tab context menu with no emoji', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.tabs = [fakeTab('t1')];
    TM.activeTabId = 't1';

    TM.showContextMenu({ clientX: 1, clientY: 1, preventDefault() {} }, TM.tabs[0]);
    expect(document.querySelector('.tab-context-menu').textContent).not.toMatch(EMOJI_RE);
  });
});
