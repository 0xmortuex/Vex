// @vitest-environment jsdom
// Customize the toolbar (js/toolbar-limit.js model, js/toolbar-customize.js hands, js/toolbar-overflow.js squeeze):
// the placement model (any number of buttons, order, swap, panels, saved, reset), the sidebar panels placed in the
// bar, the right-click menus, the drag logic (fake rectangles), the dialog and the narrow-window overflow.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const BUILTIN = ['btn-incognito', 'btn-tor', 'btn-notes-top', 'btn-attention', 'btn-downloads-top', 'btn-extensions', 'btn-dev-dash',
  'btn-toggle-ai', 'btn-split', 'btn-settings-top', 'btn-command', 'btn-profile'];

let L, C, O;

function fresh(name) {
  const p = require.resolve('../../src/renderer/js/' + name);
  delete require.cache[p];
  return require(p);
}

// A toy layout: the address field gets what the bar's width leaves after the left side and every visible button.
let BAR_W = 1600;
const LEFT = 300, BTN = 40;
function urlWidth() {
  const bar = document.getElementById('top-bar');
  const shown = [...bar.querySelectorAll('button')].filter(b => !b.hidden && !b.classList.contains('tb-overflowed') && !b.closest('#window-controls'));
  const compact = bar.classList.contains('tb-compact') ? 60 : 0;
  return Math.max(60, BAR_W - LEFT + compact - BTN * shown.length - 120);
}

function build() {
  document.body.innerHTML = `
    <div id="top-bar"><div id="top-bar-drag"></div>
      <div id="top-bar-left"><button id="btn-back"></button></div>
      <div id="url-bar-wrapper"><div id="url-bar"><input id="url-input"></div></div>
      <div id="top-bar-right">
        ${BUILTIN.map(id => `<button id="${id}" class="nav-btn" title="${id}"${id === 'btn-attention' || id === 'btn-dev-dash' ? ' hidden' : ''}><svg id="svg-${id}"></svg></button>`).join('')}
      </div>
      <div id="window-controls"><button id="btn-close"></button></div></div>
    <div id="icon-sidebar">
      <button class="sidebar-icon" data-panel="start" title="Start Page"><svg></svg></button>
      <button class="sidebar-icon" data-panel="notes" title="Notes (Ctrl+Shift+N)"><svg class="n"></svg></button>
      <button class="sidebar-icon" data-panel="history" title="History (Ctrl+H)"><svg class="h"></svg></button>
      <button class="sidebar-icon" data-panel="whatsapp" title="WhatsApp"><svg class="w"></svg></button>
      <button class="sidebar-icon" data-panel="site_abc" title="Example (pinned site — right-click for options)"><img src="x.png"></button>
      <button class="sidebar-icon" data-panel="gameguide_x" title="Game guide"><svg></svg></button>
    </div>
    <div id="toolbar-buttons-list"></div><button id="btn-toolbar-customize"></button><button id="btn-toolbar-buttons-reset"></button>`;
}

beforeEach(() => {
  localStorage.clear();
  BAR_W = 1600;
  build();
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = (f) => { f(); return 1; };
  globalThis.showToast = window.showToast = vi.fn();
  Element.prototype.getClientRects = function () { return (this.hidden || this.classList.contains('tb-overflowed') || !this.isConnected) ? [] : [{}]; };
  Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'url-input') return { width: urlWidth(), left: 0, right: urlWidth(), top: 0, bottom: 30 };
    if (this.id === 'top-bar') return { width: BAR_W, left: 0, right: BAR_W, top: 0, bottom: 44 };
    return { width: 32, left: 0, right: 32, top: 0, bottom: 32 };
  };
  globalThis.SidebarManager = {
    panelLabel: (p) => ({ notes: 'Notes', history: 'History', whatsapp: 'WhatsApp', site_abc: 'Example', start: 'Start Page' }[p] || p),
    _isUrlPanel: (p) => p === 'whatsapp' || p.startsWith('site_'),
  };
  globalThis.TabManager = {
    _dismissMenu: (m) => { m._closeMenu ? m._closeMenu() : m.remove(); },
    _clampMenuToViewport: () => {},
    _attachMenuDismissal: (menu) => { menu._closeMenu = () => menu.remove(); },
  };
  globalThis.CSS = { escape: (s) => String(s).replace(/([^\w-])/g, '\\$1') };
  globalThis.VexLayer = {
    popover: (el) => el,
    open: (el, o) => { document.body.appendChild(el); el._onClose = o && o.onClose; return el; },
    close: (el) => { el.remove(); if (el._onClose) el._onClose(); },
  };
  delete globalThis.SettingsUI;
  L = fresh('toolbar-limit.js');
  globalThis.ToolbarLimit = window.ToolbarLimit = L;
  O = fresh('toolbar-overflow.js');
  globalThis.ToolbarOverflow = window.ToolbarOverflow = O;
  C = fresh('toolbar-customize.js');
  globalThis.ToolbarCustomize = window.ToolbarCustomize = C;
  C.init();
});

afterEach(async () => {
  C.destroy();
  await new Promise(r => setTimeout(r, 5));   // the one-shot click guard that follows a drag comes off on the next task
  document.querySelectorAll('.tab-context-menu, .tbc-overlay, .tb-overflow-menu').forEach(n => n.remove());
});

