// @vitest-environment jsdom
//
// "Reset this site" (the site panel, Settings › Site settings and a page's
// context menu) and Boosts' "Un-zap all" happen at once with Undo on the toast
// (js/vex-undo.js) instead of asking "Are you sure?". Undo puts back every
// store the reset touched, exactly; a toast that goes unused leaves it reset.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const flush = () => new Promise(r => setTimeout(r, 0));
let offers;

function setup({ url = 'https://www.news.example/a', partition = 'persist:main', privateWindow = false } = {}) {
  document.body.innerHTML = '<div id="url-bar"><button id="url-site-btn" type="button"></button><input id="url-input"></div>';
  localStorage.clear();
  window.VexIcons = { svg: (name) => `<svg data-icon="${name}"></svg>` };
  globalThis.VexIcons = window.VexIcons;
  window.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  offers = [];
  window.showToast = vi.fn((message, type, ms, opts) => {
    const t = { message, type, opts, dismissed: false, dismiss() { this.dismissed = true; } };
    if (opts) offers.push(t);
    return t;
  });
  window.vexConfirm = vi.fn(async () => true);
  if (!globalThis.CSS || !globalThis.CSS.escape) globalThis.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, c => '\\' + c) };
  window.VexTabPolicy = { isPrivateWindow: privateWindow, defaultPartition: privateWindow ? 'private-1' : 'persist:main' };
  const wv = (u, p) => {
    let zoom = 1;
    return {
      getURL: () => u, getWebContentsId: () => 7, getZoomFactor: () => zoom, setZoomFactor: vi.fn(z => { zoom = z; }),
      getAttribute: () => p, reload: vi.fn(), executeJavaScript: vi.fn(async () => null), isConnected: true,
      insertCSS: vi.fn(async () => 'dark-key'), removeInsertedCSS: vi.fn(async () => {}), _forceDarkKey: null,
    };
  };
  const front = wv(url, partition);
  const other = wv('https://news.example/b', partition);   // a second tab of the same site
  const tab = { id: 't1', url, partition };
  const tab2 = { id: 't2', url: 'https://news.example/b', partition };
  globalThis.TabManager = { tabs: [tab, tab2], getActiveTab: () => tab, activeTabId: 't1', rebuildTab: vi.fn(), wakeTab: vi.fn(), _materializeTab: vi.fn(), createTab: vi.fn(), closeTab: vi.fn() };
  globalThis.WebviewManager = {
    webviews: new Map([['t1', front], ['t2', other]]), getActiveWebview: () => front, zoomIn: vi.fn(), zoomOut: vi.fn(), zoomReset: vi.fn(),
    _shouldForceDark: (u) => { try { return JSON.parse(localStorage.getItem('vex.forceDarkHosts') || '[]').includes(new URL(u).hostname.replace(/^www\./, '')); } catch { return false; } },
    toggleForceDarkForSite: vi.fn(),
    _applyForceDark: vi.fn(w => { w._forceDarkKey = 'dark-key'; }),
    _removeForceDark: vi.fn(w => { w._forceDarkKey = null; }),
  };
  // Main's side of the permissions, one store with a token for each reset.
  const perms = { 'https://www.news.example::geolocation': 'deny', 'https://www.news.example::camera': 'allow' };
  const kept = new Map();
  window.vex = {
    _perms: perms,
    permissionsListForPage: vi.fn(async () => ({ ...perms })),
    permissionsSetForPage: vi.fn(async () => ({ ...perms })),
    permissionsResetForPage: vi.fn(async () => {
      const token = String(kept.size).padStart(32, '0');
      kept.set(token, { ...perms });
      for (const k of Object.keys(perms)) delete perms[k];
      return { decisions: {}, undo: token };
    }),
    permissionsResetForPageUndo: vi.fn(async (token) => {
      if (!kept.has(token)) return { ok: false, error: 'There is nothing to put back any more' };
      for (const [k, v] of Object.entries(kept.get(token))) if (!(k in perms)) perms[k] = v;
      kept.delete(token);
      return { ok: true };
    }),
    privacyTrackerStats: vi.fn(async () => ({ bySite: {} })),
    getAdBlockerState: vi.fn(async () => true),
    cookiesList: vi.fn(async () => ({ ok: true, cookies: [] })),
    siteRulesGet: vi.fn(async () => ({ ok: true, rules: {} })),
    siteRulesSet: vi.fn(async (rules) => ({ ok: true, rules })),
    onSiteRulesChanged: vi.fn(),
  };
  return { front, other, tab, tab2 };
}

