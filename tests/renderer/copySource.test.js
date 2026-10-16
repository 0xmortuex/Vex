// @vitest-environment jsdom
//
// T1-021: copy a selection with its source in four formats, with a warning on
// 50 or more verbatim words (js/copy-source.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let C;
const NOW = new Date(2026, 9, 16, 12, 0).getTime();
const src = { text: 'The bootloader hands over a memory map.', title: 'UEFI [spec] chapter 7', url: 'https://uefi.org/specs/7', now: NOW };

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  delete globalThis.CitationTracker;
  ({ VexCopySource: C } = fresh(JS + 'copy-source.js'));
});

describe('format()', () => {
  it('writes a Markdown link with the brackets of the title neutralised', () => {
    expect(C.format('markdown-link', src).text).toBe('[UEFI spec chapter 7](https://uefi.org/specs/7)');
  });
  it('writes a quote block with the source and date underneath', () => {
    expect(C.format('quote', { ...src, text: 'line one\nline two' }).text).toBe('> line one\n> line two\n>\n> UEFI spec chapter 7 (https://uefi.org/specs/7), 2026-10-16');
  });
  it('writes a citation with host, address and access date', () => {
    expect(C.format('citation', src).text).toBe('"The bootloader hands over a memory map.". UEFI spec chapter 7. uefi.org. https://uefi.org/specs/7 Accessed 2026-10-16.');
  });
  it('writes plain text for any page, even one with no web address', () => {
    expect(C.format('plain', { text: ' just this ', url: 'vex://start' }).text).toBe('just this');
  });
  it('refuses a source format for a page without a web address, and an empty selection', () => {
    expect(() => C.format('quote', { text: 'a', url: 'vex://start' })).toThrow(/no web address/);
    expect(() => C.format('plain', { text: '   ', url: src.url })).toThrow(/Select some text/);
    expect(() => C.format('latex', src)).toThrow(/Unknown copy format/);
  });
});

describe('the 50-word warning', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => 'w' + i).join(' ');
  it('fires for a quote or citation of 50 words or more, never for a link or plain text', () => {
    expect(C.format('quote', { ...src, text: words(49) }).warning).toBe('');
    expect(C.format('quote', { ...src, text: words(50) }).warning).toMatch(/50 words verbatim/);
    expect(C.format('citation', { ...src, text: words(80) }).warning).toMatch(/80 words/);
    expect(C.format('plain', { ...src, text: words(80) }).warning).toBe('');
    expect(C.format('markdown-link', { ...src, text: words(80) }).warning).toBe('');
  });
  it('counts words', () => {
    expect(C.words('')).toBe(0);
    expect(C.words(' a  b\nc ')).toBe(3);
  });
});

describe('copyAs()', () => {
  it('puts the text on the clipboard, tells the citations tracker and warns when long', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const record = vi.fn();
    globalThis.CitationTracker = { enabled: () => true, record };
    window.showToast = vi.fn();
    const r = await C.copyAs('quote', src);
    expect(writeText).toHaveBeenCalledWith(r.text);
    expect(record).toHaveBeenCalledWith({ text: src.text, url: src.url, title: src.title });
    expect(window.showToast).toHaveBeenCalledWith('Copied as quote with source', 'info', 3000);
    const long = Array.from({ length: 60 }, () => 'word').join(' ');
    await C.copyAs('quote', { ...src, text: long });
    expect(window.showToast.mock.calls.at(-1)[1]).toBe('warn');
  });

  it('does not touch the tracker while it is off', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
    const record = vi.fn();
    globalThis.CitationTracker = { enabled: () => false, record };
    await C.copyAs('plain', src);
    expect(record).not.toHaveBeenCalled();
  });

  it('raises when the clipboard is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await expect(C.copyAs('plain', src)).rejects.toThrow(/clipboard is not available/);
  });
});

describe('preferences', () => {
  it('default to quote and on, validate the format, and switch off', () => {
    expect(C.prefs()).toEqual({ enabled: true, format: 'quote' });
    C.setPrefs({ format: 'citation' });
    expect(C.prefs().format).toBe('citation');
    expect(() => C.setPrefs({ format: 'rtf' })).toThrow(/Unknown copy format/);
    C.setEnabled(false);
    expect(C.enabled()).toBe(false);
    expect(C.prefs().format).toBe('citation');
  });
});
