// "Fill code from email" (right-click / Ctrl+K) is asked for by hand. It used to
// run the automatic poll: the code already in the inbox became the baseline and
// was held back 15-30 s (and never filled without verification wording), and
// while the automatic watch ran on the page the request did nothing at all.
// Now it fills the newest code from the site's own sender at once, and tells a
// running watch to do the same.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailCodeAutofill } from '../../src/renderer/js/email-code-autofill.js';

function harness(read) {
  const injected = [];
  const logs = [];
  const A = Object.assign(Object.create(Object.getPrototypeOf(EmailCodeAutofill)), EmailCodeAutofill, {
    _watching: new Set(), _active: new Set(),
    _hasEmptyCodeField: async () => true,
    _looksLikeCodePage: async () => true,
    _findMailWebview: () => ({ wv: {}, provider: EmailCodeAutofill._PROVIDERS[0] }),
    _readInbox: async () => read,
    _refreshInbox: () => {},
    _injectCode: async (_wv, code) => { injected.push({ code, at: Date.now() }); return true; },
    _log: (_u, ok, why) => logs.push(why), _toast: () => {}, _maybeMissToast: () => {}, _maybeAutoSubmit: () => {},
    _restoreAutoWoken: () => {},
  });
  return { A, injected, logs };
}

describe('manual "Fill code from email"', () => {
  let storage;
  beforeEach(() => {
    vi.useFakeTimers();
    storage = new Map();
    vi.stubGlobal('localStorage', { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const url = 'https://discord.com/login';
  const wv = () => ({ isConnected: true, getURL: () => url });

  it('fills the code already in the inbox at once, read or unread, with or without verification wording', async () => {
    for (const row of [
      { unread: true, strong: true },
      { unread: false, strong: true },
      { unread: false, strong: false },
    ]) {
      const { A, injected, logs } = harness({ loaded: true, code: '482913', from: ['noreply@discord.com'], ...row });
      const t0 = Date.now();
      const p = A.tryFill(wv(), url, { manual: true });
      await vi.advanceTimersByTimeAsync(100);
      expect(injected.length).toBe(1);
      expect(injected[0].code).toBe('482913');
      expect(injected[0].at - t0).toBeLessThan(1000);
      expect(logs).toEqual(['manual']);
      await vi.advanceTimersByTimeAsync(200000); await p;
    }
  });

  it('still never fills a code from another sender', async () => {
    const { A, injected } = harness({ loaded: true, code: '482913', unread: true, strong: true, from: ['noreply@evil.example'] });
    const p = A.tryFill(wv(), url, { manual: true });
    await vi.advanceTimersByTimeAsync(200000); await p;
    expect(injected).toEqual([]);
  });

  it('tells the automatic watch already running on the page to fill now', async () => {
    const { A, injected } = harness({ loaded: true, code: '482913', unread: false, strong: true, from: ['noreply@discord.com'] });
    const page = wv();
    const watch = A.tryFill(page, url);            // the automatic dom-ready watch
    await vi.advanceTimersByTimeAsync(4000);
    expect(injected).toEqual([]);                  // baseline: held back
    await A.tryFill(page, url, { manual: true });  // returns at once: the watch is running
    await vi.advanceTimersByTimeAsync(3500);       // the watch's next tick
    expect(injected.map(x => x.code)).toEqual(['482913']);
    await vi.advanceTimersByTimeAsync(200000); await watch;
    expect(page._vexEmailCodeFillNow).toBe(false);
  });

  it('the automatic watch alone still waits for a newer code (baseline unchanged)', async () => {
    const { A, injected } = harness({ loaded: true, code: '482913', unread: false, strong: true, from: ['noreply@discord.com'] });
    const t0 = Date.now();
    const p = A.tryFill(wv(), url);
    for (let k = 0; k < 64 && !injected.length; k++) await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(200000); await p;
    expect(injected[0].at - t0).toBeGreaterThanOrEqual(30000);
  });
});
