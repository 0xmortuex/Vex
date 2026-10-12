// @vitest-environment jsdom
// Highlights: reader-view keys (RD1), text-quote anchors across formatting
// (RD2) and a note showing at once (RD13).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/renderer/js/collection-store.js';
import '../../src/renderer/js/reading-mode.js';
import { Annotations, vexHighlightPageLib } from '../../src/renderer/js/annotations.js';

const readerUrl = (src) => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!DOCTYPE html><html><head><meta name="vex-reading-source" content="${src}"></head><body>x</body></html>`);

// A webview stand-in that runs injected code against this jsdom document.
function fakeWebview(url) {
  return {
    getURL: () => url,
    _navigationGeneration: 1,
    // eslint-disable-next-line no-eval
    executeJavaScript: vi.fn(async (js) => (0, eval)(js)),
  };
}

function select(startNode, startOff, endNode, endOff) {
  const r = document.createRange();
  r.setStart(startNode, startOff); r.setEnd(endNode, endOff);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  Annotations.store = {}; Annotations._baseline = {};
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v);
  globalThis.vexPromptModal = undefined;
});

describe('highlights across formatting (RD2)', () => {
  it('a highlight crossing bold and a paragraph comes back after reload', async () => {
    const html = '<p>zero alpha one <b>beta</b> two</p><p>gamma three end</p>';
    document.body.innerHTML = html;
    const here = location.href;
    const wv = fakeWebview(here);
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    globalThis.TabManager = { getActiveTab: () => ({ url: here, title: 'Fox' }) };
    const p1 = document.querySelector('p').firstChild;           // "zero alpha one "
    const p2 = document.querySelectorAll('p')[1].firstChild;     // "gamma three end"
    select(p1, 5, p2, 11);                                       // "alpha one beta two gamma three"
    await Annotations.highlight('yellow');
    const saved = Annotations.forUrl(here);
    expect(saved).toHaveLength(1);
    expect(saved[0].quote.exact).toBe('alphaonebetatwogammathree');
    expect(document.querySelectorAll('mark.vexhl').length).toBeGreaterThan(1);
    // The paragraphs are still two paragraphs (the old single extractContents
    // mark pulled half of each into one inline element).
    expect(document.querySelectorAll('body > p')).toHaveLength(2);

    // Reload: fresh DOM, apply from storage.
    document.body.innerHTML = html;
    Annotations.applyTo(wv, here);
    await Promise.resolve(); await Promise.resolve();
    const marks = [...document.querySelectorAll('mark.vexhl')];
    expect(marks.length).toBeGreaterThan(1);
    expect(marks.map(m => m.textContent).join('').replace(/\s+/g, '')).toBe('alphaonebetatwogammathree');
  });

  it('picks the occurrence whose surroundings match, not the first', () => {
    document.body.innerHTML = '<p>the cat sat. a dog ran. the cat ran.</p>';
    const L = vexHighlightPageLib();
    const map = L.textMap(document.body);
    const r = L.find(map, { exact: 'thecat', prefix: 'dogran.', suffix: 'ran.' });
    expect(map.text.slice(0, r.start)).toBe('thecatsat.adogran.');
  });

  it('gives a highlight saved before anchors one from its text, once', () => {
    localStorage.setItem('vex.annotations', JSON.stringify({ 'https://a.test/p': [{ id: 'h1', text: 'alpha one\nbeta', color: 'yellow', note: '', at: 1 }] }));
    Annotations.init();
    expect(Annotations.store['https://a.test/p'][0].quote).toEqual({ exact: 'alphaonebeta', prefix: '', suffix: '' });
    expect(JSON.parse(localStorage.getItem('vex.annotations'))['https://a.test/p'][0].quote.exact).toBe('alphaonebeta');
  });

  it('removing a highlight across formatting removes every piece of it', async () => {
    document.body.innerHTML = '<p>one <b>two</b> three</p>';
    const here = location.href;
    const wv = fakeWebview(here);
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    globalThis.TabManager = { getActiveTab: () => ({ url: here, title: 'T' }) };
    const p = document.querySelector('p');
    select(p.firstChild, 0, p.lastChild, 6);
    await Annotations.highlight('yellow');
    const id = Annotations.forUrl(here)[0].id;
    await Annotations.remove(here, id);
    expect(document.querySelectorAll('mark.vexhl')).toHaveLength(0);
    expect(document.body.innerHTML).toBe('<p>one <b>two</b> three</p>');
  });
});

describe('highlights in reading mode (RD1)', () => {
  it('are stored under the page the reader was made from, not the data: page', async () => {
    const src = 'https://news.test/article';
    const dataUrl = readerUrl(src);
    const wv = fakeWebview(dataUrl);
    wv.executeJavaScript = vi.fn(async () => JSON.stringify({ text: 'alpha', quote: { exact: 'alpha', prefix: '', suffix: '' } }));
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    globalThis.TabManager = { getActiveTab: () => ({ url: src, title: 'Story' }) };
    await Annotations.highlight('yellow');
    expect(Object.keys(Annotations.store)).toEqual([Annotations._key(src)]);
    expect(Annotations.store[Annotations._key(src)][0].url).toBe(src);
    // The page check inside the reader is against the reader's own address.
    expect(wv.executeJavaScript.mock.calls[0][0]).toContain(JSON.stringify(dataUrl));
  });

  it('are re-applied on the reader page', () => {
    const src = 'https://news.test/article';
    const dataUrl = readerUrl(src);
    Annotations.store[Annotations._key(src)] = [{ id: 'h1', text: 'alpha', quote: { exact: 'alpha' }, color: 'yellow', url: src }];
    const wv = fakeWebview(dataUrl);
    wv.executeJavaScript = vi.fn(async () => {});
    Annotations.applyTo(wv, src);
    expect(wv.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(wv.executeJavaScript.mock.calls[0][0]).toContain(`location.href!==${JSON.stringify(dataUrl)}`);
  });

  it('old data:-keyed entries move to their source page on load', () => {
    const src = 'https://news.test/article';
    const dataUrl = readerUrl(src);
    const badKey = Annotations._key(dataUrl);
    expect(badKey.startsWith('nulltext/html')).toBe(true);
    localStorage.setItem('vex.annotations', JSON.stringify({
      [badKey]: [{ id: 'h1', text: 'alpha', color: 'yellow', note: '', at: 1, url: dataUrl }],
      [dataUrl.slice(0, 40)]: [{ id: 'h2', text: 'lost', color: 'yellow', note: '', at: 2, url: 'data:text/html,nothing' }],
    }));
    Annotations.init();
    const stored = JSON.parse(localStorage.getItem('vex.annotations'));
    expect(Object.keys(stored)).toEqual([Annotations._key(src)]);
    expect(stored[Annotations._key(src)][0]).toMatchObject({ id: 'h1', url: src });
  });
});

describe('a highlight note (RD13)', () => {
  it('shows on the page at once, without a reload', async () => {
    document.body.innerHTML = '<p>alpha beta gamma</p>';
    const here = location.href;
    const wv = fakeWebview(here);
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    globalThis.TabManager = { getActiveTab: () => ({ url: here, title: 'T' }) };
    const t = document.querySelector('p').firstChild;
    select(t, 6, t, 10);
    await Annotations.highlight('yellow');
    const id = Annotations.forUrl(here)[0].id;
    globalThis.vexPromptModal = vi.fn(async () => 'remember this');
    await Annotations.addNote(here, id);
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector('mark.vexhl').title).toBe('Note: remember this');
  });
});
