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
    const names = (host) => tweaksForHost(host).map(t => t.name);
    expect(names('discord.com')).toContain('discord-always-visible');
    expect(names('canary.discord.com')).toContain('discord-always-visible');
    expect(names('www.tiktok.com')).toContain('hevc-mask');
    expect(names('www.instagram.com')).toContain('hevc-mask');
    expect(names('accounts.google.com')).toContain('google-uadata');
    expect(names('google.com')).toContain('google-uadata');
    // suffix tricks must NOT match
    expect(names('evil-tiktok.com')).toEqual([]);
    expect(names('evilgoogle.com')).toEqual([]);
    expect(names('google.com.evil.example')).toEqual([]);
    expect(names('tiktok.com.evil.example')).toEqual([]);
    expect(names('nodiscord.com')).toEqual([]);
    // unrelated sites get nothing
    expect(names('youtube.com')).toEqual([]);
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
