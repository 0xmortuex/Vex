// @vitest-environment jsdom
//
// "Autoplay only when I click", per site. Vex allows autoplay app-wide (main.js: Master Volume's boost needs a
// running AudioContext), so a site held to a click gets a guest built with autoplayPolicy=user-gesture-required.
// Measured in real Electron 42 on 2026-11-06 with the app's global switch on: that policy blocks Audio.play() until a
// click, and the AudioContext stays running. These tests cover the wiring around that fact.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');
const SiteRules = require('../../src/main/site-rules.js');
const fresh = (rel) => { const f = require.resolve(rel); delete require.cache[f]; return require(f); };

let S;
beforeEach(() => {
  localStorage.clear();
  window.vex = { siteRulesGet: vi.fn(async () => ({ ok: true, rules: {} })), onSiteRulesChanged: vi.fn(() => () => {}), siteRulesSet: vi.fn(async (r) => ({ ok: true, rules: r })) };
  window.VexTabPolicy = { isPrivateWindow: false };
  S = fresh('../../src/renderer/js/site-rules-ui.js').SiteRulesUI;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the autoplay switch', () => {
  it('is one of the per-site switches, so the site panel and Site settings list it', () => {
    const w = S.WHAT.find(x => x.id === 'autoplay');
    expect(w).toBeTruthy();
    expect(w.name).toBe('Autoplay');
    expect(SiteRules.clean({ 'example.com': { autoplay: 'off' } })).toEqual({ 'example.com': { autoplay: 'off' } });
  });

  it('is off only where it was turned off, for the host and its subdomains', async () => {
    expect(S.autoplayOff('https://video.example/watch')).toBe(false);
    await S.set('https://www.video.example/watch', 'autoplay', true);
    expect(S.autoplayOff('https://video.example/')).toBe(true);
    expect(S.autoplayOff('https://m.video.example/clip')).toBe(true);
    expect(S.autoplayOff('https://other.example/')).toBe(false);
    expect(S.describe('https://video.example/')).toBe('video.example: autoplay switched off');
    // Turning it back on removes the rule, so a site with nothing set has no entry.
    await S.set('https://video.example/', 'autoplay', false);
    expect(S.autoplayOff('https://video.example/')).toBe(false);
    expect(JSON.parse(localStorage.getItem('vex.siteRules'))['video.example']).toBeUndefined();
  });

  it('is told to main like the other switches, and main keeps it', async () => {
    await S.set('https://video.example/', 'autoplay', true);
    expect(window.vex.siteRulesSet).toHaveBeenCalledWith({ 'video.example': { autoplay: 'off' } });
  });

  it('main drops a value that is not "off", and a switch it does not know', () => {
    expect(SiteRules.clean({ 'a.example': { autoplay: 'on' }, 'b.example': { autoplay: 'off', nonsense: 'off' } }))
      .toEqual({ 'b.example': { autoplay: 'off' } });
  });
});

describe('the guest\'s webpreferences', () => {
  it('say nothing about autoplay for an ordinary site', () => {
    expect(WebviewManager.webPreferencesFor({})).toBe('contextIsolation=yes');
    expect(WebviewManager.webPreferencesFor({ keptAwake: true })).toBe('contextIsolation=yes,backgroundThrottling=no');
  });

  it('hold a site with autoplay off to a click, beside the other creation-time choices', () => {
    expect(WebviewManager.webPreferencesFor({ noAutoplay: true })).toBe('contextIsolation=yes,autoplayPolicy=user-gesture-required');
    expect(WebviewManager.webPreferencesFor({ keptAwake: true, noScripts: true, noAutoplay: true, historyFrom: 7, carried: 'c3' }))
      .toBe('contextIsolation=yes,backgroundThrottling=no,javascript=no,autoplayPolicy=user-gesture-required,vexHistoryFrom=7,vexHistoryFrom=c3');
  });

  it('the policy keeps the AudioContext running (document-user-activation-required would suspend it)', () => {
    expect(WebviewManager.webPreferencesFor({ noAutoplay: true })).not.toMatch(/document-user-activation-required/);
  });
});

describe('a tab that browses on to a site with the other setting', () => {
  // webview.js builds the tab again exactly when WebviewManager.autoplayDiffers says so.
  it('is built again only when the settings differ', async () => {
    window.SiteRulesUI = S;
    await S.set('https://quiet.example/', 'autoplay', true);
    expect(WebviewManager.autoplayDiffers('https://quiet.example/page', false)).toBe(true);   // loud tab -> quiet site
    expect(WebviewManager.autoplayDiffers('https://loud.example/', true)).toBe(true);         // quiet tab -> loud site
    expect(WebviewManager.autoplayDiffers('https://quiet.example/other', true)).toBe(false);  // same setting: left alone
    expect(WebviewManager.autoplayDiffers('https://loud.example/', false)).toBe(false);       // no rule: never rebuilds
    expect(WebviewManager.autoplayDiffers('https://loud.example/', undefined)).toBe(false);   // a guest built before this existed
  });

  it('never rebuilds anything when the rules are not loaded at all', () => {
    delete window.SiteRulesUI;
    expect(WebviewManager.autoplayDiffers('https://quiet.example/', false)).toBe(false);
  });
});
