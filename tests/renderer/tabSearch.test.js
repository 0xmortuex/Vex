// @vitest-environment jsdom
//
// js/tab-search.js (T1-004): the open-tab list, ranked and keyboard-driven.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.VexIcons = { has: () => true, svg: (name) => '<svg data-icon="' + name + '"></svg>' };
const { VexTr } = require('../../src/renderer/js/vex-tr.js');
globalThis.VexTr = VexTr;
const { VexTabMru } = require('../../src/renderer/js/tab-mru.js');
globalThis.VexTabMru = VexTabMru;
const { VexTabSearch } = require('../../src/renderer/js/tab-search.js');

const mk = (id, title, url, lastViewedAt, extra = {}) => ({ id, title, url, lastViewedAt, ...extra });

function install(tabs, active) {
  globalThis.TabManager = {
    tabs, activeTabId: active, groups: [],
    displayOrder() { return this.tabs.slice(); },
    switchTab: vi.fn(),
    closeTab: vi.fn(function (id) { this.tabs = this.tabs.filter(t => t.id !== id); }),
  };
}
const type = (text) => { const i = document.querySelector('#tab-search input'); i.value = text; i.dispatchEvent(new Event('input')); };
const press = (k, opts = {}) => document.querySelector('#tab-search input').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
const rowsText = () => [...document.querySelectorAll('#tab-search .tt-row .tt-title')].map(e => e.textContent);

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="before">before</button>';
  window.showToast = vi.fn();
  install([
    mk('a', 'İstanbul Haritası', 'https://maps.example/istanbul', 10),
    mk('b', 'GitHub Issues', 'https://github.com/x/y/issues', 50),
    mk('c', 'Şişli Haberleri', 'https://news.example/sisli', 30, { pinned: true }),
    mk('d', 'Inbox', 'https://mail.example/', 40, { sleeping: true }),
  ], 'd');
});
afterEach(() => { VexTabSearch.close(); delete globalThis.TabManager; });

describe('rank', () => {
  const rows = () => VexTabMru.list().map(t => VexTabMru.describe(t));
  it('lists the most recently used first when nothing is typed', () => {
    expect(VexTabSearch.rank(rows(), '').map(r => r.id)).toEqual(['d', 'b', 'c', 'a']);
  });
  it('finds by title, with the Turkish letters folded either way', () => {
    expect(VexTabSearch.rank(rows(), 'istanbul').map(r => r.id)).toEqual(['a']);
    expect(VexTabSearch.rank(rows(), 'İSTANBUL').map(r => r.id)).toEqual(['a']);
    expect(VexTabSearch.rank(rows(), 'sisli').map(r => r.id)).toEqual(['c']);
  });
  it('finds by address', () => {
    expect(VexTabSearch.rank(rows(), 'github.com/x').map(r => r.id)).toEqual(['b']);
  });
  it('puts a title that starts with the query before one that contains it', () => {
    const list = [
      { id: 'x', title: 'My Mail', host: 'a.example', url: 'https://a.example/', group: '' },
      { id: 'y', title: 'Mail', host: 'b.example', url: 'https://b.example/', group: '' },
    ];
    expect(VexTabSearch.rank(list, 'mail').map(r => r.id)).toEqual(['y', 'x']);
  });
  it('keeps the recency order among equal matches', () => {
    const list = ['p', 'q', 'r'].map(id => ({ id, title: 'Docs ' + id, host: '', url: '', group: '' }));
    expect(VexTabSearch.rank(list, 'docs').map(r => r.id)).toEqual(['p', 'q', 'r']);
  });
  it('returns nothing for a query nothing matches', () => {
    expect(VexTabSearch.rank(rows(), 'zzzqqq')).toEqual([]);
  });
});

