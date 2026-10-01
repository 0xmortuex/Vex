// @vitest-environment jsdom
//
// Tab icons leaked the real address of routed tabs (found 2026-09-30). The
// strip, the vertical list, the stacks and the panels draw every icon in Vex's
// own window, whose session is direct: a Tor tab, a Tor or proxy container, a
// burner, a Tor or proxy site route and a private tab all had their site asked
// for /favicon.ico straight from the real address.
//
// Now the window asks a site itself only for a main-session tab, and only
// while the main session is not routed; every other icon is fetched through
// the tab's own session in main (tabs:favicon) and worn as a data: URL. The
// lists of pages (history, bookmarks, read later…) never ask a site a page was
// visited in a session of its own, nor one a site rule sends elsewhere.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const DATA = 'data:image/png;base64,iVBORw0KGgo=';
const ICON = 'https://site.test/favicon.ico';

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.TabGrouper = undefined;
  // A script-wide function of tabs.js in the app; not shared between modules here.
  globalThis.isStartPage = (url) => /start\.html/.test(String(url));
  window.escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  window.vex = {
    getStartPageUrl: () => new Promise(() => {}),
    routingGet: vi.fn(async () => ({ mode: 'direct' })),
    tabFavicon: vi.fn(async () => ({ ok: true, dataUrl: DATA })),
  };
}

// The real TabManager, WebviewManager, HorizontalTabs and HistoryPanel, fresh.
async function load() {
  vi.resetModules();
  await import('../../src/renderer/js/vex-utils.js');
  const { VexIcons } = await import('../../src/renderer/js/vex-icons.js');
  globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
  const TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
  globalThis.TabManager = TM;
  TM.persistTabs = vi.fn();
  TM.renderTabUpdate = vi.fn();
  TM.updateUrlBar = vi.fn();
  const WM = (await import('../../src/renderer/js/webview.js')).WebviewManager;
  globalThis.WebviewManager = WM;
  WM._ownIcons = new Map(); WM._ownIconMisses = new Set(); WM._ownIconPending = new Map(); WM._ownIconAsked = new Map();
  await import('../../src/renderer/js/horizontal-tabs.js');
  const HP = (await import('../../src/renderer/js/history-panel.js')).HistoryPanel;
  return { TM, WM, HT: globalThis.HorizontalTabs, HP };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const tab = (id, partition, over = {}) => ({ id, url: 'https://site.test/page', title: id, favicon: null, loading: false, partition, groupId: null, stackId: null, ...over });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input"><div id="tabs-list"></div><div id="top-tab-bar"><div id="top-tabs-list"></div></div><button id="btn-new-tab-top"></button>';
  document.body.dataset.tabLayout = 'horizontal';
  installGlobals();
});
afterEach(() => { delete globalThis.SiteRoutes; });

