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
    // Updated from main's answer, so after the round trip.
    await new Promise(r => setTimeout(r, 0));
    expect(PrivacyPack.cfg.farble).toBe(false);
  });
});

describe('Global Privacy Control and referrer trimming in Settings', () => {
  const draw = (cfg, rules = {}) => {
    window.escapeHtml = (s) => String(s);
    globalThis.SiteRulesUI = {
      rules: () => rules,
      set: vi.fn(async (url, what, off) => {
        const h = new URL(url).hostname;
        rules[h] = { ...(rules[h] || {}) };
        if (off) rules[h][what] = 'off'; else delete rules[h][what];
        if (!Object.keys(rules[h]).length) delete rules[h];
      }),
    };
    window.vex = { privacySetConfig: vi.fn(async (patch) => ({ ...PrivacyPack.cfg, ...patch })) };
    PrivacyPack.cfg = { farble: false, doh: 'off', dohProvider: 'cloudflare', httpsOnly: false, ...cfg };
    const el = document.createElement('div');
    PrivacyPack.renderSettings(el);
    return el;
  };
  it('GPC is on by default, referrer trimming off', () => {
    const el = draw({});
    expect(el.querySelector('#priv-gpc').checked).toBe(true);
    expect(el.querySelector('#priv-referrer').value).toBe('default');
  });
  it('sends only the patch for each choice', async () => {
    const el = draw({});
    const gpc = el.querySelector('#priv-gpc');
    gpc.checked = false; gpc.dispatchEvent(new window.Event('change'));
    const ref = el.querySelector('#priv-referrer');
    ref.value = 'strict'; ref.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 0));
    expect(window.vex.privacySetConfig).toHaveBeenCalledWith({ gpc: false });
    expect(window.vex.privacySetConfig).toHaveBeenCalledWith({ referrer: 'strict' });
  });
  it('the excluded sites are the site switches, listed, added and removed', async () => {
    const rules = { 'a.example': { gpc: 'off' }, 'b.example': { referrer: 'off' } };
    const el = draw({}, rules);
    expect(el.querySelector('#priv-gpc-sites').textContent).toContain('a.example');
    expect(el.querySelector('#priv-gpc-sites').textContent).not.toContain('b.example');
    expect(el.querySelector('#priv-referrer-sites').textContent).toContain('b.example');
    el.querySelector('#priv-gpc-add-host').value = 'https://www.Shop.example/path';
    el.querySelector('#priv-gpc-add').click();
    await new Promise(r => setTimeout(r, 0));
    expect(rules['shop.example']).toEqual({ gpc: 'off' });
    el.querySelector('#priv-gpc-sites button[data-host="a.example"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(rules['a.example']).toBeUndefined();
  });
  it('refuses something that is not a web address', async () => {
    const el = draw({});
    el.querySelector('#priv-gpc-add-host').value = 'not an address';
    el.querySelector('#priv-gpc-add').click();
    await new Promise(r => setTimeout(r, 0));
    expect(globalThis.SiteRulesUI.set).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/web address/), 'error');
  });
});
