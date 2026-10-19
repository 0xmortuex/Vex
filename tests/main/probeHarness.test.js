// T0-005: the probe harness (scripts/lib/probe-harness.js) and the rule that no
// script in scripts/ kills by name/pattern or sends OS-level input.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const H = require('../../scripts/lib/probe-harness.js');

describe('profile and exe guards', () => {
  it('accepts a folder under the temp dir and refuses everything else', () => {
    expect(() => H.assertTempProfile(path.join(os.tmpdir(), 'vex-probe-x'))).not.toThrow();
    expect(() => H.assertTempProfile(os.tmpdir())).toThrow(/under/);
    expect(() => H.assertTempProfile('C:\\Users\\Someone\\Documents\\profile')).toThrow(/under/);
    const env = { APPDATA: path.join(os.tmpdir(), 'fakeRoaming') };
    expect(() => H.assertTempProfile(path.join(env.APPDATA, 'vex'), env)).toThrow(/real profile/);
    expect(() => H.assertTempProfile(path.join(env.APPDATA, 'game-control-center', 'x'), env)).toThrow(/real profile/);
    expect(() => H.assertTempProfile('')).toThrow();
  });
  it('refuses the owner\'s dist\\win-unpacked copy', () => {
    expect(() => H.assertNotOwnersCopy(path.join(H.REPO, 'dist', 'win-unpacked', 'Vex.exe'))).toThrow(/owner/);
    expect(() => H.assertNotOwnersCopy(path.join(os.tmpdir(), 'copy', 'Vex.exe'))).not.toThrow();
  });
});

describe('ownership checks (pure)', () => {
  const handle = { pid: 10, exe: 'C:\\x\\electron.exe', userDataDir: path.join(os.tmpdir(), 'vex-probe-abc') };
  const own = { pid: 10, ppid: 1, exe: handle.exe, cmd: `"${handle.exe}" . --user-data-dir=${handle.userDataDir} --remote-debugging-port=1` };
  it('recognises the process it started, case-insensitively', () => {
    expect(H.isOwned(own, handle)).toBe(true);
    expect(H.isOwned({ ...own, exe: handle.exe.toUpperCase() }, handle)).toBe(true);
  });
  it('rejects another exe, another profile and a missing row', () => {
    expect(H.isOwned({ ...own, exe: 'C:\\Windows\\notepad.exe' }, handle)).toBe(false);
    expect(H.isOwned({ ...own, cmd: own.cmd.replace('vex-probe-abc', 'vex-probe-zzz') }, handle)).toBe(false);
    expect(H.isOwned(undefined, handle)).toBe(false);
  });
  it('finds descendants by parent links only', () => {
    const table = [{ pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 12, ppid: 11 }, { pid: 13, ppid: 99 }, { pid: 14, ppid: 10 }];
    expect(H.descendantsOf(10, table).sort()).toEqual([11, 12, 14]);
  });
  it('stopOwned throws and kills nothing when the pid now belongs to something else', () => {
    const table = [{ pid: 10, ppid: 1, exe: 'C:\\Windows\\notepad.exe', cmd: 'notepad.exe' }];
    expect(() => H.stopOwned(handle, table)).toThrow(/not the process this probe started/);
  });
  it('stopOwned does nothing for a pid that is gone', () => {
    expect(H.stopOwned(handle, [])).toEqual({ killed: [], alreadyGone: true });
  });
});

describe.skipIf(process.platform !== 'win32')('a real process the test starts itself', () => {
  it('launch forces VEX_NO_OS_SCHEDULE, records the pid, verifies and stops only that process', () => {
    const script = path.join(os.tmpdir(), 'vex-probe-test-idle-' + process.pid + '.js');
    fs.writeFileSync(script, 'setInterval(function () {}, 1000);\n');
    const h = H.launch({ exe: process.execPath, args: [script], stdio: 'ignore', env: { VEX_NO_OS_SCHEDULE: '0' } });
    try {
      expect(process.kill(h.pid, 0)).toBe(true);
      expect(h.userDataDir.startsWith(os.tmpdir())).toBe(true);
      expect(fs.readFileSync(H.PID_LOG, 'utf8')).toContain('"pid":' + h.pid);
      // A handle with the right pid but another profile must be refused.
      expect(() => H.stopOwned({ ...h, userDataDir: path.join(os.tmpdir(), 'vex-probe-other') })).toThrow(/not the process/);
      expect(process.kill(h.pid, 0)).toBe(true); // still alive after the refusal
      const r = H.stopOwned(h);
      expect(r.killed).toContain(h.pid);
      expect(r.alreadyGone).toBe(false);
    } finally {
      try { process.kill(h.pid, 'SIGKILL'); } catch { /* already stopped by the test */ }
      H.removeProfile(h);
      fs.rmSync(script, { force: true });
    }
  }, 60000);
});

