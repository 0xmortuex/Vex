// @vitest-environment jsdom
//
// In the browser looks a panel docks BESIDE the page (the browser's own
// sidebar) instead of covering it; Settings still takes the whole area, and
// Classic/Glass keep the old cover-the-page behaviour. showPanel/hidePanel
// stamp body[data-sidebar-panel] and fire 'vex:panel-changed' for
// js/look-sidebar.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');

beforeEach(() => {
  document.body.innerHTML = `
    <div id="content-area">
      <div id="panels-container">
        <div class="panel" id="panel-notes"></div>
        <div class="panel" id="panel-settings"></div>
      </div>
      <div id="webviews-container"></div>
    </div>`;
  for (const a of ['data-gui-family', 'data-sidebar-panel']) document.body.removeAttribute(a);
  SidebarManager.activePanel = null;
  globalThis.NotesPanel = { init: vi.fn() };
  globalThis.TabManager = { activeTabId: null };
  globalThis.WebviewManager = { showWebview: vi.fn() };
});

const pageShown = () => document.getElementById('webviews-container').style.display;

describe('panel docking', () => {
  it('Classic: a panel covers the page', () => {
    SidebarManager.showPanel('notes');
    expect(pageShown()).toBe('none');
  });

  it('browser look: a panel docks beside the page, which stays showing', () => {
    document.body.dataset.guiFamily = 'browser';
    SidebarManager.showPanel('notes');
    expect(pageShown()).toBe('block');
  });

  it('browser look: Settings still takes the whole area', () => {
    document.body.dataset.guiFamily = 'browser';
    SidebarManager.showPanel('settings');
    expect(pageShown()).toBe('none');
  });

  it('stamps the open panel on body and announces open and close', () => {
    const seen = [];
    const onChange = (e) => seen.push(e.detail.panel);
    document.addEventListener('vex:panel-changed', onChange);
    SidebarManager.showPanel('notes');
    expect(document.body.dataset.sidebarPanel).toBe('notes');
    SidebarManager.hideActivePanel();
    expect(document.body.dataset.sidebarPanel).toBeUndefined();
    expect(seen).toEqual(['notes', null]);
    document.removeEventListener('vex:panel-changed', onChange);
  });
});
