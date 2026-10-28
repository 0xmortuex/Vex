// @vitest-environment jsdom
//
// An extension's side panel, docked beside the page (js/ext-sidepanel.js), 2026-10-28: chrome.sidePanel.open for the Claude extension.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexExtSidePanel } = require('../../src/renderer/js/ext-sidepanel.js');
const EXT = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
const URL_A = 'chrome-extension://' + EXT + '/sidepanel.html?tabId=11';

let active, vexTabs;
const open = (over = {}) => VexExtSidePanel.open({ tabId: 11, extId: EXT, name: 'Claude', url: URL_A, ...over });

beforeEach(() => {
  document.body.innerHTML = '<div id="content-area"><div id="webviews-container"></div></div>';
  VexExtSidePanel._panels.clear();
  active = 11;
  vexTabs = { 11: 'tab-a', 12: 'tab-b' };
  globalThis.TabManager = { activeTabId: 'tab-a', tabsByPageId: (ids) => ({ tabs: ids.map(id => (vexTabs[id] ? { id: vexTabs[id] } : null)), missing: null }) };
  globalThis.WebviewManager = { webviews: new Map([['tab-a', { getWebContentsId: () => 11 }], ['tab-b', { getWebContentsId: () => 12 }]]) };
  localStorage.clear();
  const area = document.getElementById('content-area');
  area.getBoundingClientRect = () => ({ left: 60, right: 1400, width: 1340, top: 90, bottom: 700, height: 610 });
});
afterEach(() => { delete globalThis.TabManager; delete globalThis.WebviewManager; });

