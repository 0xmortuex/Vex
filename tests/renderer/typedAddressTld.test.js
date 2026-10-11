// What a typed line means, address or search, checked against the real list of
// top-level domains (js/tld-list.js, from IANA). Found 2026-10-10:
//   * "document.getElementById", "lodash.debounce" and "e.coli" opened as
//     broken addresses because any word after a dot counted as a domain;
//   * "router/" and "nas/admin" were searched (Chrome opens them);
//   * "999.1.1.1" opened as an address;
//   * a Windows path with # or % in it opened the wrong file or none.
import { describe, it, expect } from 'vitest';
const TA = require('../../src/renderer/js/typed-address.js');

describe('a word after a dot that is no top-level domain is a search', () => {
  for (const t of ['document.getElementById', 'lodash.debounce', 'this.setState', 'e.coli', 'window.location', 'os.path']) {
    it(`"${t}"`, () => { expect(TA.addressFor(t)).toBeNull(); });
  }
});

describe('real domains still open', () => {
  const cases = {
    'example.com': 'https://example.com',
    'bbc.co.uk/news': 'https://bbc.co.uk/news',
    'docs.rs': 'https://docs.rs',
    'münchen.de': 'https://münchen.de',
    'пример.рф': 'https://пример.рф',
    'example.xn--p1ai': 'https://example.xn--p1ai',
    'duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion': 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion',
    'printer.lan': 'https://printer.lan',
    'myapp.test': 'https://myapp.test',
    'EXAMPLE.COM': 'https://EXAMPLE.COM',
    'example.com.': 'https://example.com.',
  };
  for (const [t, url] of Object.entries(cases)) it(`"${t}"`, () => { expect(TA.addressFor(t)).toBe(url); });

  it('an unlisted name with a port or a path is still an address (it can only be one)', () => {
    expect(TA.addressFor('build.box:8080')).toBe('https://build.box:8080');
    expect(TA.addressFor('wiki.office/start')).toBe('https://wiki.office/start');
  });
});

describe('intranet names with a slash open', () => {
  it('"router/" always, "nas/admin" once nas has been visited, "and/or" never', () => {
    expect(TA.addressFor('router/')).toBe('http://router/');
    expect(TA.addressFor('and/or')).toBeNull();
    expect(TA.addressFor('nas/admin')).toBeNull();
    globalThis.HistoryPanel = { list: () => [{ url: 'http://nas/' }] };
    try { expect(TA.addressFor('nas/admin')).toBe('http://nas/admin'); }
    finally { delete globalThis.HistoryPanel; }
  });
  it('but not a fraction or a date', () => {
    expect(TA.addressFor('24/7')).toBeNull();
    expect(TA.addressFor('1/2')).toBeNull();
  });
});

describe('IPv4 addresses', () => {
  it('a real one opens', () => { expect(TA.addressFor('192.168.1.1')).toBe('http://192.168.1.1'); });
  it('"999.1.1.1" is a search', () => { expect(TA.addressFor('999.1.1.1')).toBeNull(); });
  it('"256.0.0.1:8080" is a search', () => { expect(TA.addressFor('256.0.0.1:8080')).toBeNull(); });
});

describe('a Windows path with # or % opens that file', () => {
  it('C:\\dev\\c#\\notes.txt keeps the # in the path', () => {
    const u = TA.addressFor('C:\\dev\\c#\\notes.txt');
    expect(new URL(u).pathname).toBe('/C:/dev/c%23/notes.txt');
  });
  it('C:\\docs\\100%.txt is a valid address', () => {
    const u = TA.addressFor('C:\\docs\\100%.txt');
    expect(() => decodeURI(u)).not.toThrow();
    expect(decodeURI(new URL(u).pathname)).toBe('/C:/docs/100%25.txt'.replace('%25', '%'));
  });
  it('a UNC path too', () => {
    expect(new URL(TA.addressFor('\\\\nas\\share\\a#b.txt')).pathname).toBe('/share/a%23b.txt');
  });
});
