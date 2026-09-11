// @vitest-environment jsdom
//
// Browser-look sidebars (js/look-sidebar.js). In a browser look the panels live
// in that browser's own sidebar: a toolbar button (Chrome/Safari/IE) reopens
// the panel used last, the header picker lists the panels the user has not
// hidden, and the button sits where that browser keeps it.

import { describe, it, expect, beforeEach, vi } from 'vitest';

function setupDom(style, side, launcher) {
  document.body.innerHTML = `
    <div id="top-bar"><div id="top-bar-left"><button id="btn-back"></button></div>
      <div id="top-bar-right"><button id="btn-extensions"></button><button id="btn-command"></button></div></div>
    <div id="icon-sidebar">
      <button class="sidebar-icon" data-panel="start" title="Start Page"></button>
      <button class="sidebar-icon" data-panel="whatsapp" title="WhatsApp"></button>
      <button class="sidebar-icon" data-panel="notes" title="Notes (Ctrl+Shift+N)"></button>
      <button class="sidebar-icon" data-panel="bookmarks" title="Bookmarks" style="display:none"></button>
      <button class="sidebar-icon" data-panel="authenticator" title="Authenticator — 2FA codes"></button>
    </div>
    <div id="content-area"><div id="panels-container"></div></div>`;
  Object.assign(document.body.dataset, { guiFamily: 'browser', guiStyle: style, sbSide: side, sbLauncher: launcher });
}

async function load() {
  vi.resetModules();
  await import('../../src/renderer/js/look-sidebar.js');
  return window.VexLookSidebar;
}

describe('look sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const a of ['data-gui-family', 'data-gui-style', 'data-sb-side', 'data-sb-launcher', 'style']) document.body.removeAttribute(a);
    globalThis.SidebarManager = {
      activePanel: null,
      showPanel: vi.fn(function (p) {
        this.activePanel = p;
        document.dispatchEvent(new CustomEvent('vex:panel-changed', { detail: { panel: p } }));
      }),
      hideActivePanel: vi.fn(function () {
        this.activePanel = null;
        document.dispatchEvent(new CustomEvent('vex:panel-changed', { detail: { panel: null } }));
      }),
    };
  });

  it('offers the visible panels, not the start page or hidden ones, with plain names', async () => {
    setupDom('chrome', 'right', 'toolbar');
    const S = await load();
    expect(S.panelChoices()).toEqual([
      { panel: 'whatsapp', label: 'WhatsApp' },
      { panel: 'notes', label: 'Notes' },
      { panel: 'authenticator', label: 'Authenticator' },
    ]);
  });

  it('the toolbar button opens the first panel, then the one used last, and closes an open one', async () => {
    setupDom('chrome', 'right', 'toolbar');
    await load();
    const btn = document.getElementById('btn-look-sidebar');
    btn.click();
    expect(SidebarManager.showPanel).toHaveBeenLastCalledWith('whatsapp');
    expect(btn.classList.contains('active')).toBe(true);

    SidebarManager.showPanel('notes');          // picked another panel
    btn.click();                                 // close
    expect(SidebarManager.activePanel).toBe(null);
    expect(btn.classList.contains('active')).toBe(false);
    btn.click();                                 // reopen: the last one
    expect(SidebarManager.showPanel).toHaveBeenLastCalledWith('notes');
  });

  it('a last panel the user has since hidden falls back to the first visible one', async () => {
    setupDom('chrome', 'right', 'toolbar');
    localStorage.setItem('vex.lookSidebarLast', 'bookmarks');
    await load();
    document.getElementById('btn-look-sidebar').click();
    expect(SidebarManager.showPanel).toHaveBeenLastCalledWith('whatsapp');
  });

  it('the header picker follows the open panel and switches panels', async () => {
    setupDom('chrome', 'right', 'toolbar');
    await load();
    SidebarManager.showPanel('notes');
    const picker = document.getElementById('look-sb-picker');
    expect(picker.value).toBe('notes');
    expect([...picker.options].map(o => o.value)).toEqual(['whatsapp', 'notes', 'authenticator']);
    expect(document.getElementById('look-sb-title').textContent).toBe('Notes');
    picker.value = 'authenticator';
    picker.dispatchEvent(new Event('change'));
    expect(SidebarManager.activePanel).toBe('authenticator');
  });

  it('the close button closes the sidebar', async () => {
    setupDom('firefox', 'left', 'rail');
    await load();
    SidebarManager.showPanel('notes');
    document.getElementById('look-sb-close').click();
    expect(SidebarManager.hideActivePanel).toHaveBeenCalled();
  });

  it('puts the button where each browser keeps it', async () => {
    setupDom('chrome', 'right', 'toolbar');
    await load();
    let btn = document.getElementById('btn-look-sidebar');
    expect(btn.parentElement.id).toBe('top-bar-right');
    expect(btn.nextElementSibling.id).toBe('btn-command');

    setupDom('safari', 'left', 'toolbar');
    await load();
    btn = document.getElementById('btn-look-sidebar');
    expect(btn.parentElement.id).toBe('top-bar-left');
    expect(btn.parentElement.firstElementChild).toBe(btn);
  });

  it('refuses to open when every panel is hidden, saying why', async () => {
    setupDom('chrome', 'right', 'toolbar');
    document.querySelectorAll('.sidebar-icon').forEach(b => { b.style.display = 'none'; });
    const S = await load();
    expect(() => S.toggle()).toThrow(/every panel is hidden/);
  });
});
