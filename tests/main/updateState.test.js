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

describe('hypothesis (d): a copy run from a folder (dist\\win-unpacked) or from source', () => {
  const folder = { kind: 'folder', folder: 'C:\\Claude code free\\vex\\dist\\win-unpacked' };

  it('is told at the check, with the reason, not offered an "Update now" that installs elsewhere', async () => {
    const r = await newUpdater({ copy: folder }).check();
    expect(r).toMatchObject({ ok: true, hasUpdate: true, canSelfUpdate: false, copy: { kind: 'folder' } });
    expect(r.cannotUpdateReason).toMatch(/runs from a folder .*win-unpacked.* not installed/);
    expect(r.cannotUpdateReason).toMatch(/Install Vex with Vex-Setup\.exe/);
    expect(r.downloadUrl).toBe(exeUrl('2.35.0'));
  });

  it('download is refused with a code and a reason, and nothing is fetched or written', async () => {
    const u = newUpdater({ copy: folder }); await u.check();
    fetch.mockClear();
    const r = await u.download('2.35.0');
    expect(r).toMatchObject({ ok: false, code: 'not-installed' });
    expect(r.error).toMatch(/not installed/);
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.readdirSync(dir)).toEqual([S.LOG_FILE]);
    expect(journal.tail().join('\n')).toMatch(/PROBLEM: refused to download 2\.35\.0/);
  });

  it('even an old staged download is not run from a copy that cannot take it', async () => {
    const first = newUpdater(); await first.check(); await first.download('2.35.0');
    const second = newUpdater({ copy: folder }); second.restoreStaged();
    await expect(second.prepareInstall('2.35.0')).rejects.toThrow(/not installed/);
  });

  it('source (npm start) is told the same way', async () => {
    const r = await newUpdater({ copy: { kind: 'dev', folder: 'C:\\src' } }).check();
    expect(r.canSelfUpdate).toBe(false);
    expect(r.cannotUpdateReason).toMatch(/running from source code/);
  });

  it('the test feed (VEX_UPDATE_FEED stand-in) is the one exception, so it can be tested from any copy', async () => {
    const standIn = Buffer.from('@echo off\r\n');
    const feed = 'http://127.0.0.1:17100/';
    routes.set(feed + 'latest.yml', () => respond(yml({ body: standIn, url: 'stand-in.cmd' })));
    routes.set(feed + 'stand-in.cmd', () => respond(standIn, { length: standIn.length }));
    const u = newUpdater({ copy: folder, env: { VEX_UPDATE_FEED: feed } });
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

  it('the log keeps the last 200 lines, oldest first, and never a Windows path', () => {
    const j = S.createUpdateLog({ fs, dir, warn: () => {} });
    for (let i = 0; i < 700; i++) j.add('line ' + i + ' C:\\Users\\someone\\secret.txt');
    const lines = j.tail(500);
    expect(lines.length).toBeLessThanOrEqual(200);
    expect(lines[lines.length - 1]).toMatch(/line 699 \(path\)$/);
    expect(lines.join('\n')).not.toMatch(/someone/);
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
