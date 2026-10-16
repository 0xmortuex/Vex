// @vitest-environment jsdom
//
// Wave 3 tab tools: gesture editor bindings (T3-068), pick several tabs (T3-071), hold widths (T3-081),
// tab names (T3-118), wake pictures (T3-069), hints (T3-113), split keys (T3-054).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.VexIcons = { has: () => true, svg: (n) => '<svg data-icon="' + n + '"></svg>' };
const { MouseGestures } = require('../../src/renderer/js/gestures.js');
const { VexTabSelect } = require('../../src/renderer/js/tab-select.js');
const { VexTabHold } = require('../../src/renderer/js/tab-hold.js');
const { VexTabNames } = require('../../src/renderer/js/tab-names.js');
const { VexTabThumbs } = require('../../src/renderer/js/tab-thumbs.js');
const { VexLinkHints } = require('../../src/renderer/js/link-hints.js');
const { VexSplitKeys } = require('../../src/renderer/js/split-keys.js');
const { VexPreconnect } = require('../../src/renderer/js/preconnect.js');

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); });
afterEach(() => { delete globalThis.TabManager; delete globalThis.SplitScreen; delete globalThis.WebviewManager; document.body.innerHTML = ''; VexTabSelect.clear(); VexTabHold.release(); });

describe('gesture bindings', () => {
  it('keeps the built-in map until a stroke is changed, and sixteen strokes exist', () => {
    expect(MouseGestures.DIRS.length).toBe(16);
    expect(MouseGestures.actionFor('DR')).toBe('close-tab');
    MouseGestures.setBinding('DR', 'mute-tab');
    expect(MouseGestures.actionFor('DR')).toBe('mute-tab');
    MouseGestures.setBinding('DR', 'close-tab');
    expect(localStorage.getItem('vex.gestureBindings')).toBe(null);
  });
  it('refuses an unknown stroke or action, and treats a damaged record as the built-in map', () => {
    expect(() => MouseGestures.setBinding('LL', 'back')).toThrow(/stroke/);
    expect(() => MouseGestures.setBinding('L', 'nope')).toThrow(/stroke can do/);
    localStorage.setItem('vex.gestureBindings', '{bad');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(MouseGestures.actionFor('L')).toBe('back');
    err.mockRestore();
  });
  it('runs a Ctrl+K command bound to a stroke, and says when it is gone', () => {
    const action = vi.fn();
    globalThis.CommandBar = { commands: [{ id: 'chain:1', label: 'My chain', action }] };
    globalThis.TabManager = { getActiveTab: () => null };
    MouseGestures.setBinding('U', 'cmd:chain:1');
    MouseGestures.run('U', {});
    expect(action).toHaveBeenCalled();
    globalThis.CommandBar.commands = [];
    MouseGestures.run('U', {});
    expect(window.showToast.mock.calls.at(-1)[1]).toBe('error');
    delete globalThis.CommandBar;
  });
});

function strip(ids) {
  document.body.innerHTML = '<div id="top-tab-bar"><div id="top-tabs-list">' + ids.map(i => '<div class="top-tab" data-tab-id="' + i + '"></div>').join('') + '</div></div>';
}
describe('pick several tabs', () => {
  const tabs = ['a', 'b', 'c', 'd'].map(id => ({ id, url: 'https://' + id + '.com/', muted: false }));
  beforeEach(() => {
    strip(tabs.map(t => t.id));
    globalThis.TabManager = { tabs, activeTabId: 'a', shownOrder: () => tabs, closeTabsWithUndo: vi.fn(), toggleMuteTab: vi.fn(t => { tabs.find(x => x.id === t).muted = true; }), togglePinTab: vi.fn() };
  });
  it('Ctrl-click adds the tab in front and the clicked one; a plain click lets go', () => {
    expect(VexTabSelect.handleClick({ ctrlKey: true }, tabs[2])).toBe(true);
    expect([...VexTabSelect._sel].sort()).toEqual(['a', 'c']);
    expect(document.querySelector('.ts-bar')).not.toBe(null);
    expect(document.querySelector('[data-tab-id="c"]').classList.contains('multi-selected')).toBe(true);
    expect(VexTabSelect.handleClick({}, tabs[1])).toBe(false);
    expect(VexTabSelect.count()).toBe(0);
    expect(document.querySelector('.ts-bar')).toBe(null);
  });
  it('Shift-click picks the run, and Close hands them to closeTabsWithUndo', () => {
    VexTabSelect.handleClick({ ctrlKey: true }, tabs[1]);
    VexTabSelect.handleClick({ shiftKey: true }, tabs[3]);
    expect(VexTabSelect.tabs().map(t => t.id)).toEqual(['a', 'b', 'c', 'd']);
    VexTabSelect.close();
    expect(TabManager.closeTabsWithUndo).toHaveBeenCalledWith(['a', 'b', 'c', 'd'], 'Closed 4 tabs');
    expect(VexTabSelect.count()).toBe(0);
  });
  it('mutes only the tabs that are not muted yet, and forgets a tab that closed', () => {
    VexTabSelect.handleClick({ ctrlKey: true }, tabs[1]);
    VexTabSelect.mute();
    expect(TabManager.toggleMuteTab).toHaveBeenCalledTimes(2);
    TabManager.tabs = tabs.filter(t => t.id !== 'b');
    VexTabSelect.refresh();
    expect(VexTabSelect.count()).toBe(1);
    expect(document.querySelector('.ts-bar')).toBe(null);
  });
  it('does nothing when switched off', () => {
    VexTabSelect.setEnabled(false);
    expect(VexTabSelect.handleClick({ ctrlKey: true }, tabs[1])).toBe(false);
    VexTabSelect.setEnabled(true);
  });
});

