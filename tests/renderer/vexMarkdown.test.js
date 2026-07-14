// Unit tests for the sanitized markdown renderer (js/vex-markdown.js).
// Follows the smartSearchbar.test.js pattern: import the pure function,
// assert on strings — no DOM, no storage, no network.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/renderer/js/vex-markdown.js';

describe('sanitization', () => {
  it('escapes raw HTML tags', () => {
    const out = render('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes HTML inside emphasis and headings', () => {
    const out = render('# <script>evil</script>\n**<b>x</b>**');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<b>');
  });

  it('escapes HTML inside fenced code blocks', () => {
    const out = render('```html\n<div onclick="x()">hi</div>\n```');
    expect(out).not.toContain('<div onclick');
    expect(out).toContain('&lt;div');
  });

  it('refuses non-http(s) link protocols', () => {
    const out = render('[evil](javascript:alert(1)) [ok](https://a.com)');
    expect(out).not.toContain('href="javascript:');
    expect(out).toContain('href="https://a.com"');
  });

  it('strips sentinel control chars from input so they cannot address the stash', () => {
    const out = render('a \u0000 0 \u0000 b `code`');
    expect(out).not.toContain('\u0000');
    expect(out).toContain('<code');
  });
});

describe('inline markdown', () => {
  it('renders bold, italic, and inline code', () => {
    const out = render('**b** *i* `c`');
    expect(out).toContain('<strong>b</strong>');
    expect(out).toContain('<em>i</em>');
    expect(out).toContain('<code class="vex-md-code">c</code>');
  });

  it('does not treat markdown markers inside inline code', () => {
    const out = render('`**not bold**`');
    expect(out).not.toContain('<strong>');
    expect(out).toContain('**not bold**');
  });

  it('renders [text](url) links with the interceptable class', () => {
    const out = render('[Docs](https://example.com/a?b=1)');
    expect(out).toContain('<a href="https://example.com/a?b=1" class="vex-md-link" rel="noopener">Docs</a>');
  });

  it('autolinks bare URLs', () => {
    const out = render('see https://example.com/page.');
    expect(out).toContain('href="https://example.com/page"');
    expect(out).toContain('</a>.');
  });

  it('leaves plain numbers alone (placeholder sentinels must not collide)', () => {
    expect(render('I have 3 cats and 12 dogs')).toContain('I have 3 cats and 12 dogs');
  });
});

describe('block markdown', () => {
  it('renders headings h1-h4 with classes', () => {
    const out = render('# One\n#### Four');
    expect(out).toContain('<h1 class="vex-md-h vex-md-h1">One</h1>');
    expect(out).toContain('<h4 class="vex-md-h vex-md-h4">Four</h4>');
  });

  it('renders unordered and ordered lists', () => {
    const out = render('- a\n- b\n\n1. x\n2. y');
    expect(out).toContain('<ul class="vex-md-list"><li>a</li><li>b</li></ul>');
    expect(out).toContain('<ol class="vex-md-list"><li>x</li><li>y</li></ol>');
  });

  it('renders fenced code with language attr and preserved newlines', () => {
    const out = render('```js\nconst a = 1;\nconst b = 2;\n```');
    expect(out).toContain('data-lang="js"');
    expect(out).toContain('const a = 1;\nconst b = 2;');
  });

  it('renders blockquotes', () => {
    expect(render('> quoted')).toContain('<blockquote class="vex-md-quote">quoted</blockquote>');
  });

  it('renders pipe tables with header and body', () => {
    const out = render('| Name | Age |\n|------|-----|\n| Ada | 36 |');
    expect(out).toContain('<th>Name</th>');
    expect(out).toContain('<td>Ada</td>');
    expect(out).toContain('vex-md-table-wrap');
  });

  it('joins consecutive paragraph lines with <br> and splits on blank lines', () => {
    const out = render('line one\nline two\n\nsecond para');
    expect(out).toContain('<p class="vex-md-p">line one<br>line two</p>');
    expect(out).toContain('<p class="vex-md-p">second para</p>');
  });

  it('handles null/empty input', () => {
    expect(render(null)).toBe('');
    expect(render('')).toBe('');
  });
});
