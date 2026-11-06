// @vitest-environment jsdom
// Next / previous page with one key (js/page-nav.js): the finder against synthetic documents, the page-side source text,
// and the shortcut defaults.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs'), path = require('path');
const { VexPageNav, findAdjacentPage } = require('../../src/renderer/js/page-nav.js');

const HERE = 'https://site.test/results?q=x&page=2';
function doc(html) { document.documentElement.innerHTML = html; return document; }
const find = (html, dir = 'next', here = HERE) => findAdjacentPage(doc(html), dir, here);

describe('1. what the site says', () => {
  it('<link rel=next> and rel=prev in the head', () => {
    const h = '<head><link rel="prev" href="/results?page=1"><link rel="next" href="/results?page=3"></head><body><a href="/other">Next</a></body>';
    expect(find(h, 'next')).toMatchObject({ href: 'https://site.test/results?page=3', how: 'rel' });
    expect(find(h, 'prev')).toMatchObject({ href: 'https://site.test/results?page=1', how: 'rel' });
  });
  it('rel="previous" and a rel on an <a>, with the <link> winning when both exist', () => {
    expect(find('<body><a rel="previous" href="/p1">go</a></body>', 'prev')).toMatchObject({ href: 'https://site.test/p1', how: 'rel' });
    expect(find('<head><link rel="next" href="/head"></head><body><a rel="next" href="/body">x</a></body>')).toMatchObject({ href: 'https://site.test/head' });
    expect(find('<body><a rel="next nofollow" href="/body">x</a></body>')).toMatchObject({ href: 'https://site.test/body' });
  });
  it('ignores a rel that points at the page itself, or at something that is not a web page', () => {
    expect(find('<head><link rel="next" href="' + HERE + '#top"></head>')).toBeNull();
    expect(find('<body><a rel="next" href="javascript:void(0)">x</a><a rel="next" href="ftp://x/y">y</a></body>')).toBeNull();
  });
});

describe('2. the words on the link', () => {
  const body = (inner) => '<body>' + inner + '</body>';
  it.each([
    ['Next', 'next'], ['Next page', 'next'], ['Next Page \u00bb', 'next'], ['Older posts', 'next'], ['Sonraki', 'next'], ['Sonraki Sayfa', 'next'],
    ['\u0130leri', 'next'], ['ileri', 'next'], ['\u00bb', 'next'], ['\u203a', 'next'], ['&gt;', 'next'], ['&rarr;', 'next'], ['Next 25', 'next'],
    ['Previous', 'prev'], ['Prev', 'prev'], ['\u00d6nceki', 'prev'], ['\u00d6nceki Sayfa', 'prev'], ['Geri', 'prev'], ['\u00ab', 'prev'], ['\u2039', 'prev'],
    ['Newer posts', 'prev'], ['&lt;', 'prev'], ['\u2190 Previous', 'prev'],
  ])('%s goes %s', (label, dir) => {
    const r = find(body('<a href="/other">Home</a><a href="/go">' + label + '</a>'), dir);
    expect(r).toMatchObject({ href: 'https://site.test/go', how: 'text' });
  });
  it('reads an icon-only link from its aria-label, title or image alt', () => {
    expect(find(body('<a href="/a" aria-label="Sonraki sayfa"><svg></svg></a>'))).toMatchObject({ href: 'https://site.test/a' });
    expect(find(body('<a href="/b" title="Previous page"><i></i></a>'), 'prev')).toMatchObject({ href: 'https://site.test/b' });
    expect(find(body('<a href="/c"><img alt="Next"></a>'))).toMatchObject({ href: 'https://site.test/c' });
  });
  it('does not take a link that only mentions the word', () => {
    for (const label of ['Back to top', 'Geri d\u00f6n', 'Next-generation widgets', 'Previously on the show', 'Forward looking statements', 'Go back'])
      expect(find(body('<a href="/x">' + label + '</a>'), label.startsWith('Prev') || label.startsWith('Geri') || label.startsWith('Go back') || label.startsWith('Back') ? 'prev' : 'next')).toBeNull();
  });
  it('uses the class when the words are missing (WordPress), but not on a carousel', () => {
    expect(find(body('<a class="next page-numbers" href="/wp2">\u2192</a>'.replace('\u2192', '')))).toMatchObject({ href: 'https://site.test/wp2', how: 'class' });
    expect(find(body('<div class="swiper"><a class="swiper-next" href="/slide">.</a></div>'))).toBeNull();
    expect(find(body('<a class="slick-next" href="/slide">.</a>'))).toBeNull();
  });
  it('prefers the one in a pagination block over a loose one', () => {
    const r = find(body('<a href="/loose">Next</a><nav class="pagination"><a href="/real">Next</a></nav>'));
    expect(r.href).toBe('https://site.test/real');
  });
  it('skips a link the page hides', () => {
    expect(find(body('<a href="/h" hidden>Next</a><a href="/v" aria-hidden="true">Next</a><a href="/ok">Next</a>')).href).toBe('https://site.test/ok');
  });
  it('does not choose the page it is already on', () => {
    expect(find(body('<a href="' + HERE + '">Next</a>'))).toBeNull();
  });
});

