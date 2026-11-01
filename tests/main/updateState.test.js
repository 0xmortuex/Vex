// @vitest-environment node
//
// "Update now" must never do nothing silently (owner report 2026-11-01: the
// update was recognised, and after launching Vex nothing had happened). Each
// way it could do nothing is reproduced here with fakes, then shown to be
// visible: src/main/update-state.js (log, staged download, install marker,
// rollback state machine) and the parts of src/main/updates.js that use it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const { createUpdater } = require('../../src/main/updates.js');
const S = require('../../src/main/update-state.js');
const { parseChangelogList, addTurkishNotes } = require('../../src/main-helpers.js');

const sha = buf => crypto.createHash('sha512').update(buf).digest('base64');
const INSTALLER = Buffer.alloc(300 * 1024, 7);
const yml = ({ version = '2.35.0', body = INSTALLER, url = 'Vex-Setup.exe' } = {}) => `version: ${version}
files:
  - url: ${url}
    sha512: ${sha(body)}
    size: ${body.length}
path: ${url}
sha512: ${sha(body)}
releaseDate: '2026-10-02T10:00:00.000Z'
`;
const GH_YML = 'https://github.com/0xmortuex/Vex/releases/latest/download/latest.yml';
const exeUrl = v => `https://github.com/0xmortuex/Vex/releases/download/v${v}/Vex-Setup.exe`;

let dir, routes, fetch, log, journal;
const respond = (body, { status = 200, length } = {}) => {
  const headers = new Headers();
  if (length != null) headers.set('content-length', String(length));
  return new Response(body, { status, headers });
};
function newUpdater(over = {}) {
  const j = S.createUpdateLog({ fs, dir, warn: () => {} });
  journal = j;
  return createUpdater({
    fetch, fs, dir, currentVersion: '2.34.5', env: {}, spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn(), pid: 4242 })), log,
    parseChangelogList, addTurkishNotes, platform: 'win32',
    journal: j, staged: S.createStagedStore({ fs, dir }), copy: { kind: 'installed', folder: 'C:\\Vex' }, ...over,
  });
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-updstate-'));
  routes = new Map();
  fetch = vi.fn(async (url) => { const h = routes.get(url); return h ? h() : respond('nope', { status: 404 }); });
  log = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  routes.set(GH_YML, () => respond(yml()));
  routes.set(exeUrl('2.35.0'), () => respond(INSTALLER, { length: INSTALLER.length }));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('hypothesis (a)/(b): a download that is not installed in the same run is not forgotten', () => {
  it('a downloaded update survives a restart, and can be installed without a new check or download', async () => {
    const first = newUpdater();
    await first.check();
    expect((await first.download('2.35.0')).ok).toBe(true);
    // Vex is closed any other way than through "Update now": a new process, a new updater.
    fetch.mockClear();
    const second = newUpdater();
    expect(second.stagedUpdate()).toBe(null);
    expect(second.restoreStaged()).toEqual({ version: '2.35.0', size: INSTALLER.length });
    expect(second.stagedUpdate()).toEqual({ version: '2.35.0', size: INSTALLER.length });
    const plan = await second.prepareInstall('2.35.0');
    expect(plan.file).toBe(path.join(dir, 'Vex-Setup-2.35.0.exe'));
    expect(fetch).not.toHaveBeenCalled();
    // The tidy-up after start does not delete it, nor the log and records.
    second.cleanup();
    expect(fs.existsSync(plan.file)).toBe(true);
    expect(fs.existsSync(path.join(dir, S.LOG_FILE))).toBe(true);
    expect(fs.existsSync(path.join(dir, S.STAGED_FILE))).toBe(true);
  });

  it('a staged file that was tampered with while Vex was closed is refused and forgotten', async () => {
    const first = newUpdater(); await first.check(); await first.download('2.35.0');
    fs.appendFileSync(path.join(dir, 'Vex-Setup-2.35.0.exe'), 'x');
    const second = newUpdater(); second.restoreStaged();
    await expect(second.prepareInstall('2.35.0')).rejects.toThrow(/changed on disk/);
    expect(second.stagedUpdate()).toBe(null);
    expect(fs.existsSync(path.join(dir, S.STAGED_FILE))).toBe(false);
    expect(journal.tail().join('\n')).toMatch(/PROBLEM: the downloaded update changed on disk/);
  });

  it('a record whose file is gone is dropped, and said', async () => {
    const first = newUpdater(); await first.check(); await first.download('2.35.0');
    fs.rmSync(path.join(dir, 'Vex-Setup-2.35.0.exe'));
    const second = newUpdater();
    expect(second.restoreStaged()).toBe(null);
    expect(fs.existsSync(path.join(dir, S.STAGED_FILE))).toBe(false);
    expect(journal.tail().join('\n')).toMatch(/PROBLEM: the downloaded update 2\.35\.0 is no longer on disk/);
  });

  it('after the update did happen (running that version), the record is cleared as a success', async () => {
    const first = newUpdater(); await first.check(); await first.download('2.35.0');
    const after = newUpdater({ currentVersion: '2.35.0' });
    expect(after.restoreStaged()).toBe(null);
    expect(fs.existsSync(path.join(dir, S.STAGED_FILE))).toBe(false);
    expect(journal.tail().join('\n')).toMatch(/2\.35\.0 is installed/);
  });

  it('a damaged record is not trusted: dropped with a problem line, never thrown away silently', () => {
    fs.writeFileSync(path.join(dir, S.STAGED_FILE), '{not json');
    const u = newUpdater();
    expect(u.restoreStaged()).toBe(null);
    expect(journal.tail().join('\n')).toMatch(/PROBLEM: the record of a downloaded update is unreadable/);
  });
});

