// @vitest-environment jsdom
//
// The site panel (js/site-panel.js): one place for everything about the site
// in front, opened from the icon at the left of the address field. What is
// checked here: it knows what kind of page and tab it is looking at; a tab that
// keeps nothing (private window, off-the-record, Tor) cannot write anything
// about the site; the panel reads and writes the same stores the rest of Vex
// and Settings use; and it behaves as a dialog for the keyboard.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const flush = () => new Promise(r => setTimeout(r, 0));

function setup({ url = 'https://www.news.example/a', partition = 'persist:main', privateWindow = false } = {}) {
  document.body.innerHTML = '<div id="url-bar"><button id="url-site-btn" type="button"></button><input id="url-input"></div>';
  localStorage.clear();
  window.VexIcons = { svg: (name) => `<svg data-icon="${name}"></svg>` };
  globalThis.VexIcons = window.VexIcons;
  window.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  // jsdom has no CSS.escape; Chromium does.
  if (!globalThis.CSS || !globalThis.CSS.escape) globalThis.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, c => '\\' + c) };
  window.VexTabPolicy = { isPrivateWindow: privateWindow, defaultPartition: privateWindow ? 'private-1' : 'persist:main' };
  const wv = { getURL: () => url, getWebContentsId: () => 7, getZoomFactor: () => 1, setZoomFactor: vi.fn(), getAttribute: () => partition, reload: vi.fn() };
  const tab = { id: 't1', url, partition };
  globalThis.TabManager = { tabs: [tab], getActiveTab: () => tab, activeTabId: 't1', rebuildTab: vi.fn(), wakeTab: vi.fn(), _materializeTab: vi.fn(), createTab: vi.fn(), closeTab: vi.fn() };
  globalThis.WebviewManager = { webviews: new Map([['t1', wv]]), getActiveWebview: () => wv, zoomIn: vi.fn(), zoomOut: vi.fn(), zoomReset: vi.fn(), _shouldForceDark: () => false, toggleForceDarkForSite: vi.fn() };
  window.vex = {
    permissionsListForPage: vi.fn(async () => ({ 'https://www.news.example::geolocation': 'deny', 'https://www.news.example::media': 'allow' })),
    permissionsSetForPage: vi.fn(async () => ({})),
    permissionsResetForPage: vi.fn(async () => ({})),
    privacyTrackerStats: vi.fn(async () => ({ bySite: { 'news.example': 4, 'm.news.example': 2, 'other.example': 9 } })),
    getAdBlockerState: vi.fn(async () => true),
    cookiesList: vi.fn(async () => ({ ok: true, cookies: [{ name: 'a' }, { name: 'b' }] })),
    siteRulesGet: vi.fn(async () => ({ ok: true, rules: {} })),
    siteRulesSet: vi.fn(async (rules) => ({ ok: true, rules })),
    onSiteRulesChanged: vi.fn(),
    siteCertificate: vi.fn(async () => ({ ok: true, secure: true, subject: 'news.example', issuer: 'Test CA', validFrom: 0, validTo: 0, fingerprint256: 'AA:BB' })),
  };
  return { wv, tab };
}

const FILES = ['site-panel', 'site-rules-ui', 'translate-side', 'site-profiles', 'site-routes'].map(f => require.resolve(`../../src/renderer/js/${f}.js`));
const load = () => {
  vi.resetModules();
  // Each file runs again, so the globals it sets are this test's own.
  for (const f of FILES) delete require.cache[f];
  const { SitePanel } = require('../../src/renderer/js/site-panel.js');
  const { SiteRulesUI } = require('../../src/renderer/js/site-rules-ui.js');
  const { TranslateSide } = require('../../src/renderer/js/translate-side.js');
  require('../../src/renderer/js/site-profiles.js');
  require('../../src/renderer/js/site-routes.js');
  Object.assign(globalThis, { SitePanel, SiteRulesUI, TranslateSide, SiteProfiles: window.SiteProfiles, SiteRoutes: window.SiteRoutes });
  return SitePanel;
};