const bar = () => [...document.getElementById('top-bar-right').children].filter(el => el.dataset.tbId && L.shownIds().includes(el.dataset.tbId)).map(el => el.dataset.tbId);

describe('the model: four is the default, not a limit', () => {
  it('starts with the default four in the order the bar draws them and no key written', () => {
    expect(L.shownIds()).toEqual(['btn-attention', 'btn-downloads-top', 'btn-settings-top', 'btn-profile']);
    expect(localStorage.getItem('vex.toolbarShown')).toBeNull();
    expect(localStorage.getItem('vex.toolbarMenu')).toBeNull();
  });
  it('takes as many buttons as are asked for, panels included, and keeps all of them', () => {
    for (const id of ['btn-notes-top', 'btn-tor', 'btn-split', 'btn-extensions', 'btn-command', 'panel:notes', 'panel:history', 'panel:whatsapp']) L.place(id, 'bar');
    expect(L.shownIds()).toHaveLength(4 + 8);
    expect(L.where('panel:history')).toBe('bar');
    expect(L.menuIds()).not.toContain('btn-notes-top');
  });
  it('places at an index, moves along the bar and stops at the ends', () => {
    L.place('btn-tor', 'bar', 0);
    expect(L.shownIds()[0]).toBe('btn-tor');
    expect(L.move('btn-tor', -1)).toBe(false);
    expect(L.move('btn-tor', 1)).toBe(true);
    expect(L.shownIds().slice(0, 2)).toEqual(['btn-attention', 'btn-tor']);
    expect(L.move('btn-profile', 1)).toBe(false);
  });
  it('steps over a neighbour that is out of sight', () => {
    // [attention (hidden), downloads, settings, profile]: Downloads has nothing visible to its left
    expect(L.move('btn-downloads-top', -1, (x) => x === 'btn-attention')).toBe(false);
    expect(L.move('btn-settings-top', -1, (x) => x === 'btn-downloads-top')).toBe(true);
    expect(L.shownIds()).toEqual(['btn-settings-top', 'btn-attention', 'btn-downloads-top', 'btn-profile']);
  });
  it('drops next to a button, also across the bar and the menu', () => {
    L.moveNextTo('btn-profile', 'btn-attention', false);
    expect(L.shownIds()[0]).toBe('btn-profile');
    L.moveNextTo('btn-tor', 'btn-split', true);   // Split is folded: Tor joins the menu right after it
    const menu = L.menuIds();
    expect(menu.indexOf('btn-tor')).toBe(menu.indexOf('btn-split') + 1);
    expect(L.shownIds()).not.toContain('btn-tor');
  });
  it('swaps two buttons, across the bar and the menu', () => {
    L.swap('btn-downloads-top', 'btn-profile');
    expect(L.shownIds()).toEqual(['btn-attention', 'btn-profile', 'btn-settings-top', 'btn-downloads-top']);
    L.swap('btn-downloads-top', 'btn-tor');   // Tor is in the menu
    expect(L.where('btn-downloads-top')).toBe('menu');
    expect(L.where('btn-tor')).toBe('bar');
    expect(L.shownIds()[3]).toBe('btn-tor');
  });
  it('a panel can be in the bar, the menu, or only in the sidebar; a toolbar button cannot be nowhere', () => {
    expect(L.where('panel:notes')).toBe('none');
    L.place('panel:notes', 'menu');
    expect(L.where('panel:notes')).toBe('menu');
    L.setShown('panel:notes', true);
    expect(L.where('panel:notes')).toBe('bar');
    L.setShown('panel:notes', false);
    expect(L.where('panel:notes')).toBe('none');
    expect(() => L.place('btn-tor', 'none')).toThrow(/not nowhere/);
  });
  it('refuses ids that are not buttons or panels', () => {
    expect(() => L.place('btn-nope', 'bar')).toThrow(/unknown toolbar button/);
    expect(() => L.panelId('a b')).toThrow(/not a usable panel name/);
    expect(() => L.place('panel:notes', 'sideways')).toThrow(/cannot place/);
    expect(() => L.move('panel:notes', 1)).toThrow(/not in the toolbar or the menu/);
  });
  it('saves both lists and tells the toolbar', () => {
    const heard = vi.fn();
    window.addEventListener('vex:toolbar-shown', heard);
    L.place('panel:history', 'bar', 1);
    window.removeEventListener('vex:toolbar-shown', heard);
    expect(JSON.parse(localStorage.getItem('vex.toolbarShown'))[1]).toBe('panel:history');
    expect(JSON.parse(localStorage.getItem('vex.toolbarMenu'))).toEqual(L.menuIds());
    expect(heard).toHaveBeenCalled();
  });
  it('survives a reload: a new module reads the same placement', () => {
    L.place('panel:notes', 'bar', 0);
    L.place('btn-tor', 'menu', 0);
    const again = fresh('toolbar-limit.js');
    expect(again.shownIds()).toEqual(L.shownIds());
    expect(again.menuIds()).toEqual(L.menuIds());
    expect(again.menuIds()[0]).toBe('btn-tor');
  });
  it('reset removes both keys and goes back to the default four', () => {
    L.place('panel:notes', 'bar');
    L.reset();
    expect(localStorage.getItem('vex.toolbarShown')).toBeNull();
    expect(localStorage.getItem('vex.toolbarMenu')).toBeNull();
    expect(L.shownIds()).toEqual(L.DEFAULT_SHOWN);
  });
  it('leaves out an id this version does not know, and throws on a broken value', () => {
    localStorage.setItem('vex.toolbarShown', JSON.stringify(['btn-profile', 'btn-from-the-future', 'panel:notes']));
    expect(L.shownIds()).toEqual(['btn-profile', 'panel:notes']);
    localStorage.setItem('vex.toolbarMenu', '{oops');
    expect(() => L.menuIds()).toThrow(/not valid JSON/);
    localStorage.setItem('vex.toolbarMenu', JSON.stringify([1]));
    expect(() => L.menuIds()).toThrow(/only button ids/);
  });
});

