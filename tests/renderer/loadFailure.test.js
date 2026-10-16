// @vitest-environment jsdom
//
// js/load-failure.js (T3-055): Vex's own page for a site that did not load, with the
// ways to try again that need only a press.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { VexLoadFailure } = require('../../src/renderer/js/load-failure.js');

const URL1 = 'https://shop.example/cart';
const fail = (code, url = URL1, extra = {}) => ({ errorCode: code, validatedURL: url, isMainFrame: true, ...extra });

function install(over = {}) {
  const tab = { id: 'a', url: URL1, _loadFailed: { code: -105, url: URL1 }, ...over };
  globalThis.TabManager = {
    tabs: [tab], activeTabId: 'a',
    getActiveTab() { return this.tabs.find(t => t.id === this.activeTabId); },
    switchTab: vi.fn(),
  };
  const wv = { reloadIgnoringCache: vi.fn() };
  globalThis.WebviewManager = { webviews: new Map([['a', wv]]), navigate: vi.fn() };
  return { tab, wv };
}
const buttons = () => [...document.querySelectorAll('#vex-load-failure .vlf-btn')].map(b => b.textContent);

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = '<div id="webviews-container"></div>';
  VexLoadFailure._el = null;
  VexLoadFailure._timers.clear();
  delete globalThis.ArchiveLibrary; delete globalThis.LinkRot;
  window.showToast = vi.fn();
});
afterEach(() => { vi.useRealTimers(); });

describe('which failures get the page', () => {
  it('a main-frame failure does, after a short wait for a page main may draw instead', () => {
    const { tab } = install();
    expect(VexLoadFailure.note('a', fail(-105))).toBe(true);
    expect(document.getElementById('vex-load-failure')).toBe(null);
    vi.advanceTimersByTime(300);
    expect(document.getElementById('vex-load-failure')).not.toBe(null);
    expect(document.querySelector('.vlf-title').textContent).toBe('shop.example did not load');
    expect(document.querySelector('.vlf-what').textContent).toMatch(/could not be found/);
    expect(tab._failedPage.code).toBe(-105);
  });

  it('not an aborted load, a certificate error, an ad-blocker block, a frame, or a non-web address', () => {
    install();
    for (const e of [fail(-3), fail(-200), fail(-299), fail(-20), fail(-105, URL1, { isMainFrame: false }), fail(-105, 'file:///a.html'), fail(-105, 'chrome-error://chromewebdata/')]) {
      expect(VexLoadFailure.note('a', e)).toBe(false);
    }
  });

  it('is dropped if a new navigation began in the meantime', () => {
    const { tab } = install();
    VexLoadFailure.note('a', fail(-105));
    tab._loadFailed = null;                      // did-start-navigation
    VexLoadFailure.clear('a');
    vi.advanceTimersByTime(500);
    expect(document.getElementById('vex-load-failure')).toBe(null);
  });

  it('goes when the next navigation starts, and is not drawn for a tab that is not in front', () => {
    const { tab } = install();
    VexLoadFailure.note('a', fail(-102));
    vi.advanceTimersByTime(300);
    VexLoadFailure.clear('a');
    expect(document.getElementById('vex-load-failure')).toBe(null);
    expect(tab._failedPage).toBe(null);
    VexLoadFailure.note('a', fail(-102));
    TabManager.activeTabId = 'other';
    vi.advanceTimersByTime(300);
    expect(document.getElementById('vex-load-failure')).toBe(null);
    TabManager.activeTabId = 'a';
    VexLoadFailure.render();
    expect(document.getElementById('vex-load-failure')).not.toBe(null);
  });

  it('is off when switched off, and Chromium\'s own page is left showing', () => {
    install();
    VexLoadFailure.setEnabled(false);
    expect(VexLoadFailure.note('a', fail(-105))).toBe(false);
  });
});

