// @vitest-environment jsdom
//
// Discord (and WhatsApp) wrap the page's Notification so a click tells the
// host (preload-webview.js, 'vex-notification-click'). A panel opens itself
// (sidebar.js openFromNotification) — but with Discord set to open as a tab,
// the host is the tab's webview, which ignored the message: the click did
// nothing (found in the v19.1.7 check).

import { describe, it, expect, vi, beforeEach } from 'vitest';

let wv, tab;
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="webviews-container"></div><input id="url-input">';
  window.VexDataContracts = require('../../src/renderer/js/data-contracts.js');
  require('../../src/renderer/js/vex-utils.js');
  const { WebviewManager: WM } = require('../../src/renderer/js/webview.js');
  tab = { id: 't-discord', url: 'https://discord.com/app', title: 'Discord', partition: 'persist:discord' };
  WM.webviews.clear();
  globalThis.isStartPage = () => false;
  globalThis.TabManager = {
    tabs: [{ id: 't-other', url: 'https://example.com/' }, tab], activeTabId: 't-other',
    updateTab: vi.fn((id, patch) => Object.assign(tab, patch)),
    updateUrlBar: vi.fn(), renderTabUpdate: vi.fn(), windowMayAsk: () => true,
    switchTab: vi.fn(function (id) { this.activeTabId = id; }),
  };
  globalThis.HistoryPanel = { addEntry: vi.fn(), updateTitle: vi.fn(), entries: [] };
  window.vex = { focusWindow: vi.fn(async () => ({ ok: true })) };
  WM.createWebview(tab);
  wv = WM.webviews.get('t-discord');
});

const clicked = () => { const e = new Event('ipc-message'); e.channel = 'vex-notification-click'; e.args = []; wv.dispatchEvent(e); };

describe('a desktop notification from a tab, clicked', () => {
  it('brings Vex up on that tab', () => {
    clicked();
    expect(window.vex.focusWindow).toHaveBeenCalledTimes(1);
    expect(globalThis.TabManager.switchTab).toHaveBeenCalledWith('t-discord');
  });

  it('does not switch when the tab is already the one in front', () => {
    globalThis.TabManager.activeTabId = 't-discord';
    clicked();
    expect(window.vex.focusWindow).toHaveBeenCalledTimes(1);
    expect(globalThis.TabManager.switchTab).not.toHaveBeenCalled();
  });
});