describe('a sidebar panel placed in the toolbar', () => {
  it('lists every rail button as something that can be placed, but not a temporary game guide', () => {
    const ids = C.catalog().map(c => c.id);
    for (const id of BUILTIN) expect(ids).toContain(id);
    for (const p of ['start', 'notes', 'history', 'whatsapp', 'site_abc']) expect(ids).toContain('panel:' + p);
    expect(ids).not.toContain('panel:gameguide_x');
    const groups = Object.fromEntries(C.catalog().map(c => [c.id, c.group]));
    expect(groups['panel:notes']).toBe('Sidebar panels');
    expect(groups['panel:whatsapp']).toBe('Apps');
    expect(groups['panel:site_abc']).toBe('Pinned sites');
    expect(groups['btn-tor']).toBe('Toolbar buttons');
  });
  it('is a button of the bar with the rail button icon, tooltip and name, drawn in the saved place', () => {
    L.place('panel:notes', 'bar', 0);
    const el = document.getElementById('btn-tbp-notes');
    expect(el).not.toBeNull();
    expect(el.classList.contains('nav-btn')).toBe(true);
    expect(el.parentElement.id).toBe('top-bar-right');
    expect(el.title).toBe('Notes (Ctrl+Shift+N)');
    expect(el.getAttribute('aria-label')).toBe('Notes');
    expect(el.querySelector('svg.n')).not.toBeNull();
    expect(bar()[0]).toBe('panel:notes');
  });
  it('a click is the rail button click, with the Shift key it carried', () => {
    L.place('panel:history', 'bar');
    const src = document.querySelector('.sidebar-icon[data-panel="history"]');
    const got = [];
    src.addEventListener('click', (e) => got.push(e.shiftKey));
    document.getElementById('btn-tbp-history').click();
    document.getElementById('btn-tbp-history').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(got).toEqual([false, true]);
  });
  it('follows the rail button: active state, unread badge, a renamed tooltip, and goes when the site is unpinned', async () => {
    L.place('panel:whatsapp', 'bar');
    const src = document.querySelector('.sidebar-icon[data-panel="whatsapp"]');
    const el = () => document.getElementById('btn-tbp-whatsapp');
    expect(el().classList.contains('active')).toBe(false);
    src.classList.add('active');
    const b = document.createElement('span');
    b.className = 'panel-badge';
    b.textContent = '7';
    src.appendChild(b);
    src.title = 'WhatsApp Web';
    C.sync();
    expect(el().classList.contains('active')).toBe(true);
    expect(el().getAttribute('aria-pressed')).toBe('true');
    expect(el().querySelector('.tb-panel-badge').hidden).toBe(false);
    expect(el().querySelector('.tb-panel-badge').textContent).toBe('7');
    expect(el().title).toBe('WhatsApp Web');
    src.remove();
    C.sync();
    expect(el()).toBeNull();
    expect(L.where('panel:whatsapp')).toBe('bar');   // the choice is kept; the button returns with the site
  });
  it('removing it from the toolbar takes the button away and leaves the sidebar alone', () => {
    L.place('panel:notes', 'bar');
    L.place('panel:notes', 'none');
    expect(document.getElementById('btn-tbp-notes')).toBeNull();
    expect(document.querySelector('.sidebar-icon[data-panel="notes"]')).not.toBeNull();
  });
  it('the saved order is the order on screen, and a bar nobody changed is never touched', () => {
    const before = [...document.getElementById('top-bar-right').children].map(e => e.id);
    C.sync();
    expect([...document.getElementById('top-bar-right').children].map(e => e.id)).toEqual(before);
    L.place('btn-profile', 'bar', 0);
    L.place('btn-settings-top', 'bar', 1);
    expect(bar().slice(0, 2)).toEqual(['btn-profile', 'btn-settings-top']);
    const kids = [...document.getElementById('top-bar-right').children].map(e => e.id);
    expect(kids.indexOf('btn-profile')).toBeLessThan(kids.indexOf('btn-settings-top'));
    expect(kids.indexOf('btn-settings-top')).toBeLessThan(kids.indexOf('btn-downloads-top'));
  });
});

