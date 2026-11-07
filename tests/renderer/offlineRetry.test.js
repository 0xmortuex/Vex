// @vitest-environment jsdom
//
// Back online (js/load-failure.js backOnline): a page that failed because there was no internet is offered a reload, or
// reloaded in the background when the person turned that on; DNS, certificate and server errors are never touched.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { VexLoadFailure } = require('../../src/renderer/js/load-failure.js');

let tabs, loads, toast;
const mk = (id, code, extra = {}) => ({ id, url: 'https://shop.example/' + id, _failedPage: { code, url: 'https://shop.example/' + id }, ...extra });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  loads = [];
  toast = [];
  tabs = [mk('a', -106), mk('b', -105), mk('c', -106)];
  globalThis.TabManager = { tabs, activeTabId: 'b', switchTab: vi.fn() };
  globalThis.WebviewManager = { webviews: new Map(tabs.map(t => [t.id, { loadURL: (u) => loads.push(t.id + ' ' + u) }])), navigate: vi.fn() };
  globalThis.VexAttention = { toast: vi.fn((opts, text, kind, ms, extra) => { toast.push({ opts, text, extra }); }) };
  delete window.VexTabPolicy;
  VexLoadFailure.setEnabled(true);
});

describe('which tabs count', () => {
  it('only the ones that failed with no internet and were not handled yet', () => {
    expect(VexLoadFailure.offlineFailures(tabs).map(t => t.id)).toEqual(['a', 'c']);
    tabs[0]._failedPage.offlineHandled = true;
    expect(VexLoadFailure.offlineFailures(tabs).map(t => t.id)).toEqual(['c']);
  });
  it('leaves out a tab the policy will not keep (private, Tor)', () => {
    window.VexTabPolicy = { canPersist: (t) => t.id !== 'a' };
    expect(VexLoadFailure.offlineFailures(tabs).map(t => t.id)).toEqual(['c']);
  });
});

describe('the offer (on by default)', () => {
  it('shows one notice with a Reload button, once per failure, and reloads only the offline ones', () => {
    expect(VexLoadFailure.offerOn()).toBe(true);
    expect(VexLoadFailure.autoOn()).toBe(false);
    expect(VexLoadFailure.backOnline()).toBe(2);
    expect(toast).toHaveLength(1);
    expect(toast[0].opts.feature).toBe('offline-retry');
    expect(loads).toEqual([]);                                  // nothing reloaded until the button is pressed
    toast[0].extra.action.run();
    expect(loads).toEqual(['a https://shop.example/a', 'c https://shop.example/c']);
    expect(VexLoadFailure.backOnline()).toBe(0);                // the same failures are not offered again
    expect(toast).toHaveLength(1);
    expect(TabManager.switchTab).not.toHaveBeenCalled();
  });
  it('a new failure on the same tab is offered again', () => {
    VexLoadFailure.backOnline();
    tabs[0]._failedPage = { code: -106, url: 'https://shop.example/a' };
    expect(VexLoadFailure.backOnline()).toBe(1);
  });
  it('says nothing when the offer is off, or the failed-page feature is off', () => {
    VexLoadFailure.setOffer(false);
    expect(VexLoadFailure.backOnline()).toBe(0);
    VexLoadFailure.setOffer(true);
    VexLoadFailure.setEnabled(false);
    expect(VexLoadFailure.backOnline()).toBe(0);
    expect(toast).toHaveLength(0);
  });
});

describe('reloading by itself (off by default)', () => {
  it('reloads the offline failures in the background, with no notice and no tab switch', () => {
    VexLoadFailure.setAuto(true);
    expect(VexLoadFailure.backOnline()).toBe(2);
    expect(loads).toEqual(['a https://shop.example/a', 'c https://shop.example/c']);
    expect(toast).toHaveLength(0);
    expect(TabManager.switchTab).not.toHaveBeenCalled();
  });
  it('works even when the offer is off', () => {
    VexLoadFailure.setOffer(false);
    VexLoadFailure.setAuto(true);
    expect(VexLoadFailure.backOnline()).toBe(2);
  });
});

describe('wiring', () => {
  it('init listens for the online event', () => {
    const spy = vi.spyOn(window, 'addEventListener');
    VexLoadFailure._inited = false;
    VexLoadFailure.init();
    expect(spy.mock.calls.map(c => c[0])).toContain('online');
    spy.mockRestore();
  });
});
