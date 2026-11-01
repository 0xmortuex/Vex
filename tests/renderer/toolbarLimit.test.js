// @vitest-environment jsdom
// At most four icons on the right of the toolbar (js/toolbar-limit.js): the
// default set, the rest folded into the "more" menu, a profile that already
// arranged its toolbar keeping every button, "Show in toolbar", and reset.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const ids = ['btn-incognito', 'btn-tor', 'btn-notes-top', 'btn-attention', 'btn-downloads-top', 'btn-extensions', 'btn-dev-dash',
  'btn-toggle-ai', 'btn-split', 'btn-settings-top', 'btn-command', 'btn-profile'];

function loadLimit() {
  const p = require.resolve('../../src/renderer/js/toolbar-limit.js');
  delete require.cache[p];
  const api = require(p);
  globalThis.ToolbarLimit = api;
  return api;
}
function loadOverflow() {
  const p = require.resolve('../../src/renderer/js/toolbar-overflow.js');
  delete require.cache[p];
  return require(p);
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `<div id="top-bar"><div id="top-bar-right">
    ${ids.map(id => `<button id="${id}" title="${id}"${id === 'btn-attention' || id === 'btn-dev-dash' ? ' hidden' : ''}><svg></svg></button>`).join('')}
    </div><div id="window-controls"><button id="btn-close"></button></div></div>
    <div id="toolbar-buttons-list"></div><button id="btn-toolbar-buttons-reset"></button>`;
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  Element.prototype.getClientRects = function () { return (this.hidden || this.classList.contains('tb-overflowed')) ? [] : [{}]; };
  Element.prototype.getBoundingClientRect = function () { return { width: 32, left: 0, right: 32, top: 0, bottom: 32 }; };
  delete globalThis.ToolbarLimit;
  delete globalThis.SettingsUI;
});

describe('the default four', () => {
  it('keeps Downloads, Inbox and Settings in the toolbar; everything else is folded', () => {
    const L = loadLimit();
    expect(L.DEFAULT_SHOWN).toEqual(['btn-downloads-top', 'btn-attention', 'btn-settings-top']);
    expect(L.foldedIds().sort()).toEqual(ids.filter(i => !L.DEFAULT_SHOWN.includes(i)).sort());
  });
  it('never shows more than four buttons: three kept plus the more button', () => {
    const L = loadLimit();
    expect(L.DEFAULT_SHOWN.length + 1).toBeLessThanOrEqual(4);
  });
  it('the folded buttons land in the more menu, which is shown; the kept ones stay', () => {
    loadLimit();
    const O = loadOverflow();
    O.relayout();
    const more = document.getElementById('btn-toolbar-overflow');
    expect(more.hidden).toBe(false);
    const gone = O.moved().map(e => e.id).sort();
    expect(gone).toEqual(['btn-command', 'btn-extensions', 'btn-incognito', 'btn-notes-top', 'btn-profile', 'btn-split', 'btn-toggle-ai', 'btn-tor']);
    expect(document.getElementById('btn-downloads-top').classList.contains('tb-overflowed')).toBe(false);
    // Hidden-by-themselves buttons (Inbox, Developer dashboard) are not in the menu.
    expect(gone).not.toContain('btn-attention');
    expect(gone).not.toContain('btn-dev-dash');
  });
  it('every folded button is a keyboard-reachable menu row, plus a Customize row', () => {
    loadLimit();
    const O = loadOverflow();
    O.relayout();
    document.getElementById('btn-toolbar-overflow').click();
    const rows = [...document.querySelectorAll('#toolbar-overflow-menu button[role="menuitem"]')];
    expect(rows).toHaveLength(8 + 1);
    expect(rows[rows.length - 1].textContent).toContain('Customize toolbar');
  });
  it('Customize toolbar opens the Layout section of Settings', () => {
    loadLimit();
    globalThis.SettingsUI = { openSection: vi.fn() };
    const O = loadOverflow();
    O.relayout();
    document.getElementById('btn-toolbar-overflow').click();
    document.querySelector('.tb-overflow-customize').click();
    expect(globalThis.SettingsUI.openSection).toHaveBeenCalledWith('setcat-layout');
  });
});