describe('hold tab widths', () => {
  function widths(list, w) { [...list.children].forEach((el, i) => { el.getBoundingClientRect = () => ({ width: w[i], height: 30, top: 0 }); }); }
  it('keeps the widths after one tab goes, and lets go when the pointer leaves', () => {
    strip(['a', 'b', 'c']);
    const list = document.getElementById('top-tabs-list');
    widths(list, [200, 200, 200]);
    VexTabHold.beforeClose(list);
    list.removeChild(list.firstChild);
    VexTabHold.apply();
    expect([...list.children].map(e => e.style.maxWidth)).toEqual(['200px', '200px']);
    VexTabHold.release();
    expect(list.children[0].style.maxWidth).toBe('');
  });
  it('lets go when a tab it did not hold appears, and never holds a lone tab', () => {
    strip(['a', 'b', 'c']);
    const list = document.getElementById('top-tabs-list');
    widths(list, [100, 100, 100]);
    VexTabHold.beforeClose(list);
    const n = document.createElement('div'); n.className = 'top-tab'; n.dataset.tabId = 'z'; list.appendChild(n);
    VexTabHold.apply();
    expect(VexTabHold.held()).toBe(false);
    strip(['a']);
    VexTabHold.beforeClose(document.getElementById('top-tabs-list'));
    expect(VexTabHold.held()).toBe(false);
  });
  it('sets the narrow classes from the held width', () => {
    strip(['a', 'b']);
    const list = document.getElementById('top-tabs-list');
    widths(list, [50, 300]);
    VexTabHold.beforeClose(list);
    VexTabHold.apply();
    expect(list.children[0].classList.contains('very-narrow')).toBe(true);
    expect(list.children[1].classList.contains('narrow')).toBe(false);
  });
  it('touches widths only: heights and tops are untouched', () => {
    strip(['a', 'b']);
    const list = document.getElementById('top-tabs-list');
    widths(list, [120, 120]);
    VexTabHold.beforeClose(list);
    VexTabHold.apply();
    for (const el of list.children) expect(['flex', 'width', 'min-width', 'max-width'].every(p => el.style.getPropertyValue(p) !== undefined) && el.style.height === '' && el.style.top === '').toBe(true);
  });
});

describe('tab names', () => {
  const tab = { id: 't', url: 'https://docs.example.com/guide/?utm=1#x', title: 'Guide', partition: undefined };
  it('keys by host and path, ignoring query and fragment', () => {
    expect(VexTabNames.keyFor(tab.url)).toBe('docs.example.com/guide');
    expect(VexTabNames.keyFor('vex://start')).toBe(null);
  });
  it('shows the name for the address anywhere, and the page title otherwise', () => {
    VexTabNames.set(tab, '  Work   guide ');
    expect(VexTabNames.display({ ...tab, url: 'https://docs.example.com/guide' })).toBe('Work guide');
    expect(VexTabNames.display({ id: 'o', url: 'https://other.com/', title: 'Other' })).toBe('Other');
    VexTabNames.set(tab, '');
    expect(VexTabNames.display(tab)).toBe('Guide');
  });
  it('never names a private or Tor tab, and keeps at most 300 names', () => {
    expect(() => VexTabNames.set({ ...tab, partition: 'tor-1' }, 'x')).toThrow(/normal profile/);
    for (let i = 0; i < 305; i++) VexTabNames.set({ url: 'https://a.com/' + i }, 'n' + i);
    expect(Object.keys(VexTabNames.all()).length).toBe(300);
    expect(VexTabNames.all()['a.com/0']).toBeUndefined();
  });
});

