// @vitest-environment jsdom
// Search this site (js/site-search.js): the address it builds for each engine, the pages that have no site, the
// "@site" prefix, and the flow around them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs'), path = require('path');
const { VexSiteSearch: S } = require('../../src/renderer/js/site-search.js');
const TA = require('../../src/renderer/js/typed-address.js');
const SS = require('../../src/renderer/js/search-shortcuts.js').SearchShortcuts;

const google = { name: 'Google', q: TA.SEARCH_ENGINES.google.q };
const ddg = { name: 'DuckDuckGo', q: TA.SEARCH_ENGINES.duckduckgo.q };
const q = (r) => new URL(r.url).searchParams.get('q') || new URL(r.url).searchParams.get('query');

describe('the host', () => {
  it('drops www. and the port, keeps a subdomain', () => {
    expect(S.hostOf('https://www.example.com/a?b=1')).toEqual({ host: 'example.com', port: '' });
    expect(S.hostOf('https://docs.python.org/3/')).toEqual({ host: 'docs.python.org', port: '' });
    expect(S.hostOf('http://example.com:8080/x')).toEqual({ host: 'example.com', port: '8080' });
    expect(S.hostOf('https://EXAMPLE.com./x').host).toBe('example.com');
    expect(S.hostOf('https://www.blog.example.co.uk/').host).toBe('blog.example.co.uk');
    expect(S.hostOf('https://wwwexample.com/').host).toBe('wwwexample.com');
  });
  it('sends an international name the way the browser writes it', () => {
    const h = S.hostOf('https://www.çağrı.com.tr/arama').host;
    expect(h).toMatch(/^xn--[a-z0-9-]+\.com\.tr$/);
    expect(require('url').domainToUnicode(h)).toBe('çağrı.com.tr');
    expect(S.hostOf('https://İSTANBUL.bel.tr/').host).toMatch(/^xn--/);
    expect(S.hostOf('https://öğrenci.gov.tr/').host).toBe(require('url').domainToASCII('öğrenci.gov.tr'));
  });
  it.each([
    'vex://settings', 'file:///C:/Users/a/x.html', 'about:blank', 'view-source:https://example.com/', 'chrome://gpu', 'data:text/html,hi', 'blob:https://example.com/abc',
    'http://localhost:3000/', 'https://127.0.0.1/', 'http://192.168.1.1/admin', 'http://[::1]:8080/', 'http://intranet/', 'https://printer.local/', 'https://app.localhost/', 'http://x.internal/',
    'https://duckduckgogg4ndixyz.onion/', '', null, 'not a url',
  ])('has no site to search at %s', (url) => {
    expect(() => S.hostOf(url)).toThrow();
  });
});

describe('the words', () => {
  it('are trimmed and tidied', () => {
    expect(S.cleanWords('  refund \n\t policy  ')).toBe('refund policy');
    expect(S.cleanWords('a\u0000b')).toBe('a b');
  });
  it('must exist, be short, and carry no bang', () => {
    for (const bad of ['', '   ', null, 'x'.repeat(301), '!w einstein', 'einstein !yt']) expect(() => S.cleanWords(bad)).toThrow();
    expect(S.cleanWords('what is rust!')).toBe('what is rust!');
    expect(S.cleanWords('@angular/core update')).toBe('@angular/core update');
  });
});

describe('build', () => {
  it('writes site:host words for each built-in engine', () => {
    for (const id of ['google', 'bing', 'duckduckgo', 'brave', 'startpage', 'ecosia']) {
      const e = { name: TA.SEARCH_ENGINES[id].name, q: TA.SEARCH_ENGINES[id].q };
      const r = S.build('https://www.example.com/page', 'refund policy', e, null);
      expect(r.url.startsWith(e.q.split('%s')[0])).toBe(true);
      expect(decodeURIComponent(r.url.split(e.q.split('%s')[0])[1])).toMatch(/site:example\.com refund policy/);
      expect(r.usedFallback).toBe(false);
      expect(r.note).toBe('');
    }
  });
  it('encodes Turkish letters, spaces and ampersands in the words', () => {
    const r = S.build('https://example.com/', 'iade politikası & şartlar', google, null);
    expect(q(r)).toBe('site:example.com iade politikası & şartlar');
    expect(r.url).not.toContain(' ');
    expect(r.url).toContain(encodeURIComponent('politikası'));
  });
  it('says that a port is not part of site:', () => {
    const r = S.build('https://example.com:8443/a', 'x', google, null);
    expect(q(r)).toBe('site:example.com x');
    expect(r.note).toMatch(/Ports are not part of site:/);
  });
  it('trusts an engine of your own only when it is a known engine, else uses the engine chosen before it, with a note', () => {
    const known = { name: 'Mine', q: 'https://www.google.com.tr/search?q=%s&hl=tr', own: true };
    expect(S.build('https://example.com/', 'x', known, null)).toMatchObject({ usedFallback: false, note: '' });
    const odd = { name: 'Mine', q: 'https://search.my-lab.example/?find=%s', own: true };
    const r = S.build('https://example.com/', 'x', odd, ddg);
    expect(r.usedFallback).toBe(true);
    expect(r.url.startsWith('https://duckduckgo.com/')).toBe(true);
    expect(r.note).toMatch(/may not understand site:/);
    expect(() => S.build('https://example.com/', 'x', odd, null)).toThrow(/may not understand site:/);
  });
  it('does not build for a page without a site, before looking at the engine', () => {
    expect(() => S.build('vex://settings', 'x', google, null)).toThrow(/web pages/);
    expect(() => S.build('http://localhost/', 'x', google, null)).toThrow(/private or local/);
  });
});

