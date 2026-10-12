// @vitest-environment jsdom
//
// The address bar's right-click menu (js/url-bar-menu.js) and the tab menu
// (js/tabs.js) share their menu code. Opened with the menu key or Shift+F10,
// focus stayed where it was: the arrows did nothing, Enter did nothing, and
// Escape closed the menu with focus lost (release check, 2026-10-12). Now
// focus goes to the first row, the arrows, Home and End move, Enter runs the
// row, and Escape closes the menu and puts focus back where it was.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const fresh = (p) => { const r = require.resolve(path.join(ROOT, p)); delete require.cache[r]; return require(r); };

let TabManager;
const key = (target, k, opts = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(e);
  return e;
};
const rows = (sel) => [...document.querySelector(sel).children].filter(e => e.classList.contains('tab-context-item'));
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

beforeEach(() => {
  document.body.innerHTML = '';
  window.escapeHtml = (s) => String(s == null ? '' : s);
  window.showToast = vi.fn();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  ({ TabManager } = fresh('src/renderer/js/tabs.js'));
  globalThis.TabManager = TabManager;
});
afterEach(() => {
  document.querySelectorAll('.tab-context-menu').forEach(m => TabManager._dismissMenu(m));
  vi.restoreAllMocks();
  delete globalThis.TabManager;
});

describe('the address bar menu from the keyboard', () => {
  let input, go;
  beforeEach(() => {
    document.body.innerHTML = '<input id="url-input">';
    input = document.getElementById('url-input');
    input.value = 'https://example.com/';
    go = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn(async () => 'https://pasted.example/'), writeText: vi.fn(async () => {}) } });
    fresh('src/renderer/js/url-bar-menu.js').UrlBarMenu.init(input, { onPasteAndGo: go });
    input.focus();
  });

  for (const [name, k, opts] of [['the menu key', 'ContextMenu', {}], ['Shift+F10', 'F10', { shiftKey: true }]]) {
    it(name + ' opens it with focus on the first row', () => {
      const e = key(input, k, opts);
      expect(e.defaultPrevented).toBe(true);
      expect(document.querySelector('.url-bar-menu')).not.toBeNull();
      expect(document.activeElement).toBe(rows('.url-bar-menu')[0]);
    });
  }

  it('F10 alone does not open it', () => {
    key(input, 'F10');
    expect(document.querySelector('.url-bar-menu')).toBeNull();
  });

  it('arrows, Home and End move; they wrap', () => {
    key(input, 'ContextMenu');
    const r = rows('.url-bar-menu');
    expect(r.map(x => x.textContent)).toEqual(['Paste', 'Paste and go', 'Select all']);
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(r[1]);
    key(document.activeElement, 'End');
    expect(document.activeElement).toBe(r[2]);
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(r[0]);
    key(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(r[2]);
    key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(r[0]);
  });

  it('Enter runs the row', async () => {
    key(input, 'ContextMenu');
    key(document.activeElement, 'ArrowDown');
    key(document.activeElement, 'Enter');
    await flush();
    expect(go).toHaveBeenCalledWith('https://pasted.example/');
    expect(document.querySelector('.url-bar-menu')).toBeNull();
    expect(document.querySelector('.context-menu-overlay')).toBeNull();
  });

  it('Escape closes it and puts focus back in the address bar', () => {
    key(input, 'ContextMenu');
    key(document.activeElement, 'Escape');
    expect(document.querySelector('.url-bar-menu')).toBeNull();
    expect(document.querySelector('.context-menu-overlay')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('a right-click still opens it where the pointer is, and the arrows reach it from there', () => {
    input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }));
    const menu = document.querySelector('.url-bar-menu');
    expect([menu.style.left, menu.style.top]).toEqual(['30px', '40px']);
    expect(document.activeElement).toBe(input);
    key(input, 'ArrowDown');
    expect(document.activeElement).toBe(rows('.url-bar-menu')[0]);
  });
});

