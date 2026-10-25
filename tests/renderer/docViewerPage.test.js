// @vitest-environment jsdom
//
// The document viewer's page driven end to end in jsdom: the real app.js, the views and the worker, with a stand-in for the network (what main
// serves at /doc), for the worker's thread and for the observers jsdom has no layout for. The look and the weight of the page are checked
// in the real app (scripts in the session's notes); this checks the wiring: what is shown for each kind of document and what the controls do.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.resolve(__dirname, '../../src/renderer/doc-viewer');
const ICONS = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/vex-icons.js'), 'utf8');

function pageBody() {
  const html = fs.readFileSync(path.join(DIR, 'viewer.html'), 'utf8');
  return /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

// The worker's file, run in a vm; messages in, replies out a moment later (as a thread would).
class FakeWorker {
  constructor() {
    const src = fs.readFileSync(path.join(DIR, 'doc-worker.js'), 'utf8');
    const self = { postMessage: (m) => queueMicrotask(() => this.onmessage && this.onmessage({ data: m })) };
    const ctx = vm.createContext({ self, TextDecoder, TextEncoder, Intl, Int32Array, Uint8Array, Uint16Array, Uint32Array, Float64Array, Map, Error, Object, Array, Math, Number, String, JSON, Date });
    vm.runInContext(src, ctx);
    this.self = self;
  }
  postMessage(m) { this.self.onmessage({ data: m }); }
  terminate() {}
}

let calls;       // what the page asked the network and the host for
let host;
const mount = { current: null };

async function boot(doc, opts = {}) {
  vi.resetModules();
  calls = { fetch: [], host: [] };
  const bytes = Buffer.isBuffer(doc.body) ? doc.body : Buffer.from(doc.body, 'utf8');
  document.body.innerHTML = pageBody();
  document.documentElement.lang = opts.lang || 'en';
  window.history.pushState({}, '', '/?u=' + encodeURIComponent(doc.url) + (doc.source ? '&m=source' : ''));
  window.eval(ICONS + '; window.VexIcons = VexIcons;');
  // jsdom has no canvas: the page asks one for the colour of a CSS value (theme.js resolveColor)
  window.HTMLCanvasElement.prototype.getContext = function () {
    const ctx = { clearRect() {}, fillRect() {}, getImageData() { const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(String(ctx._fill)); return { data: m ? [Number(m[1]), Number(m[2]), Number(m[3]), 255] : [0, 0, 0, 255] }; } };
    Object.defineProperty(ctx, 'fillStyle', { get: () => ctx._fill, set: (v) => { ctx._fill = v; } });
    return ctx;
  };
  globalThis.Worker = FakeWorker;
  globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(el) { queueMicrotask(() => this.cb([{ target: el, isIntersecting: true }])); } unobserve() {} disconnect() {} };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 0);
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  const written = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { written.push(t); } }, configurable: true });
  mount.written = written;
  host = {
    saveAs: async () => { calls.host.push('saveAs'); return { ok: true, cancelled: false, name: 'x.json' }; },
    download: async () => { calls.host.push('download'); return { ok: true, viaDownloads: true }; },
    openRaw: async () => { calls.host.push('openRaw'); return { ok: true }; },
    navigate: async (u) => { calls.host.push('navigate ' + u); return { ok: true }; },
    onTheme: () => {},
  };
  window.vexDocHost = host;
  let grown = bytes;
  mount.grow = (extra) => { grown = Buffer.concat([grown, Buffer.from(extra)]); };
  globalThis.fetch = async (url, init) => {
    calls.fetch.push([String(url), init && init.headers && init.headers.Range]);
    if (opts.fail) return new Response(opts.failBody || 'x', { status: opts.fail, headers: { 'x-vex-error': opts.failKind || 'fetch' } });
    const range = init && init.headers && init.headers.Range && /bytes=(\d+)-/.exec(init.headers.Range);
    if (range) {
      const start = Number(range[1]);
      if (start >= grown.length) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + grown.length } });
      return new Response(grown.subarray(start), { status: 206, headers: { 'content-range': `bytes ${start}-${grown.length - 1}/${grown.length}` } });
    }
    return new Response(grown, { status: 200, headers: { 'content-type': doc.type || '', 'content-length': String(grown.length) } });
  };
  await import('../../src/renderer/doc-viewer/app.js');
  await vi.waitFor(() => {
    const info = document.getElementById('dv-info').textContent;
    const state = document.querySelector('.dv-state-title');
    if (!info && !(state && !/Reading|okunuyor/.test(state.textContent))) throw new Error('not ready');
  }, { timeout: 8000 });
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

