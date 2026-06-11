import { describe, it, expect } from 'vitest';
import { shouldBlock, AD_DOMAINS } from '../../src/adblocker.js';

describe('shouldBlock', () => {
  describe('blocks known ad domains', () => {
    it('exact host: doubleclick.net', () => {
      expect(shouldBlock('https://doubleclick.net/whatever')).toBe(true);
    });
    it('exact host: googletagmanager.com', () => {
      expect(shouldBlock('https://googletagmanager.com/gtm.js')).toBe(true);
    });
    it('subdomain: ads.doubleclick.net', () => {
      expect(shouldBlock('https://ads.doubleclick.net/foo')).toBe(true);
    });
    it('subdomain: pagead.doubleclick.net', () => {
      expect(shouldBlock('https://pagead.doubleclick.net/x')).toBe(true);
    });
    it('host+path entry: facebook.com/tr', () => {
      expect(shouldBlock('https://facebook.com/tr?id=123')).toBe(true);
    });
  });

  describe('does NOT block non-ad domains', () => {
    it('github.com', () => expect(shouldBlock('https://github.com/foo')).toBe(false));
    it('anthropic.com', () => expect(shouldBlock('https://anthropic.com/')).toBe(false));
    it('wikipedia.org', () => expect(shouldBlock('https://en.wikipedia.org/wiki/Foo')).toBe(false));
    it('a benign facebook.com path that is NOT /tr', () => {
      expect(shouldBlock('https://facebook.com/profile/123')).toBe(false);
    });
  });

  describe('subdomain-spoof rejection (FIXED — was a substring bug)', () => {
    // Strict host check: a hostname that happens to contain an ad-domain as
    // a substring is NOT blocked. Subdomains (with the dot) still are.
    it('mydoubleclick.net is NOT blocked', () => {
      expect(shouldBlock('https://mydoubleclick.net/page')).toBe(false);
    });
    it('safe-but-similar names are NOT blocked', () => {
      expect(shouldBlock('https://googletagmanager.com.evil.example/x')).toBe(false);
      expect(shouldBlock('https://notdoubleclick.net/y')).toBe(false);
    });
    it('but real subdomains ARE still blocked', () => {
      expect(shouldBlock('https://ads.doubleclick.net/page')).toBe(true);
      expect(shouldBlock('https://www.doubleclick.net/page')).toBe(true); // www stripping
    });
  });

  describe('handles malformed input gracefully', () => {
    it('empty string → false (no throw)', () => {
      expect(shouldBlock('')).toBe(false);
    });
    it('null → false', () => {
      expect(shouldBlock(null)).toBe(false);
    });
    it('not a URL → false', () => {
      expect(shouldBlock('not a url at all')).toBe(false);
    });
  });

  it('AD_DOMAINS is a non-empty array of strings', () => {
    expect(Array.isArray(AD_DOMAINS)).toBe(true);
    expect(AD_DOMAINS.length).toBeGreaterThan(10);
    for (const d of AD_DOMAINS) expect(typeof d).toBe('string');
  });

  // === Bug fix verification ===
  // Previously these were pinned with an it.todo. The fix in src/adblocker.js
  // replaced full.includes(d) with strict host matching + path-prefix matching
  // for entries that explicitly contain a "/". Both assertions below now
  // pass cleanly.
  describe('substring-bug fix verification', () => {
    it('pathname containing a host-only ad-domain entry is NOT blocked', () => {
      expect(shouldBlock('https://example.com/redirect/doubleclick.net/x')).toBe(false);
    });
    it('pathname embedded ad-domain string in unrelated host is NOT blocked', () => {
      expect(shouldBlock('https://example.com/blog/facebook.com/whatever')).toBe(false);
    });
  });

  // === Path-bearing entries (e.g. "facebook.com/tr") ===
  describe('path-bearing AD_DOMAINS entries', () => {
    it('blocks when host matches AND path starts with the declared prefix', () => {
      expect(shouldBlock('https://facebook.com/tr')).toBe(true);
      expect(shouldBlock('https://facebook.com/tr/something')).toBe(true);
      expect(shouldBlock('https://facebook.com/tr?id=123')).toBe(true);
    });
    it('does NOT block facebook.com paths that are not /tr*', () => {
      expect(shouldBlock('https://facebook.com/profile/123')).toBe(false);
      expect(shouldBlock('https://facebook.com/groups/abc')).toBe(false);
      expect(shouldBlock('https://facebook.com/')).toBe(false);
    });
    it('blocks subdomains for path-bearing entries too', () => {
      expect(shouldBlock('https://www.facebook.com/tr/x')).toBe(true);
    });
  });
});
