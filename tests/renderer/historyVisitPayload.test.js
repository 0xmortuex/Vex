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

// The same visit in the history list (vex.history, saved through persist-set
// and the same contract): a page still "Loading…" is titled with its address,
// and a 5000-character one failed every later save of the list with "Invalid
// record text" (seen live, 2026-10-10).
describe('the history list kept by the History panel', () => {
  const MODULE = '../../src/renderer/js/history-panel.js';
  const fresh = () => { delete require.cache[require.resolve(MODULE)]; return require(MODULE).HistoryPanel; };

  it('stays savable after a visit to a long, still-loading address', () => {
    localStorage.clear();
    window.escapeHtml = s => String(s == null ? '' : s);
    const H = fresh();
    const url = longQuery(5000);
    H.addEntry(url, 'Loading…');
    const saved = JSON.parse(localStorage.getItem('vex.history'));
    expect(saved[0].url).toBe(url);
    expect(() => dataContracts.storage('history', saved)).not.toThrow();
  });

  it('stays savable when an old entry with no title is read and saved back', () => {
    localStorage.clear();
    const url = longQuery(5000);
    localStorage.setItem('vex.history', JSON.stringify([{ url, time: Date.now() - 60000 }]));
    const H = fresh();
    H.addEntry('https://example.org/', 'Example');
    expect(() => dataContracts.storage('history', JSON.parse(localStorage.getItem('vex.history')))).not.toThrow();
  });
});
