// @vitest-environment jsdom
//
// "Could not add a visit to history: Error invoking remote method
// 'storage:history-add': Error: Invalid payload for storage:history-add" —
// twice in the owner's log, on v2.35, after non-web pages were already
// screened out (2026-09-29). What still got through was a web page history
// cannot hold: main takes an address of at most 8192 characters and a title
// of at most 4096, and a sign-in redirect is longer than the first, while a
// page with no title yet sent its whole address as the title. The visit is
// now shaped (or skipped) where it is made, the did-navigate handler.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const dataContracts = require('../../src/renderer/js/data-contracts.js');
window.VexDataContracts = dataContracts;
require('../../src/renderer/js/vex-utils.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const { assertHistoryEntry } = require('../../src/main/contracts.js');

// What main does with the payload before the handler runs (main/ipc-policy.js).
const accepted = entry => { validate('storage:history-add', [entry]); assertHistoryEntry(entry); return true; };

let tab, sent, panel;
beforeEach(() => {
  document.body.innerHTML = '<div id="webviews-container"></div><input id="url-input">';
  localStorage.clear();
  tab = { id: 't1', url: 'https://example.org/', title: '', partition: 'persist:main' };
  sent = [];
  panel = [];
  WebviewManager.webviews.clear();
  globalThis.isStartPage = () => false;
  globalThis.TabManager = {
    tabs: [tab], activeTabId: 't1',
    updateTab: vi.fn((id, patch) => Object.assign(tab, patch)),
    renderTabUpdate: vi.fn(), windowMayAsk: () => true,
  };
  globalThis.VexStorage = { addHistory: vi.fn(async entry => { sent.push(entry); accepted(entry); return true; }) };
  globalThis.HistoryPanel = { addEntry: vi.fn((url, title) => panel.push({ url, title })), entries: [] };
});

function navigate(url) {
  if (!WebviewManager.webviews.has(tab.id)) WebviewManager.createWebview(tab);
  const wv = WebviewManager.webviews.get(tab.id);
  const e = new Event('did-navigate');
  e.url = url;
  wv.dispatchEvent(e);
  return wv;
}

const longQuery = n => 'https://www.xbox.com/en-US/auth/msa?action=loggedIn&state=' + 'x'.repeat(n);

describe('the history visit a navigation sends', () => {
  it('sends a title history accepts when the page has none yet and the address is long', async () => {
    const url = longQuery(5000);           // under 8192, over 4096
    navigate(url);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(url);
    expect(() => accepted(sent[0])).not.toThrow();
    expect(panel[0].title.length).toBeLessThanOrEqual(4096);
  });

  it('records nothing for an address too long for history, rather than sending one main refuses', () => {
    navigate(longQuery(9000));
    expect(VexStorage.addHistory).not.toHaveBeenCalled();
    expect(HistoryPanel.addEntry).not.toHaveBeenCalled();
  });

  it('records an ordinary visit as before', () => {
    tab.title = 'Example';
    navigate('https://example.org/page');
    expect(sent).toEqual([{ url: 'https://example.org/page', title: 'Example' }]);
  });

  it('still leaves out pages that are not web pages', () => {
    navigate('chrome-extension://abc/page.html');
    navigate('file:///C:/x.pdf');
    expect(VexStorage.addHistory).not.toHaveBeenCalled();
  });
});
