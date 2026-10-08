// @vitest-environment node
//
// The site panel (js/site-panel.js) changes a site's permissions in the store
// the page is held to, and its "Block ads and trackers on this site" switch is
// the 'ads' site rule. What matters: an answer set from the panel is the one
// the site is then held to and the one Settings › Site permissions lists; a
// private page's answer never reaches the disk; and the ad switch only lets
// the site it names through.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { createPermissionService } = require('../../src/main/permissions.js');
const SiteRules = require('../../src/main/site-rules.js');
const { validate } = require('../../src/main/ipc-schemas.js');

describe('permissions set from the site panel', () => {
  const dirs = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  function live() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-sp-perm-')); dirs.push(dir);
    const ipcMain = { on: vi.fn(), handle: vi.fn() };
    const host = { win: { webContents: { send: vi.fn() } } };
    const svc = createPermissionService({ userDataPath: dir, secureSessions: { partitionOf: (c) => c.partition, owner: () => host }, ipcMain, _markHidRequestActive: () => {} });
    svc.permissionsReady();
    const handlers = {};
    svc.wirePermissionsOnSession({ setPermissionRequestHandler: (fn) => { handlers.request = fn; }, setPermissionCheckHandler: (fn) => { handlers.check = fn; } }, 'test', {});
    const sessions = new Map();
    const page = (partition, url = 'https://maps.example/a') => {
      if (!sessions.has(partition)) sessions.set(partition, { partition });
      return { partition, session: sessions.get(partition), getURL: () => url };
    };
    // What the site gets when it asks: true/false, or 'asked' for a prompt.
    const ask = (p, permission = 'geolocation', details = {}) => {
      let answer = 'asked';
      handlers.request(p, permission, (ok) => { answer = ok; }, { requestingUrl: p.getURL(), ...details });
      return answer;
    };
    return { svc, dir, page, ask, check: (p, perm) => handlers.check(p, perm, 'https://maps.example/', {}) };
  }

  it('Block is enforced on the next request and listed by Settings; Ask forgets it', async () => {
    const v = live();
    const p = v.page('persist:main');
    await v.svc.setPageDecision(p, p.getURL(), 'geolocation', 'deny');
    expect(v.ask(p)).toBe(false);
    expect(v.svc.loadPermissionDecisions()).toEqual({ 'https://maps.example::geolocation': 'deny' });
    expect(JSON.parse(fs.readFileSync(path.join(v.dir, 'permissions.json'), 'utf8'))).toEqual({ 'https://maps.example::geolocation': 'deny' });
    await v.svc.setPageDecision(p, p.getURL(), 'geolocation', 'ask');
    expect(v.ask(p)).toBe('asked');
    expect(v.svc.loadPermissionDecisions()).toEqual({});
  });

  it('Allow is granted at once, and the permission check agrees', async () => {
    const v = live();
    const p = v.page('persist:main');
    await v.svc.setPageDecision(p, p.getURL(), 'notifications', 'allow');
    expect(v.ask(p, 'notifications')).toBe(true);
    expect(v.check(p, 'notifications')).toBe(true);
  });

  it('a container page writes the container\'s own store, which Settings names', async () => {
    const v = live();
    const p = v.page('persist:container-work');
    await v.svc.setPageDecision(p, p.getURL(), 'camera', 'deny');
    expect(v.ask(v.page('persist:main'), 'media', { mediaTypes: ['video'] })).toBe('asked');
    expect(v.ask(p, 'media', { mediaTypes: ['video'] })).toBe(false);
    expect(v.svc.loadPermissionDecisions()).toEqual({ 'https://maps.example (in the work container)::camera': 'deny' });
  });

  it('a private or off-the-record page\'s answer is held in memory and never written', async () => {
    const v = live();
    const p = v.page('otr-123');
    await v.svc.setPageDecision(p, p.getURL(), 'geolocation', 'deny');
    expect(v.ask(p)).toBe(false);
    expect(v.ask(v.page('persist:main'))).toBe('asked');
    expect(fs.existsSync(path.join(v.dir, 'permissions.json'))).toBe(false);
    expect(v.svc.loadPermissionDecisions()).toEqual({});
  });

  it('changing one half of an old "camera and microphone" answer keeps the other half', async () => {
    const v = live();
    const p = v.page('persist:main');
    await v.svc.savePermissionDecisions({ 'https://maps.example::media': 'allow' });
    await v.svc.setPageDecision(p, p.getURL(), 'camera', 'deny');
    expect(v.svc.loadPermissionDecisions()).toEqual({ 'https://maps.example::microphone': 'allow', 'https://maps.example::camera': 'deny' });
    expect(v.ask(p, 'media', { mediaTypes: ['audio'] })).toBe(true);
    expect(v.ask(p, 'media', { mediaTypes: ['video'] })).toBe(false);
  });

  it('a choice replaces an "Allow for a day" and a "just this visit" answer', async () => {
    const v = live();
    const p = v.page('persist:main');
    await v.svc.savePermissionDecisions({ 'https://maps.example::geolocation': 'allow', __until__: { 'https://maps.example::geolocation': Date.now() + 1e6 } });
    v.svc.sessionDecisionsFor(p).set('https://maps.example::geolocation', 'allow');
    await v.svc.setPageDecision(p, p.getURL(), 'geolocation', 'deny');
    expect(v.ask(p)).toBe(false);
    expect(v.svc.loadPermissionDecisions()).toEqual({ 'https://maps.example::geolocation': 'deny' });
  });

  it('Reset forgets every answer of that site only', async () => {
    const v = live();
    const p = v.page('persist:main');
    await v.svc.savePermissionDecisions({ 'https://maps.example::geolocation': 'deny', 'https://maps.example::popups': 'deny', 'https://other.example::camera': 'allow' });
    await v.svc.resetPageDecisions(p, p.getURL());
    expect(v.svc.loadPermissionDecisions()).toEqual({ 'https://other.example::camera': 'allow' });
  });

  it('pop-ups and links to programs are kept like any other answer; nothing else is accepted', async () => {
    const v = live();
    const p = v.page('persist:main');
    await v.svc.setPageDecision(p, p.getURL(), 'popups', 'deny');
    await v.svc.setPageDecision(p, p.getURL(), 'external:steam', 'allow');
    expect(v.svc.loadPermissionDecisions()).toEqual({ 'https://maps.example::popups': 'deny', 'https://maps.example::external:steam': 'allow' });
    expect(() => v.svc.setPageDecision(p, p.getURL(), 'fullscreen', 'deny')).toThrow(/Unknown permission/);
    expect(() => v.svc.setPageDecision(p, p.getURL(), 'camera', 'maybe')).toThrow();
    expect(() => v.svc.setPageDecision(p, 'file:///C:/x.html', 'camera', 'deny')).toThrow(/Only a website/);
  });
});

