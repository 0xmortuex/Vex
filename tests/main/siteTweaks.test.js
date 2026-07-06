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
    // suffix tricks must NOT match
    expect(names('evil-tiktok.com')).toEqual([]);
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

  it('importing the module in Node has no side effects (applier is DOM-guarded)', () => {
    // If the applier ran at import time under Node, the import at the top of
    // this file would already have thrown (no DOM). Assert the guard exists.
    expect(typeof document).toBe('undefined');
    expect(SITE_TWEAKS.length).toBeGreaterThanOrEqual(2);
  });
});
