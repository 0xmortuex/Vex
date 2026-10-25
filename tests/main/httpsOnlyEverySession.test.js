// @vitest-environment node
//
// SE3: HTTPS-Only upgraded only in normal tabs and containers; private
// windows, off-the-record and burner tabs, New Identity and Tor tabs loaded
// http as it came. SE4: a site with no https was loaded over http at once,
// with a toast. Gaps: a custom port was never upgraded; a certificate error
// outside HTTPS-Only showed only Chromium's error name.
import { describe, it, expect } from 'vitest';
const fs = require('fs'), path = require('path');
const H = require('../../src/main/https-only.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

describe('the upgrade rule', () => {
  it('upgrades a page or frame asked for over http, keeping a custom port as Firefox does', () => {
    expect(H.upgradeTarget('http://site.example/a?b#c', 'mainFrame')).toEqual({ url: 'https://site.example/a?b#c', bare: 'site.example' });
    expect(H.upgradeTarget('http://www.site.example:80/', 'subFrame')).toEqual({ url: 'https://www.site.example/', bare: 'site.example' });
    expect(H.upgradeTarget('http://site.example:8080/x', 'mainFrame')).toEqual({ url: 'https://site.example:8080/x', bare: 'site.example' });
  });
  it('leaves alone this computer, the local network, IP addresses, .onion, https and anything not a page', () => {
    for (const url of ['http://localhost:3000/', 'http://127.0.0.1/', 'http://192.168.1.1/', 'http://10.0.0.2/', 'http://printer.local/', 'http://abc.onion/', 'http://8.8.8.8/', 'http://[2001:db8::1]/', 'https://site.example/']) {
      expect(H.upgradeTarget(url, 'mainFrame')).toBe(null);
    }
    expect(H.upgradeTarget('http://site.example/img.png', 'image')).toBe(null);
  });
});

describe('every kind of session asks it', () => {
  const handlers = main.split('webRequest.onBeforeRequest(').slice(1).map(s => s.slice(0, 2600));
  it('each onBeforeRequest answers a request it lets through with _httpsAnswer', () => {
    expect(handlers.length).toBe(4);   // normal tabs + containers, New Identity, Tor, private/off-the-record/burner
    for (const h of handlers) expect(h).toMatch(/_httpsAnswer\(details\)/);
  });
  it('the private-window, New Identity and Tor sessions are among them', () => {
    const block = (from) => { const a = main.indexOf(from); expect(a).toBeGreaterThan(-1); return main.slice(a, a + 4000); };
    expect(block("ipcMain.handle('identity:create'")).toMatch(/callback\(blocked \? \{ cancel: true \} : _httpsAnswer\(details\)\)/);
    expect(block('const part = `tor-')).toMatch(/callback\(blocked \? \{ cancel: true \} : _httpsAnswer\(details\)\)/);
    expect(block('function _wireEphemeralBrowsing(')).toMatch(/callback\(blocked \? \{ cancel: true \} : _httpsAnswer\(details\)\)/);
  });
});

describe('a site with no https', () => {
  it('gets a page with Go back and Continue, not an unencrypted load and a toast', () => {
    const fn = main.slice(main.indexOf('// HTTPS-Only: a page WE upgraded'), main.indexOf('// A clean main-frame load'));
    expect(fn).toMatch(/_httpsNoHttpsShown\.set\(contents\.id, \{ bare, httpUrl, failedUrl: validatedURL \}\);\s*_showVexPage\(contents, _httpsOnly\.noHttpsPage\(u\.host, httpUrl\)/);
    expect(fn).not.toMatch(/_httpsOnlyFailed\.add\(bare\)|has no HTTPS — loaded over/);
    const html = H.noHttpsPage('plain.example', 'http://plain.example/a?b=1&c=<x>');
    expect(html).toMatch(/This site doesn't support a secure connection/);
    expect(html).toMatch(/<button type="button" id="vex-back" onclick="history.back\(\)">Go back<\/button>/);
    expect(html).toContain('<a id="vex-continue" href="http://plain.example/a?b=1&amp;c=&lt;x&gt;">');
  });
  it('only its own Continue link lets the site load over http, until Vex closes', () => {
    const fn = main.slice(main.indexOf('// HTTPS-Only: a page WE upgraded'), main.indexOf('// A clean main-frame load'));
    expect(fn).toMatch(/contents\.on\('will-navigate', \(evt, url\) => \{\s*const shown = _httpsNoHttpsShown\.get\(contents\.id\);/);
    expect(fn).toMatch(/to\.protocol === 'http:' && to\.hostname\.replace\(\/\^www\\\.\/, ''\) === shown\.bare\) _httpsOnlyFailed\.add\(shown\.bare\)/);
    // Leaving the page any other way forgets it.
    // Cleared once another page commits: did-start-navigation fires before
    // will-navigate, so clearing there lost the Continue click (measured).
    expect(fn).toMatch(/contents\.on\('did-navigate'[\s\S]{0,250}_httpsNoHttpsShown\.delete\(contents\.id\)/);
    expect(fn).not.toMatch(/did-start-navigation[\s\S]{0,200}_httpsNoHttpsShown/);
  });
});

describe('a certificate error outside HTTPS-Only', () => {
  it('gets a page explaining it in a tab, with no way through', () => {
    const fn = main.slice(main.indexOf('// HTTPS-Only: a page WE upgraded'), main.indexOf('// A clean main-frame load'));
    expect(fn).toMatch(/if \(_httpsOnly\.isCertError\(errorCode\) && _isTabSession\(contents\)\) _showVexPage\(contents, _httpsOnly\.certErrorPage\(u\.host, desc\)/);
    const html = H.certErrorPage('bad.example', 'net::ERR_CERT_AUTHORITY_INVALID');
    expect(html).toMatch(/This site's certificate is not valid/);
    expect(html).toContain('(ERR_CERT_AUTHORITY_INVALID)');
    expect(html).not.toMatch(/<a /);
    expect(H.isCertError(-202)).toBe(true);
    expect(H.isCertError(-102)).toBe(false);
  });
});