const FILES = ['vex-undo', 'boosts', 'site-panel', 'site-rules-ui', 'translate-side', 'site-profiles', 'site-routes'].map(f => require.resolve(`../../src/renderer/js/${f}.js`));
const load = () => {
  vi.resetModules();
  for (const f of FILES) delete require.cache[f];
  const { VexUndo } = require('../../src/renderer/js/vex-undo.js');
  const { VexBoosts } = require('../../src/renderer/js/boosts.js');
  const { SitePanel } = require('../../src/renderer/js/site-panel.js');
  const { SiteRulesUI } = require('../../src/renderer/js/site-rules-ui.js');
  const { TranslateSide } = require('../../src/renderer/js/translate-side.js');
  require('../../src/renderer/js/site-profiles.js');
  require('../../src/renderer/js/site-routes.js');
  VexBoosts.init();
  window.VexUndo = VexUndo;
  Object.assign(globalThis, { VexUndo, VexBoosts, SitePanel, SiteRulesUI, TranslateSide, SiteProfiles: window.SiteProfiles, SiteRoutes: window.SiteRoutes });
  return SitePanel;
};

afterEach(() => {
  try { globalThis.SitePanel && globalThis.SitePanel.close({ keepFocus: true }); } catch { /* not open */ }
  for (const k of ['SitePanel', 'SiteRulesUI', 'TranslateSide', 'SiteProfiles', 'SiteRoutes', 'TabManager', 'WebviewManager', 'VexBoosts', 'VexUndo']) delete globalThis[k];
});

// Everything set for news.example, plus another site's that must not move.
function customize() {
  localStorage.setItem('vex.zooms', JSON.stringify({ 'www.news.example': 1.5, 'news.example': 1.25, 'other.example': 2 }));
  localStorage.setItem('vex.forceDarkHosts', JSON.stringify(['other.example', 'news.example']));
  localStorage.setItem('vex.neverSleepHosts', JSON.stringify(['news.example', 'other.example']));
  localStorage.setItem('vex.translateAlwaysHosts', JSON.stringify(['news.example']));
  localStorage.setItem('vex.boosts', JSON.stringify({ 'news.example': { zaps: ['.ad', '#promo'], css: 'body{color:red}', js: 'window.x=1' }, 'other.example': { zaps: ['.x'], css: '', js: '' } }));
  SiteRulesUI.save({ 'news.example': { ads: 'off', js: 'off' }, 'other.example': { cookies: 'off' } });
}
const KEYS = ['vex.zooms', 'vex.forceDarkHosts', 'vex.neverSleepHosts', 'vex.translateAlwaysHosts', 'vex.boosts', 'vex.siteRules'];
// Each list compared as a set and each map as a map: Undo may re-add a host at
// the end of a list, which is the same setting.
const stores = () => Object.fromEntries(KEYS.map(k => {
  const v = JSON.parse(localStorage.getItem(k) || 'null');
  return [k, Array.isArray(v) ? [...v].sort() : v];
}));

