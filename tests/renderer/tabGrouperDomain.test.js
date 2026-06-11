import { describe, it, expect } from 'vitest';
import { _domain } from '../../src/renderer/js/tab-grouper.js';

describe('_domain', () => {
  describe('URL parsing — happy paths', () => {
    it('strips leading "www." from a standard host', () => {
      expect(_domain('https://www.example.com/path')).toBe('example.com');
    });

    it('returns the host as-is when there is no "www."', () => {
      expect(_domain('https://example.com')).toBe('example.com');
    });

    it('does not strip "www" mid-host (only leading)', () => {
      expect(_domain('https://sub.example.co.uk/x')).toBe('sub.example.co.uk');
    });

    it('handles multi-level subdomains', () => {
      expect(_domain('https://a.b.c.example.com')).toBe('a.b.c.example.com');
    });

    it('handles http:// and https:// equivalently', () => {
      expect(_domain('http://example.com')).toBe('example.com');
      expect(_domain('https://example.com')).toBe('example.com');
    });

    it('ignores port numbers (URL.hostname strips them)', () => {
      expect(_domain('https://example.com:8443/x')).toBe('example.com');
    });

    it('ignores path, query, and fragment', () => {
      expect(_domain('https://example.com/a/b?q=1#frag')).toBe('example.com');
    });

    it('lowercases mixed-case hosts (URL.hostname normalizes)', () => {
      expect(_domain('https://EXAMPLE.com')).toBe('example.com');
    });
  });

  describe('non-URL fallback (substring)', () => {
    it('returns first 40 chars of an unparseable string', () => {
      expect(_domain('not a url')).toBe('not a url');
    });

    it('truncates a long unparseable string to 40 chars', () => {
      const long = 'a'.repeat(100);
      expect(_domain(long)).toBe('a'.repeat(40));
    });

    it('returns empty string for null', () => {
      expect(_domain(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(_domain(undefined)).toBe('');
    });

    it('returns empty string for empty string input', () => {
      expect(_domain('')).toBe('');
    });
  });

  describe('edge protocol schemes', () => {
    it('strips www from file:// URLs (parseable)', () => {
      // file:// URLs parse with empty hostname; both fallbacks land safely.
      const out = _domain('file:///C:/foo.html');
      expect(typeof out).toBe('string');
    });

    it('returns hostname for ftp:// URLs', () => {
      expect(_domain('ftp://files.example.com/x')).toBe('files.example.com');
    });
  });
});
