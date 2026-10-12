// @vitest-environment jsdom
//
// SponsorBlock: a YouTube video's sponsor segments are fetched by its id and
// handed to the page; other pages are left alone; it can be turned off.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { SponsorSkip: S } = require('../../src/renderer/js/sponsor-skip.js');

let asked, injected;
beforeEach(() => {
  localStorage.clear();
  S._cache.clear();
  asked = []; injected = [];
  window.VexNet = { fetch: vi.fn(async (url) => { asked.push(url); return url.includes('none') ? { status: 404, ok: false } : { status: 200, ok: true, json: async () => [{ segment: [10.5, 64.8], category: 'sponsor' }] }; }) };
  globalThis.WebviewManager = { webviews: new Map([['t1', {}]]) };
  // A tab in the main session, which Vex's own window may ask about.
  globalThis.TabManager = { tabs: [{ id: 't1', partition: 'persist:main' }], windowMayAsk: (p) => !p || p === 'persist:main' };
  window.vexGuestEval = vi.fn(async (wv, code) => { injected.push(code); return true; });
  window.VexProblems = { note: vi.fn() };
});

describe('SponsorSkip', () => {
  it('is off until turned on: a fresh profile sends nothing to sponsor.ajay.app', async () => {
    expect(S.enabled()).toBe(false);
    await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/watch?v=abc123' });
    expect(asked).toEqual([]);
    expect(injected).toEqual([]);
  });

  // The lookup is made from Vex's window, direct: a video in a Tor, private,
  // off-the-record or container tab is not announced from the real address.
  it('asks nothing for a video in a Tor, private or off-the-record tab', async () => {
    S.setEnabled(true);
    for (const partition of ['tor-1', 'private:x', 'otr-2', 'persist:container-work']) {
      TabManager.tabs = [{ id: 't1', partition }];
      await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/watch?v=abc123' });
    }
    expect(asked).toEqual([]);
    expect(injected).toEqual([]);
  });

  it('asks for a watched video\'s segments by id only, and hands them to the page', async () => {
    S.setEnabled(true);
    await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/watch?v=abc123&t=5' });
    expect(asked[0]).toMatch(/^https:\/\/sponsor\.ajay\.app\/api\/skipSegments\?videoID=abc123&categories=/);
    expect(injected[0]).toContain('[[10.5,64.8]]');
    expect(injected[0]).toContain('"abc123"');
  });

  it('a video nobody marked, a page that is not a video, or the setting off: nothing is injected', async () => {
    S.setEnabled(true);
    await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/watch?v=none' });
    await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/feed/subscriptions' });
    S.setEnabled(false);
    await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/watch?v=abc123' });
    expect(injected).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it('a failure is recorded, not thrown into the page load', async () => {
    window.VexNet.fetch = vi.fn(async () => ({ status: 500, ok: false }));
    S.setEnabled(true);
    await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/watch?v=x' });
    expect(window.VexProblems.note).toHaveBeenCalledWith('SponsorBlock', expect.any(String), expect.any(Error));
  });
});