describe('the site panel’s Reset this site', () => {
  it('asks nothing, resets every store, and Undo puts every one back exactly', async () => {
    const { front, other } = setup(); const P = load();
    customize();
    VexBoosts.init();
    front.setZoomFactor(1.5); other.setZoomFactor(1.25);
    front._forceDarkKey = 'dark-key';
    const before = stores();
    const permsBefore = { ...window.vex._perms };
    P.open(); await flush(); await flush();
    document.querySelector('[data-act="reset-site"]').click();
    await flush(); await flush();

    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(window.vex._perms).toEqual({});
    expect(JSON.parse(localStorage.getItem('vex.zooms'))).toEqual({ 'other.example': 2 });
    expect(JSON.parse(localStorage.getItem('vex.forceDarkHosts'))).toEqual(['other.example']);
    expect(JSON.parse(localStorage.getItem('vex.neverSleepHosts'))).toEqual(['other.example']);
    expect(JSON.parse(localStorage.getItem('vex.translateAlwaysHosts'))).toEqual([]);
    expect(Object.keys(VexBoosts.boosts)).toEqual(['other.example']);
    expect(SiteRulesUI.rules()).toEqual({ 'other.example': { cookies: 'off' } });
    expect(window.vex.siteRulesSet).toHaveBeenLastCalledWith({ 'other.example': { cookies: 'off' } });
    expect(front.getZoomFactor()).toBe(1);
    expect(other.getZoomFactor()).toBe(1);
    expect(front._forceDarkKey).toBeNull();
    // The panel shows the reset: every permission back to Ask.
    expect(document.getElementById('sp-perm-geolocation').value).toBe('ask');
    expect(offers.at(-1).message).toBe('Reset news.example');
    expect(offers.at(-1).opts.action.label).toBe('Undo');

    offers.at(-1).opts.action.run();
    await flush(); await flush(); await flush();
    expect(stores()).toEqual(before);
    expect(VexBoosts.boosts['news.example']).toEqual({ zaps: ['.ad', '#promo'], css: 'body{color:red}', js: 'window.x=1' });
    expect(window.vex._perms).toEqual(permsBefore);
    expect(window.vex.permissionsResetForPageUndo).toHaveBeenCalledTimes(1);
    expect(window.vex.siteRulesSet).toHaveBeenLastCalledWith(before['vex.siteRules']);
    expect(front.getZoomFactor()).toBe(1.5);
    expect(other.getZoomFactor()).toBe(1.25);
    expect(front._forceDarkKey).toBe('dark-key');
    // The custom JS is not run a second time on the open pages.
    for (const w of [front, other]) for (const [code] of w.executeJavaScript.mock.calls) expect(code).not.toContain('window.x=1');
    // The panel, still open, reads the stores again.
    expect(document.getElementById('sp-perm-geolocation').value).toBe('deny');
    expect(document.getElementById('sp-never-sleep').checked).toBe(true);
  });

  it('a setting made for the site after the reset wins over the one Undo would put back', async () => {
    setup(); const P = load();
    customize();
    VexBoosts.init();
    P.open(); await flush();
    document.querySelector('[data-act="reset-site"]').click();
    await flush(); await flush();
    localStorage.setItem('vex.zooms', JSON.stringify({ 'other.example': 2, 'www.news.example': 0.9 }));
    offers.at(-1).opts.action.run();
    await flush(); await flush();
    expect(JSON.parse(localStorage.getItem('vex.zooms'))).toEqual({ 'other.example': 2, 'www.news.example': 0.9, 'news.example': 1.25 });
  });

  it('once the toast goes, the reset is final: nothing comes back and Ctrl+Z does nothing', async () => {
    setup(); const P = load();
    customize();
    VexBoosts.init();
    P.open(); await flush();
    document.querySelector('[data-act="reset-site"]').click();
    await flush(); await flush();
    const after = stores();
    offers.at(-1).opts.onExpire();
    expect(VexUndo.pending()).toEqual([]);
    expect(VexUndo.undoLatest()).toBeNull();
    offers.at(-1).opts.action.run();   // a late click on a toast already gone
    await flush(); await flush();
    expect(stores()).toEqual(after);
    expect(window.vex.permissionsResetForPageUndo).not.toHaveBeenCalled();
  });

  it('the window closing with the toast up leaves the site reset, and consistent', async () => {
    setup(); const P = load();
    customize();
    VexBoosts.init();
    P.open(); await flush();
    document.querySelector('[data-act="reset-site"]').click();
    await flush(); await flush();
    const after = stores();
    window.dispatchEvent(new Event('pagehide'));
    expect(VexUndo.pending()).toEqual([]);
    expect(offers.at(-1).dismissed).toBe(true);
    expect(stores()).toEqual(after);
    expect(after['vex.zooms']).toEqual({ 'other.example': 2 });
  });

  it('a site switch put back builds the tab again; with the panel closed, at once', async () => {
    setup(); const P = load();
    customize();
    P.open(); await flush();
    document.querySelector('[data-act="reset-site"]').click();
    await flush(); await flush();
    P.close();
    expect(TabManager.rebuildTab).toHaveBeenCalledTimes(1);   // the reset, on close
    offers.at(-1).opts.action.run();
    await flush(); await flush();
    expect(TabManager.rebuildTab).toHaveBeenCalledTimes(2);   // the Undo
  });

  it('in an off-the-record tab: only its in-memory permissions and its zoom, and Undo writes nothing to the profile', async () => {
    const { front } = setup({ partition: 'otr-1' }); const P = load();
    customize();
    VexBoosts.init();
    front.setZoomFactor(1.75);
    const before = stores();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    P.open(); await flush();
    document.querySelector('[data-act="reset-site"]').click();
    await flush(); await flush();
    expect(window.vex.permissionsResetForPage).toHaveBeenCalledWith(7);
    expect(front.getZoomFactor()).toBe(1);
    expect(offers.at(-1).message).toBe('Reset news.example for this tab');
    offers.at(-1).opts.action.run();
    await flush(); await flush();
    expect(front.getZoomFactor()).toBe(1.75);
    expect(window.vex.permissionsResetForPageUndo).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    expect(stores()).toEqual(before);
    setItem.mockRestore();
  });

  it('in a Tor tab there are no permissions to reset; the zoom still comes back', async () => {
    const { front } = setup({ partition: 'tor-abc' }); const P = load();
    front.setZoomFactor(1.1);
    P.open(); await flush();
    document.querySelector('[data-act="reset-site"]').click();
    await flush(); await flush();
    expect(window.vex.permissionsResetForPage).not.toHaveBeenCalled();
    offers.at(-1).opts.action.run();
    await flush();
    expect(front.getZoomFactor()).toBe(1.1);
  });

  it('Reset permissions alone: at once, Undo with the token main gave', async () => {
    setup(); const P = load();
    P.open(); await flush(); await flush();
    document.querySelector('[data-act="perms-reset"]').click();
    await flush(); await flush();
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(window.vex._perms).toEqual({});
    expect(offers.at(-1).message).toBe('Permissions reset for news.example');
    offers.at(-1).opts.action.run();
    await flush(); await flush();
    expect(window.vex._perms).toEqual({ 'https://www.news.example::geolocation': 'deny', 'https://www.news.example::camera': 'allow' });
    expect(document.getElementById('sp-perm-geolocation').value).toBe('deny');
  });

  it('an Undo main can no longer honour says so', async () => {
    setup(); const P = load();
    P.open(); await flush(); await flush();
    document.querySelector('[data-act="perms-reset"]').click();
    await flush(); await flush();
    window.vex.permissionsResetForPageUndo.mockResolvedValueOnce({ ok: false, error: 'There is nothing to put back any more' });
    offers.at(-1).opts.action.run();
    await flush(); await flush();
    expect(window.showToast).toHaveBeenLastCalledWith('Could not undo: There is nothing to put back any more', 'error', 6000);
  });
});

