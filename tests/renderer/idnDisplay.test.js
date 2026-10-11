// @vitest-environment jsdom
//
// Addresses in other alphabets (found 2026-10-10): every xn-- name was shown
// as punycode and warned about as "not what it looks like", münchen.de and
// пример.рф included, and the warning sat over the address bar and took its
// clicks. Now a name in one alphabet is shown in it, and only a name built to
// be mistaken (alphabets mixed, or Cyrillic that reads as Latin) is warned
// about and kept as punycode.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const Idn = require('../../src/renderer/js/idn.js');
const { LinkSafety } = require('../../src/renderer/js/link-safety.js');

describe('reading a name', () => {
  it('decodes punycode', () => {
    expect(Idn.toUnicode('xn--mnchen-3ya.de')).toBe('münchen.de');
    expect(Idn.toUnicode('xn--e1afmkfd.xn--p1ai')).toBe('пример.рф');
    expect(Idn.toUnicode('xn--wgv71a119e.jp')).toBe('日本語.jp');
  });
  it('one alphabet is shown as written', () => {
    expect(Idn.display('xn--mnchen-3ya.de')).toBe('münchen.de');
    expect(Idn.display('xn--e1afmkfd.xn--p1ai')).toBe('пример.рф');
    expect(Idn.display('example.com')).toBe('example.com');
  });
  it('a fake stays punycode', () => {
    expect(Idn.display('xn--pple-43d.com')).toBe('xn--pple-43d.com');      // Cyrillic а + pple
    expect(Idn.display('xn--80ak6aa92e.com')).toBe('xn--80ak6aa92e.com');  // аррӏе, all Cyrillic
  });
});

describe('the lookalike warning', () => {
  it('only for the fakes', () => {
    expect(LinkSafety.lookalike('xn--mnchen-3ya.de')).toBe(null);
    expect(LinkSafety.lookalike('xn--e1afmkfd.xn--p1ai')).toBe(null);
    expect(LinkSafety.lookalike('xn--pple-43d.com')).toMatchObject({ looksLike: null, why: expect.stringContaining('mixes letters') });
  });

  it('opens over the page, below the address bar', () => {
    document.body.innerHTML = '<div id="webviews-container"></div>';
    document.getElementById('webviews-container').getBoundingClientRect = () => ({ top: 96, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
    globalThis.VexProblems = { note: vi.fn() };
    LinkSafety.warnOnce({ host: 'xn--pple-43d.com', looksLike: null, why: 'x' }, null);
    expect(document.querySelector('.lookalike-warn').style.top).toBe('104px');
  });
});

describe('the address bar', () => {
  let TabManager;
  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '<input id="url-input">';
    globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true), loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true), loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true) };
    if (!window.vex) window.vex = { getStartPageUrl: () => new Promise(() => {}) };
    globalThis.VexIdn = Idn;
    await import('../../src/renderer/js/vex-icons.js');
    await import('../../src/renderer/js/vex-utils.js');
    ({ TabManager } = await import('../../src/renderer/js/tabs.js'));
  });
  it('shows münchen.de, and keeps a fake as punycode', () => {
    expect(TabManager.urlBarText({ url: 'https://xn--mnchen-3ya.de/karte' })).toBe('https://münchen.de/karte');
    expect(TabManager.urlBarText({ url: 'http://xn--pple-43d.com:9946/' })).toBe('http://xn--pple-43d.com:9946/');
  });
});
