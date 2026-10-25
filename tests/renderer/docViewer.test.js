// @vitest-environment jsdom
//
// Vex's own viewer for text-like documents, page side (src/renderer/doc-viewer): what a document is, the highlighter, the Markdown
// renderer (and that it cannot be made to run anything), the worker that holds big documents, the Turkish for every sentence.

import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.resolve(__dirname, '../../src/renderer/doc-viewer');

async function load(name) { return import('../../src/renderer/doc-viewer/' + name); }

// ---------------------------------------------------------------- the worker, run as the page would run it (in a vm with a stand-in for self)
function loadWorker() {
  const src = fs.readFileSync(path.join(DIR, 'doc-worker.js'), 'utf8');
  const replies = [];
  const self = { postMessage: (m) => replies.push(m) };
  const ctx = vm.createContext({ self, TextDecoder, TextEncoder, Intl, Int32Array, Uint8Array, Uint16Array, Uint32Array, Float64Array, Map, Error, Object, Array, Math, Number, String, JSON, Date });
  vm.runInContext(src, ctx);
  let id = 0;
  const api = {
    call(type, msg) { replies.length = 0; self.onmessage({ data: { type, id: ++id, ...(msg || {}) } }); return replies[0]; },
    open(text, extra) {
      const buf = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
      return api.call('init', { buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), ...(extra || {}) });
    },
    rows(from = 0, count = 100) { return api.call('treeRows', { from, count }).rows; },
  };
  return api;
}

describe('what a document is', () => {
  it('trusts what the server says, then the name, then the first bytes', async () => {
    const { classify } = await load('kinds.js');
    const c = (url, contentType, head, source) => classify({ url, contentType, head, source });
    expect(c('https://a.test/x', 'application/json; charset=utf-8')).toMatchObject({ kind: 'json', tentative: false });
    expect(c('https://a.test/x', 'application/vnd.api+json')).toMatchObject({ kind: 'json' });
    expect(c('https://a.test/x.ndjson', 'application/x-ndjson')).toMatchObject({ kind: 'jsonl' });
    expect(c('https://a.test/x', 'application/xml')).toMatchObject({ kind: 'xml' });
    expect(c('https://a.test/x', 'text/csv')).toMatchObject({ kind: 'csv', delimiter: 'auto' });
    expect(c('https://a.test/x', 'text/tab-separated-values')).toMatchObject({ kind: 'csv', delimiter: 'tab' });
    expect(c('https://a.test/x', 'text/markdown')).toMatchObject({ kind: 'md' });
    expect(c('https://a.test/data.json', 'text/plain')).toMatchObject({ kind: 'json', tentative: false });
    expect(c('https://a.test/t.csv', 'text/plain')).toMatchObject({ kind: 'csv' });
    expect(c('https://a.test/readme.md', 'text/plain')).toMatchObject({ kind: 'md' });
    expect(c('https://a.test/run.py', 'text/plain')).toMatchObject({ kind: 'text', lang: 'py' });
    expect(c('file:///C:/a/log.LOG', '')).toMatchObject({ kind: 'text', lang: 'log' });
  });

  it('sniffs the first bytes of a server that sends text/plain for everything, and marks the guess as a guess', async () => {
    const { classify } = await load('kinds.js');
    const c = (head) => classify({ url: 'https://a.test/thing', contentType: 'text/plain', head });
    expect(c('{"a":1}')).toMatchObject({ kind: 'json', tentative: true });
    expect(c('  [1,2,3]')).toMatchObject({ kind: 'json', tentative: true });
    expect(c('{"a":1}\n{"a":2}\n{"a":3}\n')).toMatchObject({ kind: 'jsonl', tentative: true });
    expect(c('<?xml version="1.0"?><a/>')).toMatchObject({ kind: 'xml', tentative: true });
    expect(c('just words')).toMatchObject({ kind: 'text', tentative: false });
    expect(c('#!/usr/bin/env python3\nprint(1)')).toMatchObject({ kind: 'text', lang: 'py' });
  });

  it('shows a view-source page as highlighted markup', async () => {
    const { classify, looksLikeHtml } = await load('kinds.js');
    expect(classify({ url: 'https://a.test/', contentType: 'text/html', head: '<!doctype html>', source: true })).toMatchObject({ kind: 'text', lang: 'html' });
    expect(classify({ url: 'https://a.test/app.js', contentType: 'text/javascript', head: '', source: true })).toMatchObject({ kind: 'text', lang: 'js' });
    expect(looksLikeHtml('<!DOCTYPE html><html>')).toBe(true);
    expect(looksLikeHtml('plain')).toBe(false);
  });
});

