// Startup-persistence check (T3-122): read-only. The parsing is pure, the two Windows
// programs are started with fixed argument lists and no shell, and nothing is written.
import { describe, it, expect } from 'vitest';
const path = require('path');
const sc = require('../../src/main/startup-check.js');

const REG_OUT = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  '    Vex Browser    REG_SZ    "C:\\Users\\a\\AppData\\Local\\Programs\\Vex\\Vex.exe" --hidden',
  '    OneDrive    REG_SZ    "C:\\Users\\a\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe" /background',
  '    Weird Name With  Spaces    REG_EXPAND_SZ    %ProgramFiles%\\x\\y.exe',
  '',
].join('\r\n');

const TASKS_OUT = [
  '"\\Vex\\Vex Reminder abc","N/A","Ready"',
  '"\\Microsoft\\Windows\\Defrag\\ScheduledDefrag","N/A","Ready"',
  '"\\Microsoft\\Windows\\Foo\\Bar","N/A","Ready"',
  '"\\MyBackup","2026-10-17 03:00:00","Ready"',
  '"TaskName","Next Run Time","Status"',
  '"\\MyBackup","2026-10-17 03:00:00","Ready"',
].join('\r\n');

describe('parsing', () => {
  it('reads reg query values, including names with spaces and the type', () => {
    const v = sc.parseRegQuery(REG_OUT);
    expect(v.map(x => x.name)).toEqual(['Vex Browser', 'OneDrive', 'Weird Name With  Spaces']);
    expect(v[0]).toMatchObject({ type: 'REG_SZ' });
    expect(v[0].data).toContain('Vex.exe');
    expect(v[2].type).toBe('REG_EXPAND_SZ');
  });
  it('reads the CSV of scheduled tasks, once each, without the header line', () => {
    const t = sc.parseSchtasks(TASKS_OUT);
    expect(t.map(x => x.name)).toEqual(['\\Vex\\Vex Reminder abc', '\\Microsoft\\Windows\\Defrag\\ScheduledDefrag', '\\Microsoft\\Windows\\Foo\\Bar', '\\MyBackup']);
    expect(sc.parseCsvLine('"a, b","c ""q""",d')).toEqual(['a, b', 'c "q"', 'd']);
  });
  it('knows Vex\'s own entries and Microsoft\'s tasks', () => {
    const exe = 'C:\\Program Files\\Vex\\Vex.exe';
    expect(sc.isVexEntry({ name: '\\Vex\\Vex Reminder x', execPath: exe })).toBe(true);
    expect(sc.isVexEntry({ text: '"C:\\x\\Vex.exe" --hidden', name: 'Anything', execPath: exe })).toBe(true);
    expect(sc.isVexEntry({ text: '"C:\\x\\other.exe"', name: 'OneDrive', execPath: exe })).toBe(false);
    expect(sc.isMicrosoftTask('\\Microsoft\\Windows\\X')).toBe(true);
    expect(sc.isMicrosoftTask('\\MyBackup')).toBe(false);
  });
});

describe('scan', () => {
  function fakeExec() {
    const calls = [];
    const fn = (file, args, opts, cb) => {
      calls.push({ file, args, opts });
      if (file === 'reg') {
        if (args[1].includes('RunOnce')) {
          const e = new Error('Command failed'); e.code = 1;
          cb(e, '', 'ERROR: The system was unable to find the specified registry key or value.');
          return;
        }
        cb(null, args[1].startsWith('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run') ? REG_OUT : '', '');
        return;
      }
      cb(null, TASKS_OUT, '');
    };
    fn.calls = calls;
    return fn;
  }
  it('lists registry, Startup-folder and task entries, marks Vex\'s own, and counts Microsoft\'s tasks', async () => {
    const fs = require('fs'), os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-startup-'));
    const startup = path.join(dir, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    fs.mkdirSync(startup, { recursive: true });
    fs.writeFileSync(path.join(startup, 'helper.lnk'), 'x');
    fs.writeFileSync(path.join(startup, 'desktop.ini'), 'x');
    try {
      const exec = fakeExec();
      const r = await sc.scan({ execFile: exec, env: { APPDATA: dir }, execPath: 'C:\\x\\Vex.exe', platform: 'win32', now: () => 7 });
      expect(r.ok).toBe(true);
      expect(r.at).toBe(7);
      const byKind = (k) => r.items.filter(i => i.kind === k);
      expect(byKind('registry').map(i => i.name)).toEqual(['Vex Browser', 'OneDrive', 'Weird Name With  Spaces']);
      expect(byKind('registry')[0].vex).toBe(true);
      expect(byKind('registry')[1].vex).toBe(false);
      expect(byKind('folder').map(i => i.name)).toEqual(['helper.lnk']);
      expect(byKind('task').map(i => i.name)).toEqual(['\\Vex\\Vex Reminder abc', '\\MyBackup']);
      expect(byKind('task')[0].vex).toBe(true);
      expect(r.microsoftTasks).toBe(2);
      expect(r.errors).toEqual([]);
      // Every call: reg query <allow-listed key>, or schtasks with the fixed arguments; never a shell.
      for (const c of exec.calls) {
        expect(['reg', 'schtasks']).toContain(c.file);
        expect(c.opts.shell).toBeUndefined();
        expect(c.opts.windowsHide).toBe(true);
        if (c.file === 'reg') {
          expect(c.args[0]).toBe('query');
          expect(c.args).toHaveLength(2);
          expect(sc.RUN_KEYS.map(k => k.key)).toContain(c.args[1]);
        } else expect(c.args).toEqual(['/query', '/fo', 'csv', '/nh']);
      }
      expect(exec.calls.filter(c => c.file === 'reg')).toHaveLength(sc.RUN_KEYS.length);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('only reads: no key other than Run/RunOnce, nothing but query, and the module has no write calls', () => {
    for (const k of sc.RUN_KEYS) expect(k.key).toMatch(/\\CurrentVersion\\Run(Once)?$/);
    const src = require('fs').readFileSync(path.resolve(__dirname, '../../src/main/startup-check.js'), 'utf8');
    for (const bad of ['writeFile', 'unlink', 'rmSync', 'rename', 'spawn(', 'exec(', 'execSync', 'shell: true', '/delete', ' add ']) expect(src.includes(bad), bad).toBe(false);
  });
  it('reports a failing program as an error, not as an empty list', async () => {
    const exec = (file, args, opts, cb) => { cb(new Error('boom'), '', 'Access is denied'); };
    const r = await sc.scan({ execFile: exec, env: {}, platform: 'win32' });
    expect(r.ok).toBe(true);
    expect(r.errors.length).toBe(sc.RUN_KEYS.length + 1);
    expect(r.errors[0]).toMatch(/Access is denied/);
  });
  it('is Windows only', async () => {
    const r = await sc.scan({ platform: 'linux' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/only available on Windows/);
  });
  it('registers one handler, startup:list', () => {
    const handlers = new Map();
    sc.registerStartupCheck({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, scanFn: () => 'scanned' });
    expect([...handlers.keys()]).toEqual(['startup:list']);
    expect(handlers.get('startup:list')()).toBe('scanned');
  });
});
