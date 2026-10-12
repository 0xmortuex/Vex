// Ctrl+K "Open Game Control Center": the owner's separate app. Main finds it
// from places only the person or the installer can write, refuses anything
// that is not a file named exactly "Game Control Center.exe", and starts it
// detached without a shell. Nothing here starts a real program.
import { describe, it, expect, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const gcc = require('../../src/main/game-control-center.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');

const EXE = 'Game Control Center.exe';
const W = path.win32;
const SETTING = 'D:\\Tools\\' + EXE;
const LNK_TARGET = 'E:\\Apps\\GCC\\' + EXE;
const REG_DIR = 'F:\\Installed\\GCC';
const PF = 'C:\\Program Files\\Game Control Center\\' + EXE;
const env = { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', ProgramData: 'C:\\ProgramData', ProgramFiles: 'C:\\Program Files' };
const LNK = W.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Game Control Center.lnk');

// A machine with exactly these files, a shortcut that points at `lnkTarget`,
// and an uninstall entry whose InstallLocation is `regDir` (or none).
function machine({ files = [], lnkTarget = LNK_TARGET, hasLnk = true, regDir = REG_DIR } = {}) {
  const have = new Set([...files, ...(hasLnk ? [LNK] : [])].map(f => f.toLowerCase()));
  const calls = [];
  const execFile = (_exe, args, _o, cb) => {
    calls.push(args);
    if (args[0] === 'query' && args.includes('/f')) {
      return cb(null, regDir && args[1].startsWith('HKCU') ? 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\GCC\r\n    DisplayName    REG_SZ    Game Control Center\r\n' : '');
    }
    if (args[0] === 'query' && args.includes('/v')) return cb(null, '\r\nHKEY_CURRENT_USER\\...\\GCC\r\n    InstallLocation    REG_SZ    ' + regDir + '\r\n');
    return cb(new Error('unexpected'));
  };
  return {
    env, execFile, calls,
    exists: (p) => have.has(String(p).toLowerCase()),
    readdir: () => [],
    readShortcut: () => ({ target: lnkTarget }),
  };
}

describe('only the right file can be launched', () => {
  it('accepts the exact name, any case, as an absolute path', () => {
    expect(gcc.checkExe(SETTING)).toBe(SETTING);
    expect(gcc.checkExe('d:\\x\\game control center.EXE')).toMatch(/game control center\.EXE$/);
  });

  it('refuses a non-.exe, a wrong name, a relative path and rubbish', () => {
    expect(() => gcc.checkExe('D:\\Tools\\Game Control Center.bat')).toThrow(/Choose the file named/);
    expect(() => gcc.checkExe('D:\\Tools\\Game Control Center.exe.bat')).toThrow(/Choose the file named/);
    expect(() => gcc.checkExe('D:\\Tools\\cmd.exe')).toThrow(/Choose the file named/);
    expect(() => gcc.checkExe('D:\\Tools\\Game Control Center')).toThrow(/Choose the file named/);
    expect(() => gcc.checkExe('Game Control Center.exe')).toThrow(/full path/);
    expect(() => gcc.checkExe('..\\' + EXE)).toThrow(/full path/);
    expect(() => gcc.checkExe('')).toThrow(/No location/);
    expect(() => gcc.checkExe(null)).toThrow(/No location/);
    expect(() => gcc.checkExe({ toString: () => SETTING })).toThrow(/No location/);
  });

  it('refuses a right name that is not there', () => {
    expect(() => gcc.checkExeExists(SETTING, () => false)).toThrow(/no file at/);
  });
});

describe('the order it looks in', () => {
  const find = (m, saved) => gcc.resolve({ saved, env: m.env, exists: m.exists, readdir: m.readdir, readShortcut: m.readShortcut, execFile: m.execFile });

  it('the location chosen in Settings wins over everything', async () => {
    const m = machine({ files: [SETTING, LNK_TARGET, W.join(REG_DIR, EXE), PF] });
    expect(await find(m, SETTING)).toEqual({ path: SETTING, source: 'setting' });
    expect(m.calls).toHaveLength(0);               // the registry is not even asked
  });

  it('then the Start menu shortcut', async () => {
    const m = machine({ files: [LNK_TARGET, W.join(REG_DIR, EXE), PF] });
    expect(await find(m, '')).toEqual({ path: LNK_TARGET, source: 'shortcut' });
  });

  it('then the uninstall entry\u2019s InstallLocation', async () => {
    const m = machine({ files: [W.join(REG_DIR, EXE), PF], hasLnk: false });
    expect(await find(m, '')).toEqual({ path: W.join(REG_DIR, EXE), source: 'registry' });
    // reg.exe is given an argument list, never a command line.
    expect(m.calls.every(a => Array.isArray(a))).toBe(true);
  });

  it('then Program Files', async () => {
    const m = machine({ files: [PF], hasLnk: false, regDir: '' });
    expect(await find(m, '')).toEqual({ path: PF, source: 'programfiles' });
  });

  it('a saved path that is gone, or a shortcut aimed at the wrong program, is skipped and recorded', async () => {
    const m = machine({ files: [PF, 'C:\\Windows\\System32\\cmd.exe'], lnkTarget: 'C:\\Windows\\System32\\cmd.exe', regDir: '' });
    const r = await find(m, SETTING);
    expect(r).toEqual({ path: PF, source: 'programfiles' });
    // Not found anywhere: says where it looked and why each was refused.
    const none = await find(machine({ lnkTarget: 'C:\\Windows\\System32\\cmd.exe', regDir: '' }), SETTING);
    expect(none.path).toBeNull();
    expect(none.looked).toHaveLength(4);
    expect(none.looked.join(' ')).toMatch(/Settings/);
    expect(none.looked.join(' ')).toMatch(/Start menu/);
    expect(none.looked.join(' ')).toMatch(/Program Files/);
    expect(none.refused.join(' ')).toMatch(/cmd\.exe/);
  });
});

describe('reading reg.exe output', () => {
  it('finds the matching keys and the install location', () => {
    expect(gcc.parseMatchingKeys('\r\nHKEY_CURRENT_USER\\A\\B\r\n    DisplayName    REG_SZ    X\r\nEnd of search: 1 match(es) found.\r\n')).toEqual(['HKEY_CURRENT_USER\\A\\B']);
    expect(gcc.parseInstallLocation('HKEY_LOCAL_MACHINE\\A\r\n    InstallLocation    REG_SZ    C:\\Program Files\\Game Control Center\r\n')).toBe('C:\\Program Files\\Game Control Center');
    expect(gcc.parseInstallLocation('    InstallLocation    REG_SZ    "C:\\Q R"\r\n')).toBe('C:\\Q R');
    expect(gcc.parseInstallLocation('nothing here')).toBe('');
  });
});

describe('starting it', () => {
  it('spawns detached, with no arguments, no shell, no hidden window, and lets go of it', async () => {
    const child = { once: vi.fn((ev, fn) => { if (ev === 'spawn') fn(); }), unref: vi.fn() };
    const spawn = vi.fn(() => child);
    await gcc.launch(spawn, PF);
    expect(spawn).toHaveBeenCalledWith(PF, [], expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: false, shell: false }));
    expect(child.unref).toHaveBeenCalled();
  });

  it('says why when it would not start', async () => {
    const child = { once: vi.fn((ev, fn) => { if (ev === 'error') fn(new Error('spawn EACCES')); }), unref: vi.fn() };
    await expect(gcc.launch(() => child, PF)).rejects.toThrow(/EACCES/);
  });
});

describe('the channels', () => {
  function setup({ files, picked, regDir = '' }) {
    const handlers = {};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-gcc-test-'));
    const m = machine({ files, hasLnk: false, regDir });
    const child = { once: vi.fn((ev, fn) => { if (ev === 'spawn') fn(); }), unref: vi.fn() };
    const spawn = vi.fn(() => child);
    gcc.register({
      ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: !picked, filePaths: picked ? [picked] : [] })) },
      shell: { readShortcutLink: () => ({}) },
      getWindow: () => null, userDataPath: dir, env: m.env, spawn, execFile: m.execFile, exists: m.exists, readdir: m.readdir,
    });
    return { handlers, spawn, dir };
  }

  it('the contract takes no arguments and the channels are UI-only', () => {
    for (const ch of ['gcc:launch', 'gcc:get', 'gcc:pick', 'gcc:clear']) {
      expect(() => validate(ch, []), ch).not.toThrow();
      expect(() => validate(ch, ['C:\\Windows\\System32\\cmd.exe']), ch).toThrow(/Invalid payload/);
      expect(UI_ONLY_CHANNELS.has(ch), ch).toBe(true);
    }
  });

  it('launches what it found, and reports where it looked when it found nothing', async () => {
    const found = setup({ files: [PF] });
    expect(await found.handlers['gcc:launch']({})).toMatchObject({ ok: true, source: 'programfiles', path: PF });
    expect(found.spawn).toHaveBeenCalledTimes(1);

    const none = setup({ files: [] });
    const r = await none.handlers['gcc:launch']({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
    expect(r.looked.length).toBe(4);
    expect(none.spawn).not.toHaveBeenCalled();
  });

  it('Browse saves a right file and refuses the wrong one', async () => {
    const good = setup({ files: [SETTING], picked: SETTING });
    expect(await good.handlers['gcc:pick']({})).toEqual({ ok: true, path: SETTING });
    expect(await good.handlers['gcc:get']({})).toEqual({ path: SETTING });
    expect(JSON.parse(fs.readFileSync(path.join(good.dir, gcc.SAVE_FILE), 'utf8'))).toEqual({ path: SETTING });
    expect(await good.handlers['gcc:clear']({})).toEqual({ ok: true });
    expect(await good.handlers['gcc:get']({})).toEqual({ path: '' });

    const bad = setup({ files: ['D:\\Tools\\cmd.exe'], picked: 'D:\\Tools\\cmd.exe' });
    const r = await bad.handlers['gcc:pick']({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Choose the file named/);
    expect(await bad.handlers['gcc:get']({})).toEqual({ path: '' });

    const cancelled = setup({ files: [] });
    expect(await cancelled.handlers['gcc:pick']({})).toEqual({ ok: false, cancelled: true });
  });
});
