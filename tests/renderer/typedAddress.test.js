// What a typed line means (js/typed-address.js), shared by the address bar,
// the command bar's "Go to" row and Paste & Go. All three guessed separately
// and wrongly (2026-09-29): "node.js tutorial" opened https://node.js tutorial,
// localhost:8080 was searched on Google, and Bing/Startpage/Ecosia were
// ignored for Google.
import { describe, it, expect } from 'vitest';
const T = require('../../src/renderer/js/typed-address.js');

describe('an address or words to search', () => {
  it('opens what is an address', () => {
    expect(T.addressFor('example.com')).toBe('https://example.com');
    expect(T.addressFor('youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ');
    expect(T.addressFor('sub.domain.co.uk:8443/x')).toBe('https://sub.domain.co.uk:8443/x');
    expect(T.addressFor('https://example.com/a b')).toBe('https://example.com/a b');
  });

  it('opens local and internal addresses instead of searching them', () => {
    expect(T.addressFor('localhost')).toBe('http://localhost');
    expect(T.addressFor('localhost:8080')).toBe('http://localhost:8080');
    expect(T.addressFor('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(T.addressFor('192.168.1.1')).toBe('http://192.168.1.1');
    expect(T.addressFor('[::1]:3000')).toBe('http://[::1]:3000');
    expect(T.addressFor('my-server:3000/path')).toBe('http://my-server:3000/path');
    for (const a of ['about:blank', 'vex://settings', 'file:///C:/x.html']) expect(T.addressFor(a)).toBe(a);
  });

  it('searches words, even ones that start like a domain', () => {
    for (const w of ['node.js tutorial', 'example.com is down', 'hello world', '3.14', 'what is 2+2', 'foo:bar', '']) {
      expect(T.addressFor(w), w).toBe(null);
    }
  });
});

describe('the chosen engine', () => {
  it('knows every engine setup and the New Tab page offer', () => {
    expect(Object.keys(T.SEARCH_ENGINES).sort()).toEqual(['bing', 'brave', 'duckduckgo', 'ecosia', 'google', 'startpage']);
    expect(T.searchUrl('a b', 'bing')).toBe('https://www.bing.com/search?q=a%20b');
    expect(T.searchUrl('a b', 'ecosia')).toBe('https://www.ecosia.org/search?q=a%20b');
    expect(T.searchUrl('x', 'nope')).toBe('https://www.google.com/search?q=x');
  });

  it('reads the saved choice when none is named', () => {
    const saved = globalThis.localStorage;
    globalThis.localStorage = { getItem: (k) => (k === 'vex.searchEngine' ? 'startpage' : null) };
    try { expect(T.searchUrl('q')).toBe('https://www.startpage.com/sp/search?query=q'); }
    finally { globalThis.localStorage = saved; }
  });

  it('the Settings list offers every engine', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/index.html'), 'utf8');
    const select = html.slice(html.indexOf('id="setting-search-engine"'), html.indexOf('</select>', html.indexOf('id="setting-search-engine"')));
    const values = [...select.matchAll(/value="([^"]+)"/g)].map(m => m[1]).sort();
    expect(values).toEqual(Object.keys(T.SEARCH_ENGINES).sort());
  });
});
