// @vitest-environment jsdom
//
// The AI panel's look, as far as jsdom can say anything about it (what Chromium
// computes from the CSS is checked in the real app: jsdom cannot resolve var()
// or color-mix()). What is held here is the part that is plain text and plain
// logic:
//   * the stylesheet uses theme tokens only: no colour of its own, no font
//     stack of its own, no gradient, no blur, no noise;
//   * the skins and the Glass look leave the panel alone (it is a flat surface);
//   * a code block gets a bar with Copy, and Copy copies the code;
//   * a persona that holds a typed glyph (an emoji) is drawn with the default
//     icon, never the glyph;
//   * every string the redesign added has its Turkish.

import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
globalThis.VexFeatures = VexFeatures; global.window.VexFeatures = VexFeatures;
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');
const { VexMarkdown } = require('../../src/renderer/js/vex-markdown.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');

const ROOT = path.join(__dirname, '..', '..', 'src', 'renderer');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the stylesheet is built from tokens', () => {
  const css = stripComments(read('css/ai-panel.css'));

  it('has no hard-coded colour', () => {
    // Hex, rgb() and hsl() are all someone else's colour. Tokens, color-mix() and the keywords are not.
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([]);
    expect(css.match(/\brgba?\(/g) || []).toEqual([]);
    expect(css.match(/\bhsla?\(/g) || []).toEqual([]);
  });

  it('has no font stack of its own', () => {
    for (const m of css.matchAll(/font-family:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      expect(v, 'font-family: ' + v).toMatch(/^(inherit(\s*!important)?|var\(--vex-font-(base|display|mono)[^;]*\))$/);
    }
  });

  it('is flat: no gradient, no blur, no noise', () => {
    expect(css).not.toMatch(/gradient\(/);
    expect(css).not.toMatch(/backdrop-filter|filter:\s*blur/);
    expect(css).not.toMatch(/feTurbulence|data:image/);
  });

  it('draws code in the theme monospace font and text in the theme font', () => {
    expect(css).toMatch(/#ai-panel\s*\{[^}]*font-family:\s*var\(--vex-font-base\)/);
    expect(css).toMatch(/--vex-font-mono/);
  });

  it('keeps every control at least 28px', () => {
    expect(css).toMatch(/--ai-ctl:\s*28px/);
  });

  it('does not strip the keyboard focus ring without drawing another', () => {
    // The text area hides its own ring only because the card around it draws one.
    expect(css).toMatch(/\.ai-input-wrapper:has\(#ai-input:focus-visible\)\s*\{[^}]*outline:\s*2px/);
  });

  it('is not given a texture, a halo or a frost by another sheet', () => {
    const skins = stripComments(read('css/skins.css'));
    expect(skins).not.toMatch(/#ai-panel/);
    const glass = stripComments(read('css/gui-glass.css'));
    expect(glass).not.toMatch(/#ai-panel/);
  });

  it('the agent cards use no font stack or colour of their own either', () => {
    const agent = stripComments(read('css/agent.css'));
    expect(agent).not.toMatch(/Outfit|JetBrains/);
    expect(agent).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('the markup draws no glyph as an icon', () => {
  it('has no entity or character for an arrow, a triangle, a tick, a star or an emoji inside the panel', () => {
    const html = read('index.html');
    const a = html.indexOf('<div id="ai-panel"');
    const b = html.indexOf('<!-- Workspace Loading Overlay -->');
    expect(a).toBeGreaterThan(0);
    const panel = html.slice(a, b);
    expect(panel).not.toMatch(/&#\d+;|&#x[0-9a-f]+;|&[a-z]+arr;|&check;|&starf?;/i);
    expect(panel).not.toMatch(/[←-⇿■-◿☀-➿⬀-⯿]|\p{Extended_Pictographic}/u);
    // the title mark comes from the icon set, not from an inline drawing
    expect(panel).toMatch(/id="ai-title-ico" data-ico="sparkles"/);
  });

  it('every icon the panel asks for by name exists', () => {
    const html = read('index.html');
    const panel = html.slice(html.indexOf('<div id="ai-panel"'), html.indexOf('<!-- Workspace Loading Overlay -->'));
    const names = [...panel.matchAll(/data-ico="([a-z-]+)"/g)].map(m => m[1]);
    expect(names.length).toBeGreaterThan(8);
    for (const n of names) expect(VexIcons.has(n), n).toBe(true);
  });
});

describe('code blocks', () => {
  beforeEach(() => {
    window.VexMarkdown = VexMarkdown;
    globalThis.VexMarkdown = VexMarkdown;
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    globalThis.escapeHtml = window.escapeHtml;
    document.body.innerHTML = '<div id="ai-panel"><div id="ai-messages"></div></div>';
  });

  it('wraps a fenced block in a bar with its language and a Copy button', () => {
    const html = AIPanel._md('Here:\n\n```python\nprint(1)\n```\n');
    document.getElementById('ai-messages').innerHTML = html;
    const box = document.querySelector('.ai-code');
    expect(box).not.toBeNull();
    expect(box.querySelector('.ai-code-lang').textContent).toBe('python');
    expect(box.querySelector('.ai-code-copy')).not.toBeNull();
    expect(box.querySelector('pre code').textContent).toBe('print(1)');
  });

  it('names a block with no language "code"', () => {
    const html = AIPanel._wrapCode(VexMarkdown.render('```\nx\n```'));
    expect(html).toContain('<span class="ai-code-lang">code</span>');
  });

  it('leaves text without code exactly as it was', () => {
    const html = VexMarkdown.render('just **words**');
    expect(AIPanel._wrapCode(html)).toBe(html);
  });

  it('does not open a block it never closes (a streaming answer)', () => {
    const html = AIPanel._wrapCode(VexMarkdown.render('so far:\n\n```js\nlet a = 1;'));
    const d = document.createElement('div'); d.innerHTML = html;
    expect(d.querySelectorAll('.ai-code').length).toBe(d.querySelectorAll('pre').length);
  });

  it('Copy puts the code, and only the code, on the clipboard', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    document.getElementById('ai-messages').innerHTML = AIPanel._md('```sh\nls -la\n```');
    const btn = document.querySelector('.ai-code-copy');
    await AIPanel._onCodeCopy({ target: btn.querySelector('span'), stopPropagation() {} });
    expect(write).toHaveBeenCalledWith('ls -la');
    expect(btn.classList.contains('done')).toBe(true);
  });

  it('ignores a click that is not on a Copy button', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    await AIPanel._onCodeCopy({ target: document.body, stopPropagation() {} });
    expect(write).not.toHaveBeenCalled();
  });
});

describe('icons and the empty chat', () => {
  it('draws a persona that holds an emoji with the default mark, never the glyph', () => {
    const svg = AIPanel._personaIcon({ icon: '\u{1F916}' }, 14);
    expect(svg).toMatch(/^<svg/);
    expect(svg).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(AIPanel._personaIcon({ icon: 'flask' }, 14)).toMatch(/^<svg/);
  });

  it('the empty chat has a mark, a title and the hint', () => {
    const d = document.createElement('div'); d.innerHTML = AIPanel._emptyHtml();
    expect(d.querySelector('.ai-empty-ico svg')).not.toBeNull();
    expect(d.querySelector('.ai-empty-title').textContent).toBe('How can I help?');
    expect(d.querySelector('.ai-empty-hint').textContent).toMatch(/Ask anything about the current page/);
  });

  it('a failure gets a warning mark, the reason and a Retry', () => {
    document.body.innerHTML = '<div id="ai-messages"></div>';
    AIPanel._addError('503', () => {});
    const el = document.querySelector('.ai-msg.error');
    expect(el.querySelector('.ai-error-ico svg')).not.toBeNull();
    expect(el.querySelector('.ai-error-text').textContent).toBe('Error: 503');
    expect(el.querySelector('.ai-retry-btn')).not.toBeNull();
  });
});

describe('Turkish', () => {
  const T = VexI18nUI.TABLE.tr;
  it('has every string the redesign added', () => {
    for (const k of ['How can I help?', 'Copy code', 'Which tabs the AI reads', 'Talking about:', 'Recent chats', 'New chat', 'Summarize', 'Compare tabs', 'Organize tabs', 'Ask anything about this page…', 'Manage personas', 'Approve manually', 'Plan first', 'Auto-approve']) {
      expect(T[k], k).toBeTruthy();
    }
  });

  it('translates the panel furniture and leaves the conversation alone', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    document.body.innerHTML = '<div id="ai-panel"><div class="ai-header"><span class="ai-context-label">Talking about:</span></div>'
      + '<div class="ai-messages" id="ai-messages"><div class="ai-msg user"><div class="ai-msg-content">Summarize</div></div></div>'
      + '<div class="ai-quick-actions"><button class="ai-quick-btn"><span class="ai-ico"></span>Summarize</button></div></div>';
    VexI18nUI.apply();
    expect(document.querySelector('.ai-context-label').textContent).toBe('Konuşulan sekme:');
    expect(document.querySelector('.ai-quick-btn').textContent).toBe('Özetle');
    // what the person typed is never rewritten, even when it equals a phrase in the table
    expect(document.querySelector('.ai-msg-content').textContent).toBe('Summarize');
    localStorage.removeItem('vex.lang');
  });
});
