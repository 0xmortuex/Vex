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

  // The tester's table (found 2026-09-29): IDN names and Windows paths were
  // searched; bare file names and label:number words opened as broken addresses.
  const OPENS = {
    'münchen.de': 'https://münchen.de',
    'www.bücher.de/katalog': 'https://www.bücher.de/katalog',
    'пример.рф': 'https://пример.рф',
    '例子.中国': 'https://例子.中国',
    'xn--mnchen-3ya.de': 'https://xn--mnchen-3ya.de',
    'example.xn--p1ai': 'https://example.xn--p1ai',
    'C:\\x': 'file:///C:/x',
    'C:\\Windows\\win.ini': 'file:///C:/Windows/win.ini',
    'c:/x/y.html': 'file:///c:/x/y.html',
    'C:\\Program Files\\a b.txt': 'file:///C:/Program Files/a b.txt',
    '\\\\server\\share': 'file://server/share',
    '\\\\server\\share\\dir\\f.txt': 'file://server/share/dir/f.txt',
    'example.io': 'https://example.io',
    'docs.rs': 'https://docs.rs',
    'bun.sh': 'https://bun.sh',
    'www.readme.md': 'https://www.readme.md',
    'example.md/x': 'https://example.md/x',
    'example.com/readme.md': 'https://example.com/readme.md',
    'notes.md:8080': 'https://notes.md:8080',
    'my-server:3000': 'http://my-server:3000',
    'test:123': 'http://test:123',
    'localhost:3000': 'http://localhost:3000',
    'router.local': 'https://router.local',
    'example.com.': 'https://example.com.',
  };
  it('opens IDN names, Windows paths and real sites', () => {
    for (const [typed, want] of Object.entries(OPENS)) expect(T.addressFor(typed), typed).toBe(want);
  });

  const SEARCHES = ['index.html', 'readme.md', 'node.js', 'vue.js', 'script.py', 'report.final.pdf', 'photo.JPG',
    'ISBN:12345', 'time:10', 'a:1', 'note:hello', 'Re: meeting', 'x.y', '10.5.3', 'v1.2.3', '-bad.com',
    'exa_mple.com', 'my-server', 'example.com/search?q=a b'];
  it('searches file names and label:number words', () => {
    for (const w of SEARCHES) expect(T.addressFor(w), w).toBe(null);
  });
});

describe('the chosen engine', () => {
  it('the New Tab page offers the same engines and uses the same rules', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/start.html'), 'utf8');
    expect(html).toContain('<script src="js/typed-address.js"></script>');
    const block = html.slice(html.indexOf('const ENGINE_LOOK = {'), html.indexOf('};', html.indexOf('const ENGINE_LOOK = {')));
    const ids = [...block.matchAll(/^\s*(\w+):/gm)].map(m => m[1]).sort();
    expect(ids).toEqual(Object.keys(T.SEARCH_ENGINES).sort());
  });

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