describe('the address-bar prefix', () => {
  beforeEach(() => { localStorage.clear(); globalThis.SearchShortcuts = SS; });
  it('reads @site and @here with words, or alone to be asked', () => {
    expect(S.parsePrefix('@site refund policy')).toEqual({ words: 'refund policy' });
    expect(S.parsePrefix('  @HERE   cats  ')).toEqual({ words: 'cats' });
    expect(S.parsePrefix('@site')).toEqual({ words: '' });
  });
  it('is not fooled by other words that start the same', () => {
    for (const t of ['@sitemap x', '@siteground hosting', 'site cats', 'cats @site', '@yt cats', 'https://site.com', '']) expect(S.parsePrefix(t)).toBeNull();
  });
  it('gives way to a keyword of your own with that name', () => {
    SS.setUserKeyword('site', 'https://my.example/?q=%s');
    expect(S.parsePrefix('@site cats')).toBeNull();
    expect(S.parsePrefix('@here cats')).toEqual({ words: 'cats' });
  });
  it('is read by the address bar before any other guess', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
    expect(app.indexOf('VexSiteSearch.parsePrefix(val)')).toBeGreaterThan(0);
    expect(app.indexOf('VexSiteSearch.parsePrefix(val)')).toBeLessThan(app.indexOf('VexTypedAddress.resolve(val)'));
  });
});

describe('run', () => {
  let created, navigated;
  beforeEach(() => {
    localStorage.clear();
    created = []; navigated = [];
    window.showToast = vi.fn();
    window.vexPrompt = vi.fn(async () => 'refund policy');
    globalThis.VexTypedAddress = TA;
    globalThis.TabManager = {
      getActiveTab: () => ({ id: 't1', url: 'https://www.shop.example.com/cart', groupId: 'g', partition: 'persist:container-banking' }),
      createTab: vi.fn((url, activate, group, opts) => created.push({ url, activate, group, opts })),
    };
    globalThis.WebviewManager = { webviews: new Map(), navigate: (u) => navigated.push(u) };
  });
  it('asks for words naming the host, then opens the search in a new tab of the same container', async () => {
    expect(await S.run('', true)).toBe(true);
    expect(window.vexPrompt.mock.calls[0][0].message).toBe('shop.example.com');
    expect(created).toHaveLength(1);
    expect(q({ url: created[0].url })).toBe('site:shop.example.com refund policy');
    expect(created[0].opts.partition).toBe('persist:container-banking');
    expect(created[0].url.startsWith('https://www.google.com/search?q=')).toBe(true);
  });
  it('follows the engine chosen in Settings, and the one of your own', async () => {
    localStorage.setItem('vex.searchEngine', 'duckduckgo');
    await S.run('cats', true);
    expect(created[0].url.startsWith('https://duckduckgo.com/?q=')).toBe(true);
    localStorage.setItem(TA.CUSTOM_KEY, JSON.stringify({ name: 'Lab', q: 'https://search.lab.example/?find=%s', previous: 'bing' }));
    localStorage.setItem('vex.searchEngine', TA.CUSTOM_ID);
    await S.run('cats', true);
    expect(created[1].url.startsWith('https://www.bing.com/search?q=')).toBe(true);
    expect(window.showToast.mock.calls.at(-1)[0]).toMatch(/may not understand site:/);
  });
  it('navigates the tab instead when asked (the address-bar prefix)', async () => {
    await S.run('cats', false);
    expect(created).toEqual([]);
    expect(navigated).toHaveLength(1);
  });
  it('does nothing when the prompt is cancelled, and refuses a page with no site before asking', async () => {
    window.vexPrompt = vi.fn(async () => null);
    expect(await S.run('', true)).toBe(false);
    expect(created).toEqual([]);
    TabManager.getActiveTab = () => ({ id: 't1', url: 'vex://settings' });
    window.vexPrompt = vi.fn();
    await expect(S.run('', true)).rejects.toThrow(/web pages/);
    expect(window.vexPrompt).not.toHaveBeenCalled();
  });
});

describe('the key and the menu', () => {
  it('is Ctrl+Alt+Shift+F, run through the command, and the page menu has the row', () => {
    const reg = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/shortcuts-registry.js'), 'utf8');
    expect(reg).toMatch(/'search-this-site': \{ default: 'Ctrl\+Alt\+Shift\+F'[^}]*cmd: 'search-this-site'/);
    expect([...reg.matchAll(/default: 'Ctrl\+Alt\+Shift\+F'/g)]).toHaveLength(1);
    expect(fs.readFileSync(path.join(__dirname, '../../src/renderer/js/webview.js'), 'utf8')).toMatch(/label: 'Search This Site…'/);
  });
});
