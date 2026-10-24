// @vitest-environment jsdom
//
// A private window never asked for the agreement (it keeps no storage of its
// own, so it would ask every time), and nothing else stopped one opening: on
// a profile that had never agreed, or agreed to an older version, Ctrl+Alt+N
// or Ctrl+K "Private Window" gave a Vex used without agreeing (release check,
// 2026-10-12). A private window now opens only once this profile has agreed:
// main reads the version stored for the profile (vex-persist.json, which the
// main window writes) and refuses before any window is made.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { agreedTo } = require('../../src/main/agreement-gate.js');
const { VexLegal } = require('../../src/renderer/js/legal.js');

describe('has this profile agreed to this version?', () => {
  it('reads the stored version as the window writes it', () => {
    expect(agreedTo(String(VexLegal.VERSION), VexLegal.VERSION)).toBe(true);
    expect(agreedTo(VexLegal.VERSION, VexLegal.VERSION)).toBe(true);
    expect(agreedTo(String(VexLegal.VERSION + 1), VexLegal.VERSION)).toBe(true);
  });
  it('nothing, an older version, or rubbish is not agreeing', () => {
    for (const v of [undefined, null, '', '0', String(VexLegal.VERSION - 1), 'yes', '2x', -3, {}]) expect(agreedTo(v, VexLegal.VERSION), String(v)).toBe(false);
  });
});

describe('opening a private window', () => {
  const MAIN = read('src/main.js');
  const fn = MAIN.slice(MAIN.indexOf('function openPrivateWindow('), MAIN.indexOf('secureSessions.newPrivatePartition()', MAIN.indexOf('function openPrivateWindow(')));

  it('is refused before any window or session is made, until the profile has agreed', () => {
    expect(fn).toMatch(/await _refuseBeforeAgreement\(\);/);
    const refuse = MAIN.slice(MAIN.indexOf('function _refuseBeforeAgreement('), MAIN.indexOf('\n}', MAIN.indexOf('function _refuseBeforeAgreement(')));
    // "I agree" may still be on its way to disk (seen live, 2026-10-12).
    expect(refuse.indexOf('await preferences.flush()')).toBeGreaterThan(-1);
    expect(refuse.indexOf('await preferences.flush()')).toBeLessThan(refuse.indexOf('agreedTo('));
    expect(refuse).toMatch(/agreedTo\(_readPersistString\('vex\.legalAcceptedVersion'/);
    // The version is the one the window shows (renderer/js/legal.js).
    expect(MAIN).toMatch(/require\('\.\/renderer\/js\/legal'\)\.VexLegal\.VERSION/);
  });

  it('both the private and the clean (screen-sharing) window go through it', () => {
    expect(MAIN).toMatch(/ipcMain\.handle\('open-private-window', \(_e, look, uiMode(?:, url)?\) => openPrivateWindow\(/);
    expect(MAIN).toMatch(/ipcMain\.handle\('open-clean-window', \(_e, url, look, uiMode\) => openPrivateWindow\(/);
  });

  it('a refusal is said, not dropped (Ctrl+Alt+N, Ctrl+K and the Incognito button all go through VexIncognito.open)', () => {
    const inc = read('src/renderer/js/incognito.js');
    const at = inc.indexOf('openPrivateWindow(');
    expect(at).toBeGreaterThan(-1);
    expect(inc.slice(at)).toMatch(/catch \(err\) \{\s*window\.showToast\?\.\(/);
    expect(read('src/renderer/js/app.js')).toMatch(/register\('private-window', \(\) => VexIncognito\.open\(\)\)/);
    expect(read('src/renderer/js/app.js')).toMatch(/btn-incognito'\)\?\.addEventListener\('click', \(\) => \{ if \(typeof VexIncognito !== 'undefined'\) VexIncognito\.open\(\)/);
    expect(read('src/renderer/js/command.js')).toMatch(/id: 'private'.*VexIncognito\.open\(\)/);
  });

  it('the smoke run that opens one agrees first, as a person would', () => {
    const smoke = read('src/main/security-smoke.js');
    expect(smoke.indexOf('vex.legalAcceptedVersion')).toBeGreaterThan(-1);
    expect(smoke.indexOf('vex.legalAcceptedVersion')).toBeLessThan(smoke.indexOf('openPrivateWindow'));
  });
});

describe('agreeing in the main window', () => {
  beforeEach(() => { localStorage.clear(); });
  it('is written to the profile at once, so a private window opened right after is not refused', async () => {
    const flush = vi.fn(async () => {});
    window.PersistentStorage = { _ready: true, _flush: flush };
    try {
      VexLegal.accept();
      expect(flush).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('vex.legalAcceptedVersion')).toBe(String(VexLegal.VERSION));
    } finally { delete window.PersistentStorage; }
  });
});