describe('wake pictures', () => {
  const tab = { id: 't', url: 'https://a.com/', originalUrl: 'https://a.com/' };
  it('keeps the last 12 in memory, drops one for another address, refuses private tabs', () => {
    for (let i = 0; i < 14; i++) VexTabThumbs.remember({ id: 'x' + i, url: 'https://a.com/' + i }, 'data:image/png;base64,AA');
    expect(VexTabThumbs.size()).toBe(12);
    VexTabThumbs.remember({ id: 'p', url: 'https://a.com/', partition: 'tor-1' }, 'data:x');
    expect(VexTabThumbs.get({ id: 'p', url: 'https://a.com/' })).toBe(null);
    VexTabThumbs.remember(tab, 'data:image/png;base64,BB');
    expect(VexTabThumbs.get({ ...tab, originalUrl: 'https://a.com/other' })).toBe(null);
  });
  it('shows a picture over the page area and removes it when the page has loaded', async () => {
    document.body.innerHTML = '<div id="webviews-container"></div>';
    globalThis.TabManager = { activeTabId: 't' };
    VexTabThumbs.remember(tab, 'data:image/png;base64,CC');
    const handlers = {};
    const wv = { addEventListener: (e, f) => { handlers[e] = f; }, removeEventListener: () => {} };
    expect(VexTabThumbs.showWhileWaking(tab, wv)).toBe(true);
    const img = document.querySelector('.tw-shot');
    expect(img).not.toBe(null);
    expect(img.getAttribute('aria-hidden')).toBe('true');
    handlers['did-finish-load']();
    expect(VexTabThumbs.shown()).toBe(false);
  });
});

describe('hints', () => {
  it('labels with one letter while they fit, then two, never a label that starts another', () => {
    expect(VexLinkHints.labels(3)).toEqual(['s', 'a', 'd']);
    const two = VexLinkHints.labels(20);
    expect(two.every(l => l.length === 2)).toBe(true);
    expect(new Set(two).size).toBe(20);
    expect(() => VexLinkHints.labels(197)).toThrow(/At most/);
  });
  it('tab hints switch to the tab typed and put the labels away', () => {
    const tabs = ['a', 'b', 'c'].map(id => ({ id }));
    strip(tabs.map(t => t.id));
    for (const el of document.querySelectorAll('.top-tab')) el.getClientRects = () => [1];
    globalThis.TabManager = { shownOrder: () => tabs, switchTab: vi.fn() };
    VexLinkHints.startTabs();
    expect(document.querySelectorAll('.lh-chip').length).toBe(3);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(TabManager.switchTab).toHaveBeenCalledWith('b');
    expect(document.querySelector('.lh-layer')).toBe(null);
  });
  it('opens a hinted link in a background tab only for a web address', () => {
    globalThis.TabManager = { getActiveTab: () => ({ groupId: null }), createTab: vi.fn() };
    VexLinkHints.openInBackground('https://a.com/x');
    expect(TabManager.createTab).toHaveBeenCalled();
    expect(() => VexLinkHints.openInBackground('javascript:alert(1)')).toThrow();
  });
});

describe('split keys', () => {
  it('snaps the divider within 2.5 percent of 25, 50 and 75', () => {
    expect(VexSplitKeys.snapNear(0.49)).toBe(0.5);
    expect(VexSplitKeys.snapNear(0.26)).toBe(0.25);
    expect(VexSplitKeys.snapNear(0.6)).toBe(0.6);
  });
  it('swaps panes and moves focus, and refuses when the screen is not split', () => {
    globalThis.TabManager = { activeTabId: 'a' };
    globalThis.SplitScreen = { active: false, panes: [], applySplit: vi.fn(), focusPane: vi.fn() };
    globalThis.WebviewManager = { webviews: new Map() };
    expect(() => VexSplitKeys.swap()).toThrow(/not split/);
    SplitScreen.active = true; SplitScreen.panes = ['a', 'b'];
    expect(VexSplitKeys.swap()).toEqual(['b', 'a']);
    expect(SplitScreen.applySplit).toHaveBeenCalled();
    expect(VexSplitKeys.focusNext(1)).toBe('a');
  });
  it('takes only a plain web address from a page that Alt-clicked a link', () => {
    expect(VexSplitKeys.cleanAddress('https://a.com/x')).toBe('https://a.com/x');
    expect(() => VexSplitKeys.cleanAddress('file:///c:/x')).toThrow(/web links/);
    expect(() => VexSplitKeys.cleanAddress(42)).toThrow();
  });
});

describe('preconnect (window side)', () => {
  it('keeps hostnames only and refuses anything else', () => {
    expect(VexPreconnect.cleanList(['https://Example.com/path', '*.cdn.example.org', ''])).toEqual(['example.com', 'cdn.example.org']);
    expect(() => VexPreconnect.cleanList(['not a host'])).toThrow(/site name/);
  });
  it('is eligible only for a saved session', () => {
    expect(VexPreconnect._eligible({ partition: 'persist:main' })).toBe(true);
    expect(VexPreconnect._eligible({ partition: 'tor-1' })).toBe(false);
    expect(VexPreconnect._eligible(null)).toBe(false);
  });
});
