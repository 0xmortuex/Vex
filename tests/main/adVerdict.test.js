// @vitest-environment node
//
// EX2: the per-site "Block ads" switch and SITE_REPAIRS judged a page's first
// ~2 s of requests by the page before it (_pageUrlOf's cache was never
// forgotten on navigation). EX9: a click on an ad link left a blank tab.
// EX10: private windows, burner, New Identity and Tor tabs skipped
// SITE_REPAIRS (ChatGPT broke there), and New Identity skipped the
// third-party switch.
import { describe, it, expect } from 'vitest';
const fs = require('fs'), path = require('path');
const { createAdVerdict, blockedPageHtml } = require('../../src/main/ad-verdict.js');
const { repairAllows } = require('../../src/adblocker.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

function make({ shown = 'https://other.example/', allowed = [], thirdPartyOff = [], blocked = ['ads.example', 'bzr.openai.com'], t = 1000 } = {}) {
  const host = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
  let clock = t;
  const v = createAdVerdict({
    now: () => clock,
    pageUrlOf: () => shown,
    enabled: () => true,
    engineBlocks: () => null,
    shouldBlock: (url) => blocked.includes(host(url)),
    repairAllows,
    adsAllowedOn: (page) => allowed.includes(host(page)),
    blocksThirdParty: (page, url) => thirdPartyOff.includes(host(page)) && host(page) !== host(url),
  });
  v.tick = (ms) => { clock += ms; };
  return v;
}

describe('the page a request is judged by', () => {
  it('is the address being loaded for the page itself, not the page the tab still shows', () => {
    const v = make({ shown: 'https://blocked-ads.example/', allowed: ['ads.example'] });
    expect(v.pageOf({ resourceType: 'mainFrame', url: 'https://ads.example/x', webContentsId: 4 })).toBe('https://ads.example/x');
    expect(v.judge({ resourceType: 'mainFrame', url: 'https://ads.example/x', webContentsId: 4 }, {})).toBe(null);
    expect(v.pageOf({ resourceType: 'script', url: 'https://cdn.example/a.js', webContentsId: 4 })).toBe('https://blocked-ads.example/');
  });
  it('ChatGPT\'s repair holds for the page being opened, whatever the tab showed before', () => {
    const v = make({ shown: 'https://chatgpt.com/' });
    expect(v.judge({ resourceType: 'xhr', url: 'https://bzr.openai.com/v1', webContentsId: 4 }, {})).toBe(null);
    const elsewhere = make({ shown: 'https://news.example/' });
    expect(elsewhere.judge({ resourceType: 'xhr', url: 'https://bzr.openai.com/v1', webContentsId: 4 }, {})).toBe('ad');
  });
  it('main.js forgets the remembered page when a page commits', () => {
    const at = main.indexOf('function _pageUrlOf(');
    const block = main.slice(at, at + 2000);
    expect(block).toMatch(/contents\.on\('did-navigate', forget\)/);
    expect(block).toMatch(/contents\.on\('did-navigate-in-page', forget\)/);
  });
});

describe('every session asks the same verdict (EX10)', () => {
  const handlers = main.split('webRequest.onBeforeRequest(').slice(1).map(s => s.slice(0, 1400));
  it('all four onBeforeRequest handlers go through _adVerdict.judge', () => {
    expect(handlers.length).toBe(4);
    for (const h of handlers) expect(h).toMatch(/_adVerdict\.judge\(details, ses/);
    for (const h of handlers) expect(h).not.toMatch(/shouldBlock\(details\.url\)/);
  });
  it('New Identity honours the third-party switch like a private window; Tor keeps to the blocker', () => {
    const at = (from) => main.slice(main.indexOf(from), main.indexOf(from) + 4000);
    expect(at("ipcMain.handle('identity:create'")).toMatch(/_adVerdict\.judge\(details, ses\);/);
    expect(at('const part = `tor-')).toMatch(/_adVerdict\.judge\(details, ses, \{ thirdParty: false \}\)/);
  });
  it('the third-party switch is honoured unless told otherwise', () => {
    const v = make({ shown: 'https://site.example/', thirdPartyOff: ['site.example'] });
    expect(v.judge({ resourceType: 'image', url: 'https://cdn.example/x.png', webContentsId: 2 }, {})).toBe('third-party');
    expect(v.judge({ resourceType: 'image', url: 'https://cdn.example/x.png', webContentsId: 2 }, {}, { thirdParty: false })).toBe(null);
    // A link to another site is not third-party content of the page it leaves.
    expect(v.judge({ resourceType: 'mainFrame', url: 'https://cdn.example/', webContentsId: 2 }, {})).toBe(null);
  });
});

describe('a page the blocker refuses (EX9)', () => {
  it('is noted for its tab, and "Go anyway" lets that address through once', () => {
    const v = make();
    const req = { resourceType: 'mainFrame', url: 'https://ads.example/aclk?x=1', webContentsId: 7 };
    expect(v.judge(req, {})).toBe('ad');
    expect(v.takeBlockedPage(7, 'https://elsewhere.example/')).toBe(null);
    expect(v.judge(req, {})).toBe('ad');
    expect(v.takeBlockedPage(7, req.url)).toBe(req.url);
    expect(v.takeBlockedPage(7, req.url)).toBe(null);
    v.allowOnce(7, req.url);
    expect(v.judge({ ...req, webContentsId: 8 }, {})).toBe('ad');      // another tab
    expect(v.judge(req, {})).toBe(null);                               // this tab, once
    expect(v.judge(req, {})).toBe('ad');
  });
  it('a "Go anyway" not used within two minutes lapses', () => {
    const v = make();
    const req = { resourceType: 'mainFrame', url: 'https://ads.example/', webContentsId: 7 };
    v.allowOnce(7, req.url);
    v.tick(121000);
    expect(v.judge(req, {})).toBe('ad');
  });
  it('the page says what happened and escapes the address', () => {
    const html = blockedPageHtml('https://ads.example/a?"<b>');
    expect(html).toMatch(/Blocked by Vex's ad blocker/);
    expect(html).toMatch(/id="vex-go-anyway" href="https:\/\/ads\.example\/a\?&quot;&lt;b&gt;"/);
    expect(html).not.toMatch(/<b>"/);
  });
  it('tells main at once (a cancelled page fires no did-fail-load in a webview)', () => {
    const told = [];
    const v = createAdVerdict({ pageUrlOf: () => '', enabled: () => true, engineBlocks: () => true, shouldBlock: () => false,
      repairAllows: () => false, adsAllowedOn: () => false, blocksThirdParty: () => false, onBlockedPage: (id, url) => told.push([id, url]) });
    v.judge({ resourceType: 'script', url: 'https://ads.example/a.js', webContentsId: 3 }, {});
    v.judge({ resourceType: 'mainFrame', url: 'https://ads.example/', webContentsId: 3 }, {});
    expect(told).toEqual([[3, 'https://ads.example/']]);
  });
  it('main.js shows the page in the tab and lets the page\'s own link through', () => {
    const at = main.indexOf('function _adBlockedPage(');
    expect(at).toBeGreaterThan(-1);
    expect(main.slice(at, at + 500)).toMatch(/_showVexPage\(contents, require\('\.\/main\/ad-verdict'\)\.blockedPageHtml\(url\)/);
    expect(main).toMatch(/onBlockedPage: \(id, url\) => setTimeout\(\(\) => _adBlockedPage\(id, url\), 0\)/);
    expect(main).toMatch(/if \(_adVerdict\.takeBlockedPage\(contents\.id, to\)\) _adVerdict\.allowOnce\(contents\.id, to\);/);
  });
});