describe('the tab menu from the keyboard (the same menu code)', () => {
  let tabEl;
  beforeEach(() => {
    globalThis.VexIcons = { svg: () => '<svg></svg>' };
    globalThis.TabSnooze = { canSnooze: () => true, WHEN: { hour: { label: 'In an hour' }, week: { label: 'In a week' } }, snooze: vi.fn(() => ({ at: Date.now() })) };
    globalThis.Bookmarks = { has: () => false, toggle: vi.fn() };
    TabManager.tabs = [{ id: 't1', url: 'https://example.com/', title: 'Ex' }, { id: 't2', url: 'https://b.example/', title: 'B' }];
    TabManager.groups = [];
    TabManager.activeTabId = 't1';
    document.body.innerHTML = '<div id="top-tabs-list"><div class="top-tab active" data-tab-id="t1"><span class="tab-title">Ex</span></div></div>';
    tabEl = document.querySelector('.top-tab');
    tabEl.getClientRects = () => [{}];
    // As js/horizontal-tabs.js wires it.
    tabEl.addEventListener('contextmenu', (e) => { e.preventDefault(); TabManager.showContextMenu(e, TabManager.tabs[0]); });
    const { VexA11yKeys } = fresh('src/renderer/js/a11y-keys.js');
    VexA11yKeys.init();
    tabEl.focus();
  });
  afterEach(() => { delete globalThis.VexIcons; delete globalThis.TabSnooze; delete globalThis.Bookmarks; });

  it('Shift+F10 puts focus on its first row; arrows move; Escape gives focus back to the tab', () => {
    key(tabEl, 'F10', { shiftKey: true });
    const r = rows('.tab-context-menu');
    expect(r[0].textContent).toBe('Reload');
    expect(document.activeElement).toBe(r[0]);
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(r[1]);
    key(document.activeElement, 'End');
    expect(document.activeElement).toBe(r[r.length - 1]);
    key(document.activeElement, 'Escape');
    expect(document.querySelector('.tab-context-menu')).toBeNull();
    expect(document.activeElement).toBe(tabEl);
  });

  it('Enter runs the row', () => {
    const reload = vi.spyOn(TabManager, '_reloadTabFromMenu').mockImplementation(() => {});
    key(tabEl, 'ContextMenu');
    key(document.activeElement, 'Enter');
    expect(reload).toHaveBeenCalledWith(TabManager.tabs[0]);
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('a row with a list beside it: Enter or Right opens it with focus inside, Left and Escape come back to the row', () => {
    key(tabEl, 'ContextMenu');
    const r = rows('.tab-context-menu:not(.ctx-submenu)');
    const snooze = r.find(x => x.textContent.startsWith('Snooze until'));
    for (let i = 0; i < r.length && document.activeElement !== snooze; i++) key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(snooze);
    key(snooze, 'ArrowRight');
    const sub = document.querySelector('.ctx-submenu');
    expect(sub).not.toBeNull();
    expect(document.activeElement).toBe(rows('.ctx-submenu')[0]);
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(rows('.ctx-submenu')[1]);
    key(document.activeElement, 'ArrowLeft');
    expect(document.querySelector('.ctx-submenu')).toBeNull();
    expect(document.activeElement).toBe(snooze);
    key(snooze, 'Enter');
    expect(document.activeElement).toBe(rows('.ctx-submenu')[0]);
    key(document.activeElement, 'Escape');
    expect(document.querySelector('.ctx-submenu')).toBeNull();
    expect(document.querySelector('.tab-context-menu')).not.toBeNull();
    expect(document.activeElement).toBe(snooze);
  });

  it('a right-click still opens it at the pointer, with the mouse as before', () => {
    const reload = vi.spyOn(TabManager, '_reloadTabFromMenu').mockImplementation(() => {});
    tabEl.blur();
    tabEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));
    const menu = document.querySelector('.tab-context-menu');
    expect([menu.style.left, menu.style.top]).toEqual(['50px', '60px']);
    expect(menu.contains(document.activeElement)).toBe(false);
    rows('.tab-context-menu')[0].click();
    expect(reload).toHaveBeenCalled();
    expect(document.querySelector('.tab-context-menu')).toBeNull();
    expect(document.querySelector('.context-menu-overlay')).toBeNull();
  });
});

it('the menu code is shared: the address bar menu uses the tab menu\'s', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer/js/url-bar-menu.js'), 'utf8');
  expect(src).toContain('TabManager._attachMenuDismissal(menu, { keys: true })');
});
