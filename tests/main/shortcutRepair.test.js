// Vex's own broken shortcuts, pointed back at Vex (src/main/shortcut-repair.js).
// Found 2026-10-09: the Start menu Vex.lnk opened a deleted build folder's
// Vex.exe and Windows showed "Problem with Shortcut" after an update. Only
// fake paths here: no real shortcut is read or written.
import { describe, it, expect, vi } from 'vitest';

const { planShortcutRepairs, repairShortcuts } = require('../../src/main/shortcut-repair.js');

const EXE = 'C:\\Users\\me\\AppData\\Local\\Programs\\Vex\\Vex.exe';
const START = 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs';
const DESKTOP = 'C:\\Users\\me\\Desktop';
const GONE = 'C:\\Claude code free\\vex\\dist-final\\win-unpacked\\Vex.exe';

// A file system that has exactly these paths (case-insensitive, like Windows).
const disk = (...paths) => {
  const set = new Set(paths.map(p => p.toLowerCase()));
  return p => set.has(String(p).toLowerCase());
};
const there = disk(EXE, 'C:\\Users\\me\\AppData\\Local\\Programs\\Vex', 'C:\\Claude code free\\vex');

describe('which shortcuts need repair', () => {
  it('the real case: Vex.lnk opens a Vex.exe in a deleted build folder', () => {
    const plans = planShortcutRepairs({
      execPath: EXE, exists: there,
      found: [{ file: START + '\\Vex.lnk', link: { target: GONE, icon: GONE, cwd: 'C:\\Claude code free\\vex\\dist-final\\win-unpacked' } }],
    });
    expect(plans).toEqual([{
      file: START + '\\Vex.lnk', from: GONE, to: EXE,
      options: { target: EXE, icon: EXE, iconIndex: 0, cwd: 'C:\\Users\\me\\AppData\\Local\\Programs\\Vex' },
    }]);
  });

  it('a shortcut whose target is there is never touched', () => {
    const elsewhere = 'D:\\Apps\\Vex\\Vex.exe';
    expect(planShortcutRepairs({ execPath: EXE, exists: disk(EXE, elsewhere), found: [
      { file: START + '\\Vex.lnk', link: { target: EXE } },
      { file: DESKTOP + '\\Vex.lnk', link: { target: elsewhere } },
    ] })).toEqual([]);
  });

  it('a target whose folder is still there (a dev folder being rebuilt) is left alone', () => {
    const rebuilding = 'C:\\Claude code free\\vex\\dist\\win-unpacked\\Vex.exe';
    expect(planShortcutRepairs({ execPath: EXE, exists: disk(EXE, 'C:\\Claude code free\\vex\\dist\\win-unpacked'), found: [
      { file: START + '\\Vex.lnk', link: { target: rebuilding } },
    ] })).toEqual([]);
  });

  it('only a file named Vex.lnk: not "Vex (dev).lnk", not a profile shortcut, not another app', () => {
    expect(planShortcutRepairs({ execPath: EXE, exists: there, found: [
      { file: START + '\\Vex (dev).lnk', link: { target: GONE } },
      { file: DESKTOP + '\\Vex - Work.lnk', link: { target: GONE } },
      { file: DESKTOP + '\\Discord.lnk', link: { target: 'C:\\Gone\\Discord.exe' } },
    ] })).toEqual([]);
  });

  it('a Vex.lnk that opens something other than a Vex.exe is someone else\'s', () => {
    expect(planShortcutRepairs({ execPath: EXE, exists: there, found: [
      { file: START + '\\Vex.lnk', link: { target: 'C:\\Gone\\electron.exe' } },
      { file: DESKTOP + '\\Vex.lnk', link: { target: 'C:\\Gone\\vexplorer.exe' } },
    ] })).toEqual([]);
  });

  it('an empty or relative target is not judged', () => {
    expect(planShortcutRepairs({ execPath: EXE, exists: there, found: [
      { file: START + '\\Vex.lnk', link: { target: '' } },
      { file: DESKTOP + '\\Vex.lnk', link: { target: 'Vex.exe' } },
      { file: DESKTOP + '\\Vex.lnk', link: null },
    ] })).toEqual([]);
  });

  it('keeps an icon and working folder that are still there', () => {
    const icon = 'C:\\Users\\me\\icons\\vex.ico';
    const plans = planShortcutRepairs({ execPath: EXE, exists: disk(EXE, icon, 'C:\\Users\\me'), found: [
      { file: DESKTOP + '\\Vex.lnk', link: { target: GONE, icon, cwd: 'C:\\Users\\me' } },
    ] });
    expect(plans[0].options).toEqual({ target: EXE });
  });

  it('nothing when the running exe is not Vex.exe (a dev run is electron.exe)', () => {
    expect(planShortcutRepairs({ execPath: 'C:\\x\\electron.exe', exists: there, found: [
      { file: START + '\\Vex.lnk', link: { target: GONE } },
    ] })).toEqual([]);
  });
});