describe('the popover', () => {
  it('opens with every tab, takes the focus, and says what it is', () => {
    document.getElementById('before').focus();
    expect(VexTabSearch.open()).toBe(true);
    expect(rowsText()).toEqual(['Inbox', 'GitHub Issues', 'Şişli Haberleri', 'İstanbul Haritası']);
    expect(document.activeElement).toBe(document.querySelector('#tab-search input'));
    expect(document.querySelector('#tab-search [role="dialog"]').getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('#tab-search input').getAttribute('role')).toBe('combobox');
  });
  it('marks pinned, sleeping and the group', () => {
    VexTabSearch.open();
    const flags = [...document.querySelectorAll('#tab-search .tt-row')].map(r => r.querySelector('.tt-flags').children.length);
    expect(flags[0]).toBe(1);   // Inbox: sleeping
    expect(flags[2]).toBe(1);   // Şişli: pinned
  });
  it('narrows as you type, and says when nothing matches', () => {
    VexTabSearch.open();
    type('git');
    expect(rowsText()).toEqual(['GitHub Issues']);
    type('qqqq');
    expect(document.querySelector('#tab-search .tt-empty').textContent).toBe('No open tab matches');
    press('Enter');
    expect(globalThis.TabManager.switchTab).not.toHaveBeenCalled();
  });
  it('Enter goes to the selected tab and closes; arrows move and wrap', () => {
    VexTabSearch.open();
    press('ArrowDown'); press('ArrowDown');
    press('Enter');
    expect(globalThis.TabManager.switchTab).toHaveBeenCalledWith('c');
    expect(document.getElementById('tab-search')).toBeNull();
    VexTabSearch.open();
    press('ArrowUp');
    press('Enter');
    expect(globalThis.TabManager.switchTab).toHaveBeenLastCalledWith('a');
  });
  it('Escape closes and gives the focus back', () => {
    document.getElementById('before').focus();
    VexTabSearch.open();
    press('Escape');
    expect(document.getElementById('tab-search')).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('before'));
  });
  it('Delete closes the selected tab when nothing is typed, and Shift+Delete when something is', () => {
    VexTabSearch.open();
    press('ArrowDown');
    press('Delete');
    expect(globalThis.TabManager.closeTab).toHaveBeenCalledWith('b');
    expect(rowsText()).toEqual(['Inbox', 'Şişli Haberleri', 'İstanbul Haritası']);
    type('is');
    press('Delete');   // a character in the box: not a tab
    expect(globalThis.TabManager.closeTab).toHaveBeenCalledTimes(1);
    press('Delete', { shiftKey: true });
    expect(globalThis.TabManager.closeTab).toHaveBeenCalledTimes(2);
  });
  it('a click on a row goes to it', () => {
    VexTabSearch.open();
    document.querySelectorAll('#tab-search .tt-row')[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(globalThis.TabManager.switchTab).toHaveBeenCalledWith('b');
    expect(document.getElementById('tab-search')).toBeNull();
  });
  it('draws a title as text, not markup', () => {
    globalThis.TabManager.tabs[0].title = '<b onmouseover=x>hi</b>';
    VexTabSearch.open();
    expect(document.querySelector('#tab-search b')).toBeNull();
  });
  it('does not go to a tab that closed while the popover was up', () => {
    VexTabSearch.open();
    globalThis.TabManager.tabs = globalThis.TabManager.tabs.filter(t => t.id !== 'd');
    press('Enter');
    expect(globalThis.TabManager.switchTab).not.toHaveBeenCalled();
  });
  it('opened twice is one popover', () => {
    VexTabSearch.open(); VexTabSearch.open();
    expect(document.querySelectorAll('#tab-search')).toHaveLength(1);
  });
});

describe('the switch', () => {
  it('off, it says so and opens nothing', () => {
    VexTabSearch.setEnabled(false);
    expect(VexTabSearch.open()).toBe(false);
    expect(window.showToast).toHaveBeenCalled();
    expect(document.getElementById('tab-search')).toBeNull();
  });
  it('switching off closes an open popover', () => {
    VexTabSearch.open();
    VexTabSearch.setEnabled(false);
    expect(document.getElementById('tab-search')).toBeNull();
  });
});

describe('the key', () => {
  it('has a shortcut that is not Ctrl+Shift+A (the AI panel) and runs the Ctrl+K command', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/shortcuts-registry.js'), 'utf8');
    const m = /'tab-search':\s*\{ default: '([^']+)'.*cmd: 'tab-search'/.exec(src);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('Ctrl+Alt+Z');
    const all = [...src.matchAll(/default: '([^']+)'/g)].map(x => x[1]);
    expect(all.filter(k => k === 'Ctrl+Alt+Z')).toHaveLength(1);
  });
});
