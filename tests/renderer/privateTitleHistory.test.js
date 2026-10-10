// @vitest-environment jsdom
//
// A private or Tor tab's visit is never recorded, but its page title was: the
// title handler renamed the normal history entry for the same address, so
// "Inbox (3) - other-account@example.com" from a private tab showed in normal
// history, and history syncs to the other devices (found 2026-10-09).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dataContracts = require('../../src/renderer/js/data-contracts.js');
window.VexDataContracts = dataContracts;
require('../../src/renderer/js/vex-utils.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');

let tab, titles;
function setup(partition) {
  document.body.innerHTML = '<div id="webviews-container"></div><input id="url-input">';
  tab = { id: 't1', url: 'https://mail.example/inbox', title: '', partition };
  titles = [];
  WebviewManager.webviews.clear();
  globalThis.isStartPage = () => false;
  globalThis.TabManager = {
    tabs: [tab], activeTabId: 't1',
    updateTab: vi.fn((id, patch) => Object.assign(tab, patch)),
    renderTabUpdate: vi.fn(), windowMayAsk: () => true,
  };
  globalThis.HistoryPanel = { addEntry: vi.fn(), updateTitle: vi.fn((url, title) => titles.push({ url, title })), entries: [] };
  WebviewManager.createWebview(tab);
  return WebviewManager.webviews.get(tab.id);
}
function titleChanges(wv, title) {
  const e = new Event('page-title-updated');
  e.title = title;
  wv.dispatchEvent(e);
}

describe('a page title reaching history', () => {
  beforeEach(() => { localStorage.clear(); });

  it('comes from a normal tab', () => {
    titleChanges(setup('persist:main'), 'Inbox (3) - me@example.com');
    expect(titles).toEqual([{ url: 'https://mail.example/inbox', title: 'Inbox (3) - me@example.com' }]);
  });

  for (const [what, partition] of [['a private (off-the-record) tab', 'vexid-mgx1-ab12'], ['a Tor tab', 'tor-mgx1-cd34']]) {
    it('never comes from ' + what, () => {
      titleChanges(setup(partition), 'Inbox (3) - other-account@example.com');
      expect(titles).toEqual([]);
      // The tab itself still shows it.
      expect(tab.title).toBe('Inbox (3) - other-account@example.com');
    });
  }
});
