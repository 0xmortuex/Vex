// @vitest-environment jsdom
//
// Left-sidebar button customization: right-click menu adapts per button type,
// hide/restore via overrides, and reorder. Covers the feature that lets users
// rename / change icon / change link / hide / reorder the LEFT sidebar buttons
// (not just the home-page shortcuts).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { SidebarManager } = require('../../src/renderer/js/sidebar.js');

function setupDom() {
  document.body.innerHTML = `
    <div id="icon-sidebar">
      <button class="sidebar-icon" data-panel="start" title="Start Page"><svg></svg></button>
      <button class="sidebar-icon" data-panel="claude" title="Claude AI"><svg></svg></button>
      <button class="sidebar-icon" data-panel="notes" title="Notes"><svg></svg></button>
      <button class="sidebar-icon" data-panel="downloads" title="Downloads"><svg></svg></button>
      <div class="sidebar-spacer"></div>
      <button class="sidebar-icon" data-panel="settings" title="Settings"><svg></svg></button>
    </div>
    <div id="sidebar-manager-list"></div>`;
  localStorage.clear();
}

beforeEach(() => { setupDom(); document.querySelectorAll('.tab-context-menu').forEach(m => m.remove()); });

function menuLabels() {
  return [...document.querySelectorAll('.tab-context-menu .tab-context-item')].map(e => e.textContent);
}

describe('_isUrlPanel', () => {
  it('is true for web-app panels and pinned sites, false for internal panels', () => {
    expect(SidebarManager._isUrlPanel('claude')).toBe(true);
    expect(SidebarManager._isUrlPanel('whatsapp')).toBe(true);
    expect(SidebarManager._isUrlPanel('site_abc')).toBe(true);
    expect(SidebarManager._isUrlPanel('notes')).toBe(false);
    expect(SidebarManager._isUrlPanel('downloads')).toBe(false);
    expect(SidebarManager._isUrlPanel('start')).toBe(false);
  });
});

describe('right-click menu adapts to button type', () => {
  it('internal panel (Notes): Rename/Change icon/Hide/Reset, NO Change link', () => {
    SidebarManager.showContextMenu({ clientX: 10, clientY: 10 }, 'notes');
    const labels = menuLabels();
    expect(labels).toContain('Rename…');
    expect(labels).toContain('Change icon…');
    expect(labels).toContain('Hide button');
    expect(labels).toContain('Reset to default');
    expect(labels).not.toContain('Change link…');
  });

  it('URL panel (Claude): includes Change link + service switches', () => {
    SidebarManager.showContextMenu({ clientX: 10, clientY: 10 }, 'claude');
    const labels = menuLabels();
    expect(labels).toContain('Change link…');
    expect(labels).toContain('Switch to Gemini');
    expect(labels).toContain('Hide button');
  });

  it('Settings button cannot be hidden', () => {
    SidebarManager.showContextMenu({ clientX: 10, clientY: 10 }, 'settings');
    expect(menuLabels()).not.toContain('Hide button');
  });
});

describe('hide / restore', () => {
  it('hides a button and the manager toggle restores it', () => {
    SidebarManager.init?.bind?.(SidebarManager); // no-op guard; init not required here
    SidebarManager.setPanelOverride('notes', { hidden: true });
    expect(document.querySelector('.sidebar-icon[data-panel="notes"]').style.display).toBe('none');

    SidebarManager.setPanelOverride('notes', { hidden: false });
    expect(document.querySelector('.sidebar-icon[data-panel="notes"]').style.display).toBe('');
  });
});

describe('reorder', () => {
  it('moveButton reorders the DOM and persists vex.sidebarOrder', () => {
    // Move "notes" up one (above claude)
    SidebarManager.moveButton('notes', -1);
    const panels = [...document.querySelectorAll('#icon-sidebar .sidebar-icon')].map(b => b.dataset.panel);
    expect(panels.indexOf('notes')).toBeLessThan(panels.indexOf('claude'));
    const saved = JSON.parse(localStorage.getItem('vex.sidebarOrder'));
    expect(saved.indexOf('notes')).toBeLessThan(saved.indexOf('claude'));
  });

  it('does not move the first button up past the top', () => {
    SidebarManager.moveButton('start', -1);
    const panels = [...document.querySelectorAll('#icon-sidebar .sidebar-icon')].map(b => b.dataset.panel);
    expect(panels[0]).toBe('start');
  });

  it('settings (below the spacer) is not part of the reorderable region', () => {
    const tops = SidebarManager._topButtons().map(b => b.dataset.panel);
    expect(tops).toEqual(['start', 'claude', 'notes', 'downloads']);
    expect(tops).not.toContain('settings');
  });
});

describe('Settings sidebar manager', () => {
  it('renders one row per top button (settings excluded) with a Change-link button only on URL rows', () => {
    SidebarManager.renderSidebarManager();
    const rows = document.querySelectorAll('#sidebar-manager-list > div');
    expect(rows.length).toBe(4); // start, claude, notes, downloads
    // claude row (index 1) has a link button; notes row (index 2) does not
    const claudeRow = rows[1];
    const notesRow = rows[2];
    expect(claudeRow.querySelector('button[data-act="link"]')).toBeTruthy();
    expect(notesRow.querySelector('button[data-act="link"]')).toBeFalsy();
  });
});