describe('the site panel\'s IPC is held to its shapes', () => {
  it('accepts a page, a known permission and an answer', () => {
    expect(() => validate('permissions:set-for-page', [12, 'geolocation', 'deny'])).not.toThrow();
    expect(() => validate('permissions:set-for-page', [12, 'external:ms-word', 'ask'])).not.toThrow();
    expect(() => validate('permissions:set-for-page', [12, 'fullscreen', 'deny'])).toThrow();
    expect(() => validate('permissions:set-for-page', [12, 'camera', 'sometimes'])).toThrow();
    expect(() => validate('permissions:set-for-page', ['12', 'camera', 'deny'])).toThrow();
    expect(() => validate('permissions:reset-for-page', [12])).not.toThrow();
    expect(() => validate('site:certificate', [0])).toThrow();
  });
  it('the three channels are checked against the asking window\'s own pages', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
    const target = src.slice(src.indexOf('TARGET_CHANNELS'), src.indexOf(']);', src.indexOf('TARGET_CHANNELS')));
    for (const ch of ['permissions:set-for-page', 'permissions:reset-for-page', 'site:certificate']) expect(target).toContain(`'${ch}'`);
  });
});

describe('pop-ups are judged by the page\'s own user activation, as in Chrome', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  it('the page\'s window.open says whether it had activation before it asks', () => {
    const src = read('src/preload-webview.js');
    const fn = src.slice(src.indexOf('function vexPopupActivation'), src.indexOf('\n}\n', src.indexOf('function vexPopupActivation')) + 2);
    // Run it against a toy window: the wrapper reports, then opens with the real one.
    const calls = [];
    const win = { open: (u) => { calls.push(['open', u]); return 'w'; } };
    const nav = { userActivation: { isActive: true } };
    new Function('window', 'navigator', fn + '\nreturn vexPopupActivation(arguments[2]);')(win, nav, (a) => calls.push(['report', a]));
    expect(win.open('https://x.example/')).toBe('w');
    expect(calls).toEqual([['report', true], ['open', 'https://x.example/']]);
    expect(String(win.open)).toBe('function open() { [native code] }');
    nav.userActivation.isActive = false;
    win.open('y');
    expect(calls[2]).toEqual(['report', false]);
  });
  it('main takes the report from a tab\'s page, synchronously, and refuses only without activation', () => {
    expect(() => validate('popup:activation', [true])).not.toThrow();
    expect(() => validate('popup:activation', ['yes'])).toThrow();
    expect(read('src/main/ipc-policy.js')).toMatch(/GUEST_CHANNELS = new Set\([\s\S]*'popup:activation'/);
    const main = read('src/main.js');
    expect(main).toMatch(/const POPUP_ACTIVATION_MS = 5000;/);
    const gate = main.slice(main.indexOf('function _popupRefused'), main.indexOf('function _popupRefused') + 200);
    expect(gate).toMatch(/if \(_popupActivated\(contents\)\) return false;/);
  });
});

describe('ad and tracker blocking switched off for one site', () => {
  const rules = { 'news.example': { ads: 'off' } };
  it('lets that site\'s pages, and its subdomains\', load what the blocker would refuse', () => {
    expect(SiteRules.allowsAds(rules, 'https://news.example/a')).toBe(true);
    expect(SiteRules.allowsAds(rules, 'https://www.news.example/a')).toBe(true);
    expect(SiteRules.allowsAds(rules, 'https://m.news.example/a')).toBe(true);
  });
  it('blocks as usual everywhere else, and for a request with no page', () => {
    expect(SiteRules.allowsAds(rules, 'https://other.example/')).toBe(false);
    expect(SiteRules.allowsAds(rules, 'https://notnews.example/')).toBe(false);
    expect(SiteRules.allowsAds(rules, '')).toBe(false);
  });
  it('is kept by clean(), only as "off"', () => {
    expect(SiteRules.clean({ 'a.com': { ads: 'off', js: 'on' }, 'b.com': { ads: 'on' } })).toEqual({ 'a.com': { ads: 'off' } });
  });
  it('is not mistaken for the switches that hold a site back', () => {
    expect(SiteRules.blocksThirdParty(rules, 'https://news.example/', 'https://ads.tracker.net/x.js')).toBe(false);
    expect(SiteRules.blocksScripts(rules, 'https://news.example/')).toBe(false);
  });
  it('main never lets it through in a Tor tab', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    const fn = src.slice(src.indexOf('function _adsAllowedOn'), src.indexOf('function _adsAllowedOn') + 400);
    expect(fn).toMatch(/__vexTor\) return false/);
  });
});
