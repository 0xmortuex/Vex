// Cold-start link race: when Vex is launched by clicking a link (Vex not
// already running), main sends the URL via the 'open-url' IPC at the window's
// did-finish-load — but the renderer registers its onOpenUrl handler late in
// its async init. Without buffering, that first URL (the clicked link) is
// dropped and Vex opens to the start page. createOpenUrlBuffer() is the tested
// spec; preload.js mirrors it inline (it's sandboxed and can't require this).
import { describe, it, expect, vi } from 'vitest';
import { createOpenUrlBuffer } from '../../src/main-helpers.js';

describe('createOpenUrlBuffer (cold-start open-url race)', () => {
  it('flushes a URL delivered BEFORE the renderer attaches (the bug)', () => {
    const buf = createOpenUrlBuffer();
    buf.deliver('https://example.com/clicked'); // arrived before handler ready
    const got = [];
    buf.attach(u => got.push(u));               // renderer registers late
    expect(got).toEqual(['https://example.com/clicked']);
  });

  it('delivers URLs that arrive AFTER attach (warm start)', () => {
    const buf = createOpenUrlBuffer();
    const got = [];
    buf.attach(u => got.push(u));
    buf.deliver('https://example.com/warm');
    expect(got).toEqual(['https://example.com/warm']);
  });

  it('flushes multiple buffered URLs in arrival order', () => {
    const buf = createOpenUrlBuffer();
    buf.deliver('https://a.test/');
    buf.deliver('https://b.test/');
    const got = [];
    buf.attach(u => got.push(u));
    expect(got).toEqual(['https://a.test/', 'https://b.test/']);
  });

  it('keeps delivering even if the renderer callback throws', () => {
    const buf = createOpenUrlBuffer();
    buf.deliver('https://boom.test/');
    expect(() => buf.attach(() => { throw new Error('renderer bug'); })).not.toThrow();
    // a later delivery still does not throw out of deliver()
    expect(() => buf.deliver('https://after.test/')).not.toThrow();
  });

  it('does not buffer once attached (no double-delivery on a second attach path)', () => {
    const buf = createOpenUrlBuffer();
    const got = [];
    buf.attach(u => got.push(u));
    buf.deliver('https://one.test/');
    buf.deliver('https://two.test/');
    expect(got).toEqual(['https://one.test/', 'https://two.test/']);
  });
});
