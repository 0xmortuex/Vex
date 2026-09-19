// @vitest-environment jsdom
//
// "Why is this page slow?" — Chromium's own load measurements, graded against
// Core Web Vitals, with the culprits in words.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/page-export.js');
const { PerfCheck, auditPerformance } = require('../../src/renderer/js/perf-check.js');

// A fake Performance API with a navigation, FCP, resources, and observers
// that replay LCP and layout-shift entries (as buffered observers do).
function fakePerf({ ttfb = 300, fcp = 900, lcp = 1800, shifts = [], resources = [], heapMB = 40 } = {}) {
  return {
    getEntriesByType: (t) => t === 'navigation' ? [{ startTime: 0, responseStart: ttfb, domContentLoadedEventEnd: 1200, loadEventEnd: 2000, transferSize: 20000 }]
      : t === 'resource' ? resources : [],
    getEntriesByName: (n) => n === 'first-contentful-paint' ? [{ startTime: fcp }] : [],
    memory: { usedJSHeapSize: heapMB * 1048576 },
    _lcp: lcp, _shifts: shifts,
  };
}
function fakeWindow(perf) {
  class PO {
    constructor(cb) { this.cb = cb; }
    observe({ type }) {
      const entries = type === 'largest-contentful-paint' ? [{ startTime: perf._lcp, renderTime: perf._lcp, element: null }] : type === 'layout-shift' ? perf._shifts : [];
      setTimeout(() => this.cb({ getEntries: () => entries }), 0);
    }
    disconnect() {}
  }
  return { performance: perf, PerformanceObserver: PO, location: { href: 'https://shop.example/product' }, devicePixelRatio: 1 };
}
const run = (perfOpts, extra = {}) => { const p = fakePerf(perfOpts); return auditPerformance(document, fakeWindow(p), { settleMs: 5, ...extra }); };

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });

describe('the measurements', () => {
  it('reads first byte, first paint, main content and memory', async () => {
    const r = await run({});
    expect(r.metrics).toMatchObject({ ttfb: 300, fcp: 900, lcp: 1800, cls: 0 });
    expect(r.jsHeapMB).toBe(40);
  });

  it('layout shift is the worst burst, ignoring shifts the user caused', async () => {
    const r = await run({ shifts: [
      { startTime: 100, value: 0.05 }, { startTime: 400, value: 0.08 },        // one burst: 0.13
      { startTime: 3000, value: 0.2, hadRecentInput: true },                  // user's own: ignored
      { startTime: 9000, value: 0.04 },                                        // a later, smaller burst
    ] });
    expect(r.metrics.cls).toBeCloseTo(0.13, 3);
  });

  it('weighs the page by kind, and tells its own site from other companies', async () => {
    const r = await run({ resources: [
      { name: 'https://shop.example/app.js', initiatorType: 'script', transferSize: 300000 },
      { name: 'https://cdn.shop.example/hero.jpg', initiatorType: 'img', transferSize: 900000 },
      { name: 'https://ads.tracker.net/pixel.js', initiatorType: 'script', transferSize: 500000 },
    ] });
    expect(r.weight.kinds).toMatchObject({ scripts: 800000, images: 900000 });
    expect(r.weight.thirdPartyBytes).toBe(500000);
    expect(r.weight.thirdPartyHosts).toEqual(['tracker.net']);
    expect(r.heaviest[0].name).toMatch(/hero\.jpg/);
  });

  it('finds pictures sent far bigger than shown, and scripts that block the first paint', async () => {
    document.head.innerHTML = '<script src="https://shop.example/blocking.js"></script><script async src="https://shop.example/fine.js"></script><script defer src="https://shop.example/fine2.js"></script>';
    document.body.innerHTML = '<img src="big.jpg"><img src="ok.jpg">';
    const [big, ok] = document.images;
    Object.defineProperty(big, 'naturalWidth', { value: 2400 });
    Object.defineProperty(ok, 'naturalWidth', { value: 800 });
    const r = await run({}, { shownWidth: (img) => (img === big ? 400 : 760) });
    expect(r.oversizedImages).toMatchObject({ count: 1, examples: [{ src: 'big.jpg', natural: 2400, shown: 400, factor: 6 }] });
    expect(r.blockingScripts).toEqual(['blocking.js']);
  });
});