describe('Settings › Site settings: Reset', () => {
  it('at once, the row goes, and Undo brings the site and its row back', async () => {
    setup(); load();
    customize();
    VexBoosts.init();
    const before = stores();
    const box = document.createElement('div');
    document.body.appendChild(box);
    SiteProfiles.renderSettings(box);
    box.querySelector('[data-host="news.example"] [data-act="reset"]').click();
    await flush(); await flush();
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(box.querySelector('[data-host="news.example"]')).toBeNull();
    expect(offers.at(-1).message).toBe('Reset news.example');
    offers.at(-1).opts.action.run();
    await flush(); await flush();
    expect(stores()).toEqual(before);
    expect(box.querySelector('[data-host="news.example"]')).not.toBeNull();
    // Its permissions were never part of this Reset.
    expect(window.vex.permissionsResetForPage).not.toHaveBeenCalled();
  });

  it('in a private window, a site with switches is refused before anything is touched', async () => {
    setup({ privateWindow: true }); load();
    customize();
    const before = stores();
    await expect(SiteProfiles.forgetSite('news.example')).rejects.toThrow(/normal window/);
    expect(stores()).toEqual(before);
  });
});

describe('a page’s context menu: Reset this site’s settings', () => {
  it('is the panel’s Reset, for that page’s tab, with Undo', async () => {
    setup(); load();
    customize();
    const W = (await import('../../src/renderer/js/webview.js')).WebviewManager;
    const spy = vi.spyOn(SitePanel, 'resetSite');
    W.resetSite({ dataset: { tabId: 't1' }, getURL: () => 'https://www.news.example/a' });
    await flush(); await flush();
    expect(spy).toHaveBeenCalledWith(TabManager.tabs[0]);
    expect(offers.at(-1).message).toBe('Reset news.example');
  });
});

