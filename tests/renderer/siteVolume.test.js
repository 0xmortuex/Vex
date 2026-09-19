// @vitest-environment jsdom
//
// The volume you keep a site at, remembered per site and put back on the
// media the page makes later.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { SiteVolume: V } = require('../../src/renderer/js/site-volume.js');

beforeEach(() => { localStorage.clear(); window.VexProblems = { note: vi.fn() }; });

describe('remembering a site\'s volume', () => {
  it('is kept by host, whatever the page, and www is the same site', () => {
    V.set('https://www.youtube.com/watch?v=x', 40);
    expect(V.get('https://youtube.com/feed')).toBe(40);
    expect(V.get('https://other.example/')).toBeNull();
  });

  it('100% means nothing to remember, and a figure is kept in range', () => {
    V.set('https://a.example', 40);
    V.set('https://a.example', 100);
    expect(V.get('https://a.example')).toBeNull();
    expect(V.set('https://a.example', 150)).toBe(100);
    expect(V.set('https://a.example', -5)).toBe(0);
    expect(() => V.set('not a url', 50)).toThrow('not a web page');
  });

  it('forgetting one leaves the others', () => {
    V.set('https://a.example', 10);
    V.set('https://b.example', 20);
    V.forget('a.example');
    expect(V.get('https://a.example')).toBeNull();
    expect(V.get('https://b.example')).toBe(20);
  });
});

describe('putting it back on the page', () => {
  it('only where a figure is kept', async () => {
    globalThis.WebviewManager = { webviews: new Map([['t1', {}]]) };
    window.vexGuestEval = vi.fn(async () => true);
    expect(await V.apply('t1', 'https://a.example')).toBe(false);
    V.set('https://a.example', 25);
    expect(await V.apply('t1', 'https://a.example')).toBe(true);
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('__vexVolume = 0.25');
  });

  it('a page that refuses is recorded, not thrown', async () => {
    globalThis.WebviewManager = { webviews: new Map([['t1', {}]]) };
    window.vexGuestEval = vi.fn(async () => { throw new Error('page gone'); });
    V.set('https://a.example', 25);
    expect(await V.apply('t1', 'https://a.example')).toBe(false);
    expect(window.VexProblems.note).toHaveBeenCalledWith('Site volume', expect.stringContaining('a.example'), expect.any(Error));
  });
});
