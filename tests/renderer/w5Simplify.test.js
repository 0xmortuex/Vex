// @vitest-environment jsdom
// T3-086: reader view "Wording" menu (opt in), rewritten by the local model only.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let T;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  ({ VexTos: T } = fresh(JS + 'tos-highlight.js'));
  globalThis.VexTos = T;
});

describe('simplify prompt and parsing', () => {
  it('numbers the paragraphs and names the level', () => {
    const p = T.simplifyPrompt('simple', ['One.', 'Two.']);
    expect(p).toContain('12-year-old');
    expect(p).toContain('[1] One.');
    expect(p).toContain('[2] Two.');
  });
  it('refuses an unknown level', () => {
    expect(() => T.simplifyPrompt('pirate', ['x'])).toThrow(/Unknown wording level/);
  });
  it('maps the numbered answer back and leaves a skipped paragraph null', () => {
    expect(T.parseNumbered('[1] First plain.\n[3] Third plain.\nmore', 3)).toEqual(['First plain.', null, 'Third plain.\nmore']);
    expect(T.parseNumbered('', 2)).toEqual([null, null]);
  });
});

describe('switch', () => {
  it('is off by default and refuses to run while off', async () => {
    expect(T.simplifyEnabled()).toBe(false);
    await expect(T.simplifyReader('t1', 'plain')).rejects.toThrow(/switched off/);
    T.setSimplifyEnabled(true);
    expect(T.simplifyEnabled()).toBe(true);
  });
  it('refuses the original level as a rewrite level', async () => {
    T.setSimplifyEnabled(true);
    await expect(T.simplifyReader('t1', 'original')).rejects.toThrow(/Unknown wording level/);
  });
});

describe('reader page', () => {
  it('draws the Wording menu only when asked, with Original first', () => {
    const { ReadingMode } = fresh(JS + 'reading-mode.js');
    const article = { title: 'T', blocks: [{ tag: 'P', runs: [{ t: 'A paragraph that is long enough to be rewritten by the model, surely.' }] }], wordCount: 10 };
    const off = ReadingMode.buildHtml(article, 'https://e.com/a', null, {});
    expect(off).not.toContain('id="vr-level"');
    const on = ReadingMode.buildHtml({ ...article, simplifyLevels: true }, 'https://e.com/a', null, {});
    expect(on).toContain('id="vr-level"');
    expect(on.indexOf('value="original"')).toBeLessThan(on.indexOf('value="plain"'));
    expect(on).toContain('reader-simplify');
  });
  it('restores the original and reuses a finished rewrite inside the page, with no model call', () => {
    const { ReadingMode } = fresh(JS + 'reading-mode.js');
    const long = 'A paragraph that is long enough to be rewritten by the model, surely it is.';
    const article = { title: 'T', blocks: [{ tag: 'P', runs: [{ t: long }] }], wordCount: 10, simplifyLevels: true };
    const html = ReadingMode.buildHtml(article, 'https://e.com/a', null, {});
    const doc = new DOMParser().parseFromString(html, 'text/html');
    document.body.innerHTML = doc.body.innerHTML.replace(/<script>[\s\S]*?<\/script>/g, '');
    const code = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    const sent = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m) => sent.push(String(m)));
    // eslint-disable-next-line no-new-func
    new Function(code)();
    const list = window.__vrCollect();
    expect(list.length).toBe(1);
    window.__vrPut('plain', list[0].i, 'Short version.');
    const sel = document.getElementById('vr-level');
    sel.value = 'plain'; sel.dispatchEvent(new Event('change'));
    expect(document.querySelector('[data-vr-i="0"]').textContent).toBe('Short version.');
    expect(sent.some(s => s.includes('reader-simplify'))).toBe(false);
    sel.value = 'original'; sel.dispatchEvent(new Event('change'));
    expect(document.querySelector('[data-vr-i="0"]').textContent).toBe(long);
    sel.value = 'simple'; sel.dispatchEvent(new Event('change'));
    expect(sent.some(s => s.includes('reader-simplify') && s.includes('simple'))).toBe(true);
    spy.mockRestore();
  });
  it('passes the command to VexTos', () => {
    const { ReadingMode } = fresh(JS + 'reading-mode.js');
    const spy = vi.spyOn(T, 'simplifyReader').mockResolvedValue({ done: 1, skipped: 0 });
    expect(ReadingMode.onReaderCommand('t1', { type: 'reader-simplify', level: 'plain' })).toBe(true);
    expect(spy).toHaveBeenCalledWith('t1', 'plain');
  });
});
