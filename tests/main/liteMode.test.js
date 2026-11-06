// @vitest-environment node
//
// Lite mode, the main-process side: one global flag (main/nav-privacy.js) read by the request hook the per-site 'images' switch
// already uses (main/ad-verdict.js), for pictures and web fonts of web pages, with a per-site exemption. Also measured in real
// Electron 42 on 2026-11-07 (a throwaway probe, not kept in the repo): with the flag on, a page's same-host image, cross-host image
// and font request were all cancelled and never reached the server; with the site marked 'lite' off, or the flag off, all were served.
import { describe, it, expect } from 'vitest';
const fs = require('fs'), path = require('path'), os = require('os');
const SiteRules = require('../../src/main/site-rules.js');
const NavPrivacy = require('../../src/main/nav-privacy.js');
const { createAdVerdict } = require('../../src/main/ad-verdict.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

describe('which requests Lite mode refuses', () => {
  it('pictures and fonts of a web page, and nothing else', () => {
    for (const type of ['image', 'font']) expect(SiteRules.liteBlocks({}, true, 'https://news.example/a', type)).toBe(true);
    for (const type of ['script', 'stylesheet', 'xhr', 'media', 'mainFrame', 'subFrame', 'fetch', 'websocket']) {
      expect(SiteRules.liteBlocks({}, true, 'https://news.example/a', type)).toBe(false);
    }
  });
  it('only while it is on', () => {
    expect(SiteRules.liteBlocks({}, false, 'https://news.example/a', 'image')).toBe(false);
  });
  it('never for a page that is not http(s): Vex’s own pages, local files, nothing at all', () => {
    for (const page of ['file:///C:/vex/start.html', 'vex-pdf://view/x', 'chrome-extension://abc/popup.html', 'about:blank', '', undefined, null]) {
      expect(SiteRules.liteBlocks({}, true, page, 'image')).toBe(false);
    }
  });
  it('a site marked as left alone keeps its pictures, and so do its subdomains; others do not', () => {
    const rules = { 'school.example': { lite: 'off' } };
    expect(SiteRules.liteBlocks(rules, true, 'https://school.example/', 'image')).toBe(false);
    expect(SiteRules.liteBlocks(rules, true, 'https://portal.school.example/', 'font')).toBe(false);
    expect(SiteRules.liteBlocks(rules, true, 'https://other.example/', 'image')).toBe(true);
    expect(SiteRules.liteBlocks(rules, true, 'https://notschool.example/', 'image')).toBe(true);
  });
  it('the exemption is kept by clean(), like the other switches', () => {
    expect(SiteRules.clean({ 'school.example': { lite: 'off' } })).toEqual({ 'school.example': { lite: 'off' } });
    expect(SiteRules.clean({ 'school.example': { lite: 'on' } })).toEqual({});
  });
});

describe('through the shared request hook', () => {
  const make = (over = {}) => createAdVerdict({
    pageUrlOf: () => 'https://news.example/story', enabled: () => false, engineBlocks: () => null, shouldBlock: () => false, repairAllows: () => false,
    adsAllowedOn: () => false, blocksThirdParty: () => false, blocksImages: () => false,
    liteBlocks: (page, type) => SiteRules.liteBlocks({}, true, page, type), ...over,
  });
  it('answers "lite" for a picture or a font, from any host, and nothing for a script', () => {
    const v = make();
    expect(v.judge({ resourceType: 'image', url: 'https://news.example/a.png', webContentsId: 1 }, {})).toBe('lite');
    expect(v.judge({ resourceType: 'image', url: 'https://cdn.other.example/a.png', webContentsId: 1 }, {})).toBe('lite');
    expect(v.judge({ resourceType: 'font', url: 'https://fonts.example/f.woff2', webContentsId: 1 }, {})).toBe('lite');
    expect(v.judge({ resourceType: 'script', url: 'https://news.example/a.js', webContentsId: 1 }, {})).toBe(null);
    expect(v.judge({ resourceType: 'mainFrame', url: 'https://news.example/', webContentsId: 1 }, {})).toBe(null);
  });
  it('judges by the page the request comes from, so an exempt page keeps every picture', () => {
    const rules = { 'school.example': { lite: 'off' } };
    const v = make({ pageUrlOf: () => 'https://school.example/', liteBlocks: (page, type) => SiteRules.liteBlocks(rules, true, page, type) });
    expect(v.judge({ resourceType: 'image', url: 'https://cdn.other.example/a.png', webContentsId: 1 }, {})).toBe(null);
  });
  it('a session that opts out of the pictures switch (Tor) is not held to Lite mode either', () => {
    const v = make();
    expect(v.judge({ resourceType: 'image', url: 'https://news.example/a.png', webContentsId: 1 }, {}, { images: false })).toBe(null);
  });
  it('is not asked when no dependency was given (older callers)', () => {
    const v = make({ liteBlocks: undefined });
    expect(v.judge({ resourceType: 'image', url: 'https://news.example/a.png', webContentsId: 1 }, {})).toBe(null);
  });
  it('main.js cancels a "lite" verdict in the normal handler, and hands the flag to the hook', () => {
    expect(main).toMatch(/verdict === 'third-party' \|\| verdict === 'images' \|\| verdict === 'lite'\) \{\s*callback\(\{ cancel: true \}\);/);
    expect(main).toMatch(/liteBlocks: \(page, resourceType\) => _navPrivacy\.lite && SiteRules\.liteBlocks\(_siteRules, true, page, resourceType\)/);
  });
  it('the Tor handler still opts out of both', () => {
    const at = main.indexOf('const part = `tor-');
    expect(main.slice(at, at + 4000)).toMatch(/_adVerdict\.judge\(details, ses, \{ thirdParty: false, images: false \}\)/);
  });
});

describe('the saved flag', () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vex-nav-')), 'nav-privacy.json');
  it('is off for a profile that never had it, and round-trips', () => {
    const file = tmp();
    expect(NavPrivacy.load(fs, file)).toEqual({ lite: false, unwrap: null });
    NavPrivacy.save(fs, file, { lite: true });
    expect(NavPrivacy.load(fs, file)).toEqual({ lite: true, unwrap: null });
  });
  it('a damaged file is reported and starts from the default, not silently', () => {
    const file = tmp();
    fs.writeFileSync(file, '{nope');
    const errors = [];
    expect(NavPrivacy.load(fs, file, { error: (...a) => errors.push(a.join(' ')) })).toEqual({ lite: false, unwrap: null });
    expect(errors.join('\n')).toMatch(/not readable/);
  });
  it('a change must be a boolean for a key it knows', () => {
    expect(NavPrivacy.apply({ lite: false }, { lite: true })).toEqual({ lite: true });
    expect(() => NavPrivacy.apply({ lite: false }, { lite: 'yes' })).toThrow(/on or off/);
    expect(() => NavPrivacy.apply({ lite: false }, { other: true })).toThrow(/Unknown setting/);
    expect(() => NavPrivacy.apply({ lite: false }, [true])).toThrow(/object/);
    expect(() => NavPrivacy.apply({ lite: false }, null)).toThrow(/object/);
  });
  it('main saves it, tells every window, and cannot be changed from a private window', () => {
    expect(main).toMatch(/ipcMain\.handle\('navprivacy:set'[\s\S]{0,500}NavPrivacy\.save\(fs, _navPrivacyFile, next\);[\s\S]{0,200}_broadcastDownloadEvent\('navprivacy:changed'/);
    expect(fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8')).toMatch(/\|siterules:set\|navprivacy:set\|/);
  });
});
