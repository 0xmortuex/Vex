// @vitest-environment node
//
// Global Privacy Control, referrer trimming and a site's own User-Agent are
// all applied in the one request-header listener (main.js). The rules are
// pure, so what is sent is checked here without a window: what a request
// carries, what a site that opted out is spared, and that a Tor session is
// never changed.
import { describe, it, expect } from 'vitest';
const fs = require('fs'), path = require('path');
const { applyHeaders, referrerFor, siteOf } = require('../../src/main/site-headers.js');
const SiteRules = require('../../src/main/site-rules.js');

const MOBILE = 'Mozilla/5.0 (Linux; Android 10; K) Chrome/148.0.0.0 Mobile Safari/537.36';
function run(headers, ctx) {
  const h = { ...headers };
  applyHeaders(h, { url: 'https://shop.example.net/a', resourceType: 'subFrame', cfg: { gpc: true, referrer: 'default' }, rules: {}, tor: false, pageUrl: () => '', mobileUa: MOBILE, hasUaRules: false, ...ctx });
  return h;
}

describe('which addresses are one site', () => {
  it('knows registrable domains, with the common two-part suffixes', () => {
    expect(siteOf('a.b.example.com')).toBe('example.com');
    expect(siteOf('www.example.co.uk')).toBe('example.co.uk');
    expect(siteOf('192.168.1.5')).toBe('192.168.1.5');
    expect(siteOf('localhost')).toBe('localhost');
  });
});

describe('Global Privacy Control', () => {
  it('is sent to a web address by default', () => {
    expect(run({}, {})['Sec-GPC']).toBe('1');
  });
  it('is not sent when the setting is off', () => {
    expect(run({}, { cfg: { gpc: false, referrer: 'default' } })['Sec-GPC']).toBeUndefined();
  });
  it('is not sent to a site that is left out, but is to the others', () => {
    const rules = SiteRules.clean({ 'example.net': { gpc: 'off' } });
    expect(run({}, { rules })['Sec-GPC']).toBeUndefined();
    expect(run({}, { rules, url: 'https://other.org/' })['Sec-GPC']).toBe('1');
  });
  it('is never sent from a Tor session', () => {
    expect(run({}, { tor: true })['Sec-GPC']).toBeUndefined();
  });
  it('is not sent to a page that is not a website', () => {
    expect(run({}, { url: 'chrome-extension://abc/page.html' })['Sec-GPC']).toBeUndefined();
  });
  it('replaces a header already there, whatever its case', () => {
    const h = run({ 'sec-gpc': '0' }, {});
    expect(Object.keys(h).filter(k => k.toLowerCase() === 'sec-gpc')).toEqual(['Sec-GPC']);
    expect(h['Sec-GPC']).toBe('1');
  });
});

describe('referrer trimming', () => {
  const full = 'https://news.example.org/story/12?token=abc#x';
  it('is off by default: the header is left as the browser made it', () => {
    expect(run({ Referer: full }, { url: 'https://other.net/x' }).Referer).toBe(full);
  });
  it('"origin" trims only a cross-site request', () => {
    const cfg = { gpc: true, referrer: 'origin' };
    expect(run({ Referer: full }, { cfg, url: 'https://other.net/x' }).Referer).toBe('https://news.example.org/');
    expect(run({ Referer: full }, { cfg, url: 'https://img.example.org/p.png' }).Referer).toBe(full);
  });
  it('"strict" sends none across sites and only the origin within one', () => {
    const cfg = { gpc: true, referrer: 'strict' };
    expect('Referer' in run({ Referer: full }, { cfg, url: 'https://other.net/x' })).toBe(false);
    expect(run({ Referer: full }, { cfg, url: 'https://img.example.org/p.png' }).Referer).toBe('https://news.example.org/');
  });
  it('leaves a request without a referrer alone', () => {
    const cfg = { gpc: true, referrer: 'strict' };
    expect('Referer' in run({}, { cfg, url: 'https://other.net/x' })).toBe(false);
  });
  it('a site that needs the referrer keeps it, from either end of the request', () => {
    const cfg = { gpc: true, referrer: 'strict' };
    const fromIt = SiteRules.clean({ 'example.org': { referrer: 'off' } });
    expect(run({ Referer: full }, { cfg, rules: fromIt, url: 'https://pay.other.net/x' }).Referer).toBe(full);
    const toIt = SiteRules.clean({ 'other.net': { referrer: 'off' } });
    expect(run({ Referer: full }, { cfg, rules: toIt, url: 'https://pay.other.net/x' }).Referer).toBe(full);
  });
  it('is not applied in a Tor session', () => {
    expect(run({ Referer: full }, { cfg: { gpc: true, referrer: 'strict' }, tor: true, url: 'https://other.net/x' }).Referer).toBe(full);
  });
  it('referrerFor says what to do and ignores what it cannot read', () => {
    expect(referrerFor('default', full, 'https://other.net/')).toBeUndefined();
    expect(referrerFor('origin', 'not a url', 'https://other.net/')).toBeUndefined();
    expect(referrerFor('strict', 'https://a.example.org/', 'https://other.net/')).toBe(null);
  });
});