describe('the right-click menus', () => {
  const rows = () => [...document.querySelectorAll('.tb-ctx-menu .tab-context-item')].map(r => r.textContent);
  const rightClick = (el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 20 }));

  it('a button in the middle of the bar: move left, move right, to the three-dot menu, customize, reset', () => {
    rightClick(document.getElementById('btn-settings-top'));
    expect(rows()).toEqual(['Move left', 'Move right', 'Move to the three-dot menu', 'Customize toolbar…', 'Reset toolbar']);
    expect(document.querySelector('.tb-ctx-menu').getAttribute('role')).toBe('menu');
    expect(document.querySelector('.tb-ctx-title').textContent).toBe('Settings');
    expect(document.querySelectorAll('.tb-ctx-menu [role="menuitem"]')).toHaveLength(5);
  });
  it('the first button has no Move left, the last no Move right; the Inbox bell with nothing in it does not count as a place', () => {
    // [attention (hidden), downloads, settings, profile]
    rightClick(document.getElementById('btn-downloads-top'));
    expect(rows()).not.toContain('Move left');
    expect(rows()).toContain('Move right');
    document.querySelector('.tb-ctx-menu').remove();
    rightClick(document.getElementById('btn-profile'));
    expect(rows()).toContain('Move left');
    expect(rows()).not.toContain('Move right');
  });
  it('Move left runs on the model and the menu goes away', () => {
    rightClick(document.getElementById('btn-profile'));
    [...document.querySelectorAll('.tb-ctx-menu .tab-context-item')].find(r => r.textContent === 'Move left').click();
    expect(L.shownIds()).toEqual(['btn-attention', 'btn-downloads-top', 'btn-profile', 'btn-settings-top']);
    expect(document.querySelector('.tb-ctx-menu')).toBeNull();
  });
  it('Move to the three-dot menu folds the button; the menu then has it', () => {
    rightClick(document.getElementById('btn-downloads-top'));
    [...document.querySelectorAll('.tb-ctx-menu .tab-context-item')].find(r => r.textContent === 'Move to the three-dot menu').click();
    expect(L.where('btn-downloads-top')).toBe('menu');
  });
  it('a placed panel can also be removed from the toolbar, and has its sidebar settings', () => {
    globalThis.SettingsUI = { openSection: vi.fn() };
    L.place('panel:notes', 'bar');
    rightClick(document.getElementById('btn-tbp-notes'));
    expect(rows()).toContain('Remove from toolbar');
    expect(rows()).toContain('Open its settings');
    [...document.querySelectorAll('.tb-ctx-menu .tab-context-item')].find(r => r.textContent === 'Open its settings').click();
    expect(globalThis.SettingsUI.openSection).toHaveBeenCalledWith('sidebar-manager-list');
    rightClick(document.getElementById('btn-tbp-notes'));
    [...document.querySelectorAll('.tb-ctx-menu .tab-context-item')].find(r => r.textContent === 'Remove from toolbar').click();
    expect(L.where('panel:notes')).toBe('none');
  });
  it('a toolbar button with settings of its own opens them', () => {
    globalThis.SettingsUI = { openSection: vi.fn() };
    rightClick(document.getElementById('btn-profile'));
    [...document.querySelectorAll('.tb-ctx-menu .tab-context-item')].find(r => r.textContent === 'Open its settings').click();
    expect(globalThis.SettingsUI.openSection).toHaveBeenCalledWith('settings-profiles');
  });
  it('empty room in the toolbar, and the three-dot button: Customize toolbar and Reset toolbar only', () => {
    rightClick(document.getElementById('top-bar'));
    expect(rows()).toEqual(['Customize toolbar…', 'Reset toolbar']);
    document.querySelector('.tb-ctx-menu').remove();
    L.place('btn-tor', 'menu');
    O.relayout();
    rightClick(document.getElementById('btn-toolbar-overflow'));
    expect(rows()).toEqual(['Customize toolbar…', 'Reset toolbar']);
  });
  it('Reset toolbar puts the default back and says so', () => {
    L.place('panel:notes', 'bar');
    rightClick(document.getElementById('top-bar'));
    [...document.querySelectorAll('.tb-ctx-menu .tab-context-item')].find(r => r.textContent === 'Reset toolbar').click();
    expect(L.shownIds()).toEqual(L.DEFAULT_SHOWN);
    expect(window.showToast).toHaveBeenCalledWith('Toolbar put back to the default');
  });
  it('Customize toolbar opens the dialog', () => {
    rightClick(document.getElementById('top-bar'));
    [...document.querySelectorAll('.tb-ctx-menu .tab-context-item')].find(r => r.textContent === 'Customize toolbar…').click();
    expect(document.querySelector('.tbc-dialog')).not.toBeNull();
  });
  it('a right-click a button already handled keeps its own menu', () => {
    const own = document.getElementById('btn-split');
    own.addEventListener('contextmenu', (e) => e.preventDefault());
    rightClick(own);
    expect(document.querySelector('.tb-ctx-menu')).toBeNull();
  });
  it('a row of the three-dot menu: move up / down, to the toolbar; the open menu closes first', () => {
    O.relayout();
    document.getElementById('btn-toolbar-overflow').click();
    const row = document.querySelector('.tb-overflow-item[data-tb-id="btn-incognito"]');
    expect(row).not.toBeNull();
    rightClick(row);
    expect(document.querySelector('.tb-overflow-menu')).toBeNull();
    expect(rows()).toContain('Move down');
    expect(rows()).toContain('Move to the toolbar');
    expect(rows()).not.toContain('Move up');   // Private window is the first row of the menu
  });
});

