// @vitest-environment jsdom
//
// Lite mode, the window's side (js/lite-mode.js, and the autoplay policy it shares with the per-site switch in js/site-rules-ui.js
// and js/webview.js): which pages it holds, which tabs are built again when it is thrown, and that a press asks first.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');
const fresh = (rel) => { const f = require.resolve(rel); delete require.cache[f]; return require(f); };

let S, L, saved, tabs, wvs, rebuilt;
beforeEach(() => {
  localStorage.clear();
  delete window.vex;
  window.VexTabPolicy = { isPrivateWindow: false };
  saved = [];
  S = fresh('../../src/renderer/js/site-rules-ui.js').SiteRulesUI;
  globalThis.SiteRulesUI = S; window.SiteRulesUI = S;
  S._mirror = null;
  rebuilt = [];
  tabs = [
    { id: 'a', url: 'https://news.example/a', partition: 'persist:main' },
    { id: 'b', url: 'https://video.example/', partition: 'persist:main' },
    { id: 'c', url: 'https://hidden.example/', partition: 'persist:main' },    // asleep: no webview
    { id: 'd', url: 'https://onion.example/', partition: 'tor-1' },
    { id: 'e', url: 'file:///C:/vex/start.html', partition: 'persist:main' },
  ];
  wvs = new Map(tabs.filter(t => t.id !== 'c').map(t => [t.id, { getURL: () => t.url, _noAutoplay: false, reload: vi.fn() }]));
  globalThis.TabManager = { tabs, activeTabId: 'a', getActiveTab: () => tabs[0], rebuildTab: vi.fn((id) => { rebuilt.push(id); return true; }) };
  globalThis.WebviewManager = WebviewManager; WebviewManager.webviews = wvs;
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  L = fresh('../../src/renderer/js/lite-mode.js').VexLiteMode;
  L._bound = false;
  window.vex = {
    navPrivacySet: vi.fn(async (c) => { saved.push(c); return { ok: true, ...c }; }),
    navPrivacyGet: vi.fn(async () => ({ ok: true, lite: false })),
    onNavPrivacyChanged: vi.fn(),
    siteRulesSet: vi.fn(async (r) => ({ ok: true, rules: r })),
  };
});
afterEach(() => { vi.restoreAllMocks(); delete window.vex; });

describe('which pages Lite mode holds', () => {
  it('none while it is off', () => {
    expect(S.liteOn()).toBe(false);
    expect(S.autoplayOff('https://news.example/a', 'persist:main')).toBe(false);
  });
  it('every web page when it is on, so its tab is built to refuse autoplay', () => {
    S.setLiteOn(true);
    expect(S.autoplayOff('https://news.example/a', 'persist:main')).toBe(true);
    expect(S.autoplayOff('https://other.example/', 'persist:container-work')).toBe(true);
  });
  it('not a Tor tab, not Vex’s own pages, not a site left alone', async () => {
    S.setLiteOn(true);
    expect(S.autoplayOff('https://onion.example/', 'tor-4')).toBe(false);
    expect(S.autoplayOff('https://onion.example/', 'persist:route-tor')).toBe(false);
    expect(S.autoplayOff('file:///C:/vex/start.html', 'persist:main')).toBe(false);
    expect(S.autoplayOff('vex-pdf://view/x', 'persist:main')).toBe(false);
    await S.set('https://school.example/', 'lite', true);
    expect(S.autoplayOff('https://portal.school.example/', 'persist:main')).toBe(false);
    expect(S.autoplayOff('https://news.example/', 'persist:main')).toBe(true);
  });
  it('the site’s own autoplay switch still holds it with Lite mode off', async () => {
    await S.set('https://quiet.example/', 'autoplay', true);
    expect(S.autoplayOff('https://quiet.example/', 'persist:main')).toBe(true);
  });
  it('a normal window remembers it for the first tabs of the next start; a private window does not write it', () => {
    S.setLiteOn(true);
    expect(localStorage.getItem('vex.liteMode')).toBe('1');
    window.VexTabPolicy.isPrivateWindow = true;
    S.setLiteOn(false);
    expect(localStorage.getItem('vex.liteMode')).toBe('1');
    expect(S.liteOn()).toBe(false);
  });
  it('a tab is built again when it browses to a page held to the other setting', () => {
    S.setLiteOn(true);
    expect(WebviewManager.autoplayDiffers('https://news.example/', false, 'persist:main')).toBe(true);
    expect(WebviewManager.autoplayDiffers('https://news.example/', true, 'persist:main')).toBe(false);
    expect(WebviewManager.autoplayDiffers('https://onion.example/', false, 'tor-1')).toBe(false);
  });
  it('webview.js hands the tab’s partition to the decision', () => {
    const src = require('fs').readFileSync('src/renderer/js/webview.js', 'utf8');
    expect(src).toMatch(/autoplayOff\(tab\.url, tab\.partition\)/);
    expect(src).toMatch(/autoplayDiffers\(event\.url, webview\._noAutoplay, tab\.partition\)/);
  });
});

