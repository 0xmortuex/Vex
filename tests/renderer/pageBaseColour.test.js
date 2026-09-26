// @vitest-environment jsdom
//
// A 401 from an API showed a completely blank page in Vex and read fine in
// Chrome. The body was there and perfectly selectable — it was white text on
// a white page. Chromium's own JSON viewer paints no background and colours
// its text for the scheme the browser reports; with nothing behind it, that
// lands on Vex's own light surface. The same happens for a plain .txt and a
// directory listing.
//
// The fix has to be narrow: a background on <html> stops the body's
// background propagating to the canvas, so giving EVERY page one would put
// our colour through the margins of any site that styles only its body.

import { describe, it, expect } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');

describe('what to paint behind a page', () => {
  it('gives a page that paints nothing a base that matches its scheme', () => {
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: true }))
      .toEqual({ element: '#202124', inject: ':where(html){background-color:#202124}' });
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: false }))
      .toEqual({ element: '#ffffff', inject: ':where(html){background-color:#ffffff}' });
  });

  // The important half: a site that paints its own background is not touched,
  // so propagation still works and there is no border of our colour.
  it('leaves a page that paints its own background alone', () => {
    expect(WebviewManager.baseColourFor({ body: 'rgb(238, 238, 238)', html: '', dark: true }))
      .toEqual({ element: 'rgb(238, 238, 238)', inject: null });
    expect(WebviewManager.baseColourFor({ body: '', html: 'rgb(20, 20, 20)', dark: false }))
      .toEqual({ element: 'rgb(20, 20, 20)', inject: null });
  });

  it('does nothing at all when the page could not be read', () => {
    expect(WebviewManager.baseColourFor(null)).toBe(null);
    expect(WebviewManager.baseColourFor(undefined)).toBe(null);
  });

  // Zero specificity: anything the page itself sets, later, still wins.
  it('injects at a specificity the page can always beat', () => {
    const { inject } = WebviewManager.baseColourFor({ body: '', html: '', dark: true });
    expect(inject.startsWith(':where(html)')).toBe(true);
  });
});
