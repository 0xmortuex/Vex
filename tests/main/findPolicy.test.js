// Ctrl+F is intercepted in a focused guest and opens Vex's own find bar. That is
// wrong for apps that paint their text into a <canvas>: Chromium's findInPage
// walks the text tree, so canvas pixels are invisible to it. Measured in the
// running app on a page holding both forms of the same text - DOM text 1 match,
// canvas text 0 matches - which is why the find bar could never find anything in
// a Google Doc while Docs' own find works.
import { describe, expect, it } from 'vitest';
import { guestOwnsFind } from '../../src/main/find-policy.js';

describe('sites that own Ctrl+F themselves', () => {
  it('hands the key to Google Docs, Sheets and Slides', () => {
    expect(guestOwnsFind('https://docs.google.com/document/d/abc/edit')).toBe(true);
    expect(guestOwnsFind('https://docs.google.com/spreadsheets/d/abc/edit')).toBe(true);
    expect(guestOwnsFind('https://docs.google.com/presentation/d/abc/edit')).toBe(true);
  });

  it('keeps Vex find on every other site, including elsewhere on google.com', () => {
    expect(guestOwnsFind('https://accounts.google.com/v3/signin')).toBe(false);
    expect(guestOwnsFind('https://drive.google.com/drive/my-drive')).toBe(false);
    expect(guestOwnsFind('https://www.google.com/search?q=x')).toBe(false);
    expect(guestOwnsFind('https://github.com/')).toBe(false);
  });

  it('is not fooled by a look-alike host', () => {
    // The suffix is anchored, so an attacker-controlled host that merely starts
    // with the real one does not get to suppress the browser's own find.
    expect(guestOwnsFind('https://docs.google.com.evil.test/document')).toBe(false);
    expect(guestOwnsFind('https://notdocs.google.com/document')).toBe(false);
  });

  it('matches a subdomain of the real host', () => {
    expect(guestOwnsFind('https://sub.docs.google.com/document')).toBe(true);
  });

  it('requires https and survives junk input', () => {
    expect(guestOwnsFind('http://docs.google.com/document')).toBe(false);
    expect(guestOwnsFind('not a url')).toBe(false);
    expect(guestOwnsFind('')).toBe(false);
    expect(guestOwnsFind(undefined)).toBe(false);
    expect(guestOwnsFind(null)).toBe(false);
  });
});
