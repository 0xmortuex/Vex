// @vitest-environment jsdom
//
// Wave 5, pages as data the person keeps: text versions of a page, in the window. How a page watch's change reaches them (only when
// switched on, only for a page that was marked), the one line on what changed, and how a diff is drawn (as text, never as markup).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let VexKept;
beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  fresh(JS + 'page-sensitivity.js');
  window.vexGuestUrl = (wv) => wv.__url;
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => true };
  globalThis.VexPlural = { count: (n, forms) => n + ' ' + (n === 1 ? forms.en[0] : forms.en[1]) };
  ({ VexKept } = fresh(JS + 'kept-common.js'));
  globalThis.VexKept = VexKept;
});
afterEach(() => {
  delete globalThis.VexKept; delete globalThis.VexPlural; delete globalThis.VexI18nUI; delete window.vex;
});

describe('a page watch keeps a page version', () => {
  let P;
  beforeEach(() => {
    ({ VexPageVersions: P } = fresh(JS + 'page-versions.js'));
    vi.spyOn(VexKept, 'call').mockResolvedValue({ ok: true, kept: true, saved: true, change: { added: 2, removed: 1 } });
  });
  const detail = { url: 'https://example.com/terms', title: 'Terms', text: 'new text of the page', first: false };

  it('is off by default, and then keeps nothing and asks nobody', async () => {
    expect(P.enabled()).toBe(false);
    await P.onSnapshot(detail);
    expect(VexKept.call).not.toHaveBeenCalled();
    await expect(P.keepHere()).rejects.toThrow(/switched off/);
    await expect(P.saveNow()).rejects.toThrow(/switched off/);
  });
  it('hands the watch\'s text to main, which keeps it only for a page that was marked', async () => {
    P.setEnabled(true);
    await P.onSnapshot(detail);
    expect(VexKept.call).toHaveBeenCalledWith('versionsSaveKept', 'https://example.com/terms', 'Terms', 'new text of the page');
    expect(window.showToast).toHaveBeenCalledWith('Since the last version: 2 words added, 1 word removed');
  });
  it('says nothing when the page was not marked or nothing changed', async () => {
    P.setEnabled(true);
    VexKept.call.mockResolvedValueOnce({ ok: true, kept: false });
    await P.onSnapshot(detail);
    VexKept.call.mockResolvedValueOnce({ ok: true, kept: true, saved: false, change: { added: 0, removed: 0 } });
    await P.onSnapshot(detail);
    expect(window.showToast).not.toHaveBeenCalled();
  });
  it('ignores a snapshot with no text', async () => {
    P.setEnabled(true);
    await P.onSnapshot({ url: 'https://example.com/terms', title: 'T', text: '' });
    expect(VexKept.call).not.toHaveBeenCalled();
  });
  it('says in one line what changed since last time', () => {
    expect(P.summaryLine(null)).toBe('First version');
    expect(P.summaryLine({ added: 0, removed: 0 })).toBe('Nothing changed since the last version');
    expect(P.summaryLine({ added: 1, removed: 5 })).toBe('Since the last version: 1 word added, 5 words removed');
  });
  it('draws a diff with added words in <ins>, removed words in <del>, and long unchanged text folded', () => {
    const V = require(JS + 'evodata-versions-core.js');
    const long = Array.from({ length: 60 }, (_, i) => 'w' + i).join(' ');
    const diff = V.wordDiff(long + ' old ' + long, long + ' new ' + long);
    const el = document.createElement('div');
    P.renderDiff(diff, el, V);
    expect([...el.querySelectorAll('ins')].map(n => n.textContent)).toEqual(['new']);
    expect([...el.querySelectorAll('del')].map(n => n.textContent)).toEqual(['old']);
    expect(el.textContent).toContain('…');
    expect(el.textContent.length).toBeLessThan(long.length);
    expect(el.querySelector('script')).toBeNull();
  });
  it('draws markup in a page as text, never as markup', () => {
    const V = require(JS + 'evodata-versions-core.js');
    const diff = V.wordDiff('a b', 'a <img src=x onerror=alert(1)> b');
    const el = document.createElement('div');
    P.renderDiff(diff, el, V);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
