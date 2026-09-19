// src/main/full-page-capture.js — the whole page, one screenful at a time.
//
// A single-pass capture of a <webview> guest (captureBeyondViewport, and a
// viewport override) was tried live: both gave the FIRST SCREENFUL repeated
// down a correctly-sized image. capturePage per tile then stalled past seven
// minutes in a window behind others. So each screenful is taken through the
// debugger, and the renderer stitches — these tests pin what makes that right.

import { describe, it, expect, vi } from 'vitest';
const { createFullPageCapture, MAX_HEIGHT } = require('../../src/main/full-page-capture.js');

function page({ url = 'https://example.com/long', vw = 1280, vh = 800, h = 3000, grows = 0, capturesEmpty = false, attached = false } = {}) {
  let scrollY = 300;
  let height = h;
  const log = [];
  const maxY = () => Math.max(0, height - vh);
  const evaluate = async (code) => {
    log.push(code);
    if (code.startsWith('({ x: scrollX')) return { x: 0, y: scrollY, vw, vh, h: height };
    const s = /^window\.scrollTo\((\d+), (\d+)\)$/.exec(code);
    if (s) { scrollY = Math.min(Number(s[2]), maxY()); if (grows) { height += grows; grows = 0; } return undefined; }
    if (code === 'document.documentElement.scrollHeight') return height;
    if (code === 'scrollY') return scrollY;
    if (code.includes('data-vex-shot-vis')) return code.includes('removeAttribute') ? true : 2;
    return undefined;
  };
  const dbg = {
    _attached: attached,
    isAttached() { return this._attached; },
    attach: vi.fn(function () { this._attached = true; }),
    detach: vi.fn(function () { this._attached = false; }),
    sendCommand: vi.fn(async (m, p) => {
      if (m === 'Runtime.evaluate') return { result: { value: await evaluate(p.expression) } };
      if (m === 'Page.captureScreenshot') return capturesEmpty ? {} : { data: 'T' + scrollY };
      return {};
    }),
  };
  const wc = { isDestroyed: () => false, getURL: () => url, debugger: dbg };
  const cap = createFullPageCapture({ webContents: { fromId: (id) => (id === 3 ? wc : null) }, sleep: async () => {} });
  return { cap, dbg, log, scroll: () => scrollY };
}

describe('capturing the whole page', () => {
  it('one tile per screenful, each at the scroll position it was really taken', async () => {
    const r = await page({ h: 3000, vh: 800 }).cap.capture(3);
    expect(r.tiles.map(t => t.y)).toEqual([0, 800, 1600, 2200]);    // last one overlaps: 3000 - 800
    expect(r).toMatchObject({ width: 1280, viewportHeight: 800, height: 3000, cut: false });
    expect(r.tiles[3].dataUrl).toBe('data:image/png;base64,T2200');
  });

  it('a page shorter than the screen is one tile', async () => {
    expect((await page({ h: 500, vh: 800 }).cap.capture(3)).tiles).toHaveLength(1);
  });

  it('pinned headers appear once — hidden after the first tile, restored after', async () => {
    const { cap, log } = page();
    await cap.capture(3);
    const firstTile = log.findIndex(c => c === 'scrollY');
    const hide = log.findIndex(c => c.includes("setProperty('visibility', 'hidden'"));
    const restore = log.findIndex(c => c.includes('removeAttribute'));
    expect(hide).toBeGreaterThan(firstTile);
    expect(restore).toBeGreaterThan(hide);
  });

  it('scrolls through first so lazy images load, then puts you back where you were', async () => {
    const { cap, log, scroll } = page({ h: 4000, vh: 800 });
    await cap.capture(3);
    const firstTile = log.findIndex(c => c === 'scrollY');
    expect(log.slice(0, firstTile).filter(c => /scrollTo\(0, \d+\)/.test(c)).length).toBeGreaterThanOrEqual(5);
    expect(scroll()).toBe(300);
  });

  it('measures again after the walk, because pages grow as things load', async () => {
    const r = await page({ h: 2000, vh: 800, grows: 1200 }).cap.capture(3);
    expect(r.height).toBe(3200);
    expect(r.tiles[r.tiles.length - 1].y).toBe(2400);
  });

  it('an enormous page gives its top and says it was cut', async () => {
    const r = await page({ h: 200000, vh: 1000 }).cap.capture(3);
    expect(r.cut).toBe(true);
    expect(r.height).toBe(MAX_HEIGHT);
    expect(r.tiles).toHaveLength(MAX_HEIGHT / 1000);
  });

  it('restores the scroll even when a capture fails', async () => {
    const { cap, log, scroll } = page({ capturesEmpty: true });
    await expect(cap.capture(3)).rejects.toThrow(/could not be drawn/);
    expect(scroll()).toBe(300);
    expect(log.some(c => c.includes("'hidden', 'important'"))).toBe(false);   // failed before hiding anything
  });

  it('lets go of the debugger afterwards, even after a failure', async () => {
    const ok = page(); await ok.cap.capture(3);
    expect(ok.dbg.detach).toHaveBeenCalled();
    const bad = page({ capturesEmpty: true });
    await expect(bad.cap.capture(3)).rejects.toThrow();
    expect(bad.dbg.detach).toHaveBeenCalled();
  });

  it('will not fight DevTools for the tab', async () => {
    const { cap, dbg } = page({ attached: true });
    await expect(cap.capture(3)).rejects.toThrow(/DevTools is open/);
    expect(dbg.attach).not.toHaveBeenCalled();
  });

  it('refuses a closed tab and Vex\'s own internal pages', async () => {
    await expect(page().cap.capture(99)).rejects.toThrow(/tab has closed/);
    await expect(page({ url: 'devtools://devtools/x' }).cap.capture(3)).rejects.toThrow(/Only a web page/);
  });
});

describe('speed', () => {
  it('never waits on animation frames or capturePage, which stall in a covered window', () => {
    const src = require('fs').readFileSync(require.resolve('../../src/main/full-page-capture.js'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/requestAnimationFrame/);
    expect(src).not.toMatch(/capturePage\(/);
  });
});