describe('hypothesis (e): an installer staged for an older version does not block a newer one', () => {
  it('downloading a newer release replaces the older staged file and record', async () => {
    const first = newUpdater(); await first.check(); await first.download('2.35.0');
    const NEWER = Buffer.alloc(200 * 1024, 9);
    routes.set(GH_YML, () => respond(yml({ version: '2.36.0', body: NEWER })));
    routes.set(exeUrl('2.36.0'), () => respond(NEWER, { length: NEWER.length }));
    const second = newUpdater(); second.restoreStaged();
    expect(second.stagedUpdate().version).toBe('2.35.0');
    await second.check();
    expect((await second.download('2.36.0')).ok).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual([S.LOG_FILE, S.STAGED_FILE, 'Vex-Setup-2.36.0.exe'].sort());
    expect(JSON.parse(fs.readFileSync(path.join(dir, S.STAGED_FILE), 'utf8')).version).toBe('2.36.0');
    await expect(second.prepareInstall('2.35.0')).rejects.toThrow(/Download the update first/);
  });
});

describe('a copy run from a folder (dist\\win-unpacked) is updated in place; source is not updatable', () => {
  let appDir, folder;
  beforeEach(() => {
    // Spaces in the path, like C:\Claude code free\vex\dist\win-unpacked; outside the updates folder, which the tidy-up empties.
    appDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vex-app-')), 'win unpacked dir');
    fs.mkdirSync(appDir);
    folder = { kind: 'folder', folder: appDir };
  });
  afterEach(() => { fs.rmSync(path.dirname(appDir), { recursive: true, force: true }); });
  const standInFeed = (feed = 'http://127.0.0.1:17100/') => {
    const standIn = Buffer.from('@echo off\r\n');
    routes.set(feed + 'latest.yml', () => respond(yml({ body: standIn, url: 'stand-in.cmd' })));
    routes.set(feed + 'stand-in.cmd', () => respond(standIn, { length: standIn.length }));
    return { VEX_UPDATE_FEED: feed, ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
  };

  it('is updatable and says where: the check carries the folder the update goes into', async () => {
    const r = await newUpdater({ copy: folder }).check();
    expect(r).toMatchObject({ ok: true, hasUpdate: true, canSelfUpdate: true, inPlaceFolder: appDir, copy: { kind: 'folder' } });
  });

  it('an installed copy has no in-place folder and keeps today\'s exact arguments (no /D)', async () => {
    const spawn = vi.fn(() => ({ on: vi.fn(), unref: vi.fn(), pid: 1 }));
    const u = newUpdater({ spawn }); expect((await u.check()).inPlaceFolder).toBe(null);
    await u.download('2.35.0');
    const plan = await u.prepareInstall('2.35.0');
    expect(plan.args).toEqual(['--updated', '/S', '--force-run']);
    expect(plan.target).toBeUndefined();
    u.launch(plan);
    expect(spawn).toHaveBeenCalledWith(plan.file, ['--updated', '/S', '--force-run'], expect.not.objectContaining({ windowsVerbatimArguments: true }));
  });

  it('a folder copy passes /D=<its folder> LAST, unquoted, and the command line is written by hand so spaces survive', async () => {
    const spawn = vi.fn(() => ({ on: vi.fn(), unref: vi.fn(), pid: 7 }));
    const u = newUpdater({ copy: folder, spawn }); await u.check(); await u.download('2.35.0');
    const plan = await u.prepareInstall('2.35.0');
    expect(plan.args).toEqual(['--updated', '/S', '--force-run', '/D=' + appDir]);
    expect(plan.args[plan.args.length - 1]).toMatch(/^\/D=.*win unpacked dir$/);
    expect(plan.target).toBe(appDir);
    u.launch(plan);
    expect(spawn).toHaveBeenCalledWith(plan.file, plan.args, expect.objectContaining({ detached: true, windowsVerbatimArguments: true, argv0: `"${plan.file}"` }));
    expect(journal.tail().join('\n')).toContain(`the update goes into its own folder, ${appDir}`);
    expect(journal.tail().join('\n')).toContain('/D=' + appDir);
  });

  it('a trailing backslash is dropped, and a folder that is not an absolute drive path is refused', () => {
    expect(S.installerArgs(['/S'], 'C:\\Vex Dir\\')).toEqual(['/S', '/D=C:\\Vex Dir']);
    expect(() => S.installerArgs(['/S'], 'relative\\dir')).toThrow(/will not update into this folder/);
    expect(() => S.installerArgs(['/S'], 'C:\\a"b')).toThrow(/will not update into this folder/);
  });

  it('the .cmd stand-in under the test feed gets the same arguments, recorded exactly through cmd.exe', async () => {
    const spawn = vi.fn(() => ({ on: vi.fn(), unref: vi.fn(), pid: 7 }));
    const u = newUpdater({ copy: folder, spawn, env: standInFeed() });
    expect((await u.check()).canSelfUpdate).toBe(true);
    await u.download('2.35.0');
    const plan = await u.prepareInstall('2.35.0');
    u.launch(plan);
    const call = spawn.mock.calls[0];
    expect(call[0]).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(call[1]).toEqual(['/d', '/s', '/c', `""${plan.file}" --updated /S --force-run /D=${appDir}"`]);
    expect(call[2]).toMatchObject({ windowsVerbatimArguments: true });
  });

  it('a folder that cannot be written (Program Files without admin) is a visible error before anything runs', async () => {
    const first = newUpdater({ copy: folder }); await first.check(); await first.download('2.35.0');
    const noWrite = { ...fs, writeFileSync: (f, ...a) => { if (String(f).includes('.vex-update-write-test')) throw Object.assign(new Error('denied'), { code: 'EPERM' }); return fs.writeFileSync(f, ...a); } };
    const u = newUpdater({ copy: { kind: 'folder', folder: appDir }, fs: noWrite, env: { ProgramFiles: path.dirname(appDir) } });
    await u.check(); await u.download('2.35.0');
    const err = await u.prepareInstall('2.35.0').catch(e => e);
    expect(err.code).toBe('not-writable');
    expect(err.message).toMatch(/cannot write to its own folder .*EPERM/);
    expect(err.message).toMatch(/inside Program Files/);
    expect(journal.tail().join('\n')).toMatch(/PROBLEM: refused to install 2\.35\.0 into /);
  });

  it('the not-installed notice and the rollback use the same /D target', async () => {
    const hashFile = S.hashFileWith(fs);
    const base = path.join(dir, 'Vex-Setup-2.34.5.exe'); fs.writeFileSync(base, 'old');
    const m = v => S.createRollback({ fs, dir, currentVersion: v, hashFile });
    await m('2.34.5').arm({ from: '2.34.5', to: '2.35.0', baseFile: base, target: appDir });
    expect(m('2.34.5').onStart()).toMatchObject({ kind: 'not-installed', target: appDir });
    m('2.34.5').acknowledge();
    await m('2.34.5').arm({ from: '2.34.5', to: '2.35.0', baseFile: base, target: appDir });
    for (let i = 0; i < 2; i++) m('2.35.0').onStart();
    const decision = m('2.35.0').onStart();
    expect(decision).toMatchObject({ kind: 'rollback', target: appDir });
    const u = newUpdater({ copy: folder });
    const plan = u.planFor(await m('2.35.0').checkedBase(decision.base), decision.target);
    expect(plan.args).toEqual(['--updated', '/S', '--force-run', '/D=' + appDir]);
    expect(u.planFor(base, null).args).toEqual(['--updated', '/S', '--force-run']);
  });

  describe('a folder copy next to a registered install in another folder', () => {
    const INSTALLED = 'C:\\Users\\USER\\AppData\\Local\\Programs\\Vex';
    it('never gets /D: the installer runs exactly as for an installed copy, and the log names the installed Vex', async () => {
      const spawn = vi.fn(() => ({ on: vi.fn(), unref: vi.fn(), pid: 3 }));
      const u = newUpdater({ copy: { ...folder, other: INSTALLED }, spawn });
      const r = await u.check();
      expect(r).toMatchObject({ canSelfUpdate: true, otherInstall: INSTALLED, inPlaceFolder: null });
      await u.download('2.35.0');
      const plan = await u.prepareInstall('2.35.0');
      expect(plan.args).toEqual(['--updated', '/S', '--force-run']);
      expect(plan.target).toBeUndefined();
      u.launch(plan);
      expect(spawn).toHaveBeenCalledWith(plan.file, ['--updated', '/S', '--force-run'], expect.not.objectContaining({ windowsVerbatimArguments: true }));
      const text = journal.tail().join('\n');
      expect(text).toContain(`Vex is installed in ${INSTALLED}: the update goes into the installed Vex (no /D)`);
      expect(text).not.toContain('/D=');
      // The folder is not even probed for writing: nothing of this copy is touched.
      expect(fs.readdirSync(appDir)).toEqual([]);
    });
    it('the rollback for it also has no /D', async () => {
      const u = newUpdater({ copy: { ...folder, other: INSTALLED } });
      expect(u.planFor('x.exe', null).args).toEqual(['--updated', '/S', '--force-run']);
    });
    it('findRegisteredInstall: Uninstall key with InstallLocation, Programs\\Vex, a same-folder hit is not "another"', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-reg-'));
      const inst = path.join(root, 'Programs', 'Vex'); fs.mkdirSync(inst, { recursive: true });
      fs.writeFileSync(path.join(inst, 'Vex.exe'), ''); fs.writeFileSync(path.join(inst, 'Uninstall Vex.exe'), '');
      try {
        const reg = `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{GUID}\r\n    DisplayName    REG_SZ    Vex\r\n    InstallLocation    REG_SZ    ${inst}\r\n`;
        expect(S.findRegisteredInstall({ fs, env: {}, regQuery: key => (key.startsWith('HKCU') ? reg : '') })).toEqual({ folder: inst });
        expect(S.findRegisteredInstall({ fs, env: { LOCALAPPDATA: root }, regQuery: () => '' })).toEqual({ folder: inst });
        expect(S.findRegisteredInstall({ fs, env: {}, regQuery: () => '' })).toBe(null);
        // A registry entry whose folder is gone is not an install.
        expect(S.findRegisteredInstall({ fs, env: {}, regQuery: () => reg.replace(inst, path.join(root, 'gone')) })).toBe(null);
        const found = { folder: inst };
        expect(S.withOtherInstall({ kind: 'folder', folder: inst }, found)).toEqual({ kind: 'folder', folder: inst });
        expect(S.withOtherInstall({ kind: 'folder', folder: appDir }, found)).toEqual({ kind: 'folder', folder: appDir, other: inst });
        expect(S.withOtherInstall({ kind: 'installed', folder: inst }, found).other).toBeUndefined();
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('if Vex cannot tell whether another install exists, the folder copy is not updated (visible reason)', async () => {
      const u = newUpdater({ copy: { ...folder, unknownInstall: 'reg.exe failed' } });
      const r = await u.check();
      expect(r.canSelfUpdate).toBe(false);
      expect(r.cannotUpdateReason).toMatch(/could not tell whether another Vex is installed \(reg\.exe failed\)/);
      expect((await u.download('2.35.0')).code).toBe('not-installed');
    });
  });

  it('a staged download is also installed in place after a restart', async () => {
    const first = newUpdater({ copy: folder }); await first.check(); await first.download('2.35.0');
    const second = newUpdater({ copy: folder }); second.restoreStaged();
    expect((await second.prepareInstall('2.35.0')).target).toBe(appDir);
  });

  it('source (npm start) is not updatable, and says why; download and install are refused', async () => {
    const dev = { kind: 'dev', folder: 'C:\\src' };
    const u = newUpdater({ copy: dev });
    const r = await u.check();
    expect(r.canSelfUpdate).toBe(false);
    expect(r.cannotUpdateReason).toMatch(/running from source code/);
    fetch.mockClear();
    expect(await u.download('2.35.0')).toMatchObject({ ok: false, code: 'not-installed' });
    expect(fetch).not.toHaveBeenCalled();
    const first = newUpdater(); await first.check(); await first.download('2.35.0');
    const second = newUpdater({ copy: dev }); second.restoreStaged();
    await expect(second.prepareInstall('2.35.0')).rejects.toThrow(/source code/);
  });

  it('the test feed lets source act as an updatable copy for the stand-in', async () => {
    const u = newUpdater({ copy: { kind: 'dev', folder: 'C:\\src' }, env: standInFeed() });
    expect((await u.check()).canSelfUpdate).toBe(true);
    expect((await u.download('2.35.0')).ok).toBe(true);
  });

  it('installKind: Vex.exe beside "Uninstall Vex.exe" is installed; a bare folder and source are not', () => {
    const installed = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-kind-'));
    fs.writeFileSync(path.join(installed, 'Vex.exe'), '');
    fs.writeFileSync(path.join(installed, 'Uninstall Vex.exe'), '');
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-kind-'));
    fs.writeFileSync(path.join(bare, 'Vex.exe'), '');
    try {
      expect(S.installKind({ execPath: path.join(installed, 'Vex.exe'), isPackaged: true, fs }).kind).toBe('installed');
      expect(S.installKind({ execPath: path.join(bare, 'Vex.exe'), isPackaged: true, fs }).kind).toBe('folder');
      expect(S.installKind({ execPath: path.join(bare, 'electron.exe'), isPackaged: false, fs }).kind).toBe('dev');
      expect(() => S.installKind({ execPath: path.join(bare, 'gone', 'Vex.exe'), isPackaged: true, fs })).toThrow(/could not look at its own folder/);
    } finally { fs.rmSync(installed, { recursive: true, force: true }); fs.rmSync(bare, { recursive: true, force: true }); }
  });
});

describe('hypotheses (c), (f), (g), (h): a failure is in the log and the install is never a silent no-op', () => {
  it('a checksum failure is shown in the result and written to the log', async () => {
    const tampered = Buffer.from(INSTALLER); tampered[1000] ^= 1;
    routes.set(exeUrl('2.35.0'), () => respond(tampered, { length: tampered.length }));
    const u = newUpdater(); await u.check();
    const r = await u.download('2.35.0');
    expect(r).toMatchObject({ ok: false, code: 'checksum' });
    expect(journal.tail().join('\n')).toMatch(/PROBLEM: downloading 2\.35\.0 failed \(checksum\)/);
    expect(fs.existsSync(path.join(dir, S.STAGED_FILE))).toBe(false);
  });

  it('a network failure and a 404 are in the log too', async () => {
    const u = newUpdater(); await u.check();
    routes.delete(exeUrl('2.35.0'));
    expect((await u.download('2.35.0')).ok).toBe(false);
    expect(journal.tail().join('\n')).toMatch(/PROBLEM: downloading 2\.35\.0 failed \(http\)/);
  });

  it('the log has a line for each step: check, download, verify, install start', async () => {
    const spawn = vi.fn(() => ({ on: vi.fn(), unref: vi.fn(), pid: 99 }));
    const u = newUpdater({ spawn }); await u.check(); await u.download('2.35.0');
    u.launch(await u.prepareInstall('2.35.0'));
    const text = journal.tail().join('\n');
    expect(text).toMatch(/checked: running 2\.34\.5, newest 2\.35\.0 \(an update is available\)/);
    expect(text).toMatch(/downloading 2\.35\.0/);
    expect(text).toMatch(/downloaded and verified 2\.35\.0/);
    expect(text).toMatch(/checked the downloaded 2\.35\.0 again before installing/);
    expect(text).toMatch(/installer started \(Vex-Setup-2\.35\.0\.exe --updated \/S --force-run\), pid 99/);
  });

  it('an installer that Windows will not start (no pid: blocked, missing, not allowed) throws and is logged', async () => {
    const spawn = vi.fn(() => ({ on: vi.fn(), unref: vi.fn(), pid: undefined }));
    const u = newUpdater({ spawn }); await u.check(); await u.download('2.35.0');
    expect(() => u.launch({ file: path.join(dir, 'Vex-Setup-2.35.0.exe'), args: ['/S'], script: false })).toThrow(/Windows did not start the installer/);
  });

  it('an installer process that errors afterwards (for example UAC or antivirus) is written to the log', async () => {
    let onError;
    const spawn = vi.fn(() => ({ on: (ev, cb) => { if (ev === 'error') onError = cb; }, unref: vi.fn(), pid: 5 }));
    const u = newUpdater({ spawn }); await u.check(); await u.download('2.35.0');
    u.launch(await u.prepareInstall('2.35.0'));
    onError(new Error('spawn UNKNOWN'));
    expect(journal.tail().join('\n')).toMatch(/PROBLEM: the installer did not start: spawn UNKNOWN/);
  });

  it('the log keeps the last 200 lines, oldest first, and keeps a folder path whole (spaces included)', () => {
    const j = S.createUpdateLog({ fs, dir, warn: () => {} });
    for (let i = 0; i < 700; i++) j.add('line ' + i + ' C:\\Claude code free\\vex\\dist\\win-unpacked');
    const lines = j.tail(500);
    expect(lines.length).toBeLessThanOrEqual(200);
    expect(lines[lines.length - 1]).toMatch(/line 699 C:\\Claude code free\\vex\\dist\\win-unpacked$/);
  });

  it('a log that cannot be written says so through warn instead of failing the update', () => {
    const warn = vi.fn();
    const j = S.createUpdateLog({ fs, dir: path.join(dir, 'a-file'), warn });
    fs.writeFileSync(path.join(dir, 'a-file'), 'not a folder');
    j.add('x');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/update log could not be written/));
  });
});

describe('the rollback state machine', () => {
  const hashFile = S.hashFileWith(fs);
  const machine = (version) => S.createRollback({ fs, dir, currentVersion: version, hashFile });
  let baseFile;
  beforeEach(() => { baseFile = path.join(dir, 'Vex-Setup-2.34.5.exe'); fs.writeFileSync(baseFile, 'old installer bytes'); });

  it('no marker: nothing to do', () => {
    expect(machine('2.34.5').onStart()).toEqual({ kind: 'none' });
  });

  it('the happy path: installing, first start is a trial, "ready" ends it', async () => {
    const before = machine('2.34.5');
    expect((await before.arm({ from: '2.34.5', to: '2.35.0', baseFile })).canGoBack).toBe(true);
    const after = machine('2.35.0');
    expect(after.onStart()).toMatchObject({ kind: 'trial', starts: 1 });
    expect(after.markReady()).toMatchObject({ kind: 'ready', from: '2.34.5', to: '2.35.0' });
    expect(fs.existsSync(path.join(dir, S.PENDING_FILE))).toBe(false);
    expect(machine('2.35.0').onStart().kind).toBe('none');
  });

  it('the installer did not install (blocked, failed, never ran): the OLD version starts and says so', async () => {
    await machine('2.34.5').arm({ from: '2.34.5', to: '2.35.0', baseFile });
    const again = machine('2.34.5');
    expect(again.onStart()).toMatchObject({ kind: 'not-installed', from: '2.34.5', to: '2.35.0' });
    // It stays until it has been read, and never turns into a rollback.
    expect(machine('2.34.5').onStart()).toMatchObject({ kind: 'not-installed', stale: true });
    machine('2.34.5').acknowledge();
    expect(machine('2.34.5').onStart().kind).toBe('none');
  });

  it('arming but Vex not closing (tabs could not be saved) leaves no false "not installed"', async () => {
    const m = machine('2.34.5');
    await m.arm({ from: '2.34.5', to: '2.35.0', baseFile });
    m.disarm();
    expect(machine('2.34.5').onStart().kind).toBe('none');
  });

  it('the new version fails to reach ready twice: the third start goes back, with the kept installer', async () => {
    await machine('2.34.5').arm({ from: '2.34.5', to: '2.35.0', baseFile });
    expect(machine('2.35.0').onStart()).toMatchObject({ kind: 'trial', starts: 1 });     // start 1, never ready
    expect(machine('2.35.0').onStart()).toMatchObject({ kind: 'trial', starts: 2 });     // start 2, never ready
    const third = machine('2.35.0').onStart();                                            // two failures proven
    expect(third).toMatchObject({ kind: 'rollback', from: '2.34.5', to: '2.35.0', failed: 2 });
    expect(third.base.file).toBe(baseFile);
    await expect(machine('2.35.0').checkedBase(third.base)).resolves.toBe(baseFile);
  });

  it('one failed start followed by a good one is not a rollback', async () => {
    await machine('2.34.5').arm({ from: '2.34.5', to: '2.35.0', baseFile });
    machine('2.35.0').onStart();
    const second = machine('2.35.0');
    expect(second.onStart().kind).toBe('trial');
    expect(second.markReady().kind).toBe('ready');
    expect(machine('2.35.0').onStart().kind).toBe('none');
  });

  it('the old version is back: said once, the failed version is blocked, and it never loops', async () => {
    await machine('2.34.5').arm({ from: '2.34.5', to: '2.35.0', baseFile });
    for (let i = 0; i < 3; i++) machine('2.35.0').onStart();          // the third decided to roll back
    const old = machine('2.34.5');
    expect(old.onStart()).toMatchObject({ kind: 'rolled-back', from: '2.34.5', to: '2.35.0' });
    expect(old.blockedVersion()).toBe('2.35.0');
    // If the person installs 2.35.0 by hand and it fails again, the state is still terminal: no second rollback.
    expect(machine('2.35.0').onStart().kind).toBe('rolled-back');
    expect(machine('2.35.0').onStart().kind).not.toBe('rollback');
  });

  it('the rollback installer did not work (the new version is still running): said, not retried', async () => {
    await machine('2.34.5').arm({ from: '2.34.5', to: '2.35.0', baseFile });
    for (let i = 0; i < 3; i++) machine('2.35.0').onStart();
    expect(machine('2.35.0').onStart()).toMatchObject({ kind: 'rollback-failed' });
    for (let i = 0; i < 3; i++) expect(machine('2.35.0').onStart().kind).toBe('rollback-failed');
    expect(machine('2.35.0').blockedVersion()).toBe('2.35.0');
  });

  it('no installer of the old version was kept: the failure is said plainly, with no attempt to run anything', async () => {
    const m = machine('2.34.5');
    expect(await m.arm({ from: '2.34.5', to: '2.35.0', baseFile: null })).toMatchObject({ canGoBack: false, note: expect.stringMatching(/no installer of 2\.34\.5 was kept/) });
    for (let i = 0; i < 2; i++) machine('2.35.0').onStart();
    expect(machine('2.35.0').onStart()).toMatchObject({ kind: 'broken-no-backup' });
  });

  it('a kept installer that changed on disk is never run', async () => {
    await machine('2.34.5').arm({ from: '2.34.5', to: '2.35.0', baseFile });
    for (let i = 0; i < 2; i++) machine('2.35.0').onStart();
    const d = machine('2.35.0').onStart();
    fs.appendFileSync(baseFile, 'tampered');
    await expect(machine('2.35.0').checkedBase(d.base)).rejects.toThrow(/changed on disk since it was checked/);
    fs.rmSync(baseFile);
    await expect(machine('2.35.0').checkedBase(d.base)).rejects.toThrow(/cannot be read/);
  });

  it('a third version in the marker, or an unreadable marker, is not mistaken for a rollback', async () => {
    await machine('2.34.5').arm({ from: '2.34.5', to: '2.35.0', baseFile });
    expect(machine('2.99.0').onStart().kind).toBe('none');
    fs.writeFileSync(path.join(dir, S.PENDING_FILE), '{broken');
    expect(() => machine('2.35.0').onStart()).toThrow(/pending-update\.json is damaged/);
  });

  it('the old installer is protected from the tidy-up while a trial needs it', async () => {
    const u = newUpdater({ currentVersion: '2.35.0', keepFiles: () => machine('2.35.0').keepFiles() });
    await machine('2.34.5').arm({ from: '2.34.5', to: '2.35.0', baseFile });
    fs.writeFileSync(path.join(dir, 'Vex-Setup-2.35.0.exe'), 'new');
    fs.writeFileSync(path.join(dir, 'Vex-Setup-2.30.0.exe'), 'ancient');
    u.cleanup();
    expect(fs.readdirSync(dir).sort()).toEqual([S.PENDING_FILE, 'Vex-Setup-2.34.5.exe', 'Vex-Setup-2.35.0.exe'].sort());
  });

  it('baseInstallerFile is the kept installer of the running version, or null', () => {
    const u = newUpdater();
    expect(u.baseInstallerFile()).toBe(baseFile);
    fs.rmSync(baseFile);
    expect(u.baseInstallerFile()).toBe(null);
  });
});
