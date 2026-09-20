// What is new on a page since your last visit. What matters here: only pages
// you asked about are remembered, what is kept is hashes and not text, the
// store cannot grow forever, and the marks it leaves can be taken off again.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { WhatsNew } = require('../../src/renderer/js/whats-new.js');

const store = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  globalThis.window = { vexGuestEval: vi.fn(async () => []), showToast: vi.fn() };
});

describe('what gets remembered', () => {
  it('a page is only remembered once you ask', () => {
    expect(WhatsNew.isRemembered('https://example.com/thread')).toBe(false);
    WhatsNew.remember('https://example.com/thread', ['a', 'b'], 'Thread');
    expect(WhatsNew.isRemembered('https://example.com/thread')).toBe(true);
  });

  it('a place on the page is the same page', () => {
    WhatsNew.remember('https://example.com/t#post-3', ['a'], '');
    expect(WhatsNew.isRemembered('https://example.com/t#post-91')).toBe(true);
    expect(WhatsNew.isRemembered('https://example.com/other')).toBe(false);
  });

  it('hashes are kept, not the text of the page', () => {
    WhatsNew.remember('https://example.com/a', ['1q', '2w'], 'Title');
    expect(JSON.stringify(WhatsNew.known('https://example.com/a'))).not.toMatch(/paragraph|sentence/i);
    expect(WhatsNew.known('https://example.com/a').hashes).toEqual(['1q', '2w']);
  });

  it('the oldest page drops out rather than the store growing forever', () => {
    const max = WhatsNew.MAX_PAGES;
    for (let i = 0; i < max + 5; i++) {
      vi.setSystemTime?.(undefined);
      const all = WhatsNew.all();
      all['https://example.com/p' + i] = { at: i + 1, hashes: [], title: '' };
      WhatsNew.save(all);
    }
    WhatsNew.remember('https://example.com/new', ['x'], '');
    const keys = Object.keys(WhatsNew.all());
    expect(keys.length).toBeLessThanOrEqual(max);
    expect(keys).toContain('https://example.com/new');
    expect(keys).not.toContain('https://example.com/p0');
  });

  it('forgetting a page leaves the others alone', () => {
    WhatsNew.remember('https://example.com/a', ['1'], '');
    WhatsNew.remember('https://example.com/b', ['2'], '');
    WhatsNew.forget('https://example.com/a');
    expect(WhatsNew.isRemembered('https://example.com/a')).toBe(false);
    expect(WhatsNew.isRemembered('https://example.com/b')).toBe(true);
  });

  it('a page that is not a web page is refused', () => {
    expect(() => WhatsNew.remember('about:blank', [], '')).toThrow();
  });
});

describe('the scripts it runs in the page', () => {
  it('are valid JavaScript, and the known hashes go in as data', () => {
    expect(() => new Function(WhatsNew.scanScript())).not.toThrow();
    const mark = WhatsNew.markScript(['a"b', '</script>']);
    expect(() => new Function(mark)).not.toThrow();
    expect(mark).toContain(JSON.stringify(['a"b', '</script>']));
  });

  it('the marks can be taken off again, style and all', () => {
    const clear = WhatsNew.clearScript();
    expect(clear).toContain('data-vex-new');
    expect(clear).toContain('vex-new-style');
  });
});

describe('what it says', () => {
  const now = Date.UTC(2026, 8, 20, 12);
  it('counts in words, with when you were last here', () => {
    expect(WhatsNew.summary(0, now - 3600000, now)).toBe('Nothing new since your last visit, an hour ago');
    expect(WhatsNew.summary(1, now - 86400000, now)).toBe('One new paragraph since your last visit, yesterday');
    expect(WhatsNew.summary(7, now - 4 * 86400000, now)).toBe('7 new paragraphs since your last visit, 4 days ago');
  });
});

describe('running it', () => {
  it('the first time remembers, and marks nothing', async () => {
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://example.com/a', title: 'A' }), activeTabId: 1 };
    globalThis.WebviewManager = { webviews: new Map([[1, { getURL: () => 'https://example.com/a' }]]) };
    window.vexGuestEval.mockResolvedValue(['h1', 'h2']);
    const res = await WhatsNew.run();
    expect(res).toEqual({ remembered: true, count: 0 });
    expect(WhatsNew.known('https://example.com/a').hashes).toEqual(['h1', 'h2']);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Remembered'));
  });

  it('the second time marks what is new, then takes this visit as the new baseline', async () => {
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://example.com/a', title: 'A' }), activeTabId: 1 };
    globalThis.WebviewManager = { webviews: new Map([[1, { getURL: () => 'https://example.com/a' }]]) };
    WhatsNew.remember('https://example.com/a', ['h1'], 'A');
    window.vexGuestEval.mockResolvedValueOnce(3).mockResolvedValueOnce(['h1', 'h2', 'h3', 'h4']);
    const res = await WhatsNew.run();
    expect(res.count).toBe(3);
    expect(WhatsNew.known('https://example.com/a').hashes).toEqual(['h1', 'h2', 'h3', 'h4']);
  });
});
