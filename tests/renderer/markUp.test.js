// @vitest-environment jsdom
//
// Mark up a picture of the page — and redact what is private. Redaction must
// destroy the pixels, not cover them, or the "hidden" text is still in the
// file for anyone who looks.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { ScreenshotTool } = require('../../src/renderer/js/screenshot.js');

// A w×h RGBA image where every pixel is different (a gradient with "text").
function image(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = (x * 7) % 256; data[i + 1] = (y * 11) % 256; data[i + 2] = ((x ^ y) * 13) % 256; data[i + 3] = 255;
  }
  return data;
}
const px = (data, w, x, y) => Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('redaction', () => {
  it('every block inside the region becomes one flat colour — the detail is gone', () => {
    const w = 40, h = 40, data = image(w, h);
    ScreenshotTool.pixelate(data, w, h, { x: 0, y: 0, w: 20, h: 20 }, 10);
    const block = [];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) block.push(px(data, w, x, y).join(','));
    expect(new Set(block).size).toBe(1);
  });

  it('pixels outside the region are untouched', () => {
    const w = 40, h = 40, data = image(w, h), before = image(w, h);
    ScreenshotTool.pixelate(data, w, h, { x: 0, y: 0, w: 20, h: 20 }, 10);
    for (const [x, y] of [[20, 0], [39, 39], [0, 20], [25, 5]]) expect(px(data, w, x, y)).toEqual(px(before, w, x, y));
  });

  it('works dragged in any direction, and clips to the picture', () => {
    const w = 30, h = 30, data = image(w, h);
    const r = ScreenshotTool.pixelate(data, w, h, { x: 25, y: 25, w: -40, h: -40 }, 8);
    expect(r).toEqual({ x: 0, y: 0, w: 25, h: 25 });
  });

  it('never uses blocks so small that text survives', () => {
    const w = 20, h = 20, data = image(w, h);
    ScreenshotTool.pixelate(data, w, h, { x: 0, y: 0, w: 8, h: 8 }, 1);
    const block = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) block.push(px(data, w, x, y).join(','));
    expect(new Set(block).size).toBe(1);          // minimum block is 4 px
  });
});

describe('the tools', () => {
  it('offer redact, highlight and text alongside pen, box and arrow — labelled, with icons not glyphs', () => {
    expect(ScreenshotTool.TOOLS.map(t => t[0])).toEqual(['pen', 'highlight', 'rect', 'arrow', 'text', 'redact']);
    const src = require('fs').readFileSync(require.resolve('../../src/renderer/js/screenshot.js'), 'utf8');
    expect(src).not.toMatch(/[▭➜✕]/);
  });
});

describe('Mark Up This Page', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('captures what is on screen and opens the editor on it', async () => {
    const annotate = vi.spyOn(ScreenshotTool, 'annotate').mockImplementation(() => 'opened');
    globalThis.WebviewManager = { getActiveWebview: () => ({ capturePage: async () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AAA' }) }) };
    expect(await ScreenshotTool.markUp()).toBe('opened');
    expect(annotate).toHaveBeenCalledWith('data:image/png;base64,AAA');
    annotate.mockRestore();
  });
  it('says so when there is no page, or nothing was captured', async () => {
    globalThis.WebviewManager = { getActiveWebview: () => null };
    await expect(ScreenshotTool.markUp()).rejects.toThrow(/No page is open/);
    globalThis.WebviewManager = { getActiveWebview: () => ({ capturePage: async () => ({ isEmpty: () => true }) }) };
    await expect(ScreenshotTool.markUp()).rejects.toThrow(/could not be captured/);
  });
});