afterEach(() => {
  try { globalThis.SitePanel && globalThis.SitePanel.close({ keepFocus: true }); } catch { /* not open */ }
  for (const k of ['SitePanel', 'SiteRulesUI', 'TranslateSide', 'SiteProfiles', 'SiteRoutes', 'TabManager', 'WebviewManager']) delete globalThis[k];
});

describe('what the panel is looking at', () => {
  it('a website in an ordinary tab may keep what is set', () => {
    setup(); const P = load();
    const c = P.context();
    expect(c).toMatchObject({ kind: 'web', host: 'news.example', fullHost: 'www.news.example', origin: 'https://www.news.example', secure: true, canSave: true, pageId: 7 });
  });
  it('a container tab may keep things, and says which container', () => {
    setup({ partition: 'persist:container-work' }); const P = load();
    expect(P.context()).toMatchObject({ container: 'work', canSave: true });
  });
  it('an off-the-record tab, a Tor tab and a private window keep nothing', () => {
    setup({ partition: 'otr-1' }); let P = load();
    expect(P.context().canSave).toBe(false);
    expect(P._notKept(P.context())).toMatch(/keeps nothing/);
    setup({ partition: 'tor-abc' }); P = load();
    expect(P.context()).toMatchObject({ tor: true, canSave: false });
    expect(P._notKept(P.context())).toMatch(/Tor tab/);
    setup({ privateWindow: true, partition: 'private-1' }); P = load();
    expect(P.context().canSave).toBe(false);
    expect(P._notKept(P.context())).toMatch(/private window/);
  });
  it('Vex\'s own pages and files are not websites', () => {
    setup({ url: 'file:///C:/vex/src/renderer/start.html' }); let P = load();
    expect(P.context().kind).toBe('start');
    setup({ url: 'file:///C:/Users/me/notes.html' }); P = load();
    expect(P.context().kind).toBe('file');
  });
});

describe('the icon in the address field', () => {
  it('a padlock for https, an open lock for http, a globe for Vex pages', () => {
    setup(); let P = load();
    expect(P.refreshIcon()).toBe('secure');
    expect(document.querySelector('#url-site-btn svg').id).toBe('url-icon');
    expect(document.getElementById('url-site-btn').getAttribute('aria-label')).toMatch(/secure.*news\.example/);
    setup({ url: 'http://news.example/' }); P = load();
    expect(P.refreshIcon()).toBe('insecure');
    expect(document.getElementById('url-site-btn').getAttribute('aria-label')).toMatch(/^Not secure/);
    setup({ url: 'file:///C:/vex/src/renderer/start.html' }); P = load();
    expect(P.refreshIcon()).toBe('internal');
  });
});

describe('what it shows, from the stores', () => {
  it('permissions as the page is held to them, an old "camera and microphone" answer included', async () => {
    setup(); const P = load();
    P.open(); await flush(); await flush();
    expect(document.getElementById('sp-perm-geolocation').value).toBe('deny');
    expect(document.getElementById('sp-perm-camera').value).toBe('allow');
    expect(document.getElementById('sp-perm-microphone').value).toBe('allow');
    expect(document.getElementById('sp-perm-notifications').value).toBe('ask');
    // Pop-ups have no "Ask": allowed unless blocked.
    expect([...document.getElementById('sp-perm-popups').options].map(o => o.value)).toEqual(['allow', 'deny']);
    expect(window.vex.permissionsListForPage).toHaveBeenCalledWith(7);
  });
  it('the blocked count adds up the site and its subdomains', async () => {
    setup(); const P = load();
    P.open(); await flush(); await flush();
    expect(document.querySelector('[data-sec="blocking"]').textContent).toMatch(/6 blocked on this site/);
  });
  it('the cookie count of the tab\'s own session', async () => {
    setup({ partition: 'persist:container-work' }); const P = load();
    P.open(); await flush(); await flush();
    expect(window.vex.cookiesList).toHaveBeenCalledWith({ url: 'https://www.news.example/a', partition: 'persist:container-work' });
    expect(document.querySelector('[data-sec="data"]').textContent).toMatch(/2 cookies/);
  });
  it('a Tor tab is offered no permissions and always blocks', async () => {
    setup({ partition: 'tor-abc' }); const P = load();
    P.open(); await flush(); await flush();
    expect(document.getElementById('sp-perm-camera')).toBeNull();
    expect(window.vex.permissionsListForPage).not.toHaveBeenCalled();
    const ads = document.getElementById('sp-ads');
    expect(ads.checked).toBe(true);
    expect(ads.disabled).toBe(true);
  });
  it('a Vex page says there is nothing per-site, and keeps the Site settings link', () => {
    setup({ url: 'file:///C:/vex/src/renderer/start.html' }); const P = load();
    P.open();
    expect(document.querySelector('.sp-empty').textContent).toMatch(/Nothing on this page comes from a website/);
    expect(document.querySelector('[data-act="settings"]')).not.toBeNull();
    expect(document.querySelector('[data-act="reset-site"]')).toBeNull();
  });
});