describe('throwing the switch', () => {
  it('asks first, naming how many tabs reload, and then builds those again (not the asleep one, not Tor, not a Vex page)', async () => {
    await L.set(true);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/^2 open tabs reload/);
    expect(saved).toEqual([{ lite: true }]);
    expect(rebuilt.sort()).toEqual(['a', 'b']);
    expect(L.on()).toBe(true);
  });
  it('changes nothing when the person says no', async () => {
    window.vexConfirm = vi.fn(async () => false);
    await L.set(true);
    expect(saved).toEqual([]);
    expect(rebuilt).toEqual([]);
    expect(L.on()).toBe(false);
  });
  it('turning it off builds the tabs that were built for Lite mode again', async () => {
    S.setLiteOn(true);
    wvs.get('a')._noAutoplay = true; wvs.get('b')._noAutoplay = true;
    await L.set(false);
    expect(saved).toEqual([{ lite: false }]);
    expect(rebuilt.sort()).toEqual(['a', 'b']);
    expect(L.on()).toBe(false);
  });
  it('does not ask when no tab needs building', async () => {
    tabs.splice(0, 2); wvs.delete('a'); wvs.delete('b');
    await L.set(true);
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(saved).toEqual([{ lite: true }]);
  });
  it('is not changed from a private window', async () => {
    window.VexTabPolicy.isPrivateWindow = true;
    await expect(L.set(true)).rejects.toThrow(/normal window/);
    expect(saved).toEqual([]);
  });
  it('main refusing is raised, and nothing is rebuilt', async () => {
    window.vex.navPrivacySet = vi.fn(async () => ({ ok: false, error: 'no' }));
    await expect(L.set(true)).rejects.toThrow(/no/);
    expect(rebuilt).toEqual([]);
    expect(L.on()).toBe(false);
  });
  it('a change made in another window is followed without asking', () => {
    L.follow(true);
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(L.on()).toBe(true);
    expect(rebuilt.sort()).toEqual(['a', 'b']);
  });
  it('the page in front that is not rebuilt reloads so the change shows', () => {
    wvs.get('a')._noAutoplay = true;      // built for Lite mode already (e.g. its site has autoplay off)
    L.follow(true);
    expect(rebuilt).toEqual(['b']);
    expect(wvs.get('a').reload).toHaveBeenCalled();
  });
});

describe('the badge', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="btn-lite-mode" hidden><span class="lite-label"></span></button>';
  });
  it('shows "Lite mode on" while it is on, and hides when off', () => {
    S.setLiteOn(true);
    L.paint();
    const btn = document.getElementById('btn-lite-mode');
    expect(btn.hidden).toBe(false);
    expect(btn.querySelector('.lite-label').textContent).toBe('Lite mode on');
    S.setLiteOn(false);
    L.paint();
    expect(btn.hidden).toBe(true);
  });
  it('its menu turns it off, and leaves the site in front out of it (and back in)', async () => {
    S.setLiteOn(true);
    L.openMenu(document.getElementById('btn-lite-mode'));
    const rows = [...document.querySelectorAll('#lite-mode-menu .ext-menu-item')];
    expect(rows.map(r => r.querySelector('.ext-menu-label').textContent)).toEqual(['Turn Lite mode off', 'Leave Lite mode off for news.example']);
    rows[1].click();
    await new Promise(r => setTimeout(r, 0));
    expect(S.isOff('https://news.example/a', 'lite')).toBe(true);
    expect(window.vex.siteRulesSet).toHaveBeenCalled();
    expect(rebuilt).toContain('a');
    L.openMenu(document.getElementById('btn-lite-mode'));
    expect([...document.querySelectorAll('#lite-mode-menu .ext-menu-label')][1].textContent).toBe('Lite mode follows news.example again');
  });
  it('init reads main’s flag and follows another window', async () => {
    window.vex.navPrivacyGet = vi.fn(async () => ({ ok: true, lite: true }));
    await L.init();
    expect(L.on()).toBe(true);
    expect(document.getElementById('btn-lite-mode').hidden).toBe(false);
    const cb = window.vex.onNavPrivacyChanged.mock.calls[0][0];
    cb({ lite: false });
    expect(L.on()).toBe(false);
  });
  it('init raises when main cannot say', async () => {
    window.vex.navPrivacyGet = vi.fn(async () => ({ ok: false, error: 'broken' }));
    await expect(L.init()).rejects.toThrow(/broken/);
  });
});

describe('the site panel row', () => {
  it('is its own section, leaves a site out, and rebuilds the tab', () => {
    const src = require('fs').readFileSync('src/renderer/js/site-panel.js', 'utf8');
    expect(src).toMatch(/_section\('lite', 'Lite mode'/);
    expect(src).toMatch(/case 'lite-exempt':[\s\S]{0,200}SiteRulesUI\.set\(c\.url, 'lite', el\.checked\);[\s\S]{0,300}_after = 'rebuild'/);
  });
});