describe('the highlighter', () => {
  const textOf = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };

  it('never changes the text, whatever the language, and never lets text become markup', async () => {
    const { highlightLines, HIGHLIGHT_LANGS } = await load('highlight.js');
    const nasty = ['<script>alert("x")</script> & "q" \'s\'', 'if (a < b && c > d) { /* x */ } // y', '"unterminated', "'a' + `b${c}`", '/* open', 'x = """', '# <b>hi</b> `code` **b**', '[sec]\nk = "v" ; c', '- a: "b" # c', '<!-- c --> <a href="x">t</a> &amp;', '@@ -1 +1 @@\n+a\n-b', '2026-10-25 10:00:00 [ERROR] bad <thing>', ''];
    for (const lang of HIGHLIGHT_LANGS) {
      const lines = nasty.join('\n').split('\n');
      const r = highlightLines(lang, lines, '');
      for (let i = 0; i < lines.length; i++) {
        expect(textOf(r.html[i]), lang + ' / ' + lines[i]).toBe(lines[i]);
        expect(r.html[i]).not.toMatch(/<script|<b>|<a /);
      }
    }
  });

  it('colours what a reader looks for', async () => {
    const { highlightLine } = await load('highlight.js');
    const h = (lang, line, state) => highlightLine(lang, line, state || '');
    expect(h('js', 'const x = 42; // c').html).toMatch(/tk-kw">const[\s\S]*tk-num">42[\s\S]*tk-com">\/\/ c/);
    expect(h('js', 'f("a")').html).toMatch(/tk-fn">f[\s\S]*tk-str">&quot;a&quot;/);
    expect(h('json', '"k": "v", "n": 1, "b": true').html).toMatch(/tk-attr">&quot;k&quot;[\s\S]*tk-str">&quot;v&quot;[\s\S]*tk-num">1[\s\S]*tk-lit">true/);
    expect(h('py', 'def f(x): return None  # c').html).toMatch(/tk-kw">def[\s\S]*tk-lit">None[\s\S]*tk-com">/);
    expect(h('sql', 'select id from t where a = 1', '').html).toMatch(/tk-kw">select/);
    expect(h('css', '.a { color: #fff; margin: 0 -2px }', '').html).toMatch(/tk-attr">color[\s\S]*tk-num">#fff/);
    expect(h('html', '<a href="x">t</a>').html).toMatch(/tk-tag">&lt;a[\s\S]*tk-attr">href[\s\S]*tk-str">&quot;x&quot;/);
    expect(h('yaml', 'name: vex').html).toMatch(/tk-attr">name/);
    expect(h('toml', '[server]').html).toMatch(/tk-tag">\[server\]/);
    expect(h('ini', 'k = true').html).toMatch(/tk-attr">k[\s\S]*tk-lit">true/);
    expect(h('diff', '+added').html).toMatch(/tk-add/);
    expect(h('log', '2026-10-25 10:00:00 [ERROR] bad').html).toMatch(/tk-com">[^<]*10:00:00[\s\S]*tk-del">ERROR/);
    expect(h('sh', 'echo "$HOME"').html).toMatch(/tk-kw">echo/);
    expect(h('go', 'func main() {}').html).toMatch(/tk-kw">func/);
    expect(h('rs', 'fn main() {}').html).toMatch(/tk-kw">fn/);
    expect(h('c', '#include <stdio.h>').html).toMatch(/tk-meta/);
    expect(h('java', '@Override public void f() {}').html).toMatch(/tk-meta">@Override[\s\S]*tk-kw">public/);
    expect(h('ts', 'let a: string = 1').html).toMatch(/tk-ty">string/);
  });

  it('carries a block comment, a template string and a triple-quoted string from one line to the next', async () => {
    const { highlightLines } = await load('highlight.js');
    const a = highlightLines('js', ['a /* x', 'still comment', 'end */ b', "`one", 'two`', 'ok'], '');
    expect(a.html[1]).toBe('<span class="tk-com">still comment</span>');
    expect(a.html[2]).toMatch(/^<span class="tk-com">end \*\/<\/span> b/);
    expect(a.html[4]).toBe('<span class="tk-str">two`</span>');
    expect(a.html[5]).not.toMatch(/tk-str/);
    const p = highlightLines('py', ['x = """', 'inside', '"""', 'y = 1'], '');
    expect(p.html[1]).toBe('<span class="tk-str">inside</span>');
    expect(p.html[3]).toMatch(/tk-num">1/);
    const css = highlightLines('css', ['/* a', 'b */ .x { top: 1px }'], '');
    expect(css.html[1]).toMatch(/^<span class="tk-com">b \*\/<\/span>/);
  });
});

describe('Markdown never becomes anything but text, links and pictures', () => {
  async function render(md, opts) {
    const { renderMarkdown } = await load('markdown.js');
    return renderMarkdown(md, { docUrl: 'https://docs.test/dir/readme.md', allowImages: true, imageSrc: (u) => (u.startsWith('data:') ? u : '/res?u=' + encodeURIComponent(u)), ...(opts || {}) });
  }

  it('renders the structure of a document', async () => {
    const { root, headings } = await render('# Title\n\nSome **bold**, *it*, ~~gone~~ and `code`.\n\n- a\n  - nested\n- [x] done\n\n1. one\n2. two\n\n| H1 | H2 |\n|:--|--:|\n| a | b |\n\n> quote\n\n---\n\n```js\nconst a = 1;\n```\n\n## Second\n');
    expect(root.querySelector('h1').textContent).toBe('Title');
    expect(root.querySelector('strong').textContent).toBe('bold');
    expect(root.querySelector('em').textContent).toBe('it');
    expect(root.querySelector('del').textContent).toBe('gone');
    expect(root.querySelector('ul ul li').textContent).toBe('nested');
    expect(root.querySelector('input[type=checkbox]').checked).toBe(true);
    expect(root.querySelector('ol').children.length).toBe(2);
    expect(root.querySelector('th').textContent).toBe('H1');
    expect(root.querySelectorAll('td')[1].style.textAlign).toBe('right');
    expect(root.querySelector('blockquote').textContent.trim()).toBe('quote');
    expect(root.querySelector('hr')).toBeTruthy();
    expect(root.querySelector('pre code').textContent).toBe('const a = 1;');
    expect(headings.map((h) => [h.level, h.id, h.text])).toEqual([[1, 'title', 'Title'], [2, 'second', 'Second']]);
  });

  it('gives repeated headings their own ids and resolves a relative link against the document', async () => {
    const { root, headings } = await render('# A\n## A\n\n[rel](../other.md) and [top](#a-1)\n');
    expect(headings.map((h) => h.id)).toEqual(['a', 'a-1']);
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://docs.test/other.md', '#a-1']);
  });

  it('shows raw HTML as the text it is, and follows no link or picture it should not', async () => {
    const hostile = [
      '<script>window.pwned=1</script>', '<img src=x onerror="window.pwned=2">', '[x](javascript:window.pwned=3)', '[y](data:text/html,<script>1</script>)',
      '![z](javascript:alert(1))', '![w](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)', '[v](vbscript:x)', '[u]( JaVa\tScRiPt:alert(1))', '<iframe src="https://evil.test"></iframe>',
      '<a href="javascript:1">h</a>', '`<script>`', '**<b onmouseover=alert(1)>b</b>**', '[file](file:///C:/Windows/win.ini)', '<style>*{display:none}</style>',
    ].join('\n\n');
    const { root } = await render(hostile);
    expect(root.querySelector('script, iframe, style, object, embed, svg')).toBe(null);
    for (const el of root.querySelectorAll('*')) {
      for (const a of el.attributes) expect(a.name, el.outerHTML).not.toMatch(/^on/);
    }
    for (const a of root.querySelectorAll('a')) expect(a.getAttribute('href'), a.outerHTML).toMatch(/^(https?:|mailto:|#)/);
    expect(root.querySelectorAll('img').length).toBe(0);
    expect(root.textContent).toContain('<script>window.pwned=1</script>');
    expect(root.textContent).toContain('<img src=x onerror="window.pwned=2">');
    expect(window.pwned).toBeUndefined();
  });

  it('loads a picture only as the document\'s own: through the viewer\'s /res, a data image, or not at all', async () => {
    const { root } = await render('![a](pic.png "t") ![b](https://cdn.test/x.jpg) ![c](data:image/png;base64,AAAA)');
    const srcs = [...root.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(srcs[0]).toBe('/res?u=' + encodeURIComponent('https://docs.test/dir/pic.png'));
    expect(srcs[1]).toBe('/res?u=' + encodeURIComponent('https://cdn.test/x.jpg'));
    expect(srcs[2]).toBe('data:image/png;base64,AAAA');
    for (const i of root.querySelectorAll('img')) expect(i.getAttribute('referrerpolicy')).toBe('no-referrer');
    const off = await render('![a](pic.png)', { allowImages: false });
    expect(off.root.querySelectorAll('img').length).toBe(0);
    expect(off.root.querySelector('.md-image-off')).toBeTruthy();
  });

  it('drops a HTML comment and front matter, keeps reference links', async () => {
    const { root } = await render('---\ntitle: x\n---\n<!-- hidden -->\nSee [ref][r] and [r].\n\n[r]: https://ref.test/ "Ref"\n');
    expect(root.textContent).not.toContain('hidden');
    expect(root.textContent).not.toContain('title: x');
    expect([...root.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://ref.test/', 'https://ref.test/']);
  });
});

describe('the worker holds the document and answers small questions', () => {
  it('walks a JSON tree: open, close, paths, values, search', () => {
    const w = loadWorker();
    w.open('{"a":1,"b":[1,2,{"c":"x\\ny"}],"d":{"e":null,"f":true},"g":"h","odd key":0}');
    expect(w.call('openJson')).toMatchObject({ ok: true, nodes: 12 });
    expect(w.rows().map((r) => r.k)).toContain('b');
    w.call('treeAll', { open: true });
    const rows = w.rows();
    expect(rows.slice(0, 7).map((r) => r.d + ':' + (r.k !== undefined ? r.k : r.i !== undefined ? '[' + r.i + ']' : '$'))).toEqual(['0:$', '1:a', '1:b', '2:[0]', '2:[1]', '2:[2]', '3:c']);
    const hit = w.call('treeFind', { q: 'x' });
    expect([...hit.nodes].length).toBe(1);
    expect(w.call('treeValue', { node: hit.nodes[0], what: 'full' })).toMatchObject({ path: '$.b[2].c', text: 'x\ny' });
    const odd = w.call('treeFind', { q: 'odd key' });
    expect(w.call('treeValue', { node: odd.nodes[0], what: 'path' }).path).toBe('$["odd key"]');
    expect(JSON.parse(w.call('treeValue', { node: 0 }).text).b[2].c).toBe('x\ny');
    expect(w.call('treeAll', { open: false }).total).toBe(6);
  });

  it('keeps big numbers as written and finds a quoted string with its quotes', () => {
    const w = loadWorker();
    w.open('{"n":12345678901234567890123,"s":"quoted"}');
    w.call('openJson');
    const hit = w.call('treeFind', { q: '"quoted"' });
    expect(hit.nodes.length).toBe(1);
    expect(w.rows().find((r) => r.k === 'n').v).toBe('12345678901234567890123');
  });

  it('says where JSON is wrong, in a sentence the page can translate', () => {
    const w = loadWorker();
    w.open('{"a":1,\n "b":[1,2,}');
    const r = w.call('openJson');
    expect(r).toMatchObject({ ok: false, parse: true, line: 2, col: 11 });
    expect(r.tpl).toBe('A value was expected here, not a closing bracket');
    w.open('{"a":1} x');
    expect(w.call('openJson').tpl).toBe('There is more after the end of the JSON value');
    w.open('');
    expect(w.call('openJson').tpl).toBe('The document is empty');
    for (const bad of ['{"a"}', '[1,]', '{"a":01}', '"x', '{"a":tru}', '[1 2]', '{a:1}']) { w.open(bad); expect(w.call('openJson').ok, bad).toBe(false); }
    for (const good of ['0', '-1.5e+3', 'null', '"s"', '[]', '{}', '[[[[]]]]', ' {"a" : [ 1 , 2 ] } ']) { w.open(good); expect(w.call('openJson').ok, good).toBe(true); }
  });

  it('reads JSON Lines, a bad line shown where it is', () => {
    const w = loadWorker();
    w.open('{"id":1}\n{"id":2,"x":[1]}\nnot json\n\n{"id":4}\n');
    expect(w.call('openJsonLines')).toMatchObject({ ok: true, bad: 1 });
    const rows = w.rows();
    expect(rows.filter((r) => r.d === 0).map((r) => r.i)).toEqual([1, 2, 3, 5]);
    expect(rows.find((r) => r.t === 'e').err).toMatchObject({ m: 'This is not valid JSON', col: 1 });
  });

  it('reads XML with namespaces, attributes, CDATA, comments and entities', () => {
    const w = loadWorker();
    w.open('<?xml version="1.0"?><!-- c --><r:root xmlns:r="urn:x" id="1"><r:item a="1" b=\'2\'>text &amp; more</r:item><r:item/><r:grp><![CDATA[raw <b>]]><k>v</k>mixed</r:grp></r:root>');
    expect(w.call('openXml').ok).toBe(true);
    w.call('treeAll', { open: true });
    const rows = w.rows();
    const root = rows.find((r) => r.k === 'r:root');
    expect(root.a).toContain('xmlns:r="urn:x"');
    expect(rows.find((r) => r.k === 'r:item').v).toBe('text & more');
    expect(rows.find((r) => r.t === 'D').v).toBe('raw <b>');
    const f = w.call('treeFind', { q: 'more' });
    expect(w.call('treeValue', { node: f.nodes[0], what: 'path' }).path).toBe('/r:root/r:item[1]');
    w.open('<a><b></a>');
    const bad = w.call('openXml');
    expect(bad).toMatchObject({ ok: false, tpl: 'The closing tag </{a}> does not match <{b}>', args: { a: 'a', b: 'b' } });
    w.open('<a>');
    expect(w.call('openXml').tpl).toBe('The element <{name}> is never closed');
  });

  it('reads CSV with quoted commas, newlines and quotes; guesses the delimiter and the types; sorts and filters', () => {
    const w = loadWorker();
    w.open('id,name,score,when\n1,"Smith, J",3.5,2024-01-02\n2,"multi\nline",10,2024-01-03\n3,"say ""hi""",,2024-01-01\n');
    const info = w.call('openCsv', { delimiter: 'auto' });
    expect(info).toMatchObject({ rows: 3, cols: 4, delimiter: ',', types: ['integer', 'text', 'number', 'date'] });
    expect(w.call('csvRows', { from: 0, count: 10 }).rows).toEqual([['1', 'Smith, J', '3.5', '2024-01-02'], ['2', 'multi\nline', '10', '2024-01-03'], ['3', 'say "hi"', '', '2024-01-01']]);
    w.call('csvSet', { sort: { col: 2, dir: 'desc' } });
    expect(w.call('csvRows', { from: 0, count: 10 }).rows.map((r) => r[0])).toEqual(['2', '1', '3']);
    w.call('csvSet', { sort: { col: 2, dir: 'asc' } });
    expect(w.call('csvRows', { from: 0, count: 10 }).rows.map((r) => r[0])).toEqual(['1', '2', '3']);       // an empty value goes last either way
    w.call('csvSet', { sort: null, filter: { q: 'smith' } });
    expect(w.call('csvRows', { from: 0, count: 10 }).total).toBe(1);
    w.call('csvSet', { filter: { q: '', cols: { 3: '2024-01-0' } } });
    expect(w.call('csvRows', { from: 0, count: 10 }).total).toBe(3);
    w.open('a\tb\n1\t2\n');
    expect(w.call('openCsv', { delimiter: 'auto' })).toMatchObject({ delimiter: 'tab', cols: 2 });
    w.open('ad;soyad\nAyşe;Yılmaz\n');
    expect(w.call('openCsv', { delimiter: 'auto' })).toMatchObject({ delimiter: ';' });
    expect(w.call('openCsv', { delimiter: ',', header: false })).toMatchObject({ rows: 2, delimiter: ',' });
    expect(w.call('csvText', {}).text.split(String.fromCharCode(10))).toEqual(['ad;soyad', 'Ayşe;Yılmaz']);
  });

  it('numbers lines, finds words with line and column, and grows as a log grows', () => {
    const w = loadWorker();
    w.open('line one\r\nline two\nthird line with Needle\n');
    expect(w.call('linesInfo')).toMatchObject({ count: 3 });
    expect(w.call('linesGet', { from: 0, count: 10 }).lines).toEqual(['line one', 'line two', 'third line with Needle']);
    const f = w.call('linesFind', { q: 'needle' });
    expect([[...f.line], [...f.col]]).toEqual([[2], [16]]);
    expect([...w.call('linesFind', { q: 'needle', cs: true }).line]).toEqual([]);
    const add = Buffer.from('fourth\nfifth Needle');
    expect(w.call('append', { buffer: add.buffer.slice(add.byteOffset, add.byteOffset + add.length) })).toMatchObject({ lines: 5 });
    const more = Buffer.from(' more\nsixth\n');
    expect(w.call('append', { buffer: more.buffer.slice(more.byteOffset, more.byteOffset + more.length) })).toMatchObject({ lines: 6 });
    expect(w.call('linesGet', { from: 3, count: 10 }).lines).toEqual(['fourth', 'fifth Needle more', 'sixth']);
  });

  it('cuts a very long line instead of handing it to the page', () => {
    const w = loadWorker();
    w.open('short\n' + 'x'.repeat(200000) + '\nafter\n');
    const r = w.call('linesGet', { from: 0, count: 10 });
    expect(r.lines[1].length).toBeLessThanOrEqual(20000);
    expect(r.more[1]).toBeGreaterThan(100000);
    expect(r.lines[2]).toBe('after');
  });

  it('knows its encodings, and when a file is not text at all', () => {
    const w = loadWorker();
    expect(w.open(Buffer.from([0x54, 0xfc, 0x72, 0x6b, 0xe7, 0x65, 0x20, 0xfd, 0xde, 0xf0]))).toMatchObject({ encoding: 'windows-1254', binary: false });
    expect(w.call('textGet', {}).text).toBe('Türkçe ıŞğ');
    expect(w.open(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi there', 'utf16le')]))).toMatchObject({ encoding: 'utf-16le', bom: true });
    expect(w.call('textGet', {}).text).toBe('hi there');
    expect(w.open(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('bom')]))).toMatchObject({ encoding: 'utf-8', bom: true });
    expect(w.call('textGet', {}).text).toBe('bom');
    expect(w.call('init', { encoding: 'iso-8859-9' })).toMatchObject({ encoding: 'iso-8859-9' });      // the bytes stay: another encoding without sending them again
    expect(w.open(Buffer.from([0, 1, 2, 3, 0, 0, 255, 254])).binary).toBe(true);
    expect(w.open(Buffer.from('plain text\nwith lines\n')).binary).toBe(false);
  });

  it('opens a document of 400,000 nodes in a moment and answers a search in tens of milliseconds', () => {
    const w = loadWorker();
    const parts = ['['];
    for (let i = 0; i < 40000; i++) parts.push((i ? ',' : '') + `{"id":${i},"name":"item ${i}","tags":["a","b"],"n":{"x":${i % 7},"y":null}}`);
    parts.push(']');
    w.open(parts.join(''));
    let t = Date.now();
    const r = w.call('openJson');
    expect(r).toMatchObject({ ok: true, nodes: 40000 * 9 + 1 });
    expect(Date.now() - t).toBeLessThan(8000);
    t = Date.now();
    const hit = w.call('treeFind', { q: '"item 39999"' });
    expect(hit.nodes.length).toBe(1);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(w.call('treeReveal', { node: hit.nodes[0] }).row).toBeGreaterThan(0);
  }, 60000);
});

describe('words and looks', () => {
  function candidates() {
    const found = new Map();
    for (const f of fs.readdirSync(DIR)) {
      if (!/\.js$/.test(f) || /^(strings|highlight|doc-worker)/.test(f)) continue;
      const src = fs.readFileSync(path.join(DIR, f), 'utf8');
      const re = /'((?:[^'\\\n]|\\.)*)'/g;
      let m;
      while ((m = re.exec(src))) {
        const s = m[1].replace(/\\u2026/g, '\u2026').replace(/\\u2019/g, '\u2019').replace(/\\'/g, "'");
        if (/^[A-Z][A-Za-z]/.test(s) && s.length >= 3 && /[a-z]/.test(s)) found.set(s, f);
      }
    }
    return found;
  }
  // names of formats, encodings, keys and technical words that are the same in Turkish
  const SAME = new Set(['Auto', 'Markdown', 'JSON', 'XML', 'CSV', 'TSV', 'HTML', 'CSS', 'JavaScript', 'TypeScript', 'Python', 'PowerShell', 'Ruby', 'Rust', 'Lua', 'Java / C# / Kotlin', 'C / C++', 'YAML', 'TOML', 'INI', 'SQL', 'PHP', 'Go', 'UTF-8', 'UTF-16 LE', 'UTF-16 BE', 'Windows-1254', 'ISO-8859-9', 'Windows-1252', 'ISO-8859-1', 'Windows-1250', 'Windows-1251',
    'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End', 'Enter', 'Escape', 'Range', 'Content-Type', 'Aa']);

  it('has Turkish for every sentence the viewer can show', async () => {
    const { TR } = await load('strings-tr.js');
    const missing = [];
    for (const [s, file] of candidates()) {
      if (SAME.has(s) || Object.prototype.hasOwnProperty.call(TR, s)) continue;
      if (/^[A-Z][a-zA-Z]+$/.test(s) && !/\s/.test(s) && /^(Array|Map|Set|Date|Error|Object|Promise|Number|String|Highlight|Headers|Response|Worker)$/.test(s)) continue;
      missing.push(file + ': ' + s);
    }
    expect(missing).toEqual([]);
  });

  it('has Turkish for the words written into the page itself, and for every sentence the worker names', async () => {
    const { TR } = await load('strings-tr.js');
    const html = fs.readFileSync(path.join(DIR, 'viewer.html'), 'utf8');
    for (const m of html.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]+)"/g)) expect(TR, m[1]).toHaveProperty([m[1]]);
    const worker = fs.readFileSync(path.join(DIR, 'doc-worker.js'), 'utf8');
    const sentences = new Set();
    for (const m of worker.matchAll(/(?:ParseError|Fail)\(\s*(?:[^'"\n]*\?\s*)?'((?:[^'\\]|\\.)*)'(?:\s*:\s*'((?:[^'\\]|\\.)*)')?/g)) { sentences.add(m[1]); if (m[2]) sentences.add(m[2]); }
    for (const m of worker.matchAll(/'(A [^']*|The [^']*|This [^']*|There [^']*|Text outside[^']*|Nested[^']*|Only a [^']*)'/g)) if (/\b(was|is|are|has|have|not|larger|expected|never|inside)\b/.test(m[1]) && !/^The worker|^The page/.test(m[1])) sentences.add(m[1]);
    const missing = [...sentences].filter((s) => !Object.prototype.hasOwnProperty.call(TR, s) && s.length > 3);
    expect(missing).toEqual([]);
    expect(sentences.size).toBeGreaterThan(30);
  });

  it('keeps every {name} of an English sentence in its Turkish one', async () => {
    const { TR } = await load('strings-tr.js');
    for (const [en, tr] of Object.entries(TR)) {
      const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      expect(names(tr), en).toBe(names(en));
      expect(tr.trim().length, en).toBeGreaterThan(0);
    }
  });

  it('translates with t(), fills places, and falls back to English for a sentence it does not have', async () => {
    const strings = await load('strings.js');
    document.documentElement.lang = 'tr';
    strings.setLang('tr');
    expect(strings.t('Copy all')).toBe('Tümünü kopyala');
    expect(strings.t('{n} rows', { n: 5 })).toBe('5 satır');
    expect(strings.t('A sentence nobody wrote')).toBe('A sentence nobody wrote');
    strings.setLang('en');
    expect(strings.t('Copy all')).toBe('Copy all');
    expect(strings.num(1234567)).toBe('1,234,567');
    strings.setLang('tr');
    expect(strings.num(1234567)).toBe('1.234.567');
    strings.setLang('en');
  });

  it('uses only the interface\'s icons and no emoji, and no colour of its own beyond the theme\'s', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)));
    for (const f of fs.readdirSync(DIR)) {
      const src = decode(fs.readFileSync(path.join(DIR, f), 'utf8'));
      // the arrow and ellipsis characters are typography, not pictures
      const bad = [...src.matchAll(new RegExp(emoji.source, 'gu'))].map((m) => m[0]).filter((c) => !/[\u2026\u21b5\u00b7]/.test(c));
      expect(bad, f).toEqual([]);
    }
    const css = fs.readFileSync(path.join(DIR, 'viewer.css'), 'utf8');
    const outside = css.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // hex colours appear only as the fallback inside var(...) (removed above), as the one fixed white/ink on the accent and the toast
    const hexes = [...outside.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    expect(hexes.filter((h) => !['#fff', '#ffffff', '#111318'].includes(h))).toEqual([]);
    const html = fs.readFileSync(path.join(DIR, 'viewer.html'), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);                    // no inline script (the page's policy has no 'unsafe-inline' for scripts)
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.indexOf('/css/theme-tokens.css')).toBeGreaterThan(-1);
  });
});
