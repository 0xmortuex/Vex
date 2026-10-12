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

describe('the site panel’s Reset of one site’s permissions, and its Undo', () => {
  function service(dir) {
    return createPermissionService({
      userDataPath: dir,
      secureSessions: { partitionOf: (c) => c.partition, owner: () => null },
      ipcMain: { on: vi.fn(), handle: vi.fn() }, _markHidRequestActive: () => {},
    });
  }
  const page = (partition, session = {}) => ({ partition, session });

  it('puts back every answer of the site, its "for a day" end and its "this visit" answers, in the page’s store', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-item9b-reset-'));
    const svc = service(dir);
    const main = page('persist:main');
    await svc.savePermissionDecisions({
      'https://news.test::geolocation': 'deny',
      'https://news.test::camera': 'allow',
      'https://other.test::camera': 'allow',
      __until__: { 'https://news.test::camera': 4102444800000 },
    });
    svc.sessionDecisionsFor(main).set('https://news.test::microphone', 'allow');
    const before = JSON.stringify(svc.decisionsFor(main));
    const snap = await svc.resetPageDecisions(main, 'https://news.test/a/b');
    expect(svc.decisionsFor(main)).toEqual({ 'https://other.test::camera': 'allow' });
    expect(svc.sessionDecisionsFor(main).has('https://news.test::microphone')).toBe(false);
    await svc.restorePageDecisions(snap);
    expect(svc.decisionsFor(main)).toEqual(JSON.parse(before));
    expect(svc.sessionDecisionsFor(main).get('https://news.test::microphone')).toBe('allow');
    await svc.flushPermissions();
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'permissions.json'), 'utf8'))).toEqual(JSON.parse(before));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a container’s answers go back to the container, and an answer given since wins', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-item9b-reset-'));
    const svc = service(dir);
    const work = page('persist:container-work');
    await svc.setPageDecision(work, 'https://news.test', 'geolocation', 'deny');
    await svc.setPageDecision(work, 'https://news.test', 'notifications', 'allow');
    const snap = await svc.resetPageDecisions(work, 'https://news.test');
    expect(svc.decisionsFor(work)).toEqual({});
    await svc.setPageDecision(work, 'https://news.test', 'notifications', 'deny');   // decided again since
    await svc.restorePageDecisions(snap);
    expect(svc.decisionsFor(work)).toEqual({ 'https://news.test::geolocation': 'deny', 'https://news.test::notifications': 'deny' });
    expect(svc.decisionsFor(page('persist:main'))).toEqual({});
    await svc.flushPermissions();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a private window’s answers are reset and put back in memory, and nothing is written to disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-item9b-reset-'));
    const svc = service(dir);
    const priv = page('private-1', {});
    await svc.setPageDecision(priv, 'https://news.test', 'camera', 'allow');
    const snap = await svc.resetPageDecisions(priv, 'https://news.test');
    expect(svc.decisionsFor(priv)).toEqual({});
    await svc.restorePageDecisions(snap);
    expect(svc.decisionsFor(priv)).toEqual({ 'https://news.test::camera': 'allow' });
    await svc.flushPermissions();
    expect(fs.readdirSync(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('main hands the reset back behind a one-time token only the same window may use', () => {
    const reset = between("ipcMain.handle('permissions:reset-for-page'", '\n});\n');
    expect(reset).toMatch(/return \{ decisions: .*, undo: token \}/);
    expect(reset).toMatch(/sender: e\.sender\.id/);
    const undo = between("ipcMain.handle('permissions:reset-for-page-undo'", '\n});\n');
    expect(undo).toMatch(/kept\.sender !== e\.sender\.id/);
    expect(undo).toMatch(/_resetPagePermissions\.delete\(token\)/);
    expect(() => validate('permissions:reset-for-page-undo', ['0123456789abcdef0123456789abcdef'])).not.toThrow();
    expect(() => validate('permissions:reset-for-page-undo', [7])).toThrow();
    // Not "permissions:clear…": a private window may put back its own answers.
    const policySrc = fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
    const PRIVATE_DISABLED = new RegExp(policySrc.match(/const PRIVATE_DISABLED = \/(.*)\/;/)[1]);
    expect(PRIVATE_DISABLED.test('permissions:reset-for-page-undo')).toBe(false);
    expect(PRIVATE_DISABLED.test('permissions:reset-for-page')).toBe(false);
  });
});
