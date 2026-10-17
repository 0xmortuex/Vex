// @vitest-environment jsdom
//
// Whole-word find (Wave 6): the in-page finder runs inside a real DOM here (jsdom), with the CSS Custom Highlight API
// stubbed because jsdom has none. The script that Vex sends to the page is the very text under test.
import { describe, it, expect, beforeEach } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { VexWholeWordFind: W } = require(path.join(ROOT, 'src/renderer/js/whole-word-find.js'));

let store, scrolled, wv, ran;
function page(html) {
  document.body.innerHTML = html;
  delete window.__vexWW;
  store = new Map(); scrolled = [];
  window.Highlight = class { constructor(...r) { this.ranges = r; } };
  window.CSS = { highlights: store };
  globalThis.Highlight = window.Highlight; globalThis.CSS = window.CSS;
  Element.prototype.scrollIntoView = function () { scrolled.push(this); };
  ran = [];
  wv = {
    insertCSS: async (css) => { ran.push(['css', css]); return 'k'; },
    addEventListener() {},
    executeJavaScript: async (script) => { ran.push(['js', script]); return window.eval(script); },
  };
}
const texts = () => (store.get('vex-ww') ? store.get('vex-ww').ranges.map(r => r.toString()) : []);
const active = () => (store.get('vex-ww-active') ? store.get('vex-ww-active').ranges[0] : null);

beforeEach(() => { delete window.__vexWW; });