describe('what it changes, and where', () => {
  it('a permission goes to main for that page; pop-ups "Allow" forgets the block', async () => {
    setup(); const P = load();
    P.open(); await flush(); await flush();
    const sel = document.getElementById('sp-perm-notifications');
    sel.value = 'allow'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(window.vex.permissionsSetForPage).toHaveBeenCalledWith(7, 'notifications', 'allow');
    const pop = document.getElementById('sp-perm-popups');
    pop.value = 'allow'; pop.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(window.vex.permissionsSetForPage).toHaveBeenLastCalledWith(7, 'popups', 'ask');
  });
  it('never sleep and always translate land in the lists the rest of Vex reads', async () => {
    setup(); const P = load();
    P.open(); await flush();
    const never = document.getElementById('sp-never-sleep');
    never.checked = true; never.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(JSON.parse(localStorage.getItem('vex.neverSleepHosts'))).toEqual(['news.example']);
    window.vexGuestEval = vi.fn(async () => true);   // already translated: not run again
    const tr = document.getElementById('sp-translate');
    tr.checked = true; tr.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(); await flush();
    expect(JSON.parse(localStorage.getItem('vex.translateAlwaysHosts'))).toEqual(['news.example']);
    expect(TranslateSide.isAlways('https://m.news.example/')).toBe(false);
    expect(TranslateSide.isAlways('https://news.example/x')).toBe(true);
  });
  it('the ad switch is the site rule main reads, and the page reloads on close', async () => {
    setup(); const P = load();
    P.open(); await flush(); await flush();
    const ads = document.getElementById('sp-ads');
    expect(ads.checked).toBe(true);
    ads.checked = false; ads.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(); await flush();
    expect(window.vex.siteRulesSet).toHaveBeenLastCalledWith({ 'news.example': { ads: 'off' } });
    expect(SiteRulesUI.adsAllowed('https://news.example/')).toBe(true);
    // Not a "held back" site: the toolbar marker says nothing.
    expect(SiteRulesUI.describe('https://news.example/')).toBe('');
    const wv = WebviewManager.webviews.get('t1');
    P.close();
    expect(wv.reload).toHaveBeenCalled();
  });
  it('JavaScript off builds the tab again on close', async () => {
    setup(); const P = load();
    P.open(); await flush();
    const js = document.getElementById('sp-rule-js');
    js.checked = false; js.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(); await flush();
    P.close();
    expect(TabManager.rebuildTab).toHaveBeenCalledWith('t1');
  });
  it('where the site opens is a site rule, the same one Settings › Site rules lists', async () => {
    setup(); const P = load();
    P.open(); await flush();
    const route = document.getElementById('sp-route');
    route.value = 'container:work'; route.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(SiteRoutes.rules()).toEqual([expect.objectContaining({ host: 'news.example', mode: 'container', container: 'work' })]);
    const again = document.getElementById('sp-route');   // the panel was drawn again
    again.value = ''; again.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(SiteRoutes.rules()).toEqual([]);
  });
  it('in a tab that keeps nothing, every saving control is off, and refuses if forced', async () => {
    setup({ partition: 'otr-1' }); const P = load();
    P.open(); await flush();
    for (const id of ['sp-never-sleep', 'sp-translate', 'sp-dark', 'sp-ads', 'sp-rule-js', 'sp-rule-cookies', 'sp-route', 'sp-reopen']) {
      expect(document.getElementById(id).disabled, id).toBe(true);
    }
    await expect(P._act('never-sleep', { checked: true })).rejects.toThrow(/keeps nothing/);
    expect(localStorage.getItem('vex.neverSleepHosts')).toBeNull();
    expect(document.querySelector('.sp-notice').textContent).toMatch(/nothing you set here is saved/);
  });
});

