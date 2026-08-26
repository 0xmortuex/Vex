import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SITE_TWEAKS, tweaksForHost } from '../../src/site-tweaks.js';

describe('site-tweaks registry', () => {
  it('every entry is well-formed', () => {
    for (const t of SITE_TWEAKS) {
      expect(t.name).toBeTruthy();
      expect(t.hosts).toBeInstanceOf(RegExp);
      expect(['webFrame', 'dom-script']).toContain(t.mechanism);
      expect(typeof t.code).toBe('string');
      // main-world code must at least parse
      expect(() => new vm.Script(t.code)).not.toThrow();
    }
  });

  it('host patterns match the intended sites and subdomains only', () => {
    // hide-web-push is deliberately global — exclude it when asserting the
    // per-site tweaks stay scoped.
    const GLOBAL = ['hide-web-push'];
    const scoped = (host) => tweaksForHost(host).map(t => t.name).filter(n => !GLOBAL.includes(n));
    expect(scoped('discord.com')).toContain('discord-always-visible');
    expect(scoped('canary.discord.com')).toContain('discord-always-visible');
    expect(scoped('www.tiktok.com')).toContain('hevc-mask');
    expect(scoped('www.instagram.com')).toContain('hevc-mask');
    expect(scoped('accounts.google.com')).toContain('google-uadata');
    expect(scoped('google.com')).toContain('google-uadata');
    // suffix tricks must NOT match
    expect(scoped('evil-tiktok.com')).toEqual([]);
    expect(scoped('evilgoogle.com')).toEqual([]);
    expect(scoped('google.com.evil.example')).toEqual([]);
    expect(scoped('tiktok.com.evil.example')).toEqual([]);
    expect(scoped('nodiscord.com')).toEqual([]);
    // unrelated sites get only the global tweaks
    expect(scoped('youtube.com')).toEqual([]);
    // ...which apply everywhere
    expect(tweaksForHost('youtube.com').map(t => t.name)).toContain('hide-web-push');
    expect(tweaksForHost('example.org').map(t => t.name)).toContain('hide-web-push');
    // notif-deny-broken-push is scoped to claude.ai only.
    expect(tweaksForHost('claude.ai').map(t => t.name)).toContain('notif-deny-broken-push');
    expect(scoped('claude.ai')).toContain('notif-deny-broken-push');
    expect(tweaksForHost('example.org').map(t => t.name)).not.toContain('notif-deny-broken-push');
    expect(tweaksForHost('evilclaude.ai').map(t => t.name)).not.toContain('notif-deny-broken-push');
    // spotify-drm-robustness-fallback is scoped to spotify.com.
    expect(tweaksForHost('open.spotify.com').map(t => t.name)).toContain('spotify-drm-robustness-fallback');
    expect(tweaksForHost('example.org').map(t => t.name)).not.toContain('spotify-drm-robustness-fallback');
  });

  it('hevc-mask blocks HEVC probes and passes everything else through', async () => {
    const entry = SITE_TWEAKS.find(t => t.name === 'hevc-mask');
    const isTypeSupported = (t) => !/broken/.test(t); // stand-in native impl
    const ctx = {
      window: {},
      MediaSource: { isTypeSupported },
      HTMLMediaElement: { prototype: { canPlayType: (t) => (/broken/.test(t) ? '' : 'probably') } },
      navigator: {
        mediaCapabilities: {
          decodingInfo: async () => ({ supported: true, smooth: true, powerEfficient: true }),
        },
      },
      Promise,
    };
    ctx.window.MediaSource = ctx.MediaSource;
    vm.createContext(ctx);
    new vm.Script(entry.code).runInContext(ctx);

    const HEVC = 'video/mp4; codecs="hvc1.1.6.L93.B0"';
    const HEV1 = 'video/mp4; codecs="hev1.1.6.L93.B0"';
    const H264 = 'video/mp4; codecs="avc1.42E01E"';
    expect(ctx.MediaSource.isTypeSupported(HEVC)).toBe(false);
    expect(ctx.MediaSource.isTypeSupported(HEV1)).toBe(false);
    expect(ctx.MediaSource.isTypeSupported(H264)).toBe(true);
    expect(ctx.HTMLMediaElement.prototype.canPlayType(HEVC)).toBe('');
    expect(ctx.HTMLMediaElement.prototype.canPlayType(H264)).toBe('probably');
    const denied = await ctx.navigator.mediaCapabilities.decodingInfo({ video: { contentType: HEVC } });
    expect(denied.supported).toBe(false);
    const allowed = await ctx.navigator.mediaCapabilities.decodingInfo({ video: { contentType: H264 } });
    expect(allowed.supported).toBe(true);
  });

  it('discord tweak spoofs visibility in a bare context', () => {
    const entry = SITE_TWEAKS.find(t => t.name === 'discord-always-visible');
    const listeners = [];
    const ctx = {
      document: { addEventListener: (...a) => listeners.push(a) },
      window: { addEventListener: (...a) => listeners.push(a) },
      Object,
    };
    vm.createContext(ctx);
    new vm.Script(entry.code).runInContext(ctx);
    expect(ctx.document.visibilityState).toBe('visible');
    expect(ctx.document.hidden).toBe(false);
    expect(listeners.some(([name]) => name === 'visibilitychange')).toBe(true);
  });

  it('hide-web-push removes the entire Push surface so push reads as unsupported', () => {
    const entry = SITE_TWEAKS.find(t => t.name === 'hide-web-push');
    function PushManager() {}
    function ServiceWorkerRegistration() {}
    Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', {
      get: () => ({}), configurable: true,
    });
    const ctx = {
      PushManager,
      PushSubscription: function () {},
      PushSubscriptionOptions: function () {},
      ServiceWorkerRegistration,
      Notification: function () {},
      Object,
    };
    ctx.window = ctx; // the tweak reads window.PushManager etc.
    vm.createContext(ctx);
    new vm.Script(entry.code).runInContext(ctx);

    // The whole surface is gone — emulating a browser with no Web Push (like
    // older Safari), the no-push state sites already handle gracefully. This
    // is what makes claude.ai etc. NOT show/attempt their push toggle. A
    // present-but-rejecting shim (the earlier "hardening") reintroduced the
    // "unknown error" because sites detect push by pushManager's existence.
    expect('PushManager' in ctx.window).toBe(false);
    expect('PushSubscription' in ctx.window).toBe(false);
    expect('PushSubscriptionOptions' in ctx.window).toBe(false);
    expect('pushManager' in ServiceWorkerRegistration.prototype).toBe(false);
    expect(new ServiceWorkerRegistration().pushManager).toBeUndefined();
    // Plain notifications keep working — the fallback sites should use.
    expect('Notification' in ctx.window).toBe(true);
  });

  it('spotify-drm-robustness-fallback retries with SW_SECURE_CRYPTO when the original request fails', async () => {
    const entry = SITE_TWEAKS.find(t => t.name === 'spotify-drm-robustness-fallback');
    const calls = [];
    // Fake CDM: rejects anything above SW_SECURE_CRYPTO (like Electron's).
    const fakeRMKSA = (ks, configs) => {
      calls.push(JSON.parse(JSON.stringify(configs)));
      const tooHigh = configs.some(c => (c.audioCapabilities || []).some(a => a.robustness && a.robustness !== '' && a.robustness !== 'SW_SECURE_CRYPTO'));
      return tooHigh ? Promise.reject(new Error('unsupported robustness')) : Promise.resolve({ ok: true });
    };
    const ctx = {
      navigator: { requestMediaKeySystemAccess: fakeRMKSA },
      Object, Promise, Array,
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    new vm.Script(entry.code).runInContext(ctx);

    // A request that asks for SW_SECURE_DECODE (what Spotify does for some
    // tracks) now succeeds via the downgraded retry.
    const access = await ctx.navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
      { initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: 'SW_SECURE_DECODE' }] },
    ]);
    expect(access).toEqual({ ok: true });
    expect(calls).toHaveLength(2);                                   // original + retry
    expect(calls[0][0].audioCapabilities[0].robustness).toBe('SW_SECURE_DECODE');
    expect(calls[1][0].audioCapabilities[0].robustness).toBe('SW_SECURE_CRYPTO'); // downgraded

    // A request that already works is untouched (no retry).
    calls.length = 0;
    await ctx.navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
      { audioCapabilities: [{ contentType: 'audio/mp4', robustness: 'SW_SECURE_CRYPTO' }] },
    ]);
    expect(calls).toHaveLength(1);
  });

  it('notif-deny-broken-push forces Notification permission to denied', async () => {
    const entry = SITE_TWEAKS.find(t => t.name === 'notif-deny-broken-push');
    function Notification() {}
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
    Notification.requestPermission = () => Promise.resolve('granted');
    const ctx = { window: { Notification }, Object, Promise };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    new vm.Script(entry.code).runInContext(ctx);

    // The site now sees notifications as denied → shows its normal "blocked"
    // state and never reaches the failing push subscribe.
    expect(ctx.window.Notification.permission).toBe('denied');
    await expect(ctx.window.Notification.requestPermission()).resolves.toBe('denied');
    // Callback form also gets 'denied'.
    let cbVal = null;
    ctx.window.Notification.requestPermission((v) => { cbVal = v; });
    expect(cbVal).toBe('denied');
  });

  it('notif-deny-broken-push no-ops safely when Notification is absent', () => {
    const entry = SITE_TWEAKS.find(t => t.name === 'notif-deny-broken-push');
    const ctx = { window: {}, Object, Promise };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    expect(() => new vm.Script(entry.code).runInContext(ctx)).not.toThrow();
  });

  it('google-uadata grafts a "Google Chrome" brand into the real userAgentData', async () => {
    const entry = SITE_TWEAKS.find(t => t.name === 'google-uadata');
    function Navigator() {}
    // Shaped like what Electron actually exposes on an https page (verified
    // 2026-08-25): Chromium + GREASE brands, no "Google Chrome".
    const real = {
      brands: [{ brand: 'Not/A)Brand', version: '99' }, { brand: 'Chromium', version: '148' }],
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: async () => ({
        brands: [{ brand: 'Not/A)Brand', version: '99' }, { brand: 'Chromium', version: '148' }],
        fullVersionList: [{ brand: 'Not/A)Brand', version: '99.0.0.0' }, { brand: 'Chromium', version: '148.0.7778.271' }],
        mobile: false,
        platform: 'Windows',
        platformVersion: '19.0.0',
      }),
    };
    // Like the browser, userAgentData is a getter on Navigator.prototype, not
    // an own property of the navigator instance (an own property would shadow
    // the prototype getter the tweak installs).
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => real, configurable: true });
    const ctx = {
      Navigator,
      navigator: Object.assign(new Navigator(), {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      }),
      Object,
      Promise,
    };
    vm.createContext(ctx);
    new vm.Script(entry.code).runInContext(ctx);

    const uad = ctx.navigator.userAgentData;
    expect(uad).not.toBe(real);
    expect(uad.mobile).toBe(false);
    expect(uad.platform).toBe('Windows');
    expect(uad.brands.map(b => b.brand)).toContain('Google Chrome');
    // Grafted brand copies the Chromium versions so everything stays consistent.
    expect(uad.brands.find(b => b.brand === 'Google Chrome').version).toBe('148');
    const high = await uad.getHighEntropyValues(['fullVersionList', 'platformVersion']);
    expect(high.brands.map(b => b.brand)).toContain('Google Chrome');
    expect(high.fullVersionList.find(b => b.brand === 'Google Chrome').version).toBe('148.0.7778.271');
    expect(high.platformVersion).toBe('19.0.0');
    expect(JSON.parse(JSON.stringify(uad)).brands.length).toBe(3);
  });

  it('google-uadata leaves a userAgentData that already claims Chrome alone', () => {
    const entry = SITE_TWEAKS.find(t => t.name === 'google-uadata');
    function Navigator() {}
    const real = {
      brands: [{ brand: 'Chromium', version: '148' }, { brand: 'Google Chrome', version: '148' }],
      mobile: false,
      platform: 'Windows',
    };
    const ctx = {
      Navigator,
      navigator: Object.assign(new Navigator(), { userAgent: 'x', userAgentData: real }),
      Object,
      Promise,
    };
    vm.createContext(ctx);
    new vm.Script(entry.code).runInContext(ctx);
    expect(ctx.navigator.userAgentData).toBe(real);
  });

  it('importing the module in Node has no side effects (applier is DOM-guarded)', () => {
    // If the applier ran at import time under Node, the import at the top of
    // this file would already have thrown (no DOM). Assert the guard exists.
    expect(typeof document).toBe('undefined');
    expect(SITE_TWEAKS.length).toBeGreaterThanOrEqual(2);
  });
});
