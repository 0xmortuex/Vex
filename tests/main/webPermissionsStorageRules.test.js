// The storage-access rules (src/main/web-permissions-extra.js): which addresses are one site, and what a frame's
// request is kept under. Pure functions: no Electron, no clock, no network.
import { describe, it, expect } from 'vitest';
const extra = require('../../src/main/web-permissions-extra.js');

describe('which addresses are the same site', () => {
  it.each([
    ['https://www.example.com/a', 'example.com'],
    ['https://a.b.example.com', 'example.com'],
    ['https://example.com', 'example.com'],
    ['https://news.example.co.uk/x', 'example.co.uk'],
    ['https://giris.turkiye.gov.tr/', 'turkiye.gov.tr'],
    ['https://sub.example.com.tr', 'example.com.tr'],
    ['http://127.0.0.1:3000/', '127.0.0.1'],
    ['https://localhost:8443/', 'localhost'],
  ])('%s belongs to %s', (url, site) => {
    expect(extra.siteOf(url)).toBe(site);
  });

  it('a shared hosting suffix is not one site: every customer is its own', () => {
    expect(extra.siteOf('https://alice.github.io/')).toBe('alice.github.io');
    expect(extra.siteOf('https://bob.github.io/')).toBe('bob.github.io');
    expect(extra.sameSite('https://alice.github.io/', 'https://bob.github.io/')).toBe(false);
    expect(extra.sameSite('https://a.herokuapp.com/', 'https://b.herokuapp.com/')).toBe(false);
  });

  it('something that looks like a registry the list does not know is treated as separate sites', () => {
    expect(extra.siteOf('https://a.xx.yy/')).toBe('a.xx.yy');
    expect(extra.sameSite('https://a.xx.yy/', 'https://b.xx.yy/')).toBe(false);
  });

  it('only web addresses have a site', () => {
    for (const url of ['ftp://example.com/', 'file:///C:/a.html', 'about:blank', 'not a url', '', undefined, null]) {
      expect(extra.siteOf(url), String(url)).toBe('');
      expect(extra.originOf(url), String(url)).toBe('');
    }
  });

  it('same-site needs the same scheme and the same registrable domain', () => {
    expect(extra.sameSite('https://www.example.com/', 'https://login.example.com/x')).toBe(true);
    expect(extra.sameSite('https://example.com/', 'http://example.com/')).toBe(false);
    expect(extra.sameSite('https://example.com/', 'https://example.org/')).toBe(false);
    expect(extra.sameSite('https://example.com/', 'https://notexample.com/')).toBe(false);
    expect(extra.sameSite('https://example.com/', 'https://example.com.evil.example/')).toBe(false);
    expect(extra.sameSite('', 'https://example.com/')).toBe(false);
    expect(extra.sameSite('about:blank', 'about:blank')).toBe(false);
  });
});

describe('storage-access: what the request is, and under which key it is kept', () => {
  const top = 'https://app.example.com/page';
  const base = (permission, over = {}) => ({
    permission, topUrl: top, tracker: false, fullscreen: true,
    details: { isMainFrame: true, requestingUrl: top }, ...over,
  });
  const frame = (url, over = {}) => base('storage-access', { details: { isMainFrame: false, requestingUrl: url }, ...over });

  it('is kept per pair: the page the person is on, and the third party site', () => {
    const plan = extra.planExtra(frame('https://pay.widgets.example/box'));
    expect(plan.origin).toBe('https://app.example.com');
    expect(plan.part).toBe('storage-access:widgets.example');
    expect(plan.frame).toEqual({ origin: 'https://pay.widgets.example', site: 'widgets.example', top: 'https://app.example.com', cross: true });
  });

  it('tells a same-site frame from a cross-site one', () => {
    expect(extra.planExtra(frame('https://login.example.com/')).frame.cross).toBe(false);
    expect(extra.planExtra(frame('https://login.example.org/')).frame.cross).toBe(true);
  });

  it('never for an ad or tracker host, and not when that is not known to be false', () => {
    expect(extra.planExtra(frame('https://ads.tracker.example/', { tracker: true })).deny).toBeTruthy();
    expect(extra.planExtra(frame('https://ads.tracker.example/', { tracker: undefined })).deny).toBeTruthy();
    expect(extra.planExtra(frame('https://ads.tracker.example/', { tracker: null })).deny).toBeTruthy();
  });

  it('only a frame asks: the page itself, or a request that does not say, is refused', () => {
    expect(extra.planExtra(base('storage-access', { details: { isMainFrame: true, requestingUrl: top } })).deny).toBeTruthy();
    expect(extra.planExtra(base('storage-access', { details: { requestingUrl: 'https://w.example/' } })).deny).toBeTruthy();
  });

  it('a frame that is not a web address is refused', () => {
    expect(extra.planExtra(frame('about:blank')).deny).toBeTruthy();
    expect(extra.planExtra(frame('data:text/html,hi')).deny).toBeTruthy();
  });
});

describe('the key for the synchronous check (permissions.query)', () => {
  it('is the page and the frame site', () => {
    expect(extra.storageKeyFor('https://app.example.com', 'https://pay.widgets.example/x'))
      .toEqual({ origin: 'https://app.example.com', part: 'storage-access:widgets.example' });
    expect(extra.storageKeyFor('https://app.example.com/', 'https://widgets.example/')).toEqual({ origin: 'https://app.example.com', part: 'storage-access:widgets.example' });
  });
  it('is null when either side is not a web address', () => {
    expect(extra.storageKeyFor('', 'https://widgets.example/')).toBeNull();
    expect(extra.storageKeyFor('https://app.example.com', 'about:blank')).toBeNull();
    expect(extra.storageKeyFor(undefined, undefined)).toBeNull();
  });
});

describe('the set', () => {
  it('is exactly the four, and top-level-storage-access is not one of them', () => {
    expect([...extra.EXTRA_PERMISSIONS].sort()).toEqual(['idle-detection', 'keyboardLock', 'storage-access', 'window-management']);
    expect(extra.EXTRA_PERMISSIONS.has('top-level-storage-access')).toBe(false);
    expect(extra.EXTRA_PERMISSIONS.has('openExternal')).toBe(false);
  });
});
