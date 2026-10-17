// @vitest-environment jsdom
//
// T3-003, Wave 5: the place in a long article outlives the tab (kept by address), and a thin
// reading-progress bar shows how far down the page is.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { VexScrollMemory: M } = require('../../src/renderer/js/scroll-memory.js');

const A = 'https://news.example/long-read';
const DAY = 86400000;
const long = (y, over = {}) => ({ x: 0, y, h: 6000, vh: 800, anchor: 'Some paragraph words here', off: 5, ...over });

function install(tabOver = {}) {
  const wv = { isConnected: true };
  const tab = { id: 'a', url: A, scrollPosition: null, ...tabOver };
  globalThis.TabManager = { tabs: [tab], activeTabId: 'a', persistTabs: vi.fn() };
  globalThis.WebviewManager = { webviews: new Map([['a', wv]]) };
  window.VexTabPolicy = { canReadWebview: vi.fn(() => true) };
  return { wv, tab };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="content-area"></div>';
  M._handled = new WeakSet();
  window.vexGuestEval = vi.fn(async () => 'offset');
});

describe('the place of an article, by address', () => {
  it('is kept for a long page and found again for a tab that has no place of its own', async () => {
    const { tab } = install();
    M.note(tab, long(2400));
    expect(M.articlePlace(A)).toMatchObject({ y: 2400, anchor: 'Some paragraph words here' });
    // A new tab (the old one was closed) on the same article, with no place of its own:
    const { wv } = install({ scrollPosition: null });
    M._handled = new WeakSet();
    expect(await M.restoreOnce('a')).toBe('offset');
    const code = window.vexGuestEval.mock.calls[0][1];
    expect(code).toContain('"y":2400');
    expect(wv).toBeTruthy();
  });
  it('ignores a short page, a place at the very top, and a #fragment difference', () => {
    expect(M.rememberArticle(A, { x: 0, y: 300, h: 1200, vh: 800 })).toBe(false);
    expect(M.rememberArticle(A, long(10))).toBe(false);
    M.rememberArticle(A + '#intro', long(1500));
    expect(M.articlePlace(A).y).toBe(1500);
  });
  it('forgets the place when the end is reached', () => {
    M.rememberArticle(A, long(2400));
    expect(M.rememberArticle(A, long(5300))).toBe(true);
    expect(M.articlePlace(A)).toBeNull();
  });
  it('expires after 60 days and keeps at most 200', () => {
    const t0 = 1_800_000_000_000;
    M.rememberArticle(A, long(2400), t0);
    expect(M.articlePlace(A, t0 + 59 * DAY)).not.toBeNull();
    expect(M.articlePlace(A, t0 + 61 * DAY)).toBeNull();
    for (let i = 0; i < 205; i++) M.rememberArticle('https://x.example/a' + i, long(2400), t0 + i);
    expect(Object.keys(M.articles()).length).toBeLessThanOrEqual(200);
  });
  it('is off when its switch is off, and a damaged store is an error', () => {
    M.setArticlesEnabled(false);
    expect(M.rememberArticle(A, long(2400))).toBe(false);
    expect(M.articlePlace(A)).toBeNull();
    M.setArticlesEnabled(true);
    localStorage.setItem(M.ARTICLES_KEY, '{nope');
    expect(() => M.articles()).toThrow(/could not be read/);
  });
  it('is not used for a private tab: restoreOnce reads nothing a policy refuses', async () => {
    M.rememberArticle(A, long(2400));
    install();
    window.VexTabPolicy.canReadWebview = vi.fn(() => false);
    expect(await M.restoreOnce('a')).toBeNull();
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });
});

describe('the reading-progress bar', () => {
  it('is how far down a long page you are, and nothing for a short one', () => {
    expect(M.progress({ y: 1600, h: 6000, vh: 800 })).toBeCloseTo(1600 / 5200, 5);
    expect(M.progress({ y: 6000, h: 6000, vh: 800 })).toBe(1);
    expect(M.progress({ y: 100, h: 1500, vh: 800 })).toBeNull();
    expect(M.progress(null)).toBeNull();
  });
  it('draws on the page area, updates, and hides', () => {
    M._drawBar(0.5);
    const bar = document.getElementById('vex-read-progress');
    expect(bar.parentElement.id).toBe('content-area');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.firstChild.style.width).toBe('50%');
    M._drawBar(null);
    expect(bar.hidden).toBe(true);
  });
  it('updateBar reads the tab in front when it is on and hides when it is off', async () => {
    const { wv } = install();
    M._handled.add(wv);
    window.vexGuestEval = vi.fn(async () => ({ x: 0, y: 2600, h: 6000, vh: 800 }));
    expect(await M.updateBar()).toBeNull();                    // off by default
    M.setBarEnabled(true);
    expect(await M.updateBar()).toBeCloseTo(0.5, 5);
    expect(document.getElementById('vex-read-progress').hidden).toBe(false);
    M.setBarEnabled(false);
    expect(document.getElementById('vex-read-progress').hidden).toBe(true);
  });
});
