// @vitest-environment jsdom
// The house icon in the sidebar is lit only while the page in front is the start page (it used to stay lit on every other tab).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SidebarManager } from '../../src/renderer/js/sidebar.js';

describe('SidebarManager._syncStartIcon', () => {
  let btn;
  beforeEach(() => {
    document.body.innerHTML = '<button class="sidebar-icon active" data-panel="start"></button>';
    btn = document.querySelector('.sidebar-icon');
    globalThis.TabManager = { activeTabId: 'a', tabs: [{ id: 'a', url: 'vex://start' }, { id: 'b', url: 'https://www.google.com/search?q=x' }] };
    globalThis.isStartPage = (u) => u === 'vex://start';
    SidebarManager.activePanel = null;
  });
  afterEach(() => { delete globalThis.TabManager; delete globalThis.isStartPage; SidebarManager.activePanel = null; });

  it('is lit on the start page', () => {
    SidebarManager._syncStartIcon();
    expect(btn.classList.contains('active')).toBe(true);
  });
  it('goes dark when another tab is in front', () => {
    TabManager.activeTabId = 'b';
    SidebarManager._syncStartIcon();
    expect(btn.classList.contains('active')).toBe(false);
  });
  it('goes dark while a panel covers the page, and returns with the start page', () => {
    SidebarManager.activePanel = 'notes';
    SidebarManager._syncStartIcon();
    expect(btn.classList.contains('active')).toBe(false);
    SidebarManager.activePanel = null;
    SidebarManager._syncStartIcon();
    expect(btn.classList.contains('active')).toBe(true);
  });
});

describe('SidebarManager._dropWorkPanel', () => {
  beforeEach(() => { localStorage.clear(); });
  it('takes the Work panel out of the saved order, overrides, pairs and usage, and leaves the rest', () => {
    localStorage.setItem('vex.sidebarOrder', JSON.stringify(['notes', 'work', 'clock']));
    localStorage.setItem('vex.panelOverrides', JSON.stringify({ work: { hidden: true }, clock: { hidden: false } }));
    localStorage.setItem('vex.panelPairs', JSON.stringify({ work: 'notes', notes: 'work', clock: 'history', history: 'clock' }));
    localStorage.setItem('vex.panelUsage', JSON.stringify({ work: 5, notes: 7 }));
    SidebarManager._dropWorkPanel();
    expect(JSON.parse(localStorage.getItem('vex.sidebarOrder'))).toEqual(['notes', 'clock']);
    expect(JSON.parse(localStorage.getItem('vex.panelOverrides'))).toEqual({ clock: { hidden: false } });
    expect(JSON.parse(localStorage.getItem('vex.panelPairs'))).toEqual({ clock: 'history', history: 'clock' });
    expect(JSON.parse(localStorage.getItem('vex.panelUsage'))).toEqual({ notes: 7 });
    SidebarManager._dropWorkPanel();                          // nothing left to do the second time
    expect(JSON.parse(localStorage.getItem('vex.sidebarOrder'))).toEqual(['notes', 'clock']);
  });
  it('changes nothing when nothing was saved', () => {
    SidebarManager._dropWorkPanel();
    expect(localStorage.getItem('vex.sidebarOrder')).toBeNull();
  });
});