describe('opening', () => {
  it('docks the extension\'s own page in a webview of its session, beside the tab it was opened for, and makes room for it', () => {
    expect(open()).toBe(true);
    const panel = document.querySelector('.ext-sidepanel');
    expect(panel).toBeTruthy();
    expect(panel.hidden).toBe(false);
    const wv = panel.querySelector('webview');
    expect(wv.getAttribute('src')).toBe(URL_A);
    expect(wv.getAttribute('partition')).toBe('persist:main');
    expect(panel.querySelector('.ext-sidepanel-title').textContent).toBe('Claude');
    const area = document.getElementById('content-area');
    expect(area.classList.contains('ext-sp-open')).toBe(true);
    expect(area.style.getPropertyValue('--ext-sp-w')).toBe('420px');
  });
  it('refuses a page that is not the extension\'s own, and a request with no tab', () => {
    expect(() => open({ url: 'https://evil.example/' })).toThrow(/extension's own pages/);
    expect(() => open({ url: 'chrome-extension://otherextensionidotherextensionid/x.html' })).toThrow(/extension's own pages/);
    expect(() => open({ tabId: 'six' })).toThrow(/needs a tab/);
    expect(document.querySelector('.ext-sidepanel')).toBeNull();
  });
  it('asked again for the same tab it is one panel, and with another page it moves to that page', () => {
    open();
    const wv = document.querySelector('.ext-sidepanel webview');
    wv.loadURL = vi.fn();
    open();
    expect(document.querySelectorAll('.ext-sidepanel').length).toBe(1);
    expect(wv.loadURL).not.toHaveBeenCalled();
    open({ url: 'chrome-extension://' + EXT + '/other.html' });
    expect(document.querySelectorAll('.ext-sidepanel').length).toBe(1);
    expect(wv.loadURL).toHaveBeenCalledWith('chrome-extension://' + EXT + '/other.html');
  });
  it('the extension\'s name is text, never markup', () => {
    open({ name: '<img src=x onerror=alert(1)>' });
    expect(document.querySelector('.ext-sidepanel img')).toBeNull();
    expect(document.querySelector('.ext-sidepanel-title').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('it belongs to its tab', () => {
  it('is shown while that tab is in front and hidden (kept) while another is, and the page takes its width back', () => {
    open();
    TabManager.activeTabId = 'tab-b';
    VexExtSidePanel.refresh();
    expect(document.querySelector('.ext-sidepanel').hidden).toBe(true);
    expect(document.getElementById('content-area').classList.contains('ext-sp-open')).toBe(false);
    TabManager.activeTabId = 'tab-a';
    VexExtSidePanel.refresh();
    expect(document.querySelector('.ext-sidepanel').hidden).toBe(false);
    expect(document.getElementById('content-area').classList.contains('ext-sp-open')).toBe(true);
  });
  it('a panel opened for a tab that is not in front waits for it', () => {
    open({ tabId: 12, url: 'chrome-extension://' + EXT + '/sidepanel.html?tabId=12' });
    expect(document.querySelector('.ext-sidepanel').hidden).toBe(true);
    expect(document.getElementById('content-area').classList.contains('ext-sp-open')).toBe(false);
    TabManager.activeTabId = 'tab-b';
    VexExtSidePanel.refresh();
    expect(document.querySelector('.ext-sidepanel').hidden).toBe(false);
  });
  it('one panel per tab', () => {
    open(); open({ tabId: 12, url: 'chrome-extension://' + EXT + '/sidepanel.html?tabId=12' });
    expect(document.querySelectorAll('.ext-sidepanel').length).toBe(2);
    expect([...document.querySelectorAll('.ext-sidepanel')].filter(p => !p.hidden).length).toBe(1);
  });
  it('closing the tab takes its panel with it, and only its', () => {
    open(); open({ tabId: 12, url: 'chrome-extension://' + EXT + '/sidepanel.html?tabId=12' });
    document.dispatchEvent(new CustomEvent('vex:tab-closed', { detail: { tabId: 'tab-a' } }));
    VexExtSidePanel.init;   // the listener is added once at load
    VexExtSidePanel._tabClosed('tab-a');
    expect(document.querySelectorAll('.ext-sidepanel').length).toBe(1);
    expect(VexExtSidePanel._panels.has(EXT + '|12')).toBe(true);
  });
});

describe('closing', () => {
  it('the button closes that tab\'s panel and the page gets its width back', () => {
    open();
    document.querySelector('.ext-sidepanel-close').click();
    expect(document.querySelector('.ext-sidepanel')).toBeNull();
    expect(document.getElementById('content-area').classList.contains('ext-sp-open')).toBe(false);
    expect(document.getElementById('content-area').style.getPropertyValue('--ext-sp-w')).toBe('');
  });
  it('close by extension (an unloaded extension) closes every panel of it, and no other extension\'s', () => {
    open(); open({ tabId: 12, url: 'chrome-extension://' + EXT + '/sidepanel.html?tabId=12' });
    open({ extId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', tabId: 11, url: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/p.html' });
    expect(VexExtSidePanel.close({ extId: EXT })).toBe(2);
    expect(document.querySelectorAll('.ext-sidepanel').length).toBe(1);
  });
});

describe('the width', () => {
  it('is the one the person kept, never narrower than the minimum nor wider than most of the page area', () => {
    localStorage.setItem(VexExtSidePanel.WIDTH_KEY, '500');
    expect(VexExtSidePanel.width()).toBe(500);
    localStorage.setItem(VexExtSidePanel.WIDTH_KEY, '90');
    expect(VexExtSidePanel.width()).toBe(420);
    localStorage.setItem(VexExtSidePanel.WIDTH_KEY, '5000');
    expect(VexExtSidePanel.width()).toBe(Math.floor(1340 * 0.7));
    localStorage.setItem(VexExtSidePanel.WIDTH_KEY, 'wide');
    expect(VexExtSidePanel.width()).toBe(420);
  });
  it('dragging the grip resizes through a shield over the page (a webview takes the mouse away), and keeps the width', () => {
    open();
    document.querySelector('.ext-sidepanel-grip').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    const shield = document.querySelector('.ext-sidepanel-shield');
    expect(shield).toBeTruthy();
    shield.dispatchEvent(new MouseEvent('pointermove', { clientX: 800, bubbles: true }));
    expect(document.getElementById('content-area').style.getPropertyValue('--ext-sp-w')).toBe('600px');
    shield.dispatchEvent(new MouseEvent('pointermove', { clientX: 1390, bubbles: true }));
    expect(document.getElementById('content-area').style.getPropertyValue('--ext-sp-w')).toBe('280px');
    shield.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(document.querySelector('.ext-sidepanel-shield')).toBeNull();
    expect(localStorage.getItem(VexExtSidePanel.WIDTH_KEY)).toBe('280');
  });
});

describe('toasts keep clear of the panel', () => {
  it('the docked panel is one the toast stack avoids (app.js placeToasts), so a toast never covers its message box', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/js/ext-sidepanel.js'), 'utf8');
    expect(src).toMatch(/el\.setAttribute\('data-avoid-toasts', ''\);/);
  });
});
