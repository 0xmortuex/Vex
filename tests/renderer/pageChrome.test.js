// @vitest-environment jsdom
//
// The frame around a page (js/page-chrome.js): the link bar, the load bar, slim scrollbars on websites. What a screen
// looks like is verified in the real app (a probe over a real window); this holds the logic that does not need one,
// and the wiring that keeps it from being dropped.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { VexPageChromeText: T, VexLoadBar, VexPageScrollbars } = require('../../src/renderer/js/page-chrome.js');
const VexIdn = require('../../src/renderer/js/idn.js');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');

beforeEach(() => { localStorage.clear(); });

describe('the registrable domain', () => {
  it('keeps the site and drops the subdomains, with the common country registries', () => {
    expect(T.registrable('login.bank.com')).toBe('bank.com');
    expect(T.registrable('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(T.registrable('sub.site.com.tr')).toBe('site.com.tr');
    expect(T.registrable('127.0.0.1')).toBe('127.0.0.1');
    expect(T.registrable('localhost')).toBe('localhost');
  });
});

describe('cutting a long address in the middle', () => {
  it('keeps both ends and the whole when it already fits', () => {
    const s = '/a/very/long/path/to/some/page.html?query=1&other=2';
    const cut = T.middle(s, 20);
    expect(cut.length).toBe(20);
    expect(cut).toContain('…');
    expect(cut.startsWith('/a/very')).toBe(true);
    expect(cut.endsWith('=2')).toBe(true);
    expect(T.middle(s, 500)).toBe(s);
  });
});

describe('what the link bar shows for an address', () => {
  const p = (url, page) => T.parts(url, page, VexIdn);
  it('emphasises the registrable domain and mutes the rest', () => {
    const r = p('https://login.bank.co.uk:8443/a/b?x=1#top', 'https://bank.co.uk/');
    expect(r).toMatchObject({ web: true, scheme: 'https://', sub: 'login.', domain: 'bank.co.uk', rest: ':8443/a/b?x=1#top', otherSite: false, warn: null });
  });
  it('marks a link to another site, not a link to the same one', () => {
    expect(p('https://a.example.com/x', 'https://www.example.com/').otherSite).toBe(false);
    expect(p('https://other.org/x', 'https://www.example.com/').otherSite).toBe(true);
  });
  it('does not compare with a page that has no web address (a Vex page)', () => {
    expect(p('https://other.org/x', 'file:///C:/app/renderer/start.html').otherSite).toBe(false);
  });
  it('warns about a look-alike host (letters of two alphabets) and shows it as punycode', () => {
    const r = p('http://xn--pple-43d.com/login', 'https://example.com/');
    expect(r.warn).toBe('lookalike');
    expect(r.domain).toBe('xn--pple-43d.com');
  });
  it('shows a harmless address in another alphabet as written, without a warning', () => {
    const r = p('http://xn--mnchen-3ya.de/a', 'https://example.com/');
    expect(r.warn).toBe(null);
    expect(r.domain).toBe('münchen.de');
  });
  it('warns about a name in front of an @, the trick that makes the host look like another one', () => {
    const r = p('http://paypal.com@evil.example.org/verify', 'https://example.com/');
    expect(r.warn).toBe('login-name');
    expect(r.auth).toBe('paypal.com@');
    expect(r.domain).toBe('example.org');
  });
  it('shows an address that is not a web address whole', () => {
    expect(p('mailto:someone@example.com', 'https://example.com/')).toMatchObject({ web: false, rest: 'mailto:someone@example.com' });
    expect(p('not an address', '')).toMatchObject({ web: false });
  });
});

describe('the load bar\'s curve', () => {
  it('starts at nothing, reaches about 70% quickly, then creeps and never reaches the end by itself', () => {
    expect(VexLoadBar.progressAt(0)).toBe(0);
    expect(VexLoadBar.progressAt(VexLoadBar.QUICK_MS)).toBeCloseTo(0.7, 5);
    expect(VexLoadBar.progressAt(2000)).toBeGreaterThan(0.7);
    expect(VexLoadBar.progressAt(60000)).toBeLessThan(0.951);
    let last = -1;
    for (let ms = 0; ms <= 20000; ms += 250) { const v = VexLoadBar.progressAt(ms); expect(v).toBeGreaterThanOrEqual(last); last = v; }
  });
  it('keeps a state for each tab and drops it when the tab stops loading', () => {
    VexLoadBar._st.clear();
    VexLoadBar.note({ id: 'a', loading: true });
    VexLoadBar.note({ id: 'b', loading: true });
    expect(VexLoadBar._st.size).toBe(2);
    VexLoadBar.note({ id: 'a', loading: false });
    expect([...VexLoadBar._st.keys()]).toEqual(['b']);
    VexLoadBar._st.clear();
  });
});

describe('slim scrollbars on websites', () => {
  it('is off until it is switched on', () => {
    expect(VexPageScrollbars.on()).toBe(false);
    localStorage.setItem('vex.pageScrollbars', '1');
    expect(VexPageScrollbars.on()).toBe(true);
  });
  it('applies to websites only: not to Vex\'s own pages, files, error pages or data', () => {
    expect(VexPageScrollbars.applies('https://example.com/a')).toBe(true);
    expect(VexPageScrollbars.applies('http://localhost:3000/')).toBe(true);
    for (const u of ['file:///C:/app/renderer/start.html', 'vex://start', 'chrome-error://chromewebdata/', 'data:text/html,hi', 'about:blank', '', 'not a url']) expect(VexPageScrollbars.applies(u), u).toBe(false);
  });
  it('leaves out the sites on the list and their subdomains, not other sites that end the same way', () => {
    VexPageScrollbars.addSite('https://www.Example.com/some/page').catch(() => {});
    expect(VexPageScrollbars.sites()).toEqual(['example.com']);
    expect(VexPageScrollbars.applies('https://example.com/')).toBe(false);
    expect(VexPageScrollbars.applies('https://docs.example.com/')).toBe(false);
    expect(VexPageScrollbars.applies('https://notexample.com/')).toBe(true);
    VexPageScrollbars.removeSite('example.com').catch(() => {});
    expect(VexPageScrollbars.sites()).toEqual([]);
  });
  it('refuses what is not a site address, and an unreadable list is an error, not an empty one', () => {
    expect(() => VexPageScrollbars.addSite('   ')).toThrow(/Not a site address/);
    expect(() => VexPageScrollbars.addSite('nonsense')).toThrow(/Not a site address/);
    localStorage.setItem('vex.pageScrollbarsOff', '{broken');
    expect(() => VexPageScrollbars.sites()).toThrow(/not readable/);
  });
  it('inserts zero-specificity rules, so a page\'s own always win, with the theme\'s colours', () => {
    const css = VexPageScrollbars.css({ thumb: 'rgb(1, 2, 3)', track: 'rgb(4, 5, 6)' });
    expect(css).toBe(':where(html){scrollbar-color:rgb(1, 2, 3) rgb(4, 5, 6)}:where(html,html *){scrollbar-width:thin}');
  });
});

describe('the wiring', () => {
  const webview = read('src/renderer/js/webview.js');
  const tabs = read('src/renderer/js/tabs.js');
  it('webview.js feeds the link bar, the load bar and the scrollbars, each guarded because the module loads late', () => {
    expect(webview).toMatch(/onWebview\('update-target-url'/);
    expect(webview).toContain("typeof VexLinkBar === 'undefined' || tab.id !== TabManager.activeTabId");
    expect(webview).toContain("typeof VexLoadBar !== 'undefined') VexLoadBar.milestone(tab.id)");
    expect(webview).toContain('VexPageScrollbars.apply(webview)');
  });
  it('the load watchdog is untouched: Stop, a missed stopped event and did-stop-loading all go through loading: false', () => {
    expect(webview).toContain("onWebview('did-stop-loading', () => { clearLoading(); });");
    expect(tabs).toMatch(/tab\.loading = data\.loading;\s*\/\/[^\n]*\n\s*if \(typeof VexLoadBar !== 'undefined'\) VexLoadBar\.note\(tab\);/);
    expect(tabs).toContain("if (tab && typeof VexLoadBar !== 'undefined') VexLoadBar.show(tab);");
  });
  it('the module is a late module (the start-up budget allows no more blocking scripts) and its style sheet comes before a11y.css', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toContain("{ src: 'js/page-chrome.js', usage: [] }");
    expect(read('src/renderer/index.html')).not.toContain('<script src="js/page-chrome.js">');
    const html = read('src/renderer/index.html');
    expect(html.indexOf('css/page-chrome.css')).toBeGreaterThan(-1);
    expect(html.indexOf('css/page-chrome.css')).toBeLessThan(html.indexOf('css/a11y.css'));
    expect(html.indexOf('css/a11y.css')).toBeGreaterThan(html.lastIndexOf('<link rel="stylesheet"') - 60);
  });
  it('the plain line replaces the old centred spinner only when the bar could not be placed', () => {
    const css = read('src/renderer/css/app.css');
    expect(css).toContain('html:not([data-loadbar]) #webviews-container.wv-loading::after');
    expect(css).not.toMatch(/animation:\s*spin-centered/);
  });
  it('every string it shows has Turkish', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    const tr = VexI18nUI.TABLE.tr;
    for (const s of ['Slim scrollbars on websites', 'Not on these sites', 'Websites that keep their usual scrollbar.', 'Site to leave out', 'This site', 'Other site', 'Look-alike address', 'Name before the address',
      'Could not change the scrollbars on websites: {1}', 'Not a site address: {1}', 'Add', 'Remove', 'Open a website first',
      'A thin scrollbar in your theme’s colours on websites. A page that styles its own scrollbars keeps them. Off by default.']) {
      expect(tr[s], s).toBeTruthy();
    }
  });
  it('the keys are in the manifest and in the settings reset list', () => {
    const manifests = read('src/renderer/js/feature-manifests.js');
    expect(manifests).toContain("storageKeys: ['vex.pageScrollbars', 'vex.pageScrollbarsOff']");
    expect(read('src/renderer/js/app.js')).toContain("'vex.pageScrollbars', 'vex.pageScrollbarsOff'");
  });
});
