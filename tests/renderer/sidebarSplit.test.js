// @vitest-environment jsdom
//
// Two sidebar panels at once (SidebarManager.openBeside): Claude beside
// Discord, both usable. The second panel takes half the area, the pair is
// remembered so opening either later brings the other back, and the second
// panel's own icon (or "Close beside …") takes it away again.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');

beforeEach(() => {
  document.body.innerHTML = `
    <div id="icon-sidebar">
      <button class="sidebar-icon" data-panel="notes" title="Notes (Ctrl+Shift+N)"></button>
      <button class="sidebar-icon" data-panel="downloads" title="Downloads"></button>
      <button class="sidebar-icon" data-panel="history" title="History"></button>
      <button class="sidebar-icon" data-panel="settings" title="Settings"></button>
    </div>
    <div id="content-area">
      <div id="panels-container">
        <div class="panel" id="panel-notes"></div>
        <div class="panel" id="panel-downloads"></div>
        <div class="panel" id="panel-history"></div>
        <div class="panel" id="panel-settings"></div>
      </div>
      <div id="webviews-container"></div>
    </div>`;
  for (const a of ['data-sb-side', 'data-sidebar-panel']) document.body.removeAttribute(a);
  localStorage.clear();
  SidebarManager.activePanel = null;
  SidebarManager.sidePanel = null;
  globalThis.NotesPanel = { init: vi.fn() };
  globalThis.DownloadsPanel = { init: vi.fn() };
  globalThis.HistoryPanel = { init: vi.fn() };
  globalThis.TabManager = { activeTabId: null };
  globalThis.WebviewManager = { showWebview: vi.fn() };
  window.showToast = vi.fn();
});

const shown = () => [...document.querySelectorAll('#panels-container .panel')].filter(p => p.style.display === 'block').map(p => p.id);
const lit = () => [...document.querySelectorAll('.sidebar-icon.active')].map(b => b.dataset.panel);
const container = () => document.getElementById('panels-container');

describe('a second panel beside the open one', () => {
  it('shows both, marks which is which, and lights both icons', () => {
    SidebarManager.showPanel('notes');
    SidebarManager.openBeside('downloads');
    expect(shown()).toEqual(['panel-notes', 'panel-downloads']);
    expect(document.getElementById('panel-notes').classList.contains('sb-primary')).toBe(true);
    expect(document.getElementById('panel-downloads').classList.contains('sb-side')).toBe(true);
    expect(container().dataset.split).toBe('downloads');
    expect(lit()).toEqual(['notes', 'downloads']);
    expect(SidebarManager.activePanel).toBe('notes');
    expect(SidebarManager.sidePanel).toBe('downloads');
    expect(DownloadsPanel.init).toHaveBeenCalled();
  });

  it('tells the docked layout about it', () => {
    const seen = [];
    const onChange = (e) => seen.push([e.detail.panel, e.detail.beside]);
    document.addEventListener('vex:panel-changed', onChange);
    SidebarManager.showPanel('notes');
    SidebarManager.openBeside('downloads');
    SidebarManager.closeBeside();
    document.removeEventListener('vex:panel-changed', onChange);
    expect(seen).toEqual([['notes', null], ['notes', 'downloads'], ['notes', null]]);
  });

  it('the second panel\'s own icon takes only that one away', () => {
    SidebarManager.showPanel('notes');
    SidebarManager.openBeside('downloads');
    SidebarManager.togglePanel('downloads');
    expect(shown()).toEqual(['panel-notes']);
    expect(container().dataset.split).toBeUndefined();
    expect(document.getElementById('panel-downloads').classList.contains('sb-side')).toBe(false);
    expect(lit()).toEqual(['notes']);
  });

  it('closing the sidebar closes both', () => {
    SidebarManager.showPanel('notes');
    SidebarManager.openBeside('downloads');
    SidebarManager.hideActivePanel();
    expect(shown()).toEqual([]);
    expect(SidebarManager.sidePanel).toBe(null);
    expect(container().dataset.split).toBeUndefined();
    expect(lit()).toEqual([]);
  });
});

