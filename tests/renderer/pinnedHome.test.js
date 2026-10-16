// @vitest-environment jsdom
//
// js/pinned-home.js (T3-048): a pinned tab's home page, the way back, and links that
// leave the site opening in a new tab.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordWindowListeners } from '../helpers/trustedEvents.js';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
const { VexPinnedHome, vexPinnedHomeGuest } = require('../../src/renderer/js/pinned-home.js');

const HOME = 'https://mail.example.com/inbox';

function install(tabOver = {}) {
  const tab = { id: 'a', url: HOME, title: 'Mail', pinned: true, homeUrl: HOME, ...tabOver };
  globalThis.TabManager = {
    tabs: [tab], activeTabId: 'a',
    getActiveTab() { return this.tabs.find(t => t.id === this.activeTabId); },
    switchTab: vi.fn(function (id) { this.activeTabId = id; }),
    persistTabs: vi.fn(),
  };
  globalThis.WebviewManager = { webviews: new Map([['a', { isConnected: true }]]), navigate: vi.fn() };
  window.vexGuestEval = vi.fn(async () => 'installed');
  return tab;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="webviews-container"></div>';
  VexPinnedHome._pill = null;
});

describe('the home of a pinned tab', () => {
  it('is the address it is pinned on', () => {
    const tab = { url: HOME, pinned: true };
    VexPinnedHome.onPin(tab);
    expect(tab.homeUrl).toBe(HOME);
    VexPinnedHome.onPin({ ...tab, url: 'https://other.example/' });
    expect(tab.homeUrl).toBe(HOME);                 // a home already chosen is kept
  });

  it('is not made for a page that is not on the web, nor when switched off', () => {
    const a = { url: 'vex://settings' }; VexPinnedHome.onPin(a); expect(a.homeUrl).toBeUndefined();
    VexPinnedHome.setEnabled(false);
    const b = { url: HOME }; VexPinnedHome.onPin(b); expect(b.homeUrl).toBeUndefined();
  });

  it('goes when the tab is unpinned', () => {
    const tab = install();
    VexPinnedHome.onUnpin(tab);
    expect(tab.homeUrl).toBe(null);
  });

  it('is away when the address differs by path or site, not by #fragment or a trailing slash', () => {
    const tab = install();
    expect(VexPinnedHome.isAway(tab)).toBe(false);
    tab.url = HOME + '#label/work';
    expect(VexPinnedHome.isAway(tab)).toBe(false);
    tab.url = HOME + '/';
    expect(VexPinnedHome.isAway(tab)).toBe(false);
    tab.url = 'https://mail.example.com/settings';
    expect(VexPinnedHome.isAway(tab)).toBe(true);
    tab.url = 'https://elsewhere.example/';
    expect(VexPinnedHome.isAway(tab)).toBe(true);
    tab.pinned = false;
    expect(VexPinnedHome.isAway(tab)).toBe(false);
  });

  it('can be moved to the page the tab is on, only for a pinned tab', () => {
    const tab = install({ url: 'https://mail.example.com/settings' });
    VexPinnedHome.setHome('a');
    expect(tab.homeUrl).toBe('https://mail.example.com/settings');
    expect(TabManager.persistTabs).toHaveBeenCalled();
    tab.pinned = false;
    expect(() => VexPinnedHome.setHome('a')).toThrow(/pinned/);
    expect(() => VexPinnedHome.setHome('zz')).toThrow(/gone/);
  });
});

