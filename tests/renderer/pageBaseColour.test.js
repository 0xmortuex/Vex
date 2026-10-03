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

const DARK = { element: '#202124', inject: ':where(html){background-color:#202124}' };
const WHITE = { element: '#ffffff', inject: ':where(html){background-color:#ffffff}' };

describe('what to paint behind a page', () => {
  // The values below are what Chromium 148 in Vex really reported for each
  // kind of page (probe, 2026-10-03).
  it('gives the JSON and text viewers a dark base in dark mode (their text is white)', () => {
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: true, ink: 'rgb(255, 255, 255)', scheme: 'normal ' })).toEqual(DARK);
  });

  it('gives the same viewers a white base in light mode', () => {
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: false, ink: 'rgb(0, 0, 0)', scheme: 'normal ' })).toEqual(WHITE);
  });

  // The bug: <p>hi</p> in dark mode came out black on #202124. Chrome gives
  // a page that never opted into dark a white canvas.
  it('gives an ordinary page a white base even when dark mode is reported', () => {
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: true, ink: 'rgb(0, 0, 0)', scheme: 'normal ' })).toEqual(WHITE);
  });

  it('follows a page that declared light dark', () => {
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: true, ink: 'rgb(255, 255, 255)', scheme: 'normal light dark' })).toEqual(DARK);
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: false, ink: 'rgb(0, 0, 0)', scheme: 'normal light dark' })).toEqual(WHITE);
  });

  // color-scheme: dark draws white text even in light mode; a white base put
  // it on white.
  it('gives a color-scheme: dark page a dark base in light mode too', () => {
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: false, ink: 'rgb(255, 255, 255)', scheme: 'dark ' })).toEqual(DARK);
  });

  it('falls back to the declared scheme when the text colour cannot be read', () => {
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: true, ink: '', scheme: 'normal ' })).toEqual(WHITE);
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: false, ink: 'oklch(0.9 0 0)', scheme: 'dark' })).toEqual(DARK);
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: true, ink: '', scheme: 'normal light dark' })).toEqual(DARK);
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: false, ink: '', scheme: 'light dark' })).toEqual(WHITE);
    // An old probe result with neither field: never dark by default.
    expect(WebviewManager.baseColourFor({ body: '', html: '', dark: true })).toEqual(WHITE);
  });

  it('reads the text colour formats Chromium reports', () => {
    expect(WebviewManager.inkIsLight('rgb(232, 227, 216)')).toBe(true);
    expect(WebviewManager.inkIsLight('rgba(20, 20, 20, 0.9)')).toBe(false);
    expect(WebviewManager.inkIsLight('color(srgb 0.95 0.95 0.95)')).toBe(true);
    expect(WebviewManager.inkIsLight('color(srgb 0.1 0.1 0.1 / 0.5)')).toBe(false);
    expect(WebviewManager.inkIsLight('rgba(255, 255, 255, 0)')).toBe(null);
    expect(WebviewManager.inkIsLight('color(display-p3 1 1 1)')).toBe(null);
    expect(WebviewManager.inkIsLight('lab(90 0 0)')).toBe(null);
    expect(WebviewManager.inkIsLight(undefined)).toBe(null);
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
    const { inject } = WebviewManager.baseColourFor({ body: '', html: '', dark: true, ink: 'rgb(255, 255, 255)' });
    expect(inject.startsWith(':where(html)')).toBe(true);
  });
});

// "Notifications are blocked. Allow them in your browser or system settings,
// then try again." — a site's own words, shown because Vex told it the
// permission was denied before anyone had been asked. Electron's permission
// check is a boolean with no way to say "nobody has asked yet", so every
// ungranted site read as blocked, most never asked, and Vex's own prompt was
// never reached. The advice in that sentence could not be followed: there was
// no setting anywhere that would have helped.
describe('letting a site ask about notifications', () => {
  const key = 'https://a.test::notifications';

  it('offers the prompt when nobody has decided', () => {
    expect(WebviewManager.shouldOfferNotificationPrompt({}, 'https://a.test')).toBe(true);
    expect(WebviewManager.shouldOfferNotificationPrompt(null, 'https://a.test')).toBe(true);
    expect(WebviewManager.shouldOfferNotificationPrompt({ 'https://b.test::notifications': 'deny' }, 'https://a.test')).toBe(true);
  });

  // A block is a block: it must keep reading as denied.
  it('leaves a site that was blocked, or already allowed, exactly as it is', () => {
    expect(WebviewManager.shouldOfferNotificationPrompt({ [key]: 'deny' }, 'https://a.test')).toBe(false);
    expect(WebviewManager.shouldOfferNotificationPrompt({ [key]: 'allow' }, 'https://a.test')).toBe(false);
  });
});

// A cinema site showed "Konuma izin vermeniz gerekiyor" (you need to allow
// location) because navigator.permissions.query said 'denied' for a site
// nobody had decided on (2026-09-27).
describe('what a site sees when it checks a permission before asking', () => {
  const o = 'https://www.paribucineverse.com';
  it('undecided reads as prompt, so the site asks', () => {
    expect(WebviewManager.permissionStateFor({}, o, 'geolocation')).toBe('prompt');
    expect(WebviewManager.permissionStateFor(null, o, 'geolocation')).toBe('prompt');
  });
  it('allowed in Vex reads as granted, blocked stays denied', () => {
    expect(WebviewManager.permissionStateFor({ [o + '::geolocation']: 'allow' }, o, 'geolocation')).toBe('granted');
    expect(WebviewManager.permissionStateFor({ [o + '::geolocation']: 'deny' }, o, 'geolocation')).toBe('denied');
  });
  it("another site's decision does not count", () => {
    expect(WebviewManager.permissionStateFor({ 'https://other.test::geolocation': 'allow' }, o, 'geolocation')).toBe('prompt');
  });
});