describe('dragging: where would a button go', () => {
  const items = [
    { id: 'a', left: 0, right: 30, top: 0, bottom: 30 },
    { id: 'b', left: 34, right: 64, top: 0, bottom: 30 },
    { id: 'c', left: 68, right: 98, top: 0, bottom: 30 },
  ];
  const band = { top: 0, bottom: 30 };
  it('the edges of a button are before and after, its middle is a swap', () => {
    expect(C.dropTarget(items, 36, 15, band)).toEqual({ kind: 'before', id: 'b' });
    expect(C.dropTarget(items, 49, 15, band)).toEqual({ kind: 'swap', id: 'b' });
    expect(C.dropTarget(items, 62, 15, band)).toEqual({ kind: 'after', id: 'b' });
  });
  it('the gap between two buttons is after the left one; before the first and past the last work too', () => {
    expect(C.dropTarget(items, 66, 15, band)).toEqual({ kind: 'after', id: 'b' });
    expect(C.dropTarget(items, -10, 15, band)).toEqual({ kind: 'before', id: 'a' });
    expect(C.dropTarget(items, 400, 15, band)).toEqual({ kind: 'after', id: 'c' });
  });
  it('far above or below the bar is no drop, and an empty bar takes the button at its end', () => {
    expect(C.dropTarget(items, 40, 200, band)).toBeNull();
    expect(C.dropTarget(items, 40, -100, band)).toBeNull();
    expect(C.dropTarget([], 40, 15, band)).toEqual({ kind: 'bar-end' });
  });
  it('in the open menu: above a row middle is before it, below the last is after it, an empty menu is its end', () => {
    const rowsList = [{ id: 'x', top: 0, bottom: 30 }, { id: 'y', top: 30, bottom: 60 }];
    expect(C.menuRowTarget(rowsList, 10)).toEqual({ kind: 'menu-before', id: 'x' });
    expect(C.menuRowTarget(rowsList, 40)).toEqual({ kind: 'menu-before', id: 'y' });
    expect(C.menuRowTarget(rowsList, 58)).toEqual({ kind: 'menu-after', id: 'y' });
    expect(C.menuRowTarget([], 5)).toEqual({ kind: 'menu-end' });
  });
  it('commit turns each drop into the model call', () => {
    C.commit('btn-profile', { kind: 'before', id: 'btn-attention' });
    expect(L.shownIds()[0]).toBe('btn-profile');
    C.commit('btn-profile', { kind: 'swap', id: 'btn-settings-top' });
    expect(L.shownIds().indexOf('btn-settings-top')).toBe(0);
    C.commit('btn-downloads-top', { kind: 'menu-end' });
    expect(L.where('btn-downloads-top')).toBe('menu');
    C.commit('btn-downloads-top', { kind: 'bar-end' });
    expect(L.shownIds().at(-1)).toBe('btn-downloads-top');
    expect(() => C.commit('btn-tor', { kind: 'sideways' })).toThrow(/unknown drop/);
  });
});

