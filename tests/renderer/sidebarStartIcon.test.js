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
