// Night mode for sound. The dangerous failure here is silence: a page whose
// audio cannot be routed must be told about, not left muted. And a site is
// only remembered once it actually worked.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { NightAudio: N } = require('../../src/renderer/js/night-audio.js');

const store = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  globalThis.window = { vexGuestEval: vi.fn(async () => ({ ok: true, touched: 1 })), showToast: vi.fn() };
  globalThis.TabManager = { getActiveTab: () => ({ url: 'https://example.com/film' }), activeTabId: 1 };
  globalThis.WebviewManager = { webviews: new Map([[1, { getURL: () => 'https://example.com/film' }]]) };
});

describe('which sites have it on', () => {
  it('remembers a site, and forgets it again', () => {
    expect(N.isOn('https://example.com/a')).toBe(false);
    N.remember('https://example.com/a', true);
    expect(N.isOn('https://www.example.com/b')).toBe(true);
    N.remember('https://example.com/a', false);
    expect(N.isOn('https://example.com/a')).toBe(false);
  });

  it('a page that is not a web page cannot be remembered', () => {
    expect(() => N.remember('file:///C:/x.html', true)).toThrow();
  });
});

describe('the script that runs in the page', () => {
  it('is valid JavaScript both ways round', () => {
    expect(() => new Function(N.script(true))).not.toThrow();
    expect(() => new Function(N.script(false))).not.toThrow();
  });

  it('says which way it is being switched', () => {
    expect(N.script(true)).toContain('state.on = true');
    expect(N.script(false)).toContain('state.on = false');
  });

  it('never routes one media element twice \u2014 that is what silences a page', () => {
    expect(N.script(true)).toContain('if (state.nodes.has(media)) return true;');
  });
});

describe('switching it on', () => {
  it('applies it and remembers the site', async () => {
    expect(await N.toggle()).toBe(true);
    expect(window.vexGuestEval).toHaveBeenCalled();
    expect(N.isOn('https://example.com/film')).toBe(true);
  });

  it('switching it off again applies that too', async () => {
    await N.toggle();
    expect(await N.toggle()).toBe(false);
    expect(N.isOn('https://example.com/film')).toBe(false);
  });

  it('a page whose sound cannot be routed says so, and is not remembered', async () => {
    window.vexGuestEval.mockResolvedValue({ ok: false, error: 'MediaElementAudioSource outputs zeroes' });
    await expect(N.toggle()).rejects.toThrow(/cannot be evened out/);
    expect(N.isOn('https://example.com/film')).toBe(false);
  });

  it('nothing playing yet still counts as on, and says so', async () => {
    window.vexGuestEval.mockResolvedValue({ ok: true, touched: 0 });
    await N.toggle();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('when something plays'));
  });

  it('a page with no sound to route at all is refused plainly', async () => {
    globalThis.TabManager = { getActiveTab: () => ({ url: 'file:///C:/x.html' }), activeTabId: 1 };
    globalThis.WebviewManager = { webviews: new Map([[1, { getURL: () => 'file:///C:/x.html' }]]) };
    await expect(N.toggle()).rejects.toThrow(/Open a page that plays something/);
  });
});