describe('sizes other sites hide', () => {
  it('counts files that hid their size, and says totals are a minimum', async () => {
    const r = await run({ resources: [
      { name: 'https://shop.example/app.js', initiatorType: 'script', transferSize: 6 * 1048576, decodedBodySize: 6 * 1048576 },
      { name: 'https://ads.tracker.net/a.js', initiatorType: 'script', transferSize: 0, decodedBodySize: 0 },
      { name: 'https://ads.tracker.net/b.js', initiatorType: 'script', transferSize: 0, decodedBodySize: 0 },
    ] });
    expect(r.weight).toMatchObject({ hiddenSizes: 2, thirdPartyRequests: 2 });
    expect(PerfCheck.findings(r).map(f => f.text).join(' ')).toMatch(/downloaded at least 6\.0 MB/);
    expect(PerfCheck.report(r)).toMatch(/at least 6\.0 MB in 4 requests \(2 files hid their size\)/);
  });
  it('the other-companies share is by requests, since their bytes are hidden', async () => {
    const res = Array.from({ length: 6 }, (_, i) => ({ name: 'https://t' + i + '.adnet.com/x.js', initiatorType: 'script', transferSize: 0 }))
      .concat([{ name: 'https://shop.example/a.js', initiatorType: 'script', transferSize: 1000 }]);
    const r = await run({ resources: res });
    expect(PerfCheck.findings(r).map(f => f.text).join(' ')).toMatch(/6 of its 8 requests went to other companies' servers \(adnet\.com\)/);
  });
});

describe('grading and words', () => {
  it('uses the Core Web Vitals thresholds', () => {
    expect(PerfCheck.grade('lcp', 2400)).toBe('good');
    expect(PerfCheck.grade('lcp', 3000)).toBe('needs work');
    expect(PerfCheck.grade('lcp', 4500)).toBe('poor');
    expect(PerfCheck.grade('cls', 0.05)).toBe('good');
    expect(PerfCheck.grade('cls', 0.3)).toBe('poor');
    expect(PerfCheck.grade('ttfb', null)).toBe(null);
  });

  it('a fast, light page says so and lists nothing', async () => {
    const r = await run({});
    expect(PerfCheck.summary(r)).toBe('Fast');
    expect(PerfCheck.findings(r)).toEqual([]);
  });

  it('a slow page names what is wrong, worst first', async () => {
    document.head.innerHTML = '<script src="https://x.example/a.js"></script>';
    const r = await run({ ttfb: 2100, lcp: 5200, shifts: [{ startTime: 10, value: 0.3 }] });
    expect(PerfCheck.summary(r)).toBe('Slow');
    const f = PerfCheck.findings(r).map(x => x.text);
    expect(f[0]).toMatch(/main content took 5\.2 s/);
    expect(f.join(' ')).toMatch(/server took 2\.1 s/);
    expect(f.join(' ')).toMatch(/layout jumped/);
    expect(f.join(' ')).toMatch(/1 script in the page head/);
  });

  it('the report reads as plain text', async () => {
    const r = await run({ resources: [{ name: 'https://shop.example/big.js', initiatorType: 'script', transferSize: 2 * 1048576 }] });
    const text = PerfCheck.report(r);
    expect(text).toMatch(/^Performance of https:\/\/shop\.example\/product/);
    expect(text).toContain('Main content drawn: 1.8 s (good)');
    expect(text).toMatch(/2\.0 MB {2}https:\/\/shop\.example\/big\.js/);
  });
});

describe('the sheet', () => {
  it('runs in the page and shows tiles, findings and heaviest files — as text, never markup', async () => {
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    globalThis.WebviewManager = { getActiveWebview: () => ({}) };
    const r = await run({ lcp: 5000, resources: [{ name: 'https://shop.example/<img src=x onerror=alert(1)>.js', initiatorType: 'script', transferSize: 1000 }] });
    window.vexGuestEval = vi.fn(async () => r);
    await PerfCheck.run();
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('async function auditPerformance');
    const box = document.querySelector('.vex-perf-overlay');
    expect(box.textContent).toContain('Slow');
    expect(box.textContent).toContain('Main content drawn');
    expect(box.querySelector('img')).toBe(null);
  });
});
