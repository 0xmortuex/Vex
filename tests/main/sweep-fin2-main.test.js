// @vitest-environment node
//
// Fixes of 2026-09-29 in main (fin2): JavaScript switched off for a site holds
// on a page browsed to inside a tab already open (a script-src 'none' policy
// on the page's response), every window hears of a change to the per-site
// switches at once, and an extension update leaves no extensions-replaced
// folder behind. main.js cannot be loaded outside Electron, so its function
// is lifted out of its source.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
const path = require('path');
const SiteRules = require('../../src/main/site-rules.js');
const { tidyReplaced } = require('../../src/main/extensions.js');

const read = f => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');
const MAIN = read('src/main.js');
const between = (from, to) => MAIN.slice(MAIN.indexOf(from), MAIN.indexOf(to, MAIN.indexOf(from)) + to.length);

const cspFn = (rules) => new Function('SiteRules', '_siteRules',
  `${between('function _scriptsOffCsp(details, responseHeaders) {', '\n}\n')}; return _scriptsOffCsp;`)(SiteRules, rules);

describe('JavaScript off follows navigation', () => {
  const csp = cspFn({ 'b.test': { js: 'off' } });
  const run = (details, headers = {}) => { csp(details, headers); return headers; };

  it('the page of a JS-off site gets script-src none', () => {
    expect(run({ resourceType: 'mainFrame', url: 'https://www.b.test/x' })['Content-Security-Policy']).toEqual(["script-src 'none'"]);
  });

  it('added to the site\'s own policy, not in place of it', () => {
    const h = run({ resourceType: 'mainFrame', url: 'https://b.test/' }, { 'content-security-policy': ["default-src 'self'"] });
    expect(h['content-security-policy']).toEqual(["default-src 'self'", "script-src 'none'"]);
  });

  it('a frame from another host inside such a page too, but not the other sites', () => {
    expect(run({ resourceType: 'subFrame', url: 'https://ads.test/', frame: { top: { url: 'https://b.test/' } } })['Content-Security-Policy']).toBeTruthy();
    expect(run({ resourceType: 'mainFrame', url: 'https://a.test/' })).toEqual({});
    expect(run({ resourceType: 'subFrame', url: 'https://ads.test/', frame: { top: { url: 'https://a.test/' } } })).toEqual({});
    expect(run({ resourceType: 'script', url: 'https://b.test/app.js' })).toEqual({});
  });

  it('is applied in every session a tab can be in', () => {
    expect(MAIN.match(/_scriptsOffCsp\(details, (?:responseHeaders|rh)\);/g).length).toBeGreaterThanOrEqual(5);
    expect(MAIN).toMatch(/for \(const p of BROWSING_SESSIONS\) \{\n\s+secureSessions\.fromPartition\(p\)\.webRequest\.onHeadersReceived/);
  });
});

describe('a change to the switches reaches every window at once', () => {
  it('main sends the new switches; the preload lets a window hear it', () => {
    const set = between("ipcMain.handle('siterules:set'", '\n});\n');
    expect(set).toMatch(/'siterules:changed', _siteRules/);
    expect(read('src/preload.js')).toMatch(/onSiteRulesChanged: \(callback\) => subscribe\('siterules:changed', callback\)/);
  });
});

describe('extension update leaves nothing in extensions-replaced', () => {
  it('removes that extension\'s set-aside copies and the empty folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-extrep-'));
    const backup = path.join(dir, 'extensions-replaced');
    fs.mkdirSync(path.join(backup, 'dark-reader-123', 'x'), { recursive: true });
    fs.mkdirSync(path.join(backup, 'dark-reader-456'));
    tidyReplaced(backup, 'dark-reader');
    expect(fs.existsSync(backup)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps another extension\'s copy, and the folder with it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-extrep-'));
    const backup = path.join(dir, 'extensions-replaced');
    fs.mkdirSync(path.join(backup, 'dark-reader-123'), { recursive: true });
    fs.mkdirSync(path.join(backup, 'dark-reader-extra-9'));
    fs.mkdirSync(path.join(backup, 'stylus-9'));
    tidyReplaced(backup, 'dark-reader');
    expect(fs.readdirSync(backup).sort()).toEqual(['dark-reader-extra-9', 'stylus-9']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is called on every path where the update went in', () => {
    const fn = between('async function _replaceInPlace', '\n}\n');
    expect(fn.match(/_tidyReplaced\(backupDir, previous\.folder\);/g)).toHaveLength(3);
  });
});
