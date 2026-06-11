import { describe, it, expect } from 'vitest';
import { normalizeLaunchArg, findLaunchUrl } from '../../src/main-helpers.js';

describe('normalizeLaunchArg', () => {
  it('returns plain http URL unchanged', () => {
    expect(normalizeLaunchArg('http://example.com/x')).toBe('http://example.com/x');
  });
  it('returns plain https URL unchanged', () => {
    expect(normalizeLaunchArg('https://example.com')).toBe('https://example.com');
  });
  it('returns already-prefixed file:// URL unchanged', () => {
    expect(normalizeLaunchArg('file:///C:/x.html')).toBe('file:///C:/x.html');
  });

  it('converts Windows backslash path to file:// URL', () => {
    const out = normalizeLaunchArg('C:\\Users\\foo\\index.html');
    expect(out).toMatch(/^file:\/\/\//);
    expect(out).toMatch(/index\.html$/);
    // pathToFileURL percent-encodes; it must NOT contain a literal backslash.
    expect(out).not.toContain('\\');
  });

  it('converts forward-slash drive path to file:// URL', () => {
    const out = normalizeLaunchArg('D:/path/to/page.htm');
    expect(out).toMatch(/^file:\/\/\//);
    expect(out).toMatch(/page\.htm$/);
  });

  it('accepts .htm as well as .html', () => {
    expect(normalizeLaunchArg('C:\\x\\page.htm')).toMatch(/^file:\/\/\//);
  });

  it('rejects non-html drive paths', () => {
    expect(normalizeLaunchArg('C:\\Users\\foo\\readme.pdf')).toBeNull();
    expect(normalizeLaunchArg('C:\\Users\\foo\\script.js')).toBeNull();
  });

  it('rejects html filename without drive prefix', () => {
    expect(normalizeLaunchArg('foo.html')).toBeNull();
    expect(normalizeLaunchArg('./foo.html')).toBeNull();
  });

  it('returns null for empty / null / undefined / non-string', () => {
    expect(normalizeLaunchArg('')).toBeNull();
    expect(normalizeLaunchArg(null)).toBeNull();
    expect(normalizeLaunchArg(undefined)).toBeNull();
    expect(normalizeLaunchArg(42)).toBeNull();
    expect(normalizeLaunchArg({})).toBeNull();
  });
});

describe('findLaunchUrl', () => {
  it('returns the URL when argv has one', () => {
    expect(findLaunchUrl(['https://example.com'])).toBe('https://example.com');
  });

  it('returns null when argv has no URLs', () => {
    expect(findLaunchUrl(['--no-sandbox', '--remote-debugging-port=9222'])).toBeNull();
  });

  it('skips flag args and finds the URL', () => {
    expect(
      findLaunchUrl(['--no-sandbox', 'https://example.com', '--other-flag'])
    ).toBe('https://example.com');
  });

  it('returns the FIRST URL when multiple are present', () => {
    expect(
      findLaunchUrl(['https://first.example', 'https://second.example'])
    ).toBe('https://first.example');
  });

  it('finds an .html file path', () => {
    const out = findLaunchUrl(['--flag', 'C:\\Users\\me\\report.html']);
    expect(out).toMatch(/^file:\/\/\//);
    expect(out).toMatch(/report\.html$/);
  });

  it('handles null/undefined argv without throwing', () => {
    expect(findLaunchUrl(null)).toBeNull();
    expect(findLaunchUrl(undefined)).toBeNull();
    expect(findLaunchUrl([])).toBeNull();
  });
});
