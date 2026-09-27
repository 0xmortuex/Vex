// @vitest-environment jsdom
//
// Right-clicking a picture in Gemini's image viewer gave link rows and no
// Save or Copy Image: the viewer lays a link over the picture, so Chromium
// reports "none" rather than "image". The page now finds the picture under
// the pointer itself (preload-webview.js) and the menu uses that.

import { describe, it, expect, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');

let wv;
beforeEach(() => { wv = document.createElement('webview'); });

describe('which picture the menu is about', () => {
  it("uses Chromium's answer when it saw an image", () => {
    expect(WebviewManager.contextImage({ mediaType: 'image', srcURL: 'https://a.example/p.png' }, wv)).toBe('https://a.example/p.png');
  });

  it('uses the picture the page found under a link or overlay', () => {
    WebviewManager.noteContextImage(wv, { src: 'https://lh3.googleusercontent.com/moon' });
    expect(WebviewManager.contextImage({ mediaType: 'none', linkURL: 'https://site.example/' }, wv)).toBe('https://lh3.googleusercontent.com/moon');
  });

  it('belongs to one right-click only', () => {
    WebviewManager.noteContextImage(wv, { src: 'https://a.example/p.png' });
    WebviewManager.contextImage({ mediaType: 'none' }, wv);
    expect(WebviewManager.contextImage({ mediaType: 'none' }, wv)).toBe('');
  });

  it('ignores a stale answer from an earlier right-click', () => {
    wv._vexCtxImage = { src: 'https://a.example/p.png', at: Date.now() - 10000 };
    expect(WebviewManager.contextImage({ mediaType: 'none' }, wv)).toBe('');
  });

  it('only offers addresses it can do something with', () => {
    WebviewManager.noteContextImage(wv, { src: 'javascript:alert(1)' });
    expect(WebviewManager.contextImage({ mediaType: 'none' }, wv)).toBe('');
    WebviewManager.noteContextImage(wv, { src: 'data:image/png;base64,AAAA' });
    expect(WebviewManager.contextImage({ mediaType: 'none' }, wv)).toBe('data:image/png;base64,AAAA');
  });

  it('nothing found is nothing offered', () => {
    WebviewManager.noteContextImage(wv, { src: '' });
    expect(WebviewManager.contextImage({ mediaType: 'none' }, wv)).toBe('');
  });
});
