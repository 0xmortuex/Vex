// @vitest-environment jsdom
//
// Page checks, again: each run's numbers kept per page, the next report opens
// with what changed, and any past check can be run again.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/page-export.js');
const { CheckHistory } = require('../../src/renderer/js/check-history.js');
require('../../src/renderer/js/link-checker.js');

const e = (key, label, value, text) => ({ key, label, value, text: text == null ? String(value) : text });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  window.VexTabPolicy = { canReadWebview: (w) => !String(w.getAttribute('partition')).startsWith('otr-') };
});

describe('the record', () => {
  it('keeps each run per page and returns the one before', () => {
    expect(CheckHistory.record('links', 'https://a.example/p#top', [e('broken', 'Broken', 3)], '3 broken')).toBeNull();
    const prev = CheckHistory.record('links', 'https://a.example/p', [e('broken', 'Broken', 1)], '1 broken');
    expect(prev.entries[0].value).toBe(3);
    expect(CheckHistory.list().map(r => r.verdict)).toEqual(['1 broken', '3 broken']);
    expect(CheckHistory.record('speed', 'https://a.example/p', [], 'Fast')).toBeNull();        // another kind
  });

  it('says what changed, including what appeared and what went to nothing', () => {
    const prev = { at: Date.now(), entries: [e('broken', 'Broken', 3), e('moved', 'Moved', 2), e('ok', 'Working', 10)] };
    const now = [e('broken', 'Broken', 1), e('ok', 'Working', 10), e('slow', 'No answer', 1)];
    expect(CheckHistory.changes(prev, now)).toEqual([
      { key: 'broken', label: 'Broken', from: '3', to: '1' },
      { key: 'moved', label: 'Moved', from: '2', to: '0' },
      { key: 'slow', label: 'No answer', from: '0', to: '1' },
    ]);
    expect(CheckHistory.since(prev, now)).toMatch(/^Since last time \(.+\): Broken 3 → 1 · Moved 2 → 0 · No answer 0 → 1$/);
  });

  it('figures that read the same are the same', () => {
    const prev = { at: Date.now(), entries: [e('lcp', 'Main content', 1210, '1.2 s')] };
    expect(CheckHistory.since(prev, [e('lcp', 'Main content', 1190, '1.2 s')])).toMatch(/^The same as last time/);
  });

  it('a first run has nothing to compare with', () => {
    expect(CheckHistory.since(null, [e('x', 'X', 1)])).toBeNull();
  });

  it('a private tab leaves nothing behind', () => {
    const wv = { getAttribute: () => 'otr-123', getURL: () => 'https://secret.example/' };
    expect(CheckHistory.track('links', wv, [e('broken', 'Broken', 1)], '')).toBeNull();
    expect(CheckHistory.list()).toEqual([]);
  });

  it('unreadable history is an error, never silently replaced', () => {
    localStorage.setItem('vex.checkHistory', '[{');
    expect(() => CheckHistory.record('links', 'https://a.example/', [], '')).toThrow(/could not be read/);
    expect(localStorage.getItem('vex.checkHistory')).toBe('[{');
  });
});

describe('running again', () => {
  function webview(url) {
    return { url, loading: false, getURL() { return this.url; }, isLoading() { return this.loading; }, getAttribute: () => 'persist:main', reload: vi.fn(function () { this.loading = true; setTimeout(() => { this.loading = false; }, 20); }) };
  }

  it('on the page that is open: runs it; a speed check reloads first', async () => {
    const wv = webview('https://a.example/');
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    globalThis.TabManager = { createTab: vi.fn() };
    const perf = { run: vi.fn(async () => 'measured') };
    window.PerfCheck = perf;
    const saved = CheckHistory.SETTLE_MS; CheckHistory.SETTLE_MS = 0;
    expect(await CheckHistory.runOn('speed', 'https://a.example/#x')).toBe('measured');
    expect(wv.reload).toHaveBeenCalledTimes(1);
    expect(TabManager.createTab).not.toHaveBeenCalled();
    CheckHistory.SETTLE_MS = saved;
  });

  it('on another page: opens it, waits for it to load, then runs', async () => {
    let active = webview('https://a.example/');
    globalThis.WebviewManager = { getActiveWebview: () => active };
    globalThis.TabManager = { createTab: vi.fn((url) => { active = webview(url); active.loading = true; setTimeout(() => { active.loading = false; }, 30); }) };
    window.A11yCheck = { run: vi.fn(async () => { expect(active.isLoading()).toBe(false); return 'checked'; }) };
    const saved = CheckHistory.SETTLE_MS; CheckHistory.SETTLE_MS = 0;
    expect(await CheckHistory.runOn('a11y', 'https://b.example/page')).toBe('checked');
    expect(TabManager.createTab).toHaveBeenCalledWith('https://b.example/page', true);
    CheckHistory.SETTLE_MS = saved;
  });

  it('Recent Page Checks lists the newest run of each check on each page', () => {
    CheckHistory.record('links', 'https://a.example/', [], 'All 5 links working');
    CheckHistory.record('links', 'https://a.example/', [], 'All 6 links working');
    CheckHistory.record('crawl', 'https://a.example/', [], '12 pages, none broken');
    CheckHistory.open();
    const o = document.querySelector('.vex-checks-overlay');
    expect(o.querySelectorAll('[data-run]')).toHaveLength(2);
    expect(o.textContent).toContain('All 6 links working');
    expect(o.textContent).not.toContain('All 5 links working');
    expect(o.textContent).toContain('Site crawl');
  });
});

describe('in a real report', () => {
  it('the second link check of a page opens with what changed, and has Run again', async () => {
    const wv = { getURL: () => 'https://blog.example/post', getAttribute: () => 'persist:main' };
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    const LINKS = [{ url: 'https://x.example/a', text: 'A', index: 0 }, { url: 'https://x.example/b', text: 'B', index: 1 }];
    window.vexGuestEval = vi.fn(async () => LINKS);
    window.CheckHistory = CheckHistory;
    window.vex = { checkLinks: vi.fn(async () => ({ ok: true, skipped: 0, results: [{ url: 'https://x.example/a', status: 404, verdict: 'broken', finalUrl: 'https://x.example/a' }, { url: 'https://x.example/b', status: 404, verdict: 'broken', finalUrl: 'https://x.example/b' }] })) };
    await window.LinkChecker.run();
    expect(document.querySelector('.vex-links-overlay [data-since]')).toBeNull();          // first run
    window.vex.checkLinks = vi.fn(async () => ({ ok: true, skipped: 0, results: [{ url: 'https://x.example/a', status: 200, verdict: 'ok', finalUrl: 'https://x.example/a' }, { url: 'https://x.example/b', status: 404, verdict: 'broken', finalUrl: 'https://x.example/b' }] }));
    await window.LinkChecker.run();
    const o = document.querySelector('.vex-links-overlay');
    expect(o.querySelector('[data-since]').textContent).toMatch(/Broken 2 → 1 · Working 0 → 1/);
    expect(o.querySelector('[data-again]')).not.toBeNull();
    // The line survives the Problems / All toggle redrawing the body.
    o.querySelector('[data-show="all"]').click();
    expect(o.querySelector('[data-since]')).not.toBeNull();
    delete window.CheckHistory;
  });
});