describe('the pair is remembered', () => {
  it('opening either panel later brings the other back beside it', () => {
    SidebarManager.showPanel('notes');
    SidebarManager.openBeside('downloads');
    SidebarManager.hideActivePanel();

    SidebarManager.showPanel('notes');
    expect(shown()).toEqual(['panel-notes', 'panel-downloads']);
    expect(SidebarManager.sidePanel).toBe('downloads');

    SidebarManager.hideActivePanel();
    SidebarManager.showPanel('downloads');
    expect(shown()).toEqual(['panel-notes', 'panel-downloads']);
    expect(SidebarManager.activePanel).toBe('downloads');
    expect(SidebarManager.sidePanel).toBe('notes');
    expect(document.getElementById('panel-downloads').classList.contains('sb-primary')).toBe(true);
  });

  it('until the second panel is closed, which forgets it', () => {
    SidebarManager.showPanel('notes');
    SidebarManager.openBeside('downloads');
    SidebarManager.closeBeside();
    SidebarManager.hideActivePanel();
    SidebarManager.showPanel('notes');
    expect(shown()).toEqual(['panel-notes']);
    SidebarManager.hideActivePanel();
    SidebarManager.showPanel('downloads');
    expect(shown()).toEqual(['panel-downloads']);
    expect(JSON.parse(localStorage.getItem('vex.panelPairs'))).toEqual({});
  });

  it('a third panel opens on its own, not with someone else\'s partner', () => {
    SidebarManager.showPanel('notes');
    SidebarManager.openBeside('downloads');
    SidebarManager.showPanel('history');
    expect(shown()).toEqual(['panel-history']);
    expect(SidebarManager.sidePanel).toBe(null);
  });

  it('survives a corrupt pairs record', () => {
    localStorage.setItem('vex.panelPairs', '[not json');
    SidebarManager.showPanel('notes');
    expect(shown()).toEqual(['panel-notes']);
    localStorage.setItem('vex.panelPairs', '[1,2]');
    SidebarManager.showPanel('downloads');
    expect(shown()).toEqual(['panel-downloads']);
  });
});

describe('what cannot share', () => {
  it('needs an open panel, a different one, and never Settings', () => {
    expect(() => SidebarManager.openBeside('downloads')).toThrow(/Open a panel first/);
    SidebarManager.showPanel('notes');
    expect(() => SidebarManager.openBeside('notes')).toThrow(/already open/);
    expect(() => SidebarManager.openBeside('settings')).toThrow(/Settings/);
    SidebarManager.showPanel('settings');
    expect(() => SidebarManager.openBeside('notes')).toThrow(/Settings/);
    expect(shown()).toEqual(['panel-settings']);
  });

  it('a panel paired with one that no longer exists opens alone', () => {
    localStorage.setItem('vex.panelPairs', JSON.stringify({ notes: 'site_gone', site_gone: 'notes' }));
    SidebarManager.showPanel('notes');
    expect(shown()).toEqual(['panel-notes']);
    expect(SidebarManager.sidePanel).toBe(null);
  });
});

describe('the ways in', () => {
  it('Shift+click on an icon puts that panel beside the open one; plain click replaces it', () => {
    SidebarManager.showPanel('notes');
    expect(SidebarManager._besideOnShift('downloads')).toBe(true);
    expect(shown()).toEqual(['panel-notes', 'panel-downloads']);
    // Nothing to sit beside, or already there: the click falls through.
    expect(SidebarManager._besideOnShift('downloads')).toBe(false);
    expect(SidebarManager._besideOnShift('settings')).toBe(false);
    SidebarManager.hideActivePanel();
    expect(SidebarManager._besideOnShift('downloads')).toBe(false);
  });

  it('the icon menu offers "Open beside" while another panel is open, and "Close beside" for the one already there', () => {
    globalThis.TabManager._clampMenuToViewport = vi.fn();
    globalThis.TabManager._attachMenuDismissal = vi.fn();
    const labels = (name) => {
      SidebarManager.showContextMenu({ clientX: 0, clientY: 0 }, name);
      const items = [...document.querySelectorAll('.tab-context-menu .tab-context-item')].map(i => i.textContent);
      document.querySelectorAll('.tab-context-menu').forEach(m => m.remove());
      return items;
    };
    expect(labels('downloads').some(l => /beside/.test(l))).toBe(false);
    SidebarManager.showPanel('notes');
    expect(labels('downloads')[0]).toBe('Open beside Notes');
    expect(labels('settings').some(l => /beside/.test(l))).toBe(false);
    SidebarManager.openBeside('downloads');
    expect(labels('downloads')[0]).toBe('Close beside Notes');
    expect(labels('history')[0]).toBe('Open beside Notes');
  });
});
