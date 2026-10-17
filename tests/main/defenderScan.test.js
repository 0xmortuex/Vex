// T3-110 (Wave 6): "Scan now" runs MpCmdRun.exe on one file. Tested with a fake spawn and a temp folder standing in for
// the Defender install; no real scanner is run.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createDefenderScan } = require('../../src/main/defender-scan.js');

let dir, env, file, spawned, asked, answer, picked, downloaded, outcome;

function fakeSpawn(exe, args, opts) {
  spawned.push({ exe, args, opts });
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null)); };
  setImmediate(() => {
    if (outcome.hang) return;
    if (outcome.error) { child.emit('error', new Error(outcome.error)); return; }
    child.stdout.emit('data', Buffer.from(outcome.out));
    child.emit('close', outcome.code);
  });
  return child;
}
function make(over = {}) {
  return createDefenderScan({
    spawn: fakeSpawn, confirm: async (q) => { asked.push(q); return answer; }, pickFile: async () => picked,
    isDownloadedFile: (p) => downloaded.has(p), env, platform: 'win32', ...over,
  });
}
function install(version) {
  const d = path.join(env.ProgramData, 'Microsoft', 'Windows Defender', 'Platform', version);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'MpCmdRun.exe'), 'x');
  return path.join(d, 'MpCmdRun.exe');
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-def-'));
  env = { ProgramData: path.join(dir, 'pd'), ProgramFiles: path.join(dir, 'pf') };
  file = path.join(dir, 'setup.exe'); fs.writeFileSync(file, 'MZ');
  spawned = []; asked = []; answer = true; picked = null; downloaded = new Set([file]);
  outcome = { code: 0, out: 'Scan starting...\nScanning ' + file + ' found no threats.\n' };
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('T3-110 Defender scan', () => {
  it('runs the newest platform copy with an argument array and no shell, after a confirm showing the exact command', async () => {
    install('4.18.2307.1-0'); const newest = install('4.18.24090.11-0');
    const r = await make().scan({ source: 'download', path: file });
    expect(spawned).toHaveLength(1);
    expect(spawned[0].exe).toBe(newest);
    expect(spawned[0].args).toEqual(['-Scan', '-ScanType', '3', '-File', file]);
    expect(spawned[0].opts.shell).toBe(false);
    expect(asked[0].message).toContain('MpCmdRun.exe');
    expect(asked[0].message).toContain('-ScanType 3');
    expect(asked[0].message).toContain(file);
    expect(r).toMatchObject({ ok: true, clean: true, threat: false, exitCode: 0, file: 'setup.exe' });
    expect(r.text).toContain('found no threats');
  });

  it('falls back to Program Files, and says so plainly when Defender is not installed', async () => {
    await expect(make().scan({ source: 'download', path: file })).rejects.toThrow(/MpCmdRun.exe\) was not found/);
    fs.mkdirSync(path.join(env.ProgramFiles, 'Windows Defender'), { recursive: true });
    const pf = path.join(env.ProgramFiles, 'Windows Defender', 'MpCmdRun.exe'); fs.writeFileSync(pf, 'x');
    await make().scan({ source: 'download', path: file });
    expect(spawned[0].exe).toBe(pf);
  });

  it('a "no" runs nothing', async () => {
    install('4.18.1-0'); answer = false;
    await expect(make().scan({ source: 'download', path: file })).rejects.toThrow(/cancelled/);
    expect(spawned).toHaveLength(0);
  });

  it('reports a threat (exit code 2) and any other code in words', async () => {
    install('4.18.1-0'); outcome = { code: 2, out: 'Threat  : Virus:DOS/EICAR_Test_File\n' };
    const r = await make().scan({ source: 'download', path: file });
    expect(r).toMatchObject({ threat: true, clean: false, exitCode: 2 });
    expect(r.text).toContain('EICAR');
  });

  it('a path from a window is honoured only for a file Vex downloaded', async () => {
    install('4.18.1-0');
    const other = path.join(dir, 'other.exe'); fs.writeFileSync(other, 'MZ');
    await expect(make().scan({ source: 'download', path: other })).rejects.toThrow(/Only a file Vex downloaded/);
    await expect(make().scan({ source: 'download' })).rejects.toThrow(/Only a file Vex downloaded/);
    await expect(make().scan({ source: 'run', path: file })).rejects.toThrow(/download or a picked file/);
    expect(spawned).toHaveLength(0);
  });

  it('a picked file comes from the dialog main opens; cancelling the dialog is not an error', async () => {
    install('4.18.1-0');
    expect(await make().scan({ source: 'pick' })).toEqual({ ok: false, canceled: true });
    picked = file;
    const r = await make().scan({ source: 'pick', path: 'C:\\Windows\\System32\\cmd.exe' });   // a path sent along with "pick" is ignored
    expect(r.ok).toBe(true);
    expect(spawned[0].args[4]).toBe(file);
  });

  it('refuses wildcards, folders, relative and network paths, and a file that is gone', async () => {
    install('4.18.1-0');
    const bad = [path.join(dir, '*.exe'), dir, 'setup.exe', '\\\\server\\share\\a.exe', path.join(dir, 'gone.exe'), file + '\n'];
    for (const p of bad) {
      downloaded.add(p);
      await expect(make().scan({ source: 'download', path: p }), p).rejects.toThrow();
    }
    expect(spawned).toHaveLength(0);
  });

  it('refuses a symbolic link when the system lets the test make one', async () => {
    install('4.18.1-0');
    const link = path.join(dir, 'link.exe');
    try { fs.symlinkSync(file, link); } catch { return; }   // vex-allow-empty-catch: no link rights on this machine, nothing to test
    downloaded.add(link);
    await expect(make().scan({ source: 'download', path: link })).rejects.toThrow(/plain file/);
  });

  it('one scan at a time, and a stuck scan is stopped at the limit', async () => {
    install('4.18.1-0'); outcome = { hang: true };
    const s = make({ timeoutMs: 30 });
    const first = s.scan({ source: 'download', path: file });
    await new Promise(r => setTimeout(r, 5));
    await expect(s.scan({ source: 'download', path: file })).rejects.toThrow(/already running/);
    await expect(first).rejects.toThrow(/was stopped/);
    expect(spawned).toHaveLength(1);
  });

  it('reports a scanner that cannot start', async () => {
    install('4.18.1-0'); outcome = { error: 'EACCES' };
    await expect(make().scan({ source: 'download', path: file })).rejects.toThrow(/could not be run: EACCES/);
  });

  it('cuts a long output and does nothing outside Windows', async () => {
    install('4.18.1-0'); outcome = { code: 0, out: 'x'.repeat(20000) };
    expect((await make().scan({ source: 'download', path: file })).text.length).toBeLessThanOrEqual(4000);
    await expect(make({ platform: 'linux' }).scan({ source: 'download', path: file })).rejects.toThrow(/part of Windows/);
  });
});

describe('T3-110 wiring', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  it('is registered everywhere a channel must be and offers no way to name a program', () => {
    expect(src('src/main.js')).toContain("ipcMain.handle('downloads:defender-scan'");
    expect(src('src/preload.js')).toContain("'downloads:defender-scan'");
    expect(src('src/main/ipc-policy.js')).toMatch(/'downloads:defender-scan'/);
    const { validatePayload } = require('../../src/main/ipc-policy.js');
    expect(() => validatePayload('downloads:defender-scan', [{ source: 'download', path: 'C:\\a.exe' }])).not.toThrow();
    expect(() => validatePayload('downloads:defender-scan', [{ source: 'download', exe: 'cmd.exe' }])).not.toThrow();   // an extra field is ignored by main
    expect(() => validatePayload('downloads:defender-scan', [{ source: 'shell' }])).toThrow();
    expect(src('src/main/defender-scan.js')).not.toMatch(/shell:\s*true|execSync|child_process|powershell/i);
  });
});
