// @vitest-environment jsdom
//
// Extensions' items in Vex's right-click menu, and their badges and button
// menu in the extensions menu (js/ext-ui.js, 2026-10-08). Main sends what the
// extensions made ('extensions:ui-state'); a click goes back to main.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const EXT = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

async function load() {
  vi.resetModules();
  await import('../../src/renderer/js/vex-icons.js');
  await import('../../src/renderer/js/ext-menu-model.js');
  await import('../../src/renderer/js/ext-ui.js');
  const { WebviewManager } = await import('../../src/renderer/js/webview.js');
  globalThis.WebviewManager = WebviewManager;
  return { WM: WebviewManager, ui: window.VexExtUi };
}

function fakeWebview(partition = 'persist:main') {
  return {
    canGoBack: () => false, canGoForward: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    getURL: () => 'https://example.com/page', getTitle: () => 'Example',
    getWebContentsId: () => 7,
    getAttribute: (k) => (k === 'partition' ? partition : null),
    dataset: {},
  };
}

const item = (over) => ({ parentId: null, type: 'normal', contexts: ['page'], checked: false, enabled: true, visible: true, documentUrlPatterns: null, targetUrlPatterns: null, ...over });

function state() {
  return {
    menus: {
      'persist:main': {
        [EXT]: [item({ id: 'look', title: 'Look up "%s"', contexts: ['selection'] })],
        [OTHER]: [
          item({ id: 1, title: 'Save page' }),
          item({ id: 2, title: 'Dark', type: 'checkbox', checked: true }),
          item({ id: 3, title: 'Button only', contexts: ['action'] }),
        ],
      },
    },
    action: { 'persist:main': { [EXT]: { def: { text: '12', bg: [0, 128, 0, 255] }, tabs: { 7: { text: '3' } } } } },
    exts: {
      [EXT]: { folder: 'lookup', name: 'Lookup', iconPath: 'C:\\ext\\lookup\\icon.png', hasPopup: false },
      [OTHER]: { folder: 'other', name: 'Other Tools', iconPath: null, hasPopup: true },
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete globalThis.TabManager;
  window.vex = { extensionsMenuClick: vi.fn(() => Promise.resolve(true)), extensionsActionClick: vi.fn(() => Promise.resolve(true)) };
});

const rows = (menu) => [...menu.querySelectorAll(':scope > .tab-context-item')].map(r => r.textContent);

describe('the page right-click menu', () => {
  it('one item shows on its own with the extension\'s icon; "%s" is the selection', async () => {
    const { WM, ui } = await load();
    ui._set(state());
    WM.showContextMenu({ params: { x: 5, y: 5, pageURL: 'https://example.com/page', selectionText: 'word' } }, fakeWebview());
    const menu = document.querySelector('.tab-context-menu');
    const row = [...menu.querySelectorAll('.tab-context-item')].find(r => r.textContent === 'Look up "word"');
    expect(row).toBeTruthy();
    expect(row.querySelector('img.ctx-ext-icon').getAttribute('src')).toBe('file:///C:/ext/lookup/icon.png');
    // Other Tools has nothing for selected text.
    expect(rows(menu)).not.toContain('Other Tools');
    row.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(window.vex.extensionsMenuClick).toHaveBeenCalledWith({ partition: 'persist:main', id: EXT, item: 'look', tab: 7,
      ctx: expect.objectContaining({ kind: 'page', selectionText: 'word', pageUrl: 'https://example.com/page' }) });
  });

  it('several items go into a submenu named after the extension, a checkbox drawn checked', async () => {
    const { WM, ui } = await load();
    ui._set(state());
    WM.showContextMenu({ params: { x: 5, y: 5, pageURL: 'https://example.com/page' } }, fakeWebview());
    const menu = document.querySelector('.tab-context-menu');
    const group = [...menu.querySelectorAll('.tab-context-item.has-sub')].find(r => r.textContent === 'Other Tools');
    expect(group).toBeTruthy();
    expect(group.querySelector('svg')).toBeTruthy(); // VexIcons puzzle: it has no icon of its own
    group.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    const sub = document.querySelector('.ctx-submenu');
    expect([...sub.querySelectorAll('.tab-context-item')].map(r => r.textContent)).toEqual(['Save page', 'Dark']);
    const dark = [...sub.querySelectorAll('.tab-context-item')][1];
    expect(dark.getAttribute('role')).toBe('menuitemcheckbox');
    expect(dark.getAttribute('aria-checked')).toBe('true');
    dark.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(window.vex.extensionsMenuClick).toHaveBeenCalledWith(expect.objectContaining({ id: OTHER, item: 2 }));
  });

  it('nothing in a private or Tor tab: no extension runs in its session', async () => {
    const { WM, ui } = await load();
    ui._set(state());
    WM.showContextMenu({ params: { x: 5, y: 5, selectionText: 'word' } }, fakeWebview('tor:abc'));
    const text = document.querySelector('.tab-context-menu').textContent;
    expect(text).not.toMatch(/Look up|Other Tools/);
  });

  it('a click main refuses says so', async () => {
    const { WM, ui } = await load();
    ui._set(state());
    window.showToast = vi.fn();
    window.vex.extensionsMenuClick = vi.fn(() => Promise.reject(new Error("Error invoking remote method 'extensions:menu-click': Error: That menu item is gone")));
    WM.showContextMenu({ params: { x: 5, y: 5, selectionText: 'w' } }, fakeWebview());
    const row = [...document.querySelectorAll('.tab-context-item')].find(r => r.textContent === 'Look up "w"');
    row.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(window.showToast).toHaveBeenCalledWith('The extension did not get that click: That menu item is gone', 'error');
  });
});

describe('the toolbar button: badge and menu', () => {
  it('the badge is the tab\'s own, else the extension\'s', async () => {
    const { ui } = await load();
    ui._set(state());
    globalThis.WebviewManager = { getActiveWebview: () => fakeWebview() };
    expect(ui.badgeFor(EXT)).toMatchObject({ text: '3', bg: [0, 128, 0, 255], color: [255, 255, 255, 255] });
    globalThis.WebviewManager = { getActiveWebview: () => ({ ...fakeWebview(), getWebContentsId: () => 8 }) };
    expect(ui.badgeFor(EXT).text).toBe('12');
    expect(ui.badgeFor(OTHER)).toBeNull();
    expect(ui.rgba([0, 128, 0, 255])).toBe('rgba(0,128,0,1.000)');
  });
  it('its menu has only its "action" items, and a click is about the tab in front', async () => {
    const { ui } = await load();
    ui._set(state());
    globalThis.WebviewManager = { getActiveWebview: () => fakeWebview() };
    const r = ui.actionMenuRows(OTHER);
    expect(r.map(x => x.label)).toEqual(['Button only']);
    r[0].action();
    expect(window.vex.extensionsMenuClick).toHaveBeenCalledWith({ partition: 'persist:main', id: OTHER, item: 3, tab: 7, ctx: { kind: 'action', pageUrl: 'https://example.com/page' } });
  });
});

// A private window runs no extensions; asking main only logged its refusal
// (final review, 2026-10-09).
describe('in a private window', () => {
  it('never asks main what extensions show', async () => {
    window.vex.extensionsUiState = vi.fn(() => Promise.resolve(state()));
    window.vex.onExtensionsUiState = vi.fn();
    window.vex.onExtensionsRunAction = vi.fn();
    window.VexTabPolicy = { isPrivateWindow: true };
    await load();
    expect(window.vex.extensionsUiState).not.toHaveBeenCalled();
    window.VexTabPolicy = { isPrivateWindow: false };
    await load();
    expect(window.vex.extensionsUiState).toHaveBeenCalledTimes(1);
    delete window.VexTabPolicy;
  });
});
