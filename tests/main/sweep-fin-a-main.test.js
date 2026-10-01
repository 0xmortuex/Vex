// @vitest-environment node
//
// Fixes of 2026-09-29 in main (fin-a): Vencord reinstall keeps its id, safe
// mode installs without loading, popups size to their content both ways,
// Clear History leaves no old tab list in a .bak, and the shortcut editor can
// record the keys main handles itself. main.js cannot be loaded outside
// Electron, so its rules are checked in its source.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
const path = require('path');
const { validate } = require('../../src/main/ipc-schemas.js');
const { clampPopupSize } = require('../../src/main/extensions.js');

const read = f => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');
const MAIN = read('src/main.js');
const between = (from, to) => MAIN.slice(MAIN.indexOf(from), MAIN.indexOf(to, MAIN.indexOf(from)));

describe('Vencord reinstall updates in place', () => {
  it('no install path deletes the old build first', () => {
    expect(MAIN).not.toMatch(/_removeExtBySlugPrefix/);
    const official = between("ipcMain.handle('discord:install-vencord'", '\n});\n');
    const local = between("ipcMain.handle('discord:install-vencord-local'", '\n});\n');
    for (const handler of [official, local]) {
      expect(handler).toMatch(/_installExtFromZipBuffer\(buf, 'vencord', _installedVencord\(\)\)/);
      expect(handler).not.toMatch(/_installExtFromZipBuffer\(buf, 'vencord'\)/);
    }
  });

  it('the installed build is handed down to the in-place replace', () => {
    expect(between('async function _installExtFromZipBuffer', '\n}\n')).toMatch(/_activateInstalledFolder\(destFolder, copyToUpdate\)/);
    expect(between('async function _activateInstalledFolder', '\n}\n')).toMatch(/previous = copyToUpdate \|\| _installedCopyOf\(destFolder\)/);
    const find = between('function _installedVencord', '\n}\n');
    expect(find).toMatch(/_extEntriesOnDisk\(\)/);
    expect(find).toMatch(/\^vencord-/);
  });
});

describe('safe mode installs without loading', () => {
  it('a new install stops before loading', () => {
    const fn = between('async function _activateInstalledFolder', '\n}\n');
    const guard = fn.indexOf('if (_boot.safeMode)');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(fn.indexOf('_loadExtensionEverywhere(destFolder)'));
    expect(fn).toMatch(/afterRestart: true/);
  });

  it('an update puts the files in place and stops before loading, and a failure does not reload the old one', () => {
    const fn = between('async function _replaceInPlace', '\n}\n');
    const guard = fn.indexOf('if (_boot.safeMode) {');
    expect(guard).toBeGreaterThan(fn.indexOf('fs.renameSync(staged, previous.path)'));
    expect(guard).toBeLessThan(fn.indexOf('await _loadExtensionEverywhere(previous.path);\n  if (!extension)'));
    expect(fn).toMatch(/if \(wasDisabled \|\| _boot\.safeMode\) return;/);
  });

  it('the manager says it loads after a normal restart', () => {
    const src = read('src/renderer/js/extensions-settings.js');
    const fn = new Function(`${src.match(/function _installedText\(r\) \{[\s\S]*?\n  \}/)[0]}; return _installedText;`)();
    expect(fn({ name: 'Stylus', version: '2.3', afterRestart: true })).toBe('Installed Stylus v2.3 — it loads when Vex restarts normally');
    expect(fn({ name: 'Stylus', version: '2.3' })).toBe('Installed: Stylus v2.3');
    expect(fn({ name: 'Stylus', version: '2.3', disabled: true })).toBe('Installed: Stylus v2.3 — still switched off');
  });
});

describe('extension popups size to their content', () => {
  it('clamps to Chrome’s 25x25 … 800x600', () => {
    expect(clampPopupSize(246, 117)).toEqual([246, 117]);
    expect(clampPopupSize(10, 5)).toEqual([25, 25]);
    expect(clampPopupSize(2000, 1500)).toEqual([800, 600]);
    expect(clampPopupSize(245.2, 116.1)).toEqual([246, 117]);
    expect(() => clampPopupSize(NaN, 100)).toThrow(TypeError);
  });

  it('the preferred size is the target, and the page is then measured only to grow', () => {
    const popup = between("ipcMain.handle('extensions:open-popup'", '\n});\n');
    expect(popup).toMatch(/on\('preferred-size-changed', \(_event, size\) => \{\n\s*preferred = size;/);
    expect(popup).toMatch(/extHelpers\.clampPopupSize\(preferred\.width, preferred\.height\)/);
    expect(popup).toMatch(/if \(size\.w <= size\.iw && size\.h <= size\.ih\) return;/);
    // The old floor that kept small popups at 160x100 and bigger is gone.
    expect(popup).not.toMatch(/Math\.max\(160,/);
    expect(popup).not.toMatch(/win\.setSize\(/);
  });
});

describe('Clear History', () => {
  it('replaces the tab list backups with the current files', () => {
    const fn = between("ipcMain.handle('browsing:clear-history'", '\n});\n');
    expect(fn).toMatch(/for \(const key of \['tabs', 'groups', 'stacks'\]\)/);
    expect(fn).toMatch(/dataStore\.enqueue\(key,/);
    expect(fn).toMatch(/fs\.promises\.copyFile\(file, file \+ '\.bak'\)/);
    expect(fn).toMatch(/if \(err\.code !== 'ENOENT'\) throw err;/);
  });
});

describe('shortcuts:capturing', () => {
  it('takes one boolean', () => {
    expect(() => validate('shortcuts:capturing', [true])).not.toThrow();
    expect(() => validate('shortcuts:capturing', [false])).not.toThrow();
    expect(() => validate('shortcuts:capturing', ['yes'])).toThrow();
    expect(() => validate('shortcuts:capturing', [])).toThrow();
  });

  it('the preload offers setShortcutCapturing', () => {
    expect(read('src/preload.js')).toMatch(/setShortcutCapturing: \(on\) => ipcRenderer\.invoke\('shortcuts:capturing', on\)/);
  });

  it('only the main window’s own page may set it, and it clears itself', () => {
    const handler = between("ipcMain.handle('shortcuts:capturing'", '\n});\n');
    expect(handler).toMatch(/event\.sender !== mainWindow\.webContents/);
    expect(handler).toMatch(/event\.senderFrame !== mainWindow\.webContents\.mainFrame/);
    expect(MAIN).toMatch(/const SHORTCUT_CAPTURE_MS = 15000;/);
    expect(between('function _setShortcutCapturing', '\n}\n')).toMatch(/setTimeout\(\(\) => \{ _shortcutCapturing = false;/);
    expect(MAIN).toMatch(/mainWindow\.on\('blur', \(\) => _setShortcutCapturing\(false\)\);/);
  });

  it('the main window’s key handler stands aside first, before F11/F12 and every Ctrl key', () => {
    const handler = between("mainWindow.webContents.on('before-input-event'", '\n  });\n');
    const guard = handler.indexOf('if (_shortcutCapturing) return;');
    expect(guard).toBeGreaterThan(0);
    for (const later of ["input.key === 'k'", "input.key === 't'", 'handleFullscreenShortcut(event, input)', 'handleDevToolsShortcut(event, input)']) {
      expect(guard).toBeLessThan(handler.indexOf(later));
    }
  });
});