describe('Boosts: Un-zap all', () => {
  it('at once, Undo puts the zaps back in order and hides them again without re-running the JS', async () => {
    const { front } = setup(); load();
    VexBoosts.boosts = { 'news.example': { zaps: ['.ad', '#promo'], css: 'body{color:red}', js: 'window.x=1' } };
    VexBoosts.save();
    const before = localStorage.getItem('vex.boosts');
    VexBoosts.openEditor('news.example');
    document.getElementById('bm-clear-zaps').click();
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(VexBoosts.boosts['news.example'].zaps).toEqual([]);
    expect(document.getElementById('boost-edit-modal')).toBeNull();
    expect(offers.at(-1).message).toMatch(/^Brought back 2 hidden elements on news\.example/);
    front.executeJavaScript.mockClear();
    offers.at(-1).opts.action.run();
    await flush();
    expect(localStorage.getItem('vex.boosts')).toBe(before);
    const code = front.executeJavaScript.mock.calls.map(c => c[0]).join('\n');
    expect(code).toContain('#promo{display:none');
    expect(code).not.toContain('window.x=1');
  });

  it('a boost that was only zaps goes, and comes back whole; a zap added since stays after them', async () => {
    setup(); load();
    VexBoosts.boosts = { 'news.example': { zaps: ['.a', '.b'], css: '', js: '' } };
    VexBoosts.save();
    VexBoosts.openEditor('news.example');
    document.getElementById('bm-clear-zaps').click();
    expect(VexBoosts.boosts['news.example']).toBeUndefined();
    VexBoosts.boosts['news.example'] = { zaps: ['.c'], css: '', js: '' };   // zapped since
    offers.at(-1).opts.action.run();
    await flush();
    expect(VexBoosts.boosts['news.example']).toEqual({ zaps: ['.a', '.b', '.c'], css: '', js: '' });
  });

  it('expired, the zaps stay gone', async () => {
    setup(); load();
    VexBoosts.boosts = { 'news.example': { zaps: ['.a'], css: 'x{}', js: '' } };
    VexBoosts.save();
    VexBoosts.openEditor('news.example');
    document.getElementById('bm-clear-zaps').click();
    const after = localStorage.getItem('vex.boosts');
    offers.at(-1).opts.onExpire();
    offers.at(-1).opts.action.run();
    await flush();
    expect(localStorage.getItem('vex.boosts')).toBe(after);
  });
});

beforeEach(() => { vi.restoreAllMocks(); });