describe('the way back', () => {
  it('goes to the home page in the tab, switching to it first', () => {
    const tab = install({ url: 'https://elsewhere.example/' });
    TabManager.activeTabId = 'other';
    VexPinnedHome.goHome('a');
    expect(TabManager.switchTab).toHaveBeenCalledWith('a');
    expect(WebviewManager.navigate).toHaveBeenCalledWith(HOME);
    expect(tab.homeUrl).toBe(HOME);
  });

  it('says so for a tab without a home', () => {
    install({ homeUrl: null });
    expect(() => VexPinnedHome.goHome('a')).toThrow(/no home/);
  });

  it('shows a button only while the pinned tab in front is away, and it goes home when pressed', () => {
    const tab = install();
    VexPinnedHome.sync();
    expect(document.querySelector('.vph-pill')).toBe(null);
    tab.url = 'https://news.example/';
    VexPinnedHome.sync();
    const pill = document.querySelector('.vph-pill');
    expect(pill.textContent).toBe('Back to mail.example.com');
    expect(pill.querySelector('svg')).not.toBe(null);
    pill.click();
    expect(WebviewManager.navigate).toHaveBeenCalledWith(HOME);
    tab.url = HOME;
    VexPinnedHome.sync();
    expect(document.querySelector('.vph-pill')).toBe(null);
  });

  it('has menu rows for it, and none for an unpinned tab or when off', () => {
    const tab = install({ url: 'https://mail.example.com/settings' });
    expect(VexPinnedHome.menuItems(tab).map(i => i.label)).toEqual(['Back to the pinned page', 'Make this the pinned page']);
    tab.pinned = false;
    expect(VexPinnedHome.menuItems(tab)).toEqual([]);
    tab.pinned = true;
    VexPinnedHome.setEnabled(false);
    expect(VexPinnedHome.menuItems(tab)).toEqual([]);
    expect(document.querySelector('.vph-pill')).toBe(null);
  });
});

describe('the page side', () => {
  const open = vi.fn();
  let rec;
  beforeEach(() => {
    rec = recordWindowListeners();
    delete window.__vexPinHomeOn;
    window.open = open;
    open.mockClear();
    document.body.innerHTML = '<a id="out" href="https://other.example/page">out</a><a id="in" href="/inbox/42">in</a><a id="sub" href="https://calendar.localhost/">sub</a>'
      + '<a id="blank" target="_blank" href="https://other.example/">blank</a><a id="mail" href="mailto:a@b.c">mail</a><a id="dl" download href="https://other.example/f.zip">dl</a>';
    // jsdom's page is http://localhost:3000, so localhost is the home site here.
  });
  afterEach(() => { delete window.__vexPinHomeOn; rec.restore(); });
  // jsdom marks every dispatched event untrusted; the page script's own listener is called directly (tests/helpers/trustedEvents.js).
  const click = (id, init = {}) => rec.fire('click', document.getElementById(id), { button: 0, ...init });

  it('opens a link that leaves the site in a new tab and keeps the pin where it is', () => {
    vexPinnedHomeGuest({ host: 'localhost' });
    const e = click('out');
    expect(e.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('https://other.example/page', '_blank', 'noopener');
  });

  it('leaves links inside the site, a subdomain, new-tab links, mailto, downloads and modified clicks alone', () => {
    vexPinnedHomeGuest({ host: 'localhost' });
    for (const id of ['in', 'sub', 'blank', 'mail', 'dl']) expect(click(id).defaultPrevented, id).toBe(false);
    expect(click('out', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click('out', { button: 1 }).defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('does nothing once the tab was taken elsewhere on purpose, and when told to stop', () => {
    vexPinnedHomeGuest({ host: 'mail.example.com' });          // this page is not on the home site
    expect(click('out').defaultPrevented).toBe(false);
    vexPinnedHomeGuest({ host: '' });
    expect(click('out').defaultPrevented).toBe(false);
    expect(vexPinnedHomeGuest({ host: 'localhost' })).toBe('updated');
    expect(click('out').defaultPrevented).toBe(true);
  });

  it('is given to a pinned tab only, with the home site named, and not when the link rule is off', async () => {
    const tab = install();
    await VexPinnedHome._pagesOf([tab]);
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('{"host":"mail.example.com"}');
    VexPinnedHome.setLinksEnabled(false);
    window.vexGuestEval.mockClear();
    await VexPinnedHome._pagesOf([tab]);
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('{"host":""}');
  });
});
