// The main-process half of Undo instead of "Are you sure?" (js/vex-undo.js):
// an uninstalled extension waits in REMOVING_FILE until its toast goes, and
// Clear all site permissions keeps what it cleared for its Undo.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const ext = require('../../src/main/extensions.js');
const { createPermissionService } = require('../../src/main/permissions.js');
const { validate } = require('../../src/main/ipc-schemas.js');

const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const between = (start, end) => { const i = mainSrc.indexOf(start); expect(i).toBeGreaterThan(-1); return mainSrc.slice(i, mainSrc.indexOf(end, i)); };

describe('extensions being uninstalled', () => {
  it('are listed in their own file, which goes when the list is empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-item9-ext-'));
    expect(ext.readRemoving(dir)).toEqual({});
    ext.writeRemoving(dir, { 'dark-reader-1': { at: 5 } });
    expect(ext.readRemoving(dir)).toEqual({ 'dark-reader-1': { at: 5 } });
    ext.writeRemoving(dir, {});
    expect(fs.existsSync(path.join(dir, ext.REMOVING_FILE))).toBe(false);
    fs.writeFileSync(path.join(dir, ext.REMOVING_FILE), '[1]');
    expect(() => ext.readRemoving(dir)).toThrow(/corrupt/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('load nowhere, are not listed or updated, and are removed at quit and at the next start', () => {
    expect(between('function _installedEntries', '\n}\n')).toMatch(/!removing\[e\.folder\]/);
    expect(between('function _extEntries()', '\n}\n')).toMatch(/_installedEntries\(\)/);
    expect(between("ipcMain.handle('extensions:list'", '\n});\n')).toMatch(/filter\(e => !removing\[e\.folder\]\)/);
    expect(between('async function loadAllExtensionsOnStartup', '\n}\n').indexOf("_finishPendingRemovals('start')"))
      .toBeLessThan(between('async function loadAllExtensionsOnStartup', '\n}\n').indexOf('_loadExtensionEverywhere'));
    expect(mainSrc).toMatch(/app\.on\('will-quit', \(\) => _finishPendingRemovals\('quit'\)\)/);
  });

  it('Undo turns it back on only if it was on, and the final removal drops its toolbar pin', () => {
    const undo = between("ipcMain.handle('extensions:uninstall-undo'", '\n});\n');
    expect(undo).toMatch(/!_readDisabledFolders\(\)\.has\(folderName\)/);
    expect(undo).toMatch(/_loadExtensionEverywhere\(extPath\)/);
    const remove = between('function _removeExtensionFolder', '\n}\n');
    expect(remove).toMatch(/pins\.filter\(f => f !== folderName\)/);
    expect(remove).toMatch(/delete removing\[folderName\]/);
  });

  it('the new channels have schemas', () => {
    expect(() => validate('extensions:uninstall-later', ['dark-reader-1'])).not.toThrow();
    expect(() => validate('extensions:uninstall-undo', [5])).toThrow();
    expect(() => validate('permissions:clear-undo', ['0123456789abcdef0123456789abcdef'])).not.toThrow();
    expect(() => validate('permissions:clear-undo', ['nope'])).toThrow();
  });
});

describe('Clear all site permissions, and its Undo', () => {
  it('puts back every decision, a container’s too, and keeps one made since', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-item9-perm-'));
    const svc = createPermissionService({
      userDataPath: dir,
      secureSessions: { partitionOf: (c) => c.partition, owner: () => null },
      ipcMain: { on: vi.fn(), handle: vi.fn() }, _markHidRequestActive: () => {},
    });
    await svc.savePermissionDecisions({
      'https://a.test::media': 'allow',
      'https://b.test::notifications': 'block',
      __until__: { 'https://a.test::media': 99 },
    });
    const before = svc.loadPermissionDecisions();
    const kept = await svc.clearAllDecisions();
    expect(svc.loadPermissionDecisions()).toEqual({});
    await svc.savePermissionDecisions({ 'https://b.test::notifications': 'allow' });   // decided again since
    await svc.restoreDecisions(kept);
    expect(svc.loadPermissionDecisions()).toEqual({ ...before, 'https://b.test::notifications': 'allow' });
    await svc.flushPermissions();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('main keeps the cleared decisions behind a one-time token', () => {
    const clear = between("ipcMain.handle('permissions:clear-all'", '\n});\n');
    expect(clear).toMatch(/return \{ ok: true, undo: token \}/);
    const undo = between("ipcMain.handle('permissions:clear-undo'", '\n});\n');
    expect(undo).toMatch(/_clearedPermissions\.delete\(token\)/);
  });
});