describe('a site’s own User-Agent', () => {
  const rules = SiteRules.clean({ 'm.example.net': { ua: 'mobile' }, 'example.net': { ua: 'MyBrowser/1.0 (custom agent)' } });
  it('is the mobile one, with the Client Hints saying so, for the page asked for', () => {
    const r = SiteRules.clean({ 'example.net': { ua: 'mobile' } });
    const h = run({ 'User-Agent': 'x', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"' }, { rules: r, hasUaRules: true, resourceType: 'mainFrame' });
    expect(h['User-Agent']).toBe(MOBILE);
    expect(h['sec-ch-ua-mobile']).toBe('?1');
    expect(h['sec-ch-ua-platform']).toBe('"Android"');
  });
  it('follows the page for what the page loads', () => {
    const r = SiteRules.clean({ 'example.org': { ua: 'mobile' } });
    const h = run({ 'User-Agent': 'x' }, { rules: r, hasUaRules: true, url: 'https://cdn.other.net/a.js', resourceType: 'script', pageUrl: () => 'https://example.org/' });
    expect(h['User-Agent']).toBe(MOBILE);
    const none = run({ 'User-Agent': 'x' }, { rules: r, hasUaRules: true, url: 'https://cdn.other.net/a.js', resourceType: 'script', pageUrl: () => 'https://elsewhere.net/' });
    expect(none['User-Agent']).toBe('x');
  });
  it('is the typed string for a custom one', () => {
    const h = run({ 'User-Agent': 'x' }, { rules, hasUaRules: true, resourceType: 'mainFrame', url: 'https://example.net/' });
    expect(h['User-Agent']).toBe('MyBrowser/1.0 (custom agent)');
  });
  it('a page that still carries a site’s User-Agent gets its session’s back on a site with none', () => {
    const h = run({ 'User-Agent': 'stale-site-ua' }, { rules: {}, hasUaRules: false, restoreUa: 'SessionUA/1', resourceType: 'mainFrame', url: 'https://other.net/' });
    expect(h['User-Agent']).toBe('SessionUA/1');
    const r = SiteRules.clean({ 'example.net': { ua: 'mobile' } });
    const keep = run({ 'User-Agent': 'x' }, { rules: r, hasUaRules: true, restoreUa: 'SessionUA/1', resourceType: 'mainFrame', url: 'https://example.net/' });
    expect(keep['User-Agent']).toBe(MOBILE);
  });
  it('is never applied in a Tor session', () => {
    const h = run({ 'User-Agent': 'x' }, { rules, hasUaRules: true, resourceType: 'mainFrame', url: 'https://example.net/', tor: true });
    expect(h['User-Agent']).toBe('x');
  });
});

describe('main.js keeps one header listener', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  it('registers onBeforeSendHeaders once, and applies the rules from it', () => {
    expect((main.match(/onBeforeSendHeaders\(/g) || []).length).toBe(1);
    expect(main).toContain('_siteHeaders.applyHeaders(h,');
  });
  it('never sends the signal or changes the identity of a Tor page in the preload config', () => {
    expect(main).toMatch(/function _gpcFor\(ses, pageUrl\) \{\s*return privacyCfg\.gpc !== false && !\(ses && ses\.__vexTor\)/);
    expect(main).toContain('gpc: _gpcFor(e.sender.session, pageUrl)');
  });
});