describe('what it says and offers', () => {
  it('names the problem in plain words and keeps the code small underneath', () => {
    install();
    VexLoadFailure.note('a', fail(-106));
    vi.advanceTimersByTime(300);
    expect(document.querySelector('.vlf-what').textContent).toMatch(/not connected to the internet/);
    expect(document.querySelector('.vlf-url').textContent).toContain('ERR_INTERNET_DISCONNECTED');
    expect(VexLoadFailure.describe(-9999).name).toBe('Error -9999');
  });

  it('offers try again, a hard reload, http:// (for https only), the Wayback Machine and the address', () => {
    install();
    globalThis.LinkRot = { viewArchived: vi.fn() };
    VexLoadFailure.note('a', fail(-105));
    vi.advanceTimersByTime(300);
    expect(buttons()).toEqual(['Try again', 'Reload from the server', 'Try http:// instead', 'Look in the Wayback Machine', 'Copy the address']);
  });

  it('does not offer http:// for an http address or a local one', () => {
    install({ url: 'http://shop.example/', _loadFailed: { code: -102, url: 'http://shop.example/' } });
    VexLoadFailure.note('a', fail(-102, 'http://shop.example/'));
    vi.advanceTimersByTime(300);
    expect(buttons()).not.toContain('Try http:// instead');
    document.body.innerHTML = '<div id="webviews-container"></div>'; VexLoadFailure._el = null;
    const t = TabManager.tabs[0]; t._loadFailed = { code: -102, url: 'https://192.168.1.5/' }; t._failedPage = null;
    VexLoadFailure.note('a', fail(-102, 'https://192.168.1.5/'));
    vi.advanceTimersByTime(300);
    expect(buttons()).not.toContain('Try http:// instead');
  });

  it('adds "Open your saved copy" when the archive has one, and never asks in a private window', async () => {
    install();
    const entry = { id: 'e1', at: Date.now() };
    globalThis.ArchiveLibrary = { offerEnabled: () => true, _api: () => ({ pageArchiveFind: vi.fn(async () => ({ ok: true, entry })) }), openCopy: vi.fn() };
    VexLoadFailure.note('a', fail(-105));
    await vi.advanceTimersByTimeAsync(300);
    expect(buttons()).toContain('Open your saved copy');
    document.querySelectorAll('.vlf-btn').forEach(b => { if (b.textContent === 'Open your saved copy') b.click(); });
    expect(ArchiveLibrary.openCopy).toHaveBeenCalledWith('e1');
    window.VexTabPolicy = { isPrivateWindow: true };
    const find = vi.fn();
    globalThis.ArchiveLibrary._api = () => ({ pageArchiveFind: find });
    TabManager.tabs[0]._failedPage = { code: -105, url: URL1 };
    await VexLoadFailure._findCopy(TabManager.tabs[0]);
    expect(find).not.toHaveBeenCalled();
    delete window.VexTabPolicy;
  });
});

describe('the buttons', () => {
  it('Try again clears the page and loads the address again', () => {
    install();
    VexLoadFailure.note('a', fail(-105));
    vi.advanceTimersByTime(300);
    document.querySelector('.vlf-primary').click();
    vi.advanceTimersByTime(0);
    return Promise.resolve().then(() => {
      expect(WebviewManager.navigate).toHaveBeenCalledWith(URL1);
      expect(document.getElementById('vex-load-failure')).toBe(null);
    });
  });

  it('the hard reload asks the page to reload without its cache', () => {
    const { wv } = install();
    VexLoadFailure.note('a', fail(-105));
    vi.advanceTimersByTime(300);
    expect(VexLoadFailure.retry('a', true)).toBe(true);
    expect(wv.reloadIgnoringCache).toHaveBeenCalled();
  });

  it('http:// asks first, goes only on yes, and says what it costs', async () => {
    install();
    VexLoadFailure.note('a', fail(-105));
    vi.advanceTimersByTime(300);
    window.vexConfirm = vi.fn(async () => false);
    expect(await VexLoadFailure.tryHttp('a')).toBe(false);
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/in the clear/);
    expect(WebviewManager.navigate).not.toHaveBeenCalled();
    window.vexConfirm = vi.fn(async () => true);
    expect(await VexLoadFailure.tryHttp('a')).toBe(true);
    expect(WebviewManager.navigate).toHaveBeenCalledWith('http://shop.example/cart');
  });

  it('a button that fails says so out loud', async () => {
    install();
    VexLoadFailure.note('a', fail(-105));
    vi.advanceTimersByTime(300);
    WebviewManager.navigate = vi.fn(() => { throw new Error('boom'); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    document.querySelector('.vlf-primary').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('boom'), 'error');
    err.mockRestore();
  });
});