describe('which icons Vex\'s window may ask a site for', () => {
  it('only a main-session tab\'s, and only once the main session is known to be direct', async () => {
    const { TM } = await load();
    expect(TM.windowMayAsk(null)).toBe(false);            // not read yet: taken as routed
    await TM.refreshMainRouting();
    expect(window.vex.routingGet).toHaveBeenCalledWith('persist:main');
    expect(TM.windowMayAsk(null)).toBe(true);
    expect(TM.windowMayAsk('persist:main')).toBe(true);
    for (const p of ['tor-1', 'otr-abc', 'persist:container-work', 'persist:route-tor', 'persist:route-proxy-1x']) {
      expect(TM.windowMayAsk(p)).toBe(false);
    }
  });

  it('not a normal tab\'s either while the main session goes through Tor or a proxy', async () => {
    const { TM } = await load();
    window.vex.routingGet = vi.fn(async () => ({ mode: 'proxy', custom: 'http://127.0.0.1:8080' }));
    await TM.refreshMainRouting();
    expect(TM.windowMayAsk('persist:main')).toBe(false);
  });

  it('says so, and asks nothing, when the main route cannot be read', async () => {
    const { TM } = await load();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.vex.routingGet = vi.fn(async () => { throw new Error('no answer'); });
    await TM.refreshMainRouting();
    expect(TM.windowMayAsk(null)).toBe(false);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('a routed tab never wears a web address, only a picture', async () => {
    const { TM } = await load();
    await TM.refreshMainRouting();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(TM._persistableFavicon(ICON, 'tor-1')).toBe(null);
    expect(TM._persistableFavicon(ICON, 'persist:container-work')).toBe(null);
    expect(TM._persistableFavicon(DATA, 'tor-1')).toBe(DATA);
    expect(TM._persistableFavicon(ICON, 'persist:main')).toBe(ICON);
    expect(TM._persistableFavicon(ICON, null)).toBe(ICON);
    warn.mockRestore();
  });

  it('no list asks a site visited in its own session, or one a site rule sends elsewhere', async () => {
    const { TM } = await load();
    await TM.refreshMainRouting();
    globalThis.SiteRoutes = { match: (url) => (/onion-ish\.test/.test(url) ? { host: 'onion-ish.test', mode: 'tor' } : null) };
    expect(TM.mayAskSiteForIcon('https://site.test/')).toBe(true);
    expect(TM.mayAskSiteForIcon('https://site.test/', { own: true })).toBe(false);
    expect(TM.mayAskSiteForIcon('https://site.test/', { partition: 'persist:container-work' })).toBe(false);
    expect(TM.mayAskSiteForIcon('https://www.onion-ish.test/a')).toBe(false);
  });
});

describe('a routed tab\'s icon comes through its own session', () => {
  it('asks main by the tab\'s page, and wears the picture it gets', async () => {
    const { TM, WM } = await load();
    await TM.refreshMainRouting();
    TM.tabs = [tab('t', 'persist:container-work')];
    WM.webviews.set('t', { getWebContentsId: () => 42 });
    WM._setFavicon('t', ICON);
    await flush();
    expect(window.vex.tabFavicon).toHaveBeenCalledWith(42, ICON);
    expect(TM.tabs[0].favicon).toBe(DATA);
  });

  it('the guessed /favicon.ico of a new page is asked the same way, never worn', async () => {
    const { TM, WM } = await load();
    await TM.refreshMainRouting();
    TM.tabs = [tab('t', 'tor-1', { favicon: 'data:image/png;base64,OLD' })];
    WM.webviews.set('t', { getWebContentsId: () => 42 });
    const worn = [];
    const update = TM.updateTab.bind(TM);
    TM.updateTab = (id, data) => { if (data.favicon !== undefined) worn.push(data.favicon); update(id, data); };
    WM._updateFavicon('t', 'https://other.test/a');
    expect(TM.tabs[0].favicon).toBe(null);             // the last page's icon is taken off
    await flush();
    expect(window.vex.tabFavicon).toHaveBeenCalledWith(42, 'https://other.test/favicon.ico');
    expect(worn.some((f) => /^https?:/.test(String(f)))).toBe(false);
    expect(TM.tabs[0].favicon).toBe(DATA);
  });

  it('no icon when the session refuses (Tor down); asked again on the next page', async () => {
    const { TM, WM } = await load();
    await TM.refreshMainRouting();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.vex.tabFavicon = vi.fn(async () => ({ ok: false, answered: false, error: 'net::ERR_PROXY_CONNECTION_FAILED' }));
    TM.tabs = [tab('t', 'tor-1')];
    WM.webviews.set('t', { getWebContentsId: () => 42 });
    WM._setFavicon('t', ICON);
    await flush();
    expect(TM.tabs[0].favicon).toBe(null);
    WM._setFavicon('t', ICON);
    await flush();
    expect(window.vex.tabFavicon).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('a site that has none is not asked again this run', async () => {
    const { TM, WM } = await load();
    await TM.refreshMainRouting();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.vex.tabFavicon = vi.fn(async () => ({ ok: false, answered: true, error: 'the site answered 404' }));
    TM.tabs = [tab('t', 'persist:route-tor')];
    WM.webviews.set('t', { getWebContentsId: () => 42 });
    WM._setFavicon('t', ICON);
    await flush();
    WM._setFavicon('t', ICON);
    await flush();
    expect(window.vex.tabFavicon).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a normal tab keeps its web address icon, drawn by the window as before', async () => {
    const { TM, WM } = await load();
    await TM.refreshMainRouting();
    TM.tabs = [tab('t', 'persist:main')];
    WM._setFavicon('t', ICON);
    expect(TM.tabs[0].favicon).toBe(ICON);
    expect(window.vex.tabFavicon).not.toHaveBeenCalled();
  });

  it('routing the main session takes the web address icons off its tabs and asks again', async () => {
    const { TM, WM } = await load();
    await TM.refreshMainRouting();
    TM.tabs = [tab('t', null, { favicon: ICON })];
    WM.webviews.set('t', { getWebContentsId: () => 42 });
    window.vex.routingGet = vi.fn(async () => ({ mode: 'tor' }));
    await TM.mainRoutingChanged();
    await flush();
    expect(window.vex.tabFavicon).toHaveBeenCalledWith(42, 'https://site.test/favicon.ico');
    expect(TM.tabs[0].favicon).toBe(DATA);
  });
});

describe('the top strip (Firefox look) guesses no icon for a routed tab', () => {
  it('draws no web address for a Tor or container tab without an icon, and still does for a normal one', async () => {
    const { TM, HT } = await load();
    await TM.refreshMainRouting();
    TM.tabs = [tab('tor', 'tor-1'), tab('box', 'persist:container-work'), tab('main', null, { url: 'https://plain.test/' })];
    TM.activeTabId = 'main';
    HT.render();
    const srcs = [...document.querySelectorAll('#top-tabs-list img')].map((i) => i.getAttribute('src'));
    expect(srcs).toEqual(['https://plain.test/favicon.ico']);
  });

  it('shows a routed tab the picture fetched through its session', async () => {
    const { TM, HT } = await load();
    await TM.refreshMainRouting();
    TM.tabs = [tab('tor', 'tor-1', { favicon: DATA })];
    TM.activeTabId = 'tor';
    HT.render();
    expect(document.querySelector('#top-tabs-list img').getAttribute('src')).toBe(DATA);
  });
});

describe('history of a routed tab', () => {
  it('keeps no icon address, and no list asks its site', async () => {
    const { TM, HP } = await load();
    await TM.refreshMainRouting();
    HP.addEntry('https://hidden.test/a', 'Hidden', ICON, { ownSession: true });
    HP.addEntry('https://plain.test/b', 'Plain', 'https://plain.test/icon.png');
    const saved = JSON.parse(localStorage.getItem('vex.history'));
    const hidden = saved.find((e) => e.url === 'https://hidden.test/a');
    expect(hidden.favicon).toBe('');
    expect(hidden.ownSession).toBe(true);
    HP._hydrate();
    const again = HP.entries.find((e) => e.url === 'https://hidden.test/a');
    expect(again.ownSession).toBe(true);                   // survives a reload
    expect(HP._iconFor(again)).toBe('');
    expect(HP._iconFor(HP.entries.find((e) => e.url === 'https://plain.test/b'))).toBe('https://plain.test/icon.png');
    expect(HP._iconFor({ url: 'https://noicon.test/x' })).toBe('https://noicon.test/favicon.ico');
  });

  it('asks no site at all while the main session is routed', async () => {
    const { TM, HP } = await load();
    window.vex.routingGet = vi.fn(async () => ({ mode: 'tor' }));
    await TM.refreshMainRouting();
    expect(HP._iconFor({ url: 'https://plain.test/b', favicon: 'https://plain.test/icon.png' })).toBe('');
  });
});