describe('Show in toolbar', () => {
  it('a button the user adds stays in the toolbar and the choice is saved', () => {
    const L = loadLimit();
    const O = loadOverflow();
    L.setShown('btn-notes-top', true);
    O.relayout();
    expect(JSON.parse(localStorage.getItem('vex.toolbarShown'))).toContain('btn-notes-top');
    expect(O.moved().map(e => e.id)).not.toContain('btn-notes-top');
  });
  it('a button can be taken out of the default set too', () => {
    const L = loadLimit();
    L.setShown('btn-downloads-top', false);
    expect(L.foldedIds()).toContain('btn-downloads-top');
  });
  it('rejects an id that is not a toolbar button', () => {
    const L = loadLimit();
    expect(() => L.setShown('btn-nope', true)).toThrow(/unknown toolbar button/);
  });
  it('the Settings list has one checkbox per button, reflects the state and writes on change', () => {
    const L = loadLimit();
    L.init();
    const boxes = [...document.querySelectorAll('#toolbar-buttons-list input[type=checkbox]')];
    expect(boxes).toHaveLength(ids.length);
    expect(boxes.every(b => b.getAttribute('aria-label'))).toBe(true);
    expect(boxes.find(b => b.dataset.tbId === 'btn-downloads-top').checked).toBe(true);
    const notes = boxes.find(b => b.dataset.tbId === 'btn-notes-top');
    expect(notes.checked).toBe(false);
    notes.checked = true;
    notes.dispatchEvent(new Event('change'));
    expect(L.isShown('btn-notes-top')).toBe(true);
    // and the list redraws from the saved state
    expect(document.querySelector('[data-tb-id="btn-notes-top"]').checked).toBe(true);
  });
});

describe('existing profiles', () => {
  it('a profile that hid or reordered toolbar buttons keeps every button where it was', () => {
    localStorage.setItem('vex.layout', JSON.stringify({ hidden: { 'btn-tor': true } }));
    const L = loadLimit();
    L.init();
    expect(L.foldedIds()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('vex.toolbarShown'))).toEqual(L.IDS);
  });
  it('an order or region change counts as customised too', () => {
    localStorage.setItem('vex.layout', JSON.stringify({ order: { 'top-bar-right': ['btn-tor'] } }));
    const L = loadLimit();   // migrates as it loads, like the app
    expect(JSON.parse(localStorage.getItem('vex.toolbarShown'))).toEqual(L.IDS);
  });
  it('a profile with an empty or default layout gets the four-icon default', () => {
    localStorage.setItem('vex.layout', JSON.stringify({ hidden: {}, order: {} }));
    const L = loadLimit();
    L.init();
    expect(localStorage.getItem('vex.toolbarShown')).toBeNull();
    expect(L.foldedIds().length).toBe(ids.length - 3);
  });
  it('a choice already saved is never overwritten by the migration', () => {
    localStorage.setItem('vex.layout', JSON.stringify({ hidden: { 'btn-tor': true } }));
    localStorage.setItem('vex.toolbarShown', JSON.stringify(['btn-tor']));
    const L = loadLimit();
    expect(L.migrate()).toBe(false);
    expect(L.shownIds()).toEqual(['btn-tor']);
  });
  it('a broken saved value is an error, not a silent default', () => {
    localStorage.setItem('vex.toolbarShown', '{oops');
    expect(() => loadLimit()).toThrow(/not valid JSON/);
  });
});

describe('reset', () => {
  it('goes back to the default four and tells the toolbar', () => {
    const L = loadLimit();
    L.setShown('btn-notes-top', true);
    const heard = vi.fn();
    window.addEventListener('vex:toolbar-shown', heard);
    document.getElementById('btn-toolbar-buttons-reset');
    L.reset();
    expect(localStorage.getItem('vex.toolbarShown')).toBeNull();
    expect(L.isShown('btn-notes-top')).toBe(false);
    expect(heard).toHaveBeenCalled();
  });
  it('is in the Settings reset allow-list, owned by a manifest and loaded before the overflow script', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src/renderer/js/app.js'), 'utf8');
    expect(app).toMatch(/SETTINGS_PREF_KEYS = \[[\s\S]*'vex\.toolbarShown'/);
    const man = fs.readFileSync(path.join(ROOT, 'src/renderer/js/feature-manifests.js'), 'utf8');
    expect(man).toContain("storageKeys: ['vex.toolbarShown']");
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    expect(html.indexOf('js/toolbar-limit.js')).toBeGreaterThan(-1);
    expect(html.indexOf('js/toolbar-limit.js')).toBeLessThan(html.indexOf('js/toolbar-overflow.js'));
    expect(html).toContain('id="toolbar-buttons-list"');
  });
});
