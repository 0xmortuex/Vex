// @vitest-environment node
//
// SE10: a Tor page always gets fingerprint noise, whatever the global switch
// says; it got none unless Settings › Privacy hardening had it on.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const helpers = require('../../src/main-helpers.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

describe('SE10: Tor pages are always farbled', () => {
  it('a Tor tab, a Tor route and any session put through Tor get the noise with the switch off', () => {
    expect(helpers.farbleOn(false, 'tor-abc', { __vexTor: true })).toBe(true);
    expect(helpers.farbleOn(false, 'persist:route-tor', {})).toBe(true);
    expect(helpers.farbleOn(false, 'persist:container-work', { __vexTor: true })).toBe(true);
  });
  it('other pages follow the switch', () => {
    expect(helpers.farbleOn(false, 'persist:main', {})).toBe(false);
    expect(helpers.farbleOn(false, 'otr-1', null)).toBe(false);
    expect(helpers.farbleOn(true, 'persist:main', {})).toBe(true);
  });
  it('the page preload is told through farbleFor, with the page’s own session and address', () => {
    const at = main.indexOf("ipcMain.on('privacy:config-sync'");
    expect(at).toBeGreaterThan(-1);
    const body = main.slice(at, at + 600);
    expect(body).toMatch(/farble: _mainHelpers\.farbleFor\(privacyCfg\.farble, partition, e\.sender\.session, pageUrl\)/);
  });
});

// Discord: with the noise on, its microphone bar and the green "speaking" outline stayed on while the microphone
// was silent (Vex only, fixed by switching fingerprint protection off).
describe('sites exempt from fingerprint noise (Discord)', () => {
  it('Discord is exempt, with its subdomains, and look-alike addresses are not', () => {
    expect(helpers.farbleExemptSite('https://discord.com/app')).toBe(true);
    expect(helpers.farbleExemptSite('https://canary.discord.com/channels/@me')).toBe(true);
    expect(helpers.farbleExemptSite('https://discord.com.example.test/')).toBe(false);
    expect(helpers.farbleExemptSite('https://notdiscord.com/')).toBe(false);
    expect(helpers.farbleExemptSite('https://discord.com.au/')).toBe(false);
    expect(helpers.farbleExemptSite('https://example.com/')).toBe(false);
    expect(helpers.farbleExemptSite('')).toBe(false);
    expect(helpers.farbleExemptSite('not an address')).toBe(false);
  });
  it('an exempt site gets no noise even with the switch on; every other site follows the switch', () => {
    expect(helpers.farbleFor(true, 'persist:discord', {}, 'https://discord.com/app')).toBe(false);
    expect(helpers.farbleFor(true, 'persist:main', {}, 'https://discord.com/channels/@me')).toBe(false);
    expect(helpers.farbleFor(true, 'persist:main', {}, 'https://example.com/')).toBe(true);
    expect(helpers.farbleFor(false, 'persist:main', {}, 'https://example.com/')).toBe(false);
    expect(helpers.farbleFor(false, 'persist:main', {}, 'https://discord.com/app')).toBe(false);
  });
  it('a Tor page always gets the noise, even on an exempt site', () => {
    expect(helpers.farbleFor(false, 'tor-abc', { __vexTor: true }, 'https://discord.com/app')).toBe(true);
    expect(helpers.farbleFor(true, 'persist:route-tor', {}, 'https://discord.com/app')).toBe(true);
    expect(helpers.farbleFor(false, 'persist:container-work', { __vexTor: true }, 'https://discord.com/app')).toBe(true);
  });
});
