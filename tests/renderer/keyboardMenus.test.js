// @vitest-environment jsdom
//
// Menus from the keyboard: the Quick tools menu sits at the end of the page, so Tab
// from its button never reached it; and every menu but the tab and address-bar ones
// opened with the menu key had no way in.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const fresh = (p) => { const r = require.resolve(path.join(ROOT, p)); delete require.cache[r]; return require(r); };

describe('the Quick tools menu from the keyboard', () => {
  let ExtensionsMenu, btn;
  beforeEach(() => {
    document.body.innerHTML = '<button id="btn-extensions">Quick tools</button>';
    btn = document.getElementById('btn-extensions');
    window.VexIcons = { svg: () => '<svg></svg>' };
    globalThis.VexIcons = window.VexIcons;
    window.vex = {};
    vi.useFakeTimers();
    ({ ExtensionsMenu } = fresh('src/renderer/js/extensions-menu.js'));
    ExtensionsMenu._loadExtensionRows = () => {};
  });
  afterEach(() => { ExtensionsMenu.close(); vi.useRealTimers(); delete globalThis.VexIcons; });

  it('is a menu of menu items, says so on its button, and Escape closes it back onto the button', () => {
    btn.focus();
    ExtensionsMenu.open(btn);
    vi.runAllTimers();
    const menu = document.querySelector('.ext-menu');
    expect(menu.getAttribute('role')).toBe('menu');
    expect([...menu.querySelectorAll('.ext-menu-item')].every(r => r.getAttribute('role') === 'menuitem')).toBe(true);
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const rows = [...menu.querySelectorAll('.ext-menu-item')];
    rows[0].focus();
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    rows[0].dispatchEvent(down);
    expect(document.activeElement).toBe(rows[1]);
    const end = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    rows[1].dispatchEvent(end);
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    // Tab wraps inside the menu: it sits at the end of the page, outside the toolbar's Tab order.
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    rows[rows.length - 1].dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rows[0]);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('.ext-menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('a menu opened with the menu key on a control other than a tab', () => {
  let TabManager;
  beforeEach(() => {
    document.body.innerHTML = '<button id="icon">Icon</button>';
    window.escapeHtml = (s) => String(s == null ? '' : s);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    ({ TabManager } = fresh('src/renderer/js/tabs.js'));
    globalThis.TabManager = TabManager;
    fresh('src/renderer/js/focus-ring.js');
    window.VexFocusRing.init();
  });
  afterEach(() => {
    document.querySelectorAll('.tab-context-menu').forEach(m => TabManager._dismissMenu(m));
    vi.restoreAllMocks();
    delete globalThis.TabManager;
    window.VexInputModality.keyboard = false;
  });

  const makeMenu = () => {
    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    for (const label of ['One', 'Two']) {
      const row = document.createElement('div');
      row.className = 'tab-context-item';
      row.textContent = label;
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    return menu;
  };

  it('after a key press it is worked from the keyboard: roles, focus on the first row, Escape gives focus back', () => {
    const icon = document.getElementById('icon');
    icon.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }));
    const menu = makeMenu();
    TabManager._attachMenuDismissal(menu);
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.children[0].getAttribute('role')).toBe('menuitem');
    expect(document.activeElement).toBe(menu.children[0]);
    menu.children[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(menu.children[1]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('.tab-context-menu')).toBeNull();
    expect(document.activeElement).toBe(icon);
  });

  it('after a mouse press it is left as it was: focus is not moved', () => {
    const icon = document.getElementById('icon');
    icon.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const menu = makeMenu();
    TabManager._attachMenuDismissal(menu);
    expect(document.activeElement).toBe(icon);
  });

  it('a modifier key alone is not a key press', () => {
    const icon = document.getElementById('icon');
    icon.focus();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    expect(window.VexInputModality.keyboard).toBe(false);
  });
});
