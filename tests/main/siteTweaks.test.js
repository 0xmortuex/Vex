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

  it('hide-web-push hides PushManager and shims registration.pushManager to a clean denial', async () => {
    const entry = SITE_TWEAKS.find(t => t.name === 'hide-web-push');
    function PushManager() {}
    function ServiceWorkerRegistration() {}
    function DOMException(message, name) { this.message = message; this.name = name; }
    Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', {
      get: () => ({}), configurable: true,
    });
    const ctx = {
      PushManager,
      PushSubscription: function () {},
      PushSubscriptionOptions: function () {},
      ServiceWorkerRegistration,
      DOMException,
      Notification: function () {},
      Object,
      Promise,
    };
    ctx.window = ctx; // the tweak reads window.PushManager etc.
    vm.createContext(ctx);
    new vm.Script(entry.code).runInContext(ctx);

    // Feature detectors see no push support…
    expect('PushManager' in ctx.window).toBe(false);
    expect('PushSubscription' in ctx.window).toBe(false);
    expect('PushSubscriptionOptions' in ctx.window).toBe(false);
    // …but direct callers get a Chrome-like "permission denied", not a
    // TypeError on undefined.
    const reg = new ServiceWorkerRegistration();
    const pm = reg.pushManager;
    expect(pm).toBeTruthy();
    await expect(pm.subscribe()).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(pm.getSubscription()).resolves.toBeNull();
    await expect(pm.permissionState()).resolves.toBe('denied');
    // Plain notifications keep working — they're the fallback sites should use.
    expect('Notification' in ctx.window).toBe(true);
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
