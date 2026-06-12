// @vitest-environment jsdom
//
// Unit coverage for PrivacyPack (renderer side of the privacy hardening pack):
// config load on init, and that setCfg merges locally + forwards the patch to
// the main process through the window.vex bridge.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { PrivacyPack } = require('../../src/renderer/js/privacy-pack.js');

beforeEach(() => {
  PrivacyPack.cfg = { farble: false, doh: 'off', dohProvider: 'cloudflare' };
  globalThis.window.showToast = vi.fn();
});

describe('PrivacyPack', () => {
  it('loads saved config from the main process on init', async () => {
    globalThis.window.vex = { privacyGetConfig: vi.fn(async () => ({ farble: true, doh: 'strict', dohProvider: 'quad9' })) };
    await PrivacyPack.init();
    expect(PrivacyPack.cfg).toEqual({ farble: true, doh: 'strict', dohProvider: 'quad9' });
  });

  it('keeps defaults when there is no bridge', async () => {
    globalThis.window.vex = {};
    await PrivacyPack.init();
    expect(PrivacyPack.cfg.farble).toBe(false);
    expect(PrivacyPack.cfg.doh).toBe('off');
  });

  it('setCfg merges locally and forwards only the patch to main', async () => {
    const setSpy = vi.fn(async (p) => p);
    globalThis.window.vex = { privacySetConfig: setSpy };
    await PrivacyPack.setCfg({ farble: true });
    expect(PrivacyPack.cfg.farble).toBe(true);
    expect(PrivacyPack.cfg.dohProvider).toBe('cloudflare'); // untouched
    expect(setSpy).toHaveBeenCalledWith({ farble: true });
  });

  it('renderSettings reflects current config and wires the farble toggle', async () => {
    PrivacyPack.cfg = { farble: true, doh: 'auto', dohProvider: 'google' };
    globalThis.window.vex = { privacySetConfig: vi.fn(async (p) => p) };
    const el = document.createElement('div');
    PrivacyPack.renderSettings(el);
    const farble = el.querySelector('#priv-farble');
    const doh = el.querySelector('#priv-doh');
    expect(farble.checked).toBe(true);
    expect(doh.value).toBe('auto');
    // The provider select is enabled because DoH is on.
    expect(el.querySelector('#priv-doh-provider').disabled).toBe(false);
    // Toggling farble off forwards the patch.
    farble.checked = false;
    farble.dispatchEvent(new window.Event('change'));
    expect(PrivacyPack.cfg.farble).toBe(false);
  });
});