describe('3. numbered pagination', () => {
  const pager = (items) => '<body><ul class="pager">' + items + '</ul></body>';
  it('goes to the number after the current one (current marked by class)', () => {
    const h = pager('<li><a href="?page=1">1</a></li><li class="active"><a href="?page=2">2</a></li><li><a href="?page=3">3</a></li><li><a href="?page=4">4</a></li>');
    expect(find(h, 'next')).toMatchObject({ href: 'https://site.test/results?page=3', how: 'numbered', label: '3' });
    expect(find(h, 'prev')).toMatchObject({ href: 'https://site.test/results?page=1', how: 'numbered' });
  });
  it('current as aria-current, or as the one number that is not a link', () => {
    expect(find(pager('<li><a href="/1">1</a></li><li><a aria-current="page" href="/2">2</a></li><li><a href="/3">3</a></li>')).href).toBe('https://site.test/3');
    expect(find(pager('<li><a href="/1">1</a></li><li><a href="/2">2</a></li><li><b>3</b></li><li><a href="/4">4</a></li>'), 'next', 'https://x.test/y').href).toBe('https://x.test/4');
  });
  it('current from the address when nothing in the page marks it', () => {
    const h = pager('<li><a href="/p/1">1</a></li><li><a href="/p/2">2</a></li><li><a href="/p/3">3</a></li>');
    expect(find(h, 'next', 'https://site.test/list?page=1').href).toBe('https://site.test/p/2');
    expect(find(h, 'next', 'https://site.test/list/page/2/').href).toBe('https://site.test/p/3');
  });
  it('says nothing at the end, and when it cannot tell which number is current', () => {
    const last = pager('<li><a href="/1">1</a></li><li><a href="/2">2</a></li><li class="current"><span>3</span></li>');
    expect(find(last, 'next')).toBeNull();
    expect(find(pager('<li><a href="/1">1</a></li><li><a href="/2">2</a></li><li><a href="/3">3</a></li>'), 'next', 'https://x.test/')).toBeNull();
  });
  it('does not mistake a list of two numbers or unrelated numbers for pagination', () => {
    expect(find('<body><p><a href="/a">1</a> <a href="/b">2</a></p></body>', 'next', 'https://x.test/a')).toBeNull();
    expect(find('<body><p>no links here</p></body>')).toBeNull();
  });
  it('words win over numbers', () => {
    const h = pager('<li><a href="/1">1</a></li><li class="active"><span>2</span></li><li><a href="/3">3</a></li><li><a href="/more">Next</a></li>');
    expect(find(h, 'next', 'https://x.test/y')).toMatchObject({ href: 'https://x.test/more', how: 'text' });
  });
});

