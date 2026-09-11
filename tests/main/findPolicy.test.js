// Ctrl+F is intercepted in a focused guest and opens Vex's own find bar. That is
// wrong for apps that paint their text into a <canvas>: Chromium's findInPage
// walks the text tree, so canvas pixels are invisible to it. Measured in the
// running app on a page holding both forms of the same text - DOM text 1 match,
// canvas text 0 matches - which is why the find bar could never find anything in
// a Google Doc while Docs' own find works.
import { describe, expect, it, vi } from 'vitest';
import { guestOwnsFind, handFindToPage } from '../../src/main/find-policy.js';

// When Vex's own chrome has focus (straight after clicking a tab), Ctrl+F never
// reaches the guest, so main cannot pass it through. On a Google Sheet that
// opened Vex's find bar, which reported 0/0 for a name in plain view on row 15.
// handFindToPage gives the keystroke to the page instead.
function fakeWebview(url, overrides = {}) {
    return {
        getURL: () => url,
        focus: vi.fn(),
        sendInputEvent: vi.fn(),
        ...overrides,
    };
}

describe('handing Ctrl+F to a page that owns find', () => {
    it('focuses a Google Sheet and sends it Ctrl+F', () => {
        const wv = fakeWebview('https://docs.google.com/spreadsheets/d/abc/edit');

        expect(handFindToPage(wv)).toBe(true);

        expect(wv.focus).toHaveBeenCalled();
        expect(wv.sendInputEvent).toHaveBeenCalledWith({ type: 'keyDown', keyCode: 'F', modifiers: ['control'] });
        expect(wv.sendInputEvent).toHaveBeenCalledWith({ type: 'keyUp', keyCode: 'F', modifiers: ['control'] });
    });

    it('leaves every other site to the Vex find bar', () => {
        const wv = fakeWebview('https://github.com/');

        expect(handFindToPage(wv)).toBe(false);
        expect(wv.sendInputEvent).not.toHaveBeenCalled();
    });

    it('does not act on a look-alike host', () => {
        const wv = fakeWebview('https://docs.google.com.evil.test/spreadsheets');
        expect(handFindToPage(wv)).toBe(false);
        expect(wv.sendInputEvent).not.toHaveBeenCalled();
    });

    it('falls back to the Vex bar rather than throwing on a half-attached webview', () => {
        expect(handFindToPage(null)).toBe(false);
        expect(handFindToPage(fakeWebview('https://docs.google.com/document/d/x', { sendInputEvent: undefined }))).toBe(false);
        expect(handFindToPage(fakeWebview('', { getURL: () => { throw new Error('not attached'); } }))).toBe(false);
        expect(handFindToPage(fakeWebview('https://docs.google.com/document/d/x', {
            sendInputEvent: () => { throw new Error('gone'); },
        }))).toBe(false);
    });
});

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