describe('repairing them', () => {
  const fakeShell = (links) => ({
    readShortcutLink: vi.fn(file => { if (!(file in links)) throw new Error('not a shortcut'); return links[file]; }),
    writeShortcutLink: vi.fn(() => true),
  });
  const fakeFs = (...paths) => ({ existsSync: disk(...paths) });

  it('reads Vex.lnk in each folder, repoints the broken one only, and says so', () => {
    const shell = fakeShell({ [START + '\\Vex.lnk']: { target: GONE }, [DESKTOP + '\\Vex.lnk']: { target: EXE, icon: EXE } });
    const log = vi.fn();
    const r = repairShortcuts({ platform: 'win32', packaged: true, dirs: [START, DESKTOP], execPath: EXE, shell,
      fs: fakeFs(EXE, START + '\\Vex.lnk', DESKTOP + '\\Vex.lnk'), log });
    expect(shell.writeShortcutLink).toHaveBeenCalledTimes(1);
    expect(shell.writeShortcutLink).toHaveBeenCalledWith(START + '\\Vex.lnk', 'update', { target: EXE, icon: EXE, iconIndex: 0 });
    expect(r.repaired.map(p => p.file)).toEqual([START + '\\Vex.lnk']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('repaired ' + START + '\\Vex.lnk'));
  });

  it('never creates a shortcut that is not there', () => {
    const shell = fakeShell({});
    const r = repairShortcuts({ platform: 'win32', packaged: true, dirs: [START, DESKTOP], execPath: EXE, shell, fs: fakeFs(EXE) });
    expect(shell.readShortcutLink).not.toHaveBeenCalled();
    expect(shell.writeShortcutLink).not.toHaveBeenCalled();
    expect(r.repaired).toEqual([]);
  });

  it('a refused write is reported, not hidden', () => {
    const shell = fakeShell({ [START + '\\Vex.lnk']: { target: GONE } });
    shell.writeShortcutLink.mockReturnValue(false);
    const log = vi.fn();
    const r = repairShortcuts({ platform: 'win32', packaged: true, dirs: [START], execPath: EXE, shell, fs: fakeFs(EXE, START + '\\Vex.lnk'), log });
    expect(r.repaired).toEqual([]);
    expect(r.failed).toEqual([START + '\\Vex.lnk']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not repair'));
  });

  it('an unreadable shortcut is reported and the others are still checked', () => {
    const shell = fakeShell({ [DESKTOP + '\\Vex.lnk']: { target: GONE } });
    const log = vi.fn();
    const r = repairShortcuts({ platform: 'win32', packaged: true, dirs: [START, DESKTOP], execPath: EXE, shell,
      fs: fakeFs(EXE, START + '\\Vex.lnk', DESKTOP + '\\Vex.lnk'), log });
    expect(r.failed).toEqual([START + '\\Vex.lnk']);
    expect(r.repaired.map(p => p.file)).toEqual([DESKTOP + '\\Vex.lnk']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not read ' + START + '\\Vex.lnk'));
  });

  it('only in the installed Vex on Windows', () => {
    const shell = fakeShell({ [START + '\\Vex.lnk']: { target: GONE } });
    const fs = fakeFs(EXE, START + '\\Vex.lnk');
    expect(repairShortcuts({ platform: 'win32', packaged: false, dirs: [START], execPath: EXE, shell, fs }).skipped).toBe('not the installed Vex');
    expect(repairShortcuts({ platform: 'darwin', packaged: true, dirs: [START], execPath: EXE, shell, fs }).skipped).toBe('not windows');
    expect(shell.readShortcutLink).not.toHaveBeenCalled();
    expect(shell.writeShortcutLink).not.toHaveBeenCalled();
  });

  it('missing Electron calls are an error, not a quiet no-op', () => {
    expect(() => repairShortcuts({ platform: 'win32', packaged: true, dirs: [START], execPath: EXE, shell: {}, fs: fakeFs() })).toThrow(/shell shortcut functions/);
  });
});
