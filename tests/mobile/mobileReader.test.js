// @vitest-environment jsdom
//
// Reader extraction crosses a trust boundary: the script runs inside a web
// page and its result is rendered by the chrome. What matters here is that
// anything the page sends back is treated as data — including when it is not
// the shape we asked for.
import { describe, it, expect, vi } from 'vitest';

window.VexBridge = { evaluate: vi.fn() };
const { VexReader } = require('../../mobile/www/js/reader.js');

const article = {
  ok: true, title: 'A title', byline: 'A writer', published: '', words: 440,
  blocks: [{ type: 'p', text: 'First.' }, { type: 'p', text: 'Second.' }]
};

describe('reading what the page sent back', () => {
  it('parses a JSON string', () => {
    expect(VexReader.parse(JSON.stringify(article)).title).toBe('A title');
  });

  it('parses the double-encoded form a WebView sometimes returns', () => {
    expect(VexReader.parse(JSON.stringify(JSON.stringify(article))).title).toBe('A title');
  });

  it('refuses anything that is not an article', () => {
    expect(VexReader.parse('null')).toBe(null);
    expect(VexReader.parse('not json at all')).toBe(null);
    expect(VexReader.parse('"just a string"')).toBe(null);
    expect(VexReader.parse(JSON.stringify({ title: 'no blocks' }))).toBe(null);
    expect(VexReader.parse(undefined)).toBe(null);
  });

  it('does not trust a page that claims to be an object with a blocks getter', () => {
    // Whatever arrives is parsed from text, so a page cannot hand over a live
    // object — but the shape check still has to hold for odd values.
    expect(VexReader.parse(JSON.stringify({ blocks: 'not an array' }))).toBe(null);
  });
});

describe('page text for the assistant', () => {
  it('is the title and the blocks, capped', async () => {
    window.VexBridge.evaluate.mockResolvedValueOnce({ result: JSON.stringify(article) });
    const text = await VexReader.pageText('t1');
    expect(text.startsWith('A title')).toBe(true);
    expect(text).toContain('Second.');
  });

  it('respects the cap so a long page cannot blow up the request', async () => {
    const long = {
      ok: true, title: 'T', words: 90000,
      blocks: Array.from({ length: 4000 }, () => ({ type: 'p', text: 'x'.repeat(40) }))
    };
    window.VexBridge.evaluate.mockResolvedValueOnce({ result: JSON.stringify(long) });
    const text = await VexReader.pageText('t1', 1200);
    expect(text.length).toBeLessThanOrEqual(1200 + 'T\n\n'.length);
  });

  it('is empty when the page has no article', async () => {
    window.VexBridge.evaluate.mockResolvedValueOnce({ result: 'null' });
    expect(await VexReader.pageText('t1')).toBe('');
  });
});

describe('the extraction script', () => {
  it('is syntactically valid, so it cannot fail silently in a page', () => {
    expect(() => new Function('return ' + VexReader.EXTRACT)).not.toThrow();
  });

  it('skips navigation, footers and asides', () => {
    expect(VexReader.EXTRACT).toContain("closest('nav, footer, aside')");
  });
});

describe('reading time', () => {
  it('is words over a reading speed, never zero', () => {
    expect(VexReader.estimateMinutes({ words: 440 })).toBe(2);
    expect(VexReader.estimateMinutes({ words: 10 })).toBe(1);
    expect(VexReader.estimateMinutes(null)).toBe(1);
  });
});

describe('finding the article', () => {
  // jsdom has no layout, so no innerText; the extraction only needs it for the
  // blocks it keeps, where textContent is the same thing on a page like this.
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    configurable: true, get() { return this.textContent; }
  });

  it('is not won by a block of inline script, however many commas code has', () => {
    const sentence = 'The harbour was quiet that morning, and the boats sat low in the water, waiting. ';
    const code = 'var a = [' + Array.from({ length: 400 }, (unused, at) => at).join(',') + '];';
    document.body.innerHTML = '<div id="ads"><script>' + code + '</script><p>Sponsored</p></div>'
      + '<div id="story">' + Array.from({ length: 6 }, () => '<p>' + sentence.repeat(3) + '</p>').join('') + '</div>';
    // eslint-disable-next-line no-eval
    const found = VexReader.parse((0, eval)(VexReader.EXTRACT));
    expect(found.ok).toBe(true);
    expect(found.blocks.filter(block => block.type === 'p')).toHaveLength(6);
    expect(found.blocks.some(block => /var a/.test(block.text || ''))).toBe(false);
  });
});

describe('pictures in the article', () => {
  it('takes a lazy image from where it is waiting, and leaves a declared icon out', () => {
    const words = '<p>' + 'The tide came in slowly, and the gulls, as ever, complained about it. '.repeat(4) + '</p>';
    document.body.innerHTML = '<article>' + words + words
      + '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://cdn.example/harbour.jpg" alt="Harbour">'
      + '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://cdn.example/icon.png" width="16">'
      + words + '</article>';
    // eslint-disable-next-line no-eval
    const found = VexReader.parse((0, eval)(VexReader.EXTRACT));
    const images = found.blocks.filter(block => block.type === 'img').map(block => block.src);
    expect(images).toEqual(['https://cdn.example/harbour.jpg']);
  });
});
