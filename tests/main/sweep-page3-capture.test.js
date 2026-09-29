// A 79,000 px page ran past a minute: 30,000 px were captured only to be
// shrunk to the 16,000 px image, and the lazy-load walk went further still
// (found 2026-09-29). Capture what the image holds, and say how long the
// page really was.
import { describe, it, expect, vi } from 'vitest';
const { createFullPageCapture, MAX_HEIGHT } = require('../../src/main/full-page-capture.js');

function longPage(h, vh = 1000) {
  let scrollY = 0;
  const walked = [];
  const dbg = {
    isAttached: () => false, attach() {}, detach() {},
    sendCommand: vi.fn(async (m, p) => {
      if (m === 'Page.captureScreenshot') return { data: 'T' + scrollY };
      const code = p.expression;
      if (code.startsWith('({ x: scrollX')) return { result: { value: { x: 0, y: 0, vw: 1280, vh, h } } };
      const s = /^window\.scrollTo\((\d+), (\d+)\)$/.exec(code);
      if (s) { scrollY = Math.min(Number(s[2]), h - vh); walked.push(scrollY); return { result: {} }; }
      if (code === 'document.documentElement.scrollHeight') return { result: { value: h } };
      if (code === 'scrollY') return { result: { value: scrollY } };
      return { result: { value: true } };
    }),
  };
  const wc = { isDestroyed: () => false, getURL: () => 'https://example.com/long', debugger: dbg };
  return { cap: createFullPageCapture({ webContents: { fromId: () => wc }, sleep: async () => {} }), walked };
}

describe('a very long page', () => {
  it('captures no more than the stitched image can hold', () => {
    expect(MAX_HEIGHT).toBeLessThanOrEqual(16000);
  });

  it('walks, and captures, only the part that will be kept, and reports the real length', async () => {
    const { cap, walked } = longPage(79000);
    const r = await cap.capture(3);
    expect(Math.max(...walked)).toBeLessThanOrEqual(MAX_HEIGHT);
    expect(r.tiles).toHaveLength(MAX_HEIGHT / 1000);
    expect(r).toMatchObject({ cut: true, height: MAX_HEIGHT, fullHeight: 79000 });
  });
});
