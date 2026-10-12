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
  it('the page preload is told through farbleOn, with the page’s own session', () => {
    const at = main.indexOf("ipcMain.on('privacy:config-sync'");
    expect(at).toBeGreaterThan(-1);
    const body = main.slice(at, at + 600);
    expect(body).toMatch(/farble: _mainHelpers\.farbleOn\(privacyCfg\.farble, partition, e\.sender\.session\)/);
  });
});