beforeEach(() => { localStorage.clear(); });

describe('JSON', () => {
  const json = JSON.stringify({ name: 'Vex', list: [{ id: 1, tag: 'needle' }, { id: 2 }], deep: { a: { b: { c: 'bottom' } } }, nothing: null }, null, 2);

  it('is a tree with its type shown, the top opened, and the controls of a tree', async () => {
    await boot({ url: 'https://a.test/data', body: json, type: 'application/json; charset=utf-8' });
    expect($('#dv-kind').textContent).toBe('JSON');
    expect($('#dv-name').textContent).toBe('data');
    expect($$('.dv-view-btn').map((b) => b.dataset.mode + b.getAttribute('aria-pressed'))).toEqual(['treetrue', 'rawfalse']);
    await vi.waitFor(() => expect($$('.dv-row').length).toBeGreaterThan(4));
    const labels = $$('.dv-row .dv-key').map((k) => k.textContent);
    expect(labels).toEqual(expect.arrayContaining(['$', 'name', 'list', 'deep', 'nothing']));
    expect($('.dv-tree').getAttribute('role')).toBe('tree');
    const first = $('.dv-row');
    expect(first.getAttribute('role')).toBe('treeitem');
    expect(first.getAttribute('aria-level')).toBe('1');
    expect($$('.dv-row').filter((r) => r.getAttribute('aria-expanded') === 'true').length).toBeGreaterThan(0);
    expect($$('#dv-options button').map((b) => b.getAttribute('aria-label'))).toEqual(['Expand all', 'Collapse all']);
    expect($('#dv-info').textContent).toMatch(/nodes/);
  });

  it('opens and closes a branch with the keyboard', async () => {
    await boot({ url: 'https://a.test/data.json', body: json, type: 'application/json' });
    await vi.waitFor(() => expect($$('.dv-row').length).toBeGreaterThan(3));
    const tree = $('.dv-tree');
    // a small document is opened all the way; Collapse all folds it to the top
    expect($$('.dv-row .dv-key').map((k) => k.textContent)).toContain('c');
    click([...$$('#dv-options button')].find((b) => b.getAttribute('aria-label') === 'Collapse all'));
    await vi.waitFor(() => expect($$('.dv-row').length).toBe(5));
    expect($$('.dv-row .dv-key').map((k) => k.textContent)).not.toContain('c');
    // go to "deep" and open it with the arrow key, then everything under it with *
    const deepRow = $$('.dv-row').find((r) => r.querySelector('.dv-key').textContent === 'deep');
    deepRow.focus();
    click(deepRow);
    tree.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await vi.waitFor(() => expect($$('.dv-row .dv-key').map((k) => k.textContent)).toContain('a'));
    expect($$('.dv-row .dv-key').map((k) => k.textContent)).not.toContain('b');
    tree.dispatchEvent(new window.KeyboardEvent('keydown', { key: '*', bubbles: true }));
    await vi.waitFor(() => expect($$('.dv-row .dv-key').map((k) => k.textContent)).toContain('c'));
    expect($$('.dv-row .dv-val').map((v) => v.textContent)).toContain('"bottom"');
    // Left closes it again
    tree.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await vi.waitFor(() => expect($$('.dv-row .dv-key').map((k) => k.textContent)).not.toContain('a'));
  });

  it('searches keys and values, counts, steps, and marks the hit', async () => {
    await boot({ url: 'https://a.test/data.json', body: json, type: 'application/json' });
    await vi.waitFor(() => expect($$('.dv-row').length).toBeGreaterThan(3));
    const q = $('#dv-q');
    q.value = 'needle';
    q.dispatchEvent(new window.Event('input', { bubbles: true }));
    await vi.waitFor(() => expect($('#dv-count').textContent).toBe('1 / 1'), { timeout: 3000 });
    await vi.waitFor(() => expect($$('mark.dv-hit').map((m) => m.textContent)).toContain('needle'));
    expect($('.dv-row.dv-current')).toBeTruthy();
    q.value = 'zzz';
    q.dispatchEvent(new window.Event('input', { bubbles: true }));
    await vi.waitFor(() => expect($('#dv-count').textContent).toBe('No matches'), { timeout: 3000 });
  });

  it('shows the same bytes as numbered, coloured lines in Raw, and remembers the choice per kind', async () => {
    await boot({ url: 'https://a.test/data.json', body: json, type: 'application/json' });
    click($('[data-mode="raw"]'));
    await vi.waitFor(() => expect($$('.dv-line').length).toBe(json.split('\n').length));
    expect($('.dv-ln').getAttribute('data-n')).toBe('1');
    expect($$('.dv-code .tk-attr').map((x) => x.textContent)).toContain('"name"');
    expect($$('.dv-code').map((c) => c.textContent).join('\n')).toBe(json);
    expect($('[data-mode="raw"]').getAttribute('aria-pressed')).toBe('true');
    expect($$('#dv-options label').map((l) => l.textContent)).toEqual(expect.arrayContaining(['Wrap lines', 'Line numbers']));
  });

  it('says what is wrong with invalid JSON, and shows the text with the faulty line', async () => {
    await boot({ url: 'https://a.test/x.json', body: '{"a": 1,\n "b": [1, 2,\n}\n', type: 'application/json' });
    await vi.waitFor(() => expect($('#dv-banner').hidden).toBe(false));
    expect($('#dv-banner').textContent).toMatch(/not valid JSON: A value was expected here, not a closing bracket \(line 3, column 1\)/);
    expect($('#dv-banner').getAttribute('role')).toBe('alert');
    await vi.waitFor(() => expect($$('.dv-line').length).toBe(3));
    expect($$('.dv-view-btn').length).toBe(0);
  });

  it('quietly shows text for text/plain that merely looked like JSON', async () => {
    await boot({ url: 'https://a.test/thing', body: '{ this is just a note }', type: 'text/plain' });
    await vi.waitFor(() => expect($$('.dv-line').length).toBe(1));
    expect($('#dv-banner').hidden).toBe(true);
  });

  it('copies the whole document, the path and the value', async () => {
    await boot({ url: 'https://a.test/data.json', body: json, type: 'application/json' });
    await vi.waitFor(() => expect($$('.dv-row').length).toBeGreaterThan(3));
    click([...$$('#dv-actions button')].find((b) => b.getAttribute('aria-label') === 'Copy all'));
    await vi.waitFor(() => expect(mount.written[0]).toBe(json));
    const nameRow = $$('.dv-row').find((r) => r.querySelector('.dv-key').textContent === 'name');
    click([...nameRow.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Copy path'));
    await vi.waitFor(() => expect(mount.written[1]).toBe('$.name'));
    click([...nameRow.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Copy value'));
    await vi.waitFor(() => expect(mount.written[2]).toBe('Vex'));
    await vi.waitFor(() => expect($('#dv-toast').hidden).toBe(false));
  });

  it('hands Save as, Download and Open raw to main', async () => {
    await boot({ url: 'https://a.test/data.json', body: json, type: 'application/json' });
    for (const label of ['Save as\u2026', 'Download', 'Open raw in the browser\u2019s own view']) click([...$$('#dv-actions button')].find((b) => b.getAttribute('aria-label') === label));
    await vi.waitFor(() => expect(calls.host).toEqual(['saveAs', 'download', 'openRaw']));
  });
});

describe('JSON Lines and XML', () => {
  it('shows each line as an entry and a broken line where it is', async () => {
    await boot({ url: 'https://a.test/e.jsonl', body: '{"a":1}\n{"a":2}\nnot json\n{"a":4}\n', type: 'application/x-ndjson' });
    expect($('#dv-kind').textContent).toBe('JSON Lines');
    await vi.waitFor(() => expect($$('.dv-row').length).toBeGreaterThanOrEqual(4));
    expect($$('.dv-row .dv-idx').map((x) => x.textContent).slice(0, 4)).toEqual(['#1', '#2', '#3', '#4']);
    expect($('.dv-row.dv-bad .dv-err').textContent).toMatch(/not valid JSON \(column 1\)/);
  });

  it('shows XML with its attributes and namespaces', async () => {
    await boot({ url: 'https://a.test/ns.xml', body: '<?xml version="1.0"?><r:root xmlns:r="urn:x" id="1"><r:item a="1">hello</r:item><r:item/></r:root>', type: 'application/xml' });
    expect($('#dv-kind').textContent).toBe('XML');
    await vi.waitFor(() => expect($$('.dv-tag').length).toBeGreaterThan(2));
    expect($('.dv-tree').getAttribute('aria-label')).toBe('XML tree');
    const text = $$('.dv-row').map((r) => r.textContent.replace(/\s+/g, ' ')).join('|');
    expect(text).toContain('<r:root xmlns:r="urn:x" id="1">');
    expect(text).toContain('<r:item a="1">hello</r:item>');
    expect($$('.dv-attr-ns').length).toBe(1);
  });
});

describe('CSV', () => {
  const csv = 'id,name,score\n1,"Smith, J",3.5\n2,Ayşe,10\n3,"say ""hi""",\n';

  it('is a table with sticky header, types, a row count and the pickers', async () => {
    await boot({ url: 'https://a.test/t.csv', body: csv, type: 'text/csv' });
    expect($('#dv-kind').textContent).toBe('CSV');
    await vi.waitFor(() => expect($$('.dv-grow').length).toBe(3));
    expect($$('.dv-gh .dv-gh-name').map((n) => n.textContent)).toEqual(['#', 'id', 'name', 'score']);
    expect($$('.dv-type').map((n) => n.textContent)).toEqual(['123', 'abc', '1.5']);
    expect($$('.dv-grow:first-child .dv-gc').map((c) => c.textContent)).toEqual(['1', '1', 'Smith, J', '3.5']);
    expect($('#dv-info').textContent).toMatch(/3 rows.*3 columns/);
    expect($('.dv-grid').getAttribute('role')).toBe('grid');
    expect($$('#dv-options select').map((s) => s.getAttribute('aria-label'))).toEqual(['Delimiter', 'Encoding']);
    expect($('#dv-q').placeholder).toBe('Filter rows');
  });

  it('sorts by a column (ascending, descending, none) and says so in aria-sort', async () => {
    await boot({ url: 'https://a.test/t.csv', body: csv, type: 'text/csv' });
    await vi.waitFor(() => expect($$('.dv-grow').length).toBe(3));
    const scoreHead = () => $$('.dv-gh').find((h) => h.textContent.includes('score'));
    click(scoreHead().querySelector('button'));
    await vi.waitFor(() => expect(scoreHead().getAttribute('aria-sort')).toBe('ascending'));
    await vi.waitFor(() => expect($$('.dv-grow').map((r) => r.querySelector('.dv-gc:nth-child(2)').textContent)).toEqual(['1', '2', '3']));
    click(scoreHead().querySelector('button'));
    await vi.waitFor(() => expect(scoreHead().getAttribute('aria-sort')).toBe('descending'));
    await vi.waitFor(() => expect($$('.dv-grow').map((r) => r.querySelector('.dv-gc:nth-child(2)').textContent)).toEqual(['2', '1', '3']));
    click(scoreHead().querySelector('button'));
    await vi.waitFor(() => expect(scoreHead().getAttribute('aria-sort')).toBe('none'));
  });

  it('filters rows by what you type, and shows how many are left', async () => {
    await boot({ url: 'https://a.test/t.csv', body: csv, type: 'text/csv' });
    await vi.waitFor(() => expect($$('.dv-grow').length).toBe(3));
    $('#dv-q').value = 'ayşe';
    $('#dv-q').dispatchEvent(new window.Event('input', { bubbles: true }));
    await vi.waitFor(() => expect($$('.dv-grow').length).toBe(1), { timeout: 3000 });
    expect($('#dv-count').textContent).toBe('1 of 3 rows');
    expect($('.dv-grow mark.dv-hit').textContent).toBe('Ayşe');
  });

  it('re-reads with another delimiter and keeps the first column in view when asked', async () => {
    await boot({ url: 'https://a.test/t.csv', body: 'a;b\n1;2\n', type: 'text/csv' });
    await vi.waitFor(() => expect($$('.dv-gh .dv-gh-name').map((n) => n.textContent)).toEqual(['#', 'a', 'b']));
    const delim = $$('#dv-options select')[0];
    delim.value = ',';
    delim.dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($$('.dv-gh .dv-gh-name').map((n) => n.textContent)).toEqual(['#', 'a;b']));
    const frozen = $$('#dv-options input[type=checkbox]').find((c) => c.closest('label').textContent.includes('first column'));
    frozen.checked = true;
    frozen.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect($('.dv-grid').classList.contains('dv-frozen')).toBe(true);
  });

  it('is a TSV table when the server says so', async () => {
    await boot({ url: 'https://a.test/t.tsv', body: 'a\tb\n1\t2\n', type: 'text/tab-separated-values' });
    expect($('#dv-kind').textContent).toBe('TSV');
    await vi.waitFor(() => expect($$('.dv-gh .dv-gh-name').map((n) => n.textContent)).toEqual(['#', 'a', 'b']));
  });
});

describe('Markdown', () => {
  const md = '# Title\n\nHello **world** <script>window.pwned=1</script>\n\n## Part\n\n[a](javascript:alert(1)) [b](https://ok.test/)\n\n![p](pic.png)\n\n```js\nconst x = 1;\n```\n';

  it('is rendered, with its contents, safely; Raw shows the source', async () => {
    await boot({ url: 'https://a.test/readme.md', body: md, type: 'text/markdown' });
    expect($('#dv-kind').textContent).toBe('Markdown');
    await vi.waitFor(() => expect($('.md-body h1')).toBeTruthy());
    expect($$('.dv-toc-link').map((a) => a.textContent)).toEqual(['Title', 'Part']);
    expect($('.md-body script')).toBe(null);
    expect($('.md-body').textContent).toContain('<script>window.pwned=1</script>');
    expect([...$$('.md-body a')].map((a) => a.getAttribute('href'))).toEqual(['https://ok.test/']);
    expect($('.md-body img').getAttribute('src')).toBe('/res?d=' + encodeURIComponent('https://a.test/readme.md') + '&u=' + encodeURIComponent('https://a.test/pic.png'));
    expect($('.md-body pre code .tk-kw').textContent).toBe('const');
    expect(window.pwned).toBeUndefined();
    click($('[data-mode="raw"]'));
    await vi.waitFor(() => expect($$('.dv-line').length).toBe(md.split('\n').length - 1));
  });

  it('can leave pictures out', async () => {
    await boot({ url: 'https://a.test/readme.md', body: md, type: 'text/markdown' });
    await vi.waitFor(() => expect($('.md-body img')).toBeTruthy());
    const box = $$('#dv-options input').find((c) => c.closest('label').textContent.includes('Load pictures'));
    box.checked = false;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($('.md-image-off')).toBeTruthy());
    expect($('.md-body img')).toBe(null);
  });
});

describe('plain text, logs and source', () => {
  const log = Array.from({ length: 50 }, (_, i) => `2026-10-25 10:00:${String(i).padStart(2, '0')} [${i % 7 === 0 ? 'ERROR' : 'INFO'}] line ${i}${i === 42 ? ' Needle' : ''}`).join('\n') + '\n';

  it('numbers lines, colours a log, searches with a hit counter and jumps to a line', async () => {
    await boot({ url: 'https://a.test/app.log', body: log, type: 'text/plain' });
    expect($('#dv-kind').textContent).toBe('Log');
    await vi.waitFor(() => expect($$('.dv-line').length).toBe(50));
    expect($$('.dv-ln').slice(0, 3).map((n) => n.getAttribute('data-n'))).toEqual(['1', '2', '3']);
    expect($$('.tk-del').length).toBe(8);
    $('#dv-q').value = 'needle';
    $('#dv-q').dispatchEvent(new window.Event('input', { bubbles: true }));
    await vi.waitFor(() => expect($('#dv-count').textContent).toBe('1 / 1'), { timeout: 3000 });
    await vi.waitFor(() => expect($('mark.dv-hit.dv-current').textContent).toBe('Needle'));
    expect($('mark.dv-hit').closest('.dv-line').getAttribute('data-l')).toBe('42');
    // a typed line number
    const goto = $('#dv-goto');
    goto.value = '7';
    goto.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick(120);
    await vi.waitFor(() => expect($('.dv-flash')).toBeTruthy());
    expect($('.dv-flash').getAttribute('data-l')).toBe('6');
  });

  it('wraps and hides numbers on request, and remembers it for this kind', async () => {
    await boot({ url: 'https://a.test/notes.txt', body: 'one\ntwo\n', type: 'text/plain' });
    await vi.waitFor(() => expect($$('.dv-line').length).toBe(2));
    const toggles = () => $$('#dv-options .dv-toggle-input');
    const [wrap, ln] = toggles();
    expect($('.dv-text').classList.contains('dv-wrap')).toBe(false);
    wrap.checked = true; wrap.dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($('.dv-text').classList.contains('dv-wrap')).toBe(true));
    ln.checked = false; ln.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect($('.dv-text').classList.contains('dv-no-ln')).toBe(true);
  });

  it('colours source by its type and lets the language be changed', async () => {
    await boot({ url: 'https://a.test/tool.py', body: 'def f(x):\n    return None  # c\n', type: 'text/x-python' });
    await vi.waitFor(() => expect($$('.dv-line').length).toBe(2));
    expect($$('.tk-kw').map((k) => k.textContent)).toEqual(['def', 'return']);
    const lang = $$('#dv-options select')[0];
    expect(lang.value).toBe('py');
    lang.value = 'plain';
    lang.dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($$('.tk-kw').length).toBe(0));
  });

  it('shows a view-source page as highlighted, wrapped markup', async () => {
    await boot({ url: 'https://a.test/page', body: '<!DOCTYPE html>\n<html><body class="a">hi</body></html>\n', type: 'text/html', source: true });
    expect($('#dv-kind').textContent).toBe('Source');
    expect($('#dv-name').textContent).toBe('Source of page');
    await vi.waitFor(() => expect($$('.dv-line').length).toBe(2));
    expect($('.dv-text').classList.contains('dv-wrap')).toBe(true);
    expect($$('.tk-tag').length).toBeGreaterThan(2);
    expect($('[data-mode]')).toBe(null);
  });

  it('follows a growing log: only the new bytes are asked for, and the end stays in view', async () => {
    await boot({ url: 'file:///C:/logs/a.log', body: 'one\ntwo\n', type: 'text/plain' });
    await vi.waitFor(() => expect($$('.dv-line').length).toBe(2));
    const follow = $('#dv-follow input');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      follow.checked = true;
      follow.dispatchEvent(new window.Event('change', { bubbles: true }));
      mount.grow('three\nfour\n');
      await vi.advanceTimersByTimeAsync(1600);
    } finally { vi.useRealTimers(); }
    await vi.waitFor(() => expect($$('.dv-line').length).toBe(4), { timeout: 3000 });
    expect(calls.fetch.some(([, range]) => range === 'bytes=8-')).toBe(true);
    expect($$('.dv-code').map((c) => c.textContent)).toEqual(['one', 'two', 'three', 'four']);
    follow.checked = false;
    follow.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
});

describe('what is not a document, and what goes wrong', () => {
  it('does not show a binary file as text, and offers Download, Open raw and Show as text', async () => {
    await boot({ url: 'https://a.test/x.dat', body: Buffer.from([0, 1, 2, 3, 0, 0, 255, 0]), type: 'application/octet-stream' });
    expect($('.dv-state-title').textContent).toBe('This does not look like a text file');
    expect($$('.dv-state-actions button').map((b) => b.getAttribute('aria-label'))).toEqual(['Download', 'Open raw', 'Show as text anyway']);
    expect($$('.dv-line').length).toBe(0);
    click($$('.dv-state-actions button')[2]);
    await vi.waitFor(() => expect($$('.dv-line').length).toBeGreaterThan(0));
  });

  it('says it plainly when the document cannot be read, with Retry and Open raw', async () => {
    await boot({ url: 'https://a.test/x.json', body: '' }, { fail: 502, failKind: 'fetch', failBody: 'net::ERR_NAME_NOT_RESOLVED' });
    expect($('.dv-state-title').textContent).toBe('The document could not be fetched');
    expect($('.dv-state-detail').textContent).toBe('net::ERR_NAME_NOT_RESOLVED');
    expect($('.dv-state').getAttribute('role')).toBe('alert');
    expect($$('.dv-state-actions button').map((b) => b.getAttribute('aria-label'))).toEqual(['Retry', 'Open raw']);
    click($$('.dv-state-actions button')[1]);
    await vi.waitFor(() => expect(calls.host).toEqual(['openRaw']));
    const before = calls.fetch.length;
    click($$('.dv-state-actions button')[0]);
    await vi.waitFor(() => expect(calls.fetch.length).toBeGreaterThan(before));
  });

  it('says a missing file is missing', async () => {
    await boot({ url: 'file:///C:/gone.log', body: '' }, { fail: 404, failKind: 'missing' });
    expect($('.dv-state-title').textContent).toBe('That file is not there');
  });

  it('re-reads in another encoding without fetching again', async () => {
    await boot({ url: 'https://a.test/t.txt', body: Buffer.from([0x54, 0xfc, 0x72, 0x6b, 0xe7, 0x65]), type: 'text/plain' });
    await vi.waitFor(() => expect($$('.dv-code').map((c) => c.textContent)).toEqual(['Türkçe']));
    const fetches = calls.fetch.length;
    const enc = $$('#dv-options select').find((s) => s.getAttribute('aria-label') === 'Encoding');
    enc.value = 'iso-8859-1';
    enc.dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($$('.dv-code').map((c) => c.textContent)).toEqual(['T\u00fcrk\u00e7e']));
    enc.value = 'windows-1254';
    enc.dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($('#dv-info').textContent).toContain('WINDOWS-1254'));
    expect(calls.fetch.length).toBe(fetches);
  });
});

describe('Turkish', () => {
  it('shows every visible word of the page in Turkish when the interface is Turkish', async () => {
    await boot({ url: 'https://a.test/t.csv', body: 'a,b\n1,2\n', type: 'text/csv', }, { lang: 'tr' });
    await vi.waitFor(() => expect($$('.dv-grow').length).toBe(1));
    expect($('#dv-q').placeholder).toBe('Satırları süz');
    expect($$('#dv-actions button').map((b) => b.getAttribute('aria-label'))).toEqual(['Tümünü kopyala', 'Farklı kaydet\u2026', 'İndir', 'Tarayıcının kendi görünümünde ham olarak aç', 'Yeniden yükle']);
    expect($('#dv-info').textContent).toMatch(/1 satır/);
    expect($('.dv-skip').textContent).toBe('Belgeye atla');
    expect($$('#dv-options label').map((l) => l.textContent).join('|')).toMatch(/Ayırıcı.*İlk satır başlıktır.*Sütun süzgeçleri/);
  });
});
