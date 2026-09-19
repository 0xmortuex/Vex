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
  window.vexGuestEval = vi.fn(async (wv, code) => { injected.push(code); return true; });
  window.VexProblems = { note: vi.fn() };
});

describe('SponsorSkip', () => {
  it('asks for a watched video\'s segments by id only, and hands them to the page', async () => {
    await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/watch?v=abc123&t=5' });
    expect(asked[0]).toMatch(/^https:\/\/sponsor\.ajay\.app\/api\/skipSegments\?videoID=abc123&categories=/);
    expect(injected[0]).toContain('[[10.5,64.8]]');
    expect(injected[0]).toContain('"abc123"');
  });

  it('a video nobody marked, a page that is not a video, or the setting off: nothing is injected', async () => {
    await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/watch?v=none' });
    await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/feed/subscriptions' });
    S.setEnabled(false);
    await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/watch?v=abc123' });
    expect(injected).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it('a failure is recorded, not thrown into the page load', async () => {
    window.VexNet.fetch = vi.fn(async () => ({ status: 500, ok: false }));
    await S.onNavigated({ tabId: 't1', url: 'https://www.youtube.com/watch?v=x' });
    expect(window.VexProblems.note).toHaveBeenCalledWith('SponsorBlock', expect.any(String), expect.any(Error));
  });
});