// ---- no kill by name/pattern, no OS input, anywhere in scripts/ -----------------
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : (/\.(js|ps1|cmd|bat)$/.test(e.name) ? [path.join(dir, e.name)] : []));
}
const BANNED = [
  [/Stop-Process\b/i, 'Stop-Process'],
  [/\bpkill\b|\bkillall\b/, 'pkill/killall'],
  [/taskkill[^\n]*\/IM\b/i, 'taskkill /IM'],
  [/wmic[^\n]*(?:delete|terminate)/i, 'wmic delete/terminate'],
  [/\bSendKeys\b|keybd_event|mouse_event|SetCursorPos|\bSendInput\b|robotjs|nut-js|AppActivate/, 'OS-level input'],
];
// Scripts that legitimately mention these words, with the reason. Keep empty if you can.
const EXEMPT = new Map([
  ['scripts/lib/probe-harness.js', 'documents the ban in its header comment'],
]);
describe('scripts/ never kills by name or pattern and never sends OS input', () => {
  const scriptsDir = path.join(H.REPO, 'scripts');
  for (const file of walk(scriptsDir)) {
    const rel = path.relative(H.REPO, file).split(path.sep).join('/');
    it(rel, () => {
      const text = fs.readFileSync(file, 'utf8');
      for (const [re, name] of BANNED) {
        if (EXEMPT.has(rel)) continue;
        expect(re.test(text), `${rel} uses ${name}`).toBe(false);
      }
      for (const line of text.split(/\r?\n/)) {
        if (!/taskkill/i.test(line) || /^\s*(\/\/|\*)/.test(line)) continue;
        // taskkill is allowed only as "/F /PID <one pid>" with no /T tree flag.
        expect(/\/PID\b/i.test(line), `${rel}: taskkill without /PID: ${line.trim()}`).toBe(true);
        expect(/\/T\b/i.test(line), `${rel}: taskkill /T: ${line.trim()}`).toBe(false);
      }
    });
  }
});

describe('reading the process list', () => {
  const row = (cmd) => ({ ProcessId: 7, ParentProcessId: 4, ExecutablePath: 'C:/x.exe', CommandLine: cmd });
  it('copes with a control character in another program\'s command line', () => {
    // PowerShell 5.1 ConvertTo-Json leaves a raw BEL (0x07) inside the string; JSON.parse refuses it.
    const text = JSON.stringify([row('node -e "Rebase from Here\u0007*"'), row('plain')]).replace(/\\u0007/g, '\u0007');
    expect(() => JSON.parse(text)).toThrow(/control character/);
    const rows = H.parseProcessJson(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].CommandLine).toBe('node -e "Rebase from Here *"');
    expect(rows[1].CommandLine).toBe('plain');
  });
  it('still reads a normal list, and a single process that comes back as one object', () => {
    expect(H.parseProcessJson(JSON.stringify([row('a'), row('b')]))).toHaveLength(2);
    expect(H.parseProcessJson(JSON.stringify(row('only')))).toEqual([row('only')]);
  });
  it('keeps the escaped tab, newline and quote of a command line as they were', () => {
    const rows = H.parseProcessJson(JSON.stringify([row('a\tb\nc "d"')]));
    expect(rows[0].CommandLine).toBe('a\tb\nc "d"');
  });
  it('reads this computer\'s real process list', () => {
    expect(H.processTable().length).toBeGreaterThan(10);
  });
});