describe('dragging with the pointer', () => {
  const ptr = (type, x, y, target) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    (target || document).dispatchEvent(e);
    return e;
  };
  // Lay the bar's buttons out in a row of 30px boxes, 34px apart, from x = 100.
  function lay() {
    const ids = L.shownIds();
    Element.prototype.getBoundingClientRect = function () {
      if (this.id === 'top-bar-right') return { width: 400, left: 100, right: 500, top: 0, bottom: 30 };
      if (this.id === 'btn-toolbar-overflow') return { width: 30, left: 600, right: 630, top: 0, bottom: 30 };
      const i = ids.findIndex(id => L.elementId(id) === this.id);
      if (i >= 0) return { width: 30, left: 100 + 34 * i, right: 130 + 34 * i, top: 0, bottom: 30 };
      if (this.id === 'url-input') return { width: 400, left: 0, right: 400, top: 0, bottom: 30 };
      return { width: 30, left: 0, right: 30, top: 0, bottom: 30 };
    };
  }
  beforeEach(() => { L.place('panel:notes', 'bar'); lay(); document.getElementById('btn-toolbar-overflow').hidden = false; });

  it('a press and release without moving is an ordinary click, not a drag', () => {
    const el = document.getElementById('btn-downloads-top');
    const clicked = vi.fn();
    el.addEventListener('click', clicked);
    ptr('pointerdown', 150, 15, el);
    ptr('pointerup', 150, 15, el);
    el.click();
    expect(clicked).toHaveBeenCalled();
    expect(C.isDragging()).toBe(false);
  });
  it('dragging past the threshold shows a ghost and a drop marker; dropping on the middle of another button swaps', () => {
    const ids = L.shownIds();
    const from = document.getElementById('btn-downloads-top');
    const fromX = 100 + 34 * ids.indexOf('btn-downloads-top') + 15;
    const toX = 100 + 34 * ids.indexOf('btn-profile') + 15;
    ptr('pointerdown', fromX, 15, from);
    ptr('pointermove', fromX + 2, 15);
    expect(C.isDragging()).toBe(false);          // under the threshold
    ptr('pointermove', fromX + 20, 16);
    expect(C.isDragging()).toBe(true);
    expect(document.querySelector('.tb-drag-ghost')).not.toBeNull();
    expect(from.classList.contains('tb-dragging')).toBe(true);
    ptr('pointermove', toX, 15);
    expect(document.getElementById('btn-profile').classList.contains('tb-drop-swap')).toBe(true);
    ptr('pointerup', toX, 15);
    expect(C.isDragging()).toBe(false);
    expect(document.querySelector('.tb-drag-ghost')).toBeNull();
    expect(document.querySelector('.tb-drop-marker')).toBeNull();
    expect(document.querySelector('.tb-drop-swap')).toBeNull();
    const after = L.shownIds();
    expect(after.indexOf('btn-downloads-top')).toBe(ids.indexOf('btn-profile'));
    expect(after.indexOf('btn-profile')).toBe(ids.indexOf('btn-downloads-top'));
  });
  it('dropping on the edge of a button puts it before; a marker shows where', () => {
    const ids = L.shownIds();
    const from = document.getElementById('btn-profile');
    const fromX = 100 + 34 * ids.indexOf('btn-profile') + 15;
    const edge = 100 + 34 * ids.indexOf('btn-downloads-top') + 2;
    ptr('pointerdown', fromX, 15, from);
    ptr('pointermove', fromX - 30, 15);
    ptr('pointermove', edge, 15);
    const marker = document.querySelector('.tb-drop-marker');
    expect(marker.hidden).toBe(false);
    expect(marker.classList.contains('tb-drop-v')).toBe(true);
    ptr('pointerup', edge, 15);
    const after = L.shownIds();
    expect(after.indexOf('btn-profile')).toBe(after.indexOf('btn-downloads-top') - 1);
  });
  it('Escape puts it back: nothing changes, nothing is left on screen', () => {
    const before = L.shownIds();
    const from = document.getElementById('btn-profile');
    ptr('pointerdown', 300, 15, from);
    ptr('pointermove', 330, 15);
    ptr('pointermove', 110, 15);
    expect(C.isDragging()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(C.isDragging()).toBe(false);
    ptr('pointerup', 110, 15);
    expect(L.shownIds()).toEqual(before);
    expect(document.querySelector('.tb-drag-ghost, .tb-drop-marker')).toBeNull();
    expect(document.body.classList.contains('tb-drag-active')).toBe(false);
    expect(from.classList.contains('tb-dragging')).toBe(false);
  });
  it('a lost pointer (cancel) ends the drag the same way', () => {
    ptr('pointerdown', 300, 15, document.getElementById('btn-profile'));
    ptr('pointermove', 340, 15);
    ptr('pointercancel', 340, 15);
    expect(C.isDragging()).toBe(false);
    expect(document.querySelector('.tb-drag-ghost')).toBeNull();
  });
  it('dropping on the three-dot button folds the button into the menu', () => {
    const from = document.getElementById('btn-downloads-top');
    ptr('pointerdown', 150, 15, from);
    ptr('pointermove', 200, 15);
    ptr('pointermove', 610, 15);
    expect(document.getElementById('btn-toolbar-overflow').hidden).toBe(false);
    ptr('pointerup', 610, 15);
    expect(L.where('btn-downloads-top')).toBe('menu');
  });
  it('dragging a row out of the open menu into the bar places it there', () => {
    L.place('btn-tor', 'menu');
    O.relayout();
    document.getElementById('btn-toolbar-overflow').click();
    const m = document.querySelector('.tb-overflow-menu');
    const row = m.querySelector('.tb-overflow-item[data-tb-id="btn-tor"]');
    const ids = L.shownIds();
    const x = 100 + 34 * ids.indexOf('btn-downloads-top') + 2;
    ptr('pointerdown', 620, 100, row);
    ptr('pointermove', 400, 80);
    ptr('pointermove', x, 15);
    ptr('pointerup', x, 15);
    expect(L.where('btn-tor')).toBe('bar');
    const after = L.shownIds();
    expect(after.indexOf('btn-tor')).toBe(after.indexOf('btn-downloads-top') - 1);
  });
  it('the click that ends a drag does not also press the button', () => {
    const from = document.getElementById('btn-downloads-top');
    const clicked = vi.fn();
    from.addEventListener('click', clicked);
    ptr('pointerdown', 150, 15, from);
    ptr('pointermove', 200, 15);
    ptr('pointerup', 200, 15);
    from.click();   // the browser's click right after pointerup
    expect(clicked).not.toHaveBeenCalled();
  });
  it('only the left button starts one', () => {
    const e = new MouseEvent('pointerdown', { bubbles: true, button: 2, clientX: 150, clientY: 15 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    document.getElementById('btn-downloads-top').dispatchEvent(e);
    ptr('pointermove', 250, 15);
    expect(C.isDragging()).toBe(false);
  });
});

describe('the dialog', () => {
  it('lists every toolbar button and every rail button, in groups, each with a place to put it', () => {
    C.open();
    const dlg = document.querySelector('.tbc-dialog');
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const selects = [...dlg.querySelectorAll('select.tbc-select')];
    expect(selects).toHaveLength(C.catalog().length);
    expect(selects.every(s => s.getAttribute('aria-label'))).toBe(true);
    const heads = [...dlg.querySelectorAll('h5')].map(h => h.textContent);
    expect(heads).toEqual(['Toolbar buttons', 'Sidebar panels', 'Apps', 'Pinned sites']);
    const notes = dlg.querySelector('[data-focus-key="sel:panel:notes"]');
    expect([...notes.options].map(o => o.value)).toEqual(['bar', 'menu', 'none']);
    const tor = dlg.querySelector('[data-focus-key="sel:btn-tor"]');
    expect([...tor.options].map(o => o.value)).toEqual(['bar', 'menu']);
  });
  it('choosing a place puts the button there at once, and the lists redraw', () => {
    C.open();
    const sel = document.querySelector('[data-focus-key="sel:panel:history"]');
    sel.value = 'bar';
    sel.dispatchEvent(new Event('change'));
    expect(L.where('panel:history')).toBe('bar');
    expect(document.getElementById('btn-tbp-history')).not.toBeNull();
    const barList = document.querySelectorAll('.tbc-order')[0];
    expect([...barList.querySelectorAll('li')].map(li => li.getAttribute('aria-label'))).toContain('History');
  });
  it('the arrows reorder the bar and menu lists; the first and last cannot go further', () => {
    C.open();
    const first = document.querySelectorAll('.tbc-order')[0].querySelector('li');
    expect(first.querySelectorAll('button')[0].disabled).toBe(true);
    const li = [...document.querySelectorAll('.tbc-order')[0].querySelectorAll('li')][1];
    li.querySelectorAll('button')[1].click();
    expect(L.shownIds()[1]).not.toBe('btn-downloads-top');
  });
  it('Reset toolbar and Done; Escape closes it and gives the focus back', () => {
    const opener = document.getElementById('btn-toolbar-customize');
    opener.focus();
    L.place('panel:notes', 'bar');
    C.open();
    document.querySelector('[data-reset]').click();
    expect(L.shownIds()).toEqual(L.DEFAULT_SHOWN);
    document.querySelector('.tbc-overlay').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('.tbc-dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it('is opened once, and leaves nothing behind when closed (listeners are removed)', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    C.open(); C.open();
    expect(document.querySelectorAll('.tbc-dialog')).toHaveLength(1);
    C.close();
    expect(document.querySelector('.tbc-dialog')).toBeNull();
    const added = add.mock.calls.filter(c => c[0] === 'vex:toolbar-shown').length;
    const removed = remove.mock.calls.filter(c => c[0] === 'vex:toolbar-shown').length;
    expect(removed).toBe(added);
    add.mockRestore(); remove.mockRestore();
  });
  it('Settings > Layout has a button that opens it', () => {
    L.init();
    document.getElementById('btn-toolbar-customize').click();
    expect(document.querySelector('.tbc-dialog')).not.toBeNull();
  });
});

describe('a narrow window: buttons fold on their own, last placed first', () => {
  function fill() {
    for (const id of ['btn-notes-top', 'btn-tor', 'btn-split', 'btn-extensions', 'btn-command', 'panel:notes', 'panel:history']) L.place(id, 'bar');
  }
  it('a wide window shows them all in the bar and no three-dot button', () => {
    BAR_W = 1900;
    fill();
    O.relayout();
    expect(O.moved().map(e => e.id)).toEqual(L.menuIds().filter(id => document.getElementById(L.elementId(id)) && !document.getElementById(L.elementId(id)).hidden).map(id => L.elementId(id)));
    expect(O.squeezed()).toEqual([]);
    expect(window.showToast).not.toHaveBeenCalled();
  });
  it('a narrow window moves the last buttons first, keeps the address field at least 240, and says so once', () => {
    BAR_W = 900;
    fill();
    O.relayout();
    const squeezed = O.squeezed().map(e => e.dataset.tbId || e.id);
    expect(squeezed.length).toBeGreaterThan(0);
    // the last-placed panel goes before the first-placed button
    const barOrder = L.shownIds();
    const idx = squeezed.map(id => barOrder.indexOf(id)).filter(i => i >= 0);
    expect(idx).toEqual([...idx].sort((a, b) => b - a));
    expect(urlWidth()).toBeGreaterThanOrEqual(O.MIN_URL_INPUT);
    expect(O.MIN_URL_INPUT).toBe(240);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls[0][0]).toMatch(/narrow/);
    O.relayout(); O.relayout();
    expect(window.showToast).toHaveBeenCalledTimes(1);   // once
  });
  it('they come back when the window grows again', () => {
    BAR_W = 900;
    fill();
    O.relayout();
    const n = O.squeezed().length;
    expect(n).toBeGreaterThan(0);
    BAR_W = 1900;
    O.relayout();
    expect(O.squeezed()).toEqual([]);
    expect(document.querySelector('.tb-overflowed:not([data-folded])')).not.toBeNull();   // the chosen-folded ones are still folded
    expect(document.getElementById('btn-tbp-history').classList.contains('tb-overflowed')).toBe(false);
  });
  it('a panel placed in the menu is a row of it, that opens the panel', () => {
    L.place('panel:history', 'menu');
    O.relayout();
    document.getElementById('btn-toolbar-overflow').click();
    const row = document.querySelector('.tb-overflow-item[data-tb-id="panel:history"]');
    expect(row).not.toBeNull();
    const got = vi.fn();
    document.querySelector('.sidebar-icon[data-panel="history"]').addEventListener('click', got);
    row.click();
    expect(got).toHaveBeenCalled();
  });
  it('the three-dot menu follows the order the person gave it', () => {
    L.place('btn-split', 'menu', 0);
    L.place('btn-tor', 'menu', 1);
    O.relayout();
    expect(O.moved().slice(0, 2).map(e => e.id)).toEqual(['btn-split', 'btn-tor']);
  });
});

describe('wiring', () => {
  it('is a late module, linked stylesheet and in the lint list, and a feature manifest owns both keys', () => {
    const lazy = fs.readFileSync(path.join(ROOT, 'src/renderer/js/lazy-boot.js'), 'utf8');
    expect(lazy).toContain("'js/toolbar-customize.js'");
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    expect(html).not.toContain('js/toolbar-customize.js');
    expect(html).toContain('css/toolbar-customize.css');
    expect(html.indexOf('css/toolbar-customize.css')).toBeLessThan(html.indexOf('css/a11y.css'));
    expect(html).toContain('id="btn-toolbar-customize"');
    const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
    expect(pkg).toContain('src/renderer/js/toolbar-customize.js');
  });
  it('every string it shows has Turkish', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    const tr = VexI18nUI.TABLE.tr;
    for (const s of ['Move left', 'Move right', 'Move up', 'Move down', 'Move to the three-dot menu', 'Move to the toolbar', 'Remove from toolbar',
      'Open its settings', 'Customize toolbar…', 'Customize toolbar', 'Reset toolbar', 'Toolbar put back to the default', 'Done', 'Every button',
      'Toolbar buttons', 'Sidebar panels', 'Apps', 'Pinned sites', 'Place this button', 'In the toolbar', 'In the three-dot menu', 'Sidebar only',
      'In the toolbar, left to right', 'In the three-dot menu, top to bottom', 'Nothing is in the three-dot menu.',
      'Nothing here: the toolbar shows only the three-dot menu.',
      'The window is narrow, so some toolbar buttons moved into the three-dot menu. They come back when there is room.',
      'Customizable toolbar']) expect(tr[s], s).toBeTruthy();
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer/js/toolbar-customize.js'), 'utf8');
    const lead = /<p class="tbc-lead">([^<]+)<\/p>/.exec(src)[1];
    expect(tr[lead], 'the dialog lead').toBeTruthy();
    expect(tr['Hidden while Simple mode is on']).toBeTruthy();
  });
});

// A look or a mode hides some buttons on its own (browser looks: Notes; Simple mode: the power buttons; the sidebar: the gear).
// What the model puts in the bar or the three-dot menu must be forced into sight (css/toolbar-customize.css reads data-tb-placed).
describe('a button the model lists is never hidden by a look or a mode', () => {
  const placedIds = () => BUILTIN.filter(id => document.getElementById(id).hasAttribute('data-tb-placed'));
  const simple = (on) => { globalThis.VexSimpleMode = { isSimple: () => on, TOOLBAR: ['btn-tor', 'btn-notes-top', 'btn-extensions', 'btn-toggle-ai', 'btn-split', 'btn-dev-dash', 'btn-profile'] }; C.sync(); };
  afterEach(() => { delete globalThis.VexSimpleMode; });

  it('by default every button in the three-dot menu is marked, the default bar keeps its own conditional buttons conditional', () => {
    C.sync();
    expect(placedIds().sort()).toEqual(L.menuIds().sort());
    expect(placedIds()).toContain('btn-notes-top');
    expect(placedIds()).not.toContain('btn-settings-top');
    expect(placedIds()).not.toContain('btn-profile');
  });
  it('Notes put in the three-dot menu or in the bar is marked either way, and moving it keeps it marked', () => {
    L.place('btn-notes-top', 'bar');
    expect(document.getElementById('btn-notes-top').hasAttribute('data-tb-placed')).toBe(true);
    L.place('btn-notes-top', 'menu');
    expect(document.getElementById('btn-notes-top').hasAttribute('data-tb-placed')).toBe(true);
  });
  it('once the toolbar is customised, every button in it is marked, the default ones too', () => {
    L.place('btn-tor', 'bar');
    expect(placedIds().sort()).toEqual(BUILTIN.slice().sort());
  });
  it('Simple mode keeps its power buttons away on an untouched toolbar, and the dialog says so', () => {
    simple(true);
    for (const id of ['btn-tor', 'btn-notes-top', 'btn-extensions', 'btn-toggle-ai', 'btn-split', 'btn-profile']) expect(placedIds(), id).not.toContain(id);
    expect(placedIds()).toContain('btn-incognito');
    const ov = C.open();
    expect(ov.querySelectorAll('.tbc-note').length).toBeGreaterThan(0);
    expect(ov.querySelector('.tbc-note').textContent).toBe('Hidden while Simple mode is on');
    C.close();
  });
  it('Simple mode shows them once the person customised the toolbar, and follows the mode switch', () => {
    L.place('btn-split', 'bar');
    simple(true);
    expect(placedIds().sort()).toEqual(BUILTIN.slice().sort());
    const ov = C.open();
    expect(ov.querySelectorAll('.tbc-note')).toHaveLength(0);
    C.close();
    localStorage.removeItem('vex.toolbarShown');
    localStorage.removeItem('vex.toolbarMenu');
    simple(true);
    expect(placedIds()).not.toContain('btn-split');
    globalThis.VexSimpleMode.isSimple = () => false;
    window.dispatchEvent(new CustomEvent('vex-ui-mode-changed'));
    expect(placedIds()).toContain('btn-split');
  });
  it('the stylesheet forces a marked button into sight over the looks and Simple mode, but not while it is folded or empty', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src/renderer/css/toolbar-customize.css'), 'utf8');
    const rule = /([^{}]*\[data-tb-placed\][^{}]*)\{([^}]*)\}/.exec(css);
    expect(rule[2]).toMatch(/display:\s*inline-flex\s*!important/);
    expect(rule[1]).toContain(':not([hidden])');
    expect(rule[1]).toContain('.tb-overflowed');
    expect(rule[1]).toContain('.tb-overflow-proxy');
    expect(rule[1]).not.toMatch(/data-gui-family/);
  });
});
