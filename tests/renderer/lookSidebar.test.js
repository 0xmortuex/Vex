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

  // Discord, Claude, Prime… are whole apps: a panel opens taking the whole
  // page area, and the header button puts it back in the sidebar.
  it('a panel opens maximized; Restore puts it in the sidebar; closing ends it', async () => {
    setupDom('chrome', 'right', 'toolbar');
    await load();
    SidebarManager.showPanel('notes');
    const max = document.getElementById('look-sb-max');
    expect(document.body.hasAttribute('data-sidebar-max')).toBe(true);
    expect(max.title).toBe('Restore to sidebar');
    max.click();
    expect(document.body.hasAttribute('data-sidebar-max')).toBe(false);
    expect(max.title).toBe('Maximize');
    max.click();
    expect(document.body.hasAttribute('data-sidebar-max')).toBe(true);
    SidebarManager.hideActivePanel();
    expect(document.body.hasAttribute('data-sidebar-max')).toBe(false);
    expect(max.title).toBe('Maximize');
  });

  it('remembers Restore: the next panel opens in the sidebar until Maximize is pressed again', async () => {
    setupDom('chrome', 'right', 'toolbar');
    await load();
    SidebarManager.showPanel('notes');
    document.getElementById('look-sb-max').click();          // restore
    SidebarManager.showPanel('whatsapp');
    expect(document.body.hasAttribute('data-sidebar-max')).toBe(false);
    expect(localStorage.getItem('vex.lookSidebarMax')).toBe('0');
    document.getElementById('look-sb-max').click();          // maximize again
    SidebarManager.hideActivePanel();
    SidebarManager.showPanel('notes');
    expect(document.body.hasAttribute('data-sidebar-max')).toBe(true);
  });

  // The toolbar looks have no icon rail, so the header is the only way to
  // put a second panel beside the open one.
  it('the + lists the other panels to open beside, and Swap sides once there are two', async () => {
    setupDom('chrome', 'right', 'toolbar');
    SidebarManager.openBeside = vi.fn();
    SidebarManager.swapBeside = vi.fn();
    await load();
    SidebarManager.showPanel('whatsapp');
    const add = document.getElementById('look-sb-add');
    expect(add.hidden).toBe(false);
    add.click();
    let items = [...document.querySelectorAll('.look-sb-add-menu .tab-context-item')].map(i => i.textContent);
    expect(items).toEqual(['Open Notes beside', 'Open Authenticator beside']);
    document.querySelector('.look-sb-add-menu .tab-context-item').click();
    expect(SidebarManager.openBeside).toHaveBeenCalledWith('notes');
    expect(document.querySelector('.look-sb-add-menu')).toBe(null);

    SidebarManager.sidePanel = 'notes';
    SidebarManager.showPanel('whatsapp');
    add.click();
    items = [...document.querySelectorAll('.look-sb-add-menu .tab-context-item')].map(i => i.textContent);
    expect(items).toEqual(['Open Authenticator beside', 'Swap sides']);
    document.querySelectorAll('.look-sb-add-menu .tab-context-item')[1].click();
    expect(SidebarManager.swapBeside).toHaveBeenCalled();

    SidebarManager.showPanel('settings');
    expect(add.hidden).toBe(true);
  });

  it('the chip names the second panel and closes it', async () => {
    setupDom('chrome', 'right', 'toolbar');
    SidebarManager.closeBeside = vi.fn();
    await load();
    const chip = document.getElementById('look-sb-beside');
    SidebarManager.showPanel('whatsapp');
    expect(chip.hidden).toBe(true);
    SidebarManager.sidePanel = 'notes';
    SidebarManager.showPanel('whatsapp');
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe('+ Notes');
    expect(chip.title).toBe('Close Notes');
    chip.click();
    expect(SidebarManager.closeBeside).toHaveBeenCalled();
  });

  it('names both panels in the header when one sits beside the other', async () => {
    setupDom('firefox', 'left', 'rail');
    await load();
    SidebarManager.sidePanel = 'notes';
    SidebarManager.showPanel('whatsapp');
    expect(document.getElementById('look-sb-title').textContent).toBe('WhatsApp + Notes');
    SidebarManager.sidePanel = null;
    SidebarManager.showPanel('whatsapp');
    expect(document.getElementById('look-sb-title').textContent).toBe('WhatsApp');
  });

  it('a web panel\'s back/forward/reload move into the header, and back into the panel on switching away', async () => {
    setupDom('firefox', 'left', 'rail');
    const panels = document.getElementById('panels-container');
    panels.insertAdjacentHTML('beforeend', '<div class="panel" id="panel-whatsapp"><div class="panel-navbar" data-panel="whatsapp"></div></div><div class="panel" id="panel-notes"></div>');
    await load();
    SidebarManager.showPanel('whatsapp');
    const nav = document.querySelector('.panel-navbar[data-panel="whatsapp"]');
    expect(nav.parentElement.id).toBe('look-sb-nav');
    SidebarManager.showPanel('notes');
    expect(nav.parentElement.id).toBe('panel-whatsapp');
    // Leaving the looks while it is open sends it home too.
    SidebarManager.showPanel('whatsapp');
    delete document.body.dataset.sbSide;
    window.dispatchEvent(new CustomEvent('vex:gui-style'));
    expect(nav.parentElement.id).toBe('panel-whatsapp');
  });

  it('refuses to open when every panel is hidden, saying why', async () => {
    setupDom('chrome', 'right', 'toolbar');
    document.querySelectorAll('.sidebar-icon').forEach(b => { b.style.display = 'none'; });
    const S = await load();
    expect(() => S.toggle()).toThrow(/every panel is hidden/);
  });
});