describe('a dialog for the keyboard', () => {
  it('Escape closes it and gives focus back to the icon; Tab stays inside', async () => {
    setup(); const P = load();
    const btn = document.getElementById('url-site-btn');
    btn.focus();
    P.open(); await flush();
    const panel = document.getElementById('vex-site-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement.className).toBe('sp-x');
    // Shift+Tab from the first control goes round to the last.
    const rects = vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => [{}]);
    const items = P._focusables();
    expect(items.length).toBeGreaterThan(10);
    const shift = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    items[0].dispatchEvent(shift);
    expect(shift.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[items.length - 1]);
    rects.mockRestore();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(esc);
    expect(document.getElementById('vex-site-panel')).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
  it('an Escape meant for a confirmation on top is left to it', async () => {
    setup(); const P = load();
    P.open(); await flush();
    const overlay = document.createElement('div'); overlay.className = 'vex-dialog-overlay'; document.body.appendChild(overlay);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.getElementById('vex-site-panel')).not.toBeNull();
    overlay.remove();
  });
  it('opened with the mouse, focus is on the panel itself, not a control', () => {
    setup(); const P = load();
    P.open({ pointer: true });
    expect(document.activeElement.id).toBe('vex-site-panel');
  });
});

describe('Settings › Site settings lists every site from the same stores', () => {
  it('zoom saved under www., dark mode, sleep, translation, ads and switches, as one row per site', () => {
    setup(); load();
    localStorage.setItem('vex.zooms', JSON.stringify({ 'www.news.example': 1.5 }));
    localStorage.setItem('vex.forceDarkHosts', JSON.stringify(['news.example']));
    localStorage.setItem('vex.neverSleepHosts', JSON.stringify(['news.example']));
    localStorage.setItem('vex.translateAlwaysHosts', JSON.stringify(['news.example']));
    SiteRulesUI.save({ 'news.example': { ads: 'off', js: 'off' } });
    const sites = SiteProfiles.customizedSites();
    expect(sites).toEqual([{ host: 'news.example', zoom: 1.5, dark: true, neverSleep: true, translate: true, adsAllowed: true, switchesOff: ['JavaScript'] }]);
    const box = document.createElement('div');
    SiteProfiles.renderSettings(box);
    expect(box.querySelector('[data-host="news.example"]').textContent).toMatch(/zoom 150% · dark mode · never sleeps · always translated · ads and trackers not blocked · javascript off/);
  });
  it('Reset forgets all of it, the site switches main keeps included', async () => {
    setup(); load();
    localStorage.setItem('vex.zooms', JSON.stringify({ 'www.news.example': 1.5, 'other.example': 2 }));
    localStorage.setItem('vex.translateAlwaysHosts', JSON.stringify(['news.example']));
    SiteRulesUI.save({ 'news.example': { ads: 'off' } });
    await SiteProfiles.forgetSite('news.example');
    expect(JSON.parse(localStorage.getItem('vex.zooms'))).toEqual({ 'other.example': 2 });
    expect(JSON.parse(localStorage.getItem('vex.translateAlwaysHosts'))).toEqual([]);
    expect(window.vex.siteRulesSet).toHaveBeenLastCalledWith({});
  });
});

describe('always translate', () => {
  it('only a tab that keeps things translates by itself', () => {
    setup(); load();
    expect(TranslateSide.mayTranslateOnItsOwn('persist:main')).toBe(true);
    expect(TranslateSide.mayTranslateOnItsOwn('persist:container-work')).toBe(true);
    expect(TranslateSide.mayTranslateOnItsOwn('otr-1')).toBe(false);
    expect(TranslateSide.mayTranslateOnItsOwn('tor-1')).toBe(false);
    expect(TranslateSide.mayTranslateOnItsOwn('persist:route-tor')).toBe(false);
    expect(TranslateSide.mayTranslateOnItsOwn('persist:route-proxy-x')).toBe(false);
  });
  it('a private window may not change the list', () => {
    setup({ privateWindow: true }); load();
    expect(() => TranslateSide.setAlways('https://news.example/', true)).toThrow(/normal window/);
  });
});

describe('zoom in a tab that keeps nothing', () => {
  it('is not written into the profile\'s list of sites', async () => {
    setup(); vi.resetModules();
    const W = (await import('../../src/renderer/js/webview.js')).WebviewManager;
    const wv = (partition) => ({ getURL: () => 'https://news.example/', getAttribute: () => partition });
    W._saveZoom(wv('otr-1'), 1.5);
    W._saveZoom(wv('tor-1'), 1.5);
    expect(localStorage.getItem('vex.zooms')).toBeNull();
    W._saveZoom(wv('persist:main'), 1.5);
    expect(JSON.parse(localStorage.getItem('vex.zooms'))).toEqual({ 'news.example': 1.5 });
  });
});

describe('words that throw data away stay readable in every theme and look', () => {
  // The status colours are the theme's, not the look's (gui-browser.css leaves
  // them out of its bridge), so a dark theme's light red sat on a light look's
  // white panel at under 3:1. No text in the panel takes its colour from them.
  const css = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/css/site-panel.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  it('no rule colours text with --danger, --success or --warning; only icons wear them', () => {
    for (const rule of css.split('}')) {
      const [sel, body = ''] = rule.split('{');
      if (/(^|[^-])color:\s*var\(--(danger|success|warning)/.test(body)) {
        expect(sel.trim(), sel).toMatch(/(svg|#url-icon|\.sp-head-ico\[data-state)/);
      }
    }
  });
  it('"Reset this site…" is the panel\'s text colour with a red icon', async () => {
    setup(); const P = load();
    P.open(); await flush();
    const b = document.querySelector('[data-act="reset-site"]');
    expect(b.classList.contains('sp-danger')).toBe(true);
    expect(b.querySelector('svg')).not.toBeNull();
    expect(css).toMatch(/\.sp-danger\s*\{\s*color:\s*var\(--text\)/);
  });
});

describe('the per-site lists travel and are kept together', () => {
  it('all three are synced, item by item, like zoom and dark mode', () => {
    vi.resetModules();
    const p = require.resolve('../../src/renderer/js/sync-engine.js');
    delete require.cache[p];
    require(p);
    const S = window.SyncEngine;
    for (const k of ['vex.zooms', 'vex.forceDarkHosts', 'vex.neverSleepHosts', 'vex.translateAlwaysHosts']) expect(S.SYNC_KEYS, k).toContain(k);
    const src = require('fs').readFileSync(p, 'utf8');
    const lists = src.slice(src.indexOf('const LIST_PREFERENCES'), src.indexOf('];', src.indexOf('const LIST_PREFERENCES')));
    for (const k of ['vex.forceDarkHosts', 'vex.neverSleepHosts', 'vex.translateAlwaysHosts']) expect(lists, k).toContain(`'${k}'`);
  });
  it('a backup carries them; Reset to Defaults leaves them alone', () => {
    setup();
    localStorage.setItem('vex.neverSleepHosts', '["a.example"]');
    localStorage.setItem('vex.forceDarkHosts', '["b.example"]');
    localStorage.setItem('vex.translateAlwaysHosts', '["c.example"]');
    const p = require.resolve('../../src/renderer/js/backup.js');
    delete require.cache[p];
    const mod = require(p);
    const B = (mod && mod.VexBackup) || window.VexBackup;
    const items = B.collect().items;
    expect(items['vex.neverSleepHosts']).toBe('["a.example"]');
    expect(items['vex.forceDarkHosts']).toBe('["b.example"]');
    expect(items['vex.translateAlwaysHosts']).toBe('["c.example"]');
    const app = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
    const prefs = app.slice(app.indexOf('SETTINGS_PREF_KEYS = ['), app.indexOf('];', app.indexOf('SETTINGS_PREF_KEYS = [')));
    for (const k of ['vex.neverSleepHosts', 'vex.forceDarkHosts', 'vex.translateAlwaysHosts', 'vex.zooms']) expect(prefs, k).not.toContain(k);
  });
});
