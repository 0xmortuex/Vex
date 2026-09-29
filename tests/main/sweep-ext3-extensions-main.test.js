// @vitest-environment node
//
// The extension fixes of 2026-09-29 that live in main: who may ask for a Vex
// tab, and the shape main.js must keep (it cannot be loaded outside Electron,
// so the rules that matter are checked in its source).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
const path = require('path');
const { pathToFileURL } = require('url');
const { validate } = require('../../src/main/ipc-schemas.js');
const { createSessionSecurity } = require('../../src/main/session-security.js');

const MAIN = fs.readFileSync(path.resolve('src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const between = (from, to) => MAIN.slice(MAIN.indexOf(from), MAIN.indexOf(to, MAIN.indexOf(from)));

describe('extensions:open-tab', () => {
  it('takes one address and an optional "active"', () => {
    expect(() => validate('extensions:open-tab', [{ url: 'https://example.com/' }])).not.toThrow();
    expect(() => validate('extensions:open-tab', [{ url: 'x', active: false }])).not.toThrow();
    expect(() => validate('extensions:open-tab', [{ url: 42 }])).toThrow();
    expect(() => validate('extensions:open-tab', ['https://example.com/'])).toThrow();
  });

  it('is open to an extension page and nothing else outside the interface', () => {
    const security = createSessionSecurity({ session: { fromPartition: () => ({}) }, webContents: { fromId: () => null, getAllWebContents: () => [] }, root: path.resolve('src') });
    const ask = (url) => { const frame = { url }; return security.isAuxiliary({ sender: { mainFrame: frame }, senderFrame: frame }, 'extensions:open-tab'); };
    expect(ask('chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html')).toBe(true);
    expect(ask('https://evil.example/')).toBe(false);
    expect(ask(pathToFileURL(path.resolve('src/renderer/start.html')).toString())).toBe(false);
  });

  it('main opens only web pages and the asking extension’s own pages', () => {
    const fn = between('function _openTabForExtension', '\n}\n');
    expect(fn).toMatch(/url\.protocol === 'chrome-extension:' && url\.host === sender\[1\]/);
    expect(fn).toMatch(/url\.protocol !== 'https:' && url\.protocol !== 'http:'/);
  });
});

describe('main.js extension rules', () => {
  it('an update goes into the installed copy’s folder, so its id and storage stay', () => {
    const activate = between('async function _activateInstalledFolder', '\n}\n');
    expect(activate).toMatch(/_installedCopyOf\(destFolder\)/);
    expect(activate).toMatch(/return _replaceInPlace\(previous, destFolder\)/);
    const replace = between('async function _replaceInPlace', '\n}\n');
    // The new files take the old folder's path; the old ones come back if the new fail.
    expect(replace).toMatch(/fs\.renameSync\(staged, previous\.path\)/);
    expect(replace).toMatch(/fs\.renameSync\(backup, previous\.path\)/);
  });

  it('safe mode saves "on" without loading the extension', () => {
    const handler = between("ipcMain.handle('extensions:set-enabled'", '\n});\n');
    const guard = handler.indexOf('if (_boot.safeMode) return { ok: true, enabled: true, afterRestart: true }');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(handler.indexOf('_loadExtensionEverywhere(extPath)'));
  });

  it('the popup is sized by its content size with the window briefly resizable, and moved first', () => {
    const fn = between('function _setPopupContentSize', '\n}\n');
    expect(fn.indexOf('setPosition')).toBeLessThan(fn.indexOf('setContentSize'));
    expect(fn).toMatch(/setResizable\(true\);\n\s*win\.setContentSize\(w, h\);\n\s*win\.setResizable\(false\)/);
    expect(between("ipcMain.handle('extensions:open-popup'", '\n});\n')).not.toMatch(/win\.setSize\(/);
  });

  it('the popup opens links as tabs, closes on Escape, and lives in the tab’s container', () => {
    const popup = between("ipcMain.handle('extensions:open-popup'", '\n});\n');
    expect(popup).toMatch(/setWindowOpenHandler/);
    expect(popup).toMatch(/input\.key === 'Escape'/);
    expect(popup).toMatch(/tabUnder\.session\.getAllExtensions\(\)\.some\(isThis\)\) ses = tabUnder\.session/);
  });

  it('an MV3 extension whose worker never starts is reported, not shown as working', () => {
    const fn = between('function _checkBackgroundStarts', '\n}\n');
    expect(fn).toMatch(/startWorkerForScope/);
    expect(fn).toMatch(/_extLoadErrors\.set\(folder, why\)/);
  });
});