describe('whole-word find, in the page', () => {
  it('matches whole words only', async () => {
    page('<p>The cat sat. A category of concat, cats and Cat; "cat" (cat)</p>');
    const r = await W.find(wv, 'cat');
    expect(r).toMatchObject({ total: 4, active: 1, capped: false });
    expect(texts()).toEqual(['cat', 'Cat', 'cat', 'cat']);
  });

  it('is case-insensitive unless Match case is on', async () => {
    page('<p>Cat cat CAT</p>');
    expect((await W.find(wv, 'cat')).total).toBe(3);
    delete window.__vexWW;
    expect((await W.find(wv, 'cat', { matchCase: true })).total).toBe(1);
  });

  it('counts letters of other alphabets as letters (Turkish)', async () => {
    page('<p>okul okulda okullu OKUL ışık ışıklı şeker</p>');
    expect((await W.find(wv, 'okul', {})).total).toBe(2);
    delete window.__vexWW;
    expect((await W.find(wv, 'ışık')).total).toBe(1);
    delete window.__vexWW;
    expect((await W.find(wv, 'şeker')).total).toBe(1);
  });

  it('treats a query with regex characters literally and handles edges like c++', async () => {
    page('<p>Learn C++ and c++11, plus (a.b) and axb and a.b.</p>');
    expect((await W.find(wv, 'C++')).total).toBe(1);               // c++11 continues with a digit, so it is not the word
    delete window.__vexWW;
    expect((await W.find(wv, 'a.b')).total).toBe(2);               // not "axb"
    delete window.__vexWW;
    expect((await W.find(wv, '[x')).total).toBe(0);
  });

  it('steps forward and backward with wrap-around, scrolls to each match, and keeps its own count', async () => {
    page('<p>one fox</p><p>two fox</p><p>three fox</p>');
    let r = await W.find(wv, 'fox');
    expect(r).toMatchObject({ total: 3, active: 1 });
    r = await W.find(wv, 'fox'); expect(r.active).toBe(2);
    r = await W.find(wv, 'fox'); expect(r.active).toBe(3);
    r = await W.find(wv, 'fox'); expect(r.active).toBe(1);                       // wrap
    r = await W.find(wv, 'fox', { forward: false }); expect(r.active).toBe(3);   // back, wrapping
    r = await W.find(wv, 'fox', { forward: false }); expect(r.active).toBe(2);
    expect(scrolled.length).toBe(6);
    expect(active().startContainer.parentElement.textContent).toBe('two fox');
    expect(W.countText(r)).toBe('2/3');
    expect(W.countText({ total: 0, active: 0 })).toBe('0/0');
  });

  it('a new query starts again at the first match (or the last when going back)', async () => {
    page('<p>red green red blue red</p>');
    await W.find(wv, 'red'); await W.find(wv, 'red');
    expect((await W.find(wv, 'blue')).active).toBe(1);
    expect((await W.find(wv, 'red', { forward: false })).active).toBe(3);
  });

  it('skips scripts, styles, hidden text and form fields', async () => {
    page('<p>word</p><script>var word = 1;</script><style>.word{}</style><textarea>word</textarea><noscript>word</noscript><select><option>word</option></select>');
    expect((await W.find(wv, 'word')).total).toBe(1);
  });

  it('skips text a page hides (when the browser can tell)', async () => {
    page('<p>word</p><p id="h">word</p>');
    const real = Element.prototype.checkVisibility;
    Element.prototype.checkVisibility = function () { return this.id !== 'h'; };
    try { expect((await W.find(wv, 'word')).total).toBe(1); }
    finally { if (real) Element.prototype.checkVisibility = real; else delete Element.prototype.checkVisibility; }
  });

  it('notices the page changing and searches again', async () => {
    page('<p id="a">tree</p>');
    expect((await W.find(wv, 'tree')).total).toBe(1);
    document.body.innerHTML = '<p>tree</p><p>tree</p>';
    expect((await W.find(wv, 'tree')).total).toBe(2);
  });

  it('reports no match with nothing highlighted, and clear removes the highlights', async () => {
    page('<p>nothing here</p>');
    expect(await W.find(wv, 'zebra')).toEqual({ total: 0, active: 0, capped: false });
    expect(store.size).toBe(0);
    page('<p>a b a</p>');
    await W.find(wv, 'a');
    expect(store.size).toBe(2);
    await W.clear(wv);
    expect(store.size).toBe(0);
    expect(await W.find(wv, '   ')).toEqual({ total: 0, active: 0, capped: false });
  });

  it('caps the matches and says so', async () => {
    page('<p>' + 'x '.repeat(30) + '</p>');
    const orig = W.MAX_MATCHES; W.MAX_MATCHES = 10;
    try { expect(await W.find(wv, 'x')).toMatchObject({ total: 10, capped: true }); expect(W.countText({ total: 10, active: 1, capped: true })).toBe('1/10+'); }
    finally { W.MAX_MATCHES = orig; }
  });

  it('fails loudly on a page without the highlight API, and on a long query', async () => {
    page('<p>a</p>');
    delete window.CSS; delete globalThis.CSS;
    await expect(W.find(wv, 'a')).rejects.toThrow(/cannot show highlights/);
    await expect(W.find(wv, 'x'.repeat(201))).rejects.toThrow(/at most 200/);
    await expect(W.find(null, 'a')).rejects.toThrow(/no page/);
  });

  it('inserts the colours once per page load and runs one script that holds the query only as data', async () => {
    page('<p>a</p>');
    const wv2 = { ...wv, _listeners: [], addEventListener(t, f) { this._listeners.push(f); } };
    await W.find(wv2, 'a'); await W.find(wv2, 'a');
    expect(ran.filter(x => x[0] === 'css')).toHaveLength(1);
    wv2._listeners.forEach(f => f());                                    // dom-ready: the page was reloaded
    await W.find(wv2, 'a');
    expect(ran.filter(x => x[0] === 'css')).toHaveLength(2);
    const script = ran.filter(x => x[0] === 'js').at(-1)[1];
    expect(script).toContain('{"query":"a"');
    page('<p>"); window.hacked = 1; ("</p>');
    await W.find(wv, '"); window.hacked = 1; ("');
    expect(window.hacked).toBeUndefined();
  });
});

describe('whole-word find, wiring', () => {
  const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  it('is a find-bar option behind the existing Find bar switch', () => {
    expect(src('src/renderer/index.html')).toContain('id="find-word"');
    expect(src('src/renderer/index.html')).toContain('js/whole-word-find.js');
    expect(src('src/renderer/js/tabs-nav.js')).toContain('findWholeWord: false');
    const app = src('src/renderer/js/app.js');
    expect(app).toContain('VexWholeWordFind.on()');
    expect(app).toContain("setPref('findWholeWord'");
    expect(src('src/renderer/js/webview.js')).toContain('VexWholeWordFind.clear(wv)');
  });
  it('is off by default and only available when the Find bar options are on', () => {
    delete globalThis.VexTabsNav;
    expect(W.on()).toBe(false);
    globalThis.VexTabsNav = { on: (n) => n === 'findOptions', prefs: () => ({ findWholeWord: true }) };
    expect(W.on()).toBe(true);
    globalThis.VexTabsNav = { on: () => false, prefs: () => ({ findWholeWord: true }) };
    expect(W.on()).toBe(false);
    delete globalThis.VexTabsNav;
  });
});