describe('the page-side source text', () => {
  it('runs on its own and answers the same as the function', () => {
    document.documentElement.innerHTML = '<body><nav class="pagination"><a href="/n">Sonraki</a></nav></body>';
    const run = new Function('document', 'location', 'return ' + VexPageNav.script('next'));
    expect(run(document, { href: HERE })).toEqual(findAdjacentPage(document, 'next', HERE));
    expect(run(document, { href: HERE }).href).toBe('https://site.test/n');
  });
  it('refuses a direction it does not know', () => {
    expect(() => VexPageNav.script('sideways')).toThrow();
  });
  it('keeps only a plain web address from what the page answered', () => {
    expect(VexPageNav.accept({ href: 'https://a.test/x', how: 'rel', label: 'n' })).toMatchObject({ href: 'https://a.test/x', how: 'rel' });
    for (const bad of [null, 'x', {}, { href: 'javascript:alert(1)' }, { href: 'file:///C:/x' }, { href: 'https://a.test/' + 'a'.repeat(9000) }, { href: 5 }]) expect(VexPageNav.accept(bad)).toBeNull();
    expect(VexPageNav.accept({ href: 'https://a.test/', how: 'evil' }).how).toBe('text');
  });
});

describe('go', () => {
  let nav;
  beforeEach(() => {
    window.showToast = vi.fn();
    nav = vi.fn();
    globalThis.WebviewManager = { getActiveWebview: () => ({ _attached: true, executeJavaScript: vi.fn(async () => globalThis.__answer) }), navigate: nav };
    globalThis.NavLock = { blocked: () => false };
  });
  it('opens what it found in this tab', async () => {
    globalThis.__answer = { href: 'https://a.test/p3', how: 'rel', label: '3' };
    expect(await VexPageNav.go('next')).toBe(true);
    expect(nav).toHaveBeenCalledWith('https://a.test/p3');
  });
  it('says so when there is none, in the direction asked', async () => {
    globalThis.__answer = null;
    expect(await VexPageNav.go('next')).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('No next page found');
    await VexPageNav.go('prev');
    expect(window.showToast).toHaveBeenCalledWith('No previous page found');
    expect(nav).not.toHaveBeenCalled();
  });
  it('does not follow an address the page made up that is not a web page', async () => {
    globalThis.__answer = { href: 'javascript:alert(1)', how: 'rel' };
    expect(await VexPageNav.go('next')).toBe(false);
    expect(nav).not.toHaveBeenCalled();
  });
  it('does nothing while a side panel covers the page', async () => {
    globalThis.NavLock = { blocked: () => true };
    expect(await VexPageNav.go('next')).toBe(false);
    expect(nav).not.toHaveBeenCalled();
  });
  it('reports a page that cannot be searched', async () => {
    globalThis.WebviewManager.getActiveWebview = () => ({ _attached: true, executeJavaScript: vi.fn(async () => { throw new Error('gone'); }) });
    window.VexProblems = { note: vi.fn() };
    expect(await VexPageNav.go('next')).toBe(false);
    expect(window.VexProblems.note).toHaveBeenCalled();
  });
});

describe('the keys', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/shortcuts-registry.js'), 'utf8');
  it('are Alt+PageDown / Alt+PageUp, run the commands, and nothing else uses those keys', () => {
    expect(src).toMatch(/'page-next':\s*\{ default: 'Alt\+PageDown'[^}]*cmd: 'page-next'/);
    expect(src).toMatch(/'page-prev':\s*\{ default: 'Alt\+PageUp'[^}]*cmd: 'page-prev'/);
    const defaults = [...src.matchAll(/default: '([^']+)'/g)].map(m => m[1]);
    expect(defaults.filter(d => d === 'Alt+PageDown')).toHaveLength(1);
    expect(defaults.filter(d => d === 'Alt+PageUp')).toHaveLength(1);
    expect(src).not.toMatch(/FIXED_KEYS[^;]*Alt\+Page/);
  });
  it('the Back and Forward keys are untouched', () => {
    expect(src).toMatch(/'Alt\+Left': 'Back', 'Alt\+Right': 'Forward'/);
  });
});
