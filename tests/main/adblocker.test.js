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

  describe('subdomain-spoof — CURRENTLY BROKEN (see bug below)', () => {
    // The host-level check (host === d || host.endsWith('.' + d)) correctly
    // rejects mydoubleclick.net. But shouldBlock then ALSO does a
    // full.includes(d) on host+pathname, and "mydoubleclick.net/page" includes
    // "doubleclick.net". So a legitimate domain whose name contains an ad
    // domain as a substring is blocked. This is a real bug — pinned, not
    // asserted clean.
    it('CURRENT BUG: mydoubleclick.net is blocked due to substring match', () => {
      expect(shouldBlock('https://mydoubleclick.net/page')).toBe(true);
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

  // === Pinned known-broken behaviour ===
  it.todo(
    'false positive: substring match on host+pathname — should require host-based ' +
    'match only. Today, hostnames containing an ad-domain as a substring (e.g. ' +
    'mydoubleclick.net) and URLs whose pathname embeds an ad domain entry as a ' +
    'literal substring are wrongly blocked. Fix: drop the full.includes(d) leg, ' +
    'or constrain it to entries that explicitly contain a "/" (path-style entries).'
  );

  it('CURRENT BUG: pathname containing a host-only AD_DOMAIN entry is blocked', () => {
    // host = example.com (not on list). pathname = /redirect/doubleclick.net/x.
    // host+pathname.includes('doubleclick.net') → true → blocked. Bug.
    // When fixed, this assertion flips to .toBe(false) and the it.todo above
    // should be deleted.
    expect(shouldBlock('https://example.com/redirect/doubleclick.net/x')).toBe(true);
  });
});
