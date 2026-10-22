// @vitest-environment jsdom
// The selection bar offers only the actions that make sense for the selected text, and decides it without a perceptible delay.
import { describe, it, expect } from 'vitest';
import { SelectionAIBar } from '../../src/renderer/js/selection-ai-bar.js';

const acts = (text, opts) => [...SelectionAIBar.suggest(text, opts)].sort();
const QUOTE = 'And We have established the night and the day as two symbols; and thereupon We have effaced the symbol of night and set up the light giving symbol of day, so that you might seek to obtain your Sustainer’s bounty and be aware of the passing years and of the reckoning. For clearly, most clearly, have We spelt out everything!';
const TURKISH = 'Gece ile gündüzü iki ayet kıldık; gecenin ayetini sildik, gündüzün ayetini ise görünür kıldık ki Rabbinizden bir lütuf arayasınız ve yılların sayısını ve hesabı bilesiniz. Her şeyi ayrıntılı olarak açıkladık, hem de çok açık bir biçimde.';

describe('SelectionAIBar.suggest', () => {
  it('always offers Explain, and the local one only when it is switched on', () => {
    expect(acts('word')).toContain('explain');
    expect(acts('word')).not.toContain('explain-local');
    expect(acts('word', { localOn: true })).toContain('explain-local');
  });

  it('offers Debug only for an error, and no Summarize or Translate for it', () => {
    const a = acts('TypeError: Cannot read properties of undefined (reading "map")\n    at render (app.js:42:13)', { lang: 'en' });
    expect(a).toContain('debug');
    expect(a).not.toContain('summarize');
    expect(a).not.toContain('translate');
    expect(acts('Failed to connect: ECONNREFUSED 127.0.0.1:5432')).toContain('debug');
    expect(acts('HTTP 503 service unavailable')).toContain('debug');
    expect(acts('Good afternoon, Fadi')).not.toContain('debug');
    expect(acts(QUOTE)).not.toContain('debug');
  });

  it('does not offer Summarize on a line, but does on a long text', () => {
    expect(acts('Good afternoon, Fadi')).not.toContain('summarize');
    expect(acts('The meeting moves to Thursday at ten.')).not.toContain('summarize');
    expect(acts(QUOTE)).toContain('summarize');
  });

  it('does not offer Translate for text already in your language, and does for another', () => {
    expect(acts(QUOTE, { lang: 'en' })).not.toContain('translate');
    expect(acts(TURKISH, { lang: 'en' })).toContain('translate');
    expect(acts(TURKISH, { lang: 'tr' })).not.toContain('translate');
    expect(acts(QUOTE, { lang: 'tr' })).toContain('translate');
    expect(acts('مرحبا بكم في هذا العالم الجديد', { lang: 'en' })).toContain('translate');
    expect(acts('今日は天気がいいですね', { lang: 'tr' })).toContain('translate');
  });

  it('leaves Translate out for numbers, links and code, and offers it when it cannot tell', () => {
    expect(acts('1,234.56')).not.toContain('translate');
    expect(acts('https://example.com/a?b=1')).not.toContain('translate');
    expect(acts('const total = items.reduce((a, b) => a + b, 0);\nreturn total;')).not.toContain('translate');
    expect(acts('const total = items.reduce((a, b) => a + b, 0);\nreturn total;')).not.toContain('summarize');
    expect(acts('bonjour tout le monde', { lang: 'en' })).toContain('translate');
  });

  it('offers Rewrite and Fix in a field you can edit, and Shorten for a long enough text', () => {
    expect(acts('teh cat', { editable: true })).toEqual(expect.arrayContaining(['rewrite', 'fix']));
    expect(acts('teh cat', { editable: true })).not.toContain('shorten');
    expect(acts('the quick brown fox jumps over the lazy dog and then keeps running far away', { editable: true })).toContain('shorten');
    expect(acts(QUOTE, { editable: false })).not.toContain('rewrite');
  });

  it('only reads the start of a very long selection, so it stays fast', () => {
    const huge = 'word '.repeat(2_000_000);
    const t0 = performance.now();
    SelectionAIBar.suggest(huge, { editable: true, lang: 'en' });
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('the bar', () => {
  it('shows only the suggested buttons when it opens', () => {
    document.body.innerHTML = '';
    globalThis.requestAnimationFrame = (fn) => fn();
    const webview = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    SelectionAIBar._el = null; SelectionAIBar._styled = false;
    SelectionAIBar._show(webview, QUOTE, { x: 10, y: 100, w: 200 }, false);
    const shown = [...document.querySelectorAll('#vex-selection-ai button[data-act]')].filter(b => b.style.display !== 'none').map(b => b.dataset.act);
    expect(shown).toEqual(['explain', 'summarize']);
    SelectionAIBar._show(webview, 'TypeError: x is not a function', { x: 10, y: 100, w: 200 }, false);
    const again = [...document.querySelectorAll('#vex-selection-ai button[data-act]')].filter(b => b.style.display !== 'none').map(b => b.dataset.act);
    expect(again).toEqual(['explain', 'debug']);
    expect(document.querySelector('#vex-selection-ai .vex-sel-div').style.display).toBe('none');
  });
});
