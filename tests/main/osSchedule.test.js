// The Windows Task Scheduler bridge: the PowerShell it generates is the whole
// contract, so it is checked line by line without ever running it. The parts
// that were easy to get wrong — locale-safe dates, quoting a path with spaces,
// the execution-time limit that would otherwise kill the browser — each have a
// test that names them.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { createOsScheduler, registerScript, unregisterScript, launchSpec, taskName, TASK_PATH } =
  createRequire(import.meta.url)('../../src/main/os-schedule.js');

const at = new Date(2026, 8, 13, 14, 46);
const dev = { execPath: 'C:\\Claude code free\\vex\\node_modules\\electron\\dist\\electron.exe', appPath: 'C:\\Claude code free\\vex', packaged: false };
const packaged = { execPath: 'C:\\Users\\USER\\AppData\\Local\\Programs\\Vex\\Vex.exe', appPath: 'C:\\x\\app.asar', packaged: true };

describe('the launch command', () => {
  it('passes the app directory to Electron in development', () => {
    expect(launchSpec({ ...dev, id: 'r1' })).toEqual({ execute: dev.execPath, argument: '"C:\\Claude code free\\vex" --reminder=r1' });
  });
  it('passes only the flag to the packaged Vex.exe', () => {
    expect(launchSpec({ ...packaged, id: 'r1' })).toEqual({ execute: packaged.execPath, argument: '--reminder=r1' });
  });
  it('repeats a --user-data-dir so the woken Vex reads the same store', () => {
    // The reminder lives in that profile's reminders.json. Waking Vex into the
    // default profile would find nothing to show.
    const extraArgs = ['--user-data-dir=C:\\Temp\\vex profile'];
    expect(launchSpec({ ...packaged, id: 'r1', extraArgs }).argument).toBe('"--user-data-dir=C:\\Temp\\vex profile" --reminder=r1');
    expect(launchSpec({ ...dev, id: 'r1', extraArgs: ['--user-data-dir=C:\\p'] }).argument).toBe('"C:\\Claude code free\\vex" --user-data-dir=C:\\p --reminder=r1');
    expect(registerScript({ id: 'r1', at, ...dev, extraArgs: ['--user-data-dir=C:\\p'] })).toContain('--user-data-dir=C:\\p --reminder=r1');
  });
});

describe('the task name', () => {
  it('is namespaced and rejects anything that could escape quoting', () => {
    expect(taskName('rabc123')).toBe('Vex Reminder rabc123');
    expect(TASK_PATH).toBe('\\Vex\\');
    expect(() => taskName("r'; Remove-Item")).toThrow(/not safe/);
    expect(() => taskName('')).toThrow(/not safe/);
  });
});

describe('the register script', () => {
  const s = registerScript({ id: 'rabc', at, ...dev });

  it('uses an explicit ISO format so the date does not depend on the machine locale', () => {
    expect(s).toContain("[datetime]::ParseExact('2026-09-13T14:46', 'yyyy-MM-ddTHH:mm', $null)");
    expect(s).not.toMatch(/\/sd |\/st |schtasks/);
  });

  it('quotes the executable and its arguments as PowerShell literals', () => {
    expect(s).toContain("-Execute 'C:\\Claude code free\\vex\\node_modules\\electron\\dist\\electron.exe'");
    expect(s).toContain(`-Argument '"C:\\Claude code free\\vex" --reminder=rabc'`);
  });

  it('never lets Task Scheduler kill the browser it launched', () => {
    // The default limit is three days, after which Windows terminates the
    // process — which would be Vex, mid-session. Zero disables it.
    expect(s).toContain('-ExecutionTimeLimit ([TimeSpan]::Zero)');
  });

  it('runs late rather than never if the machine was asleep, and on battery', () => {
    expect(s).toContain('-StartWhenAvailable');
    expect(s).toContain('-AllowStartIfOnBatteries');
    expect(s).toContain('-DontStopIfGoingOnBatteries');
  });

  it('lets Windows delete the task itself once it has expired', () => {
    expect(s).toContain("EndBoundary = ([datetime]::ParseExact('2026-09-14T14:46'");
    expect(s).toContain('-DeleteExpiredTaskAfter');
  });

  it('stops on the first error and proves the task exists by printing its next run', () => {
    expect(s.startsWith('$ErrorActionPreference = "Stop"')).toBe(true);
    expect(s).toContain('Get-ScheduledTaskInfo).NextRunTime');
  });

  it('escapes a single quote inside a path the only way PowerShell allows', () => {
    const odd = registerScript({ id: 'r1', at, execPath: "C:\\O'Brien\\Vex.exe", appPath: '', packaged: true });
    expect(odd).toContain("-Execute 'C:\\O''Brien\\Vex.exe'");
  });
});

describe('the unregister script', () => {
  it('removes the task when present and says which happened', () => {
    const s = unregisterScript('rabc');
    expect(s).toContain("-TaskName 'Vex Reminder rabc'");
    expect(s).toContain('Unregister-ScheduledTask');
    expect(s).toContain("-Confirm:$false");
    expect(s).toMatch(/'removed'.*'absent'/);
  });
});

describe('running it', () => {
  function fakeExec({ stdout = '', stderr = '', fail = false } = {}) {
    const calls = [];
    return {
      calls,
      execFile: (file, args, opts, cb) => { calls.push({ file, args, opts }); cb(fail ? new Error('exit 1') : null, stdout, stderr); },
    };
  }

  it('invokes Windows PowerShell non-interactively and returns the next run time', async () => {
    const { execFile, calls } = fakeExec({ stdout: '2026-09-13T14:46:00.0000000+03:00\r\n' });
    const os = createOsScheduler({ platform: 'win32', execFile, ...dev });
    expect(os.supported).toBe(true);
    await expect(os.register('r1', at)).resolves.toBe('2026-09-13T14:46:00.0000000+03:00');
    expect(calls[0].file).toMatch(/WindowsPowerShell\\v1\.0\\powershell\.exe$|powershell\.exe$/);
    expect(calls[0].args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']);
    expect(calls[0].opts.windowsHide).toBe(true);
  });

  it('surfaces PowerShell\'s own error line when registration fails', async () => {
    const { execFile } = fakeExec({ fail: true, stderr: 'Register-ScheduledTask : Access is denied.\r\nAt line:1' });
    const os = createOsScheduler({ platform: 'win32', execFile, ...dev });
    await expect(os.register('r1', at)).rejects.toThrow('Register-ScheduledTask : Access is denied.');
  });

  it('refuses a bad date before touching the system', async () => {
    const { execFile, calls } = fakeExec();
    const os = createOsScheduler({ platform: 'win32', execFile, ...dev });
    await expect(os.register('r1', new Date('nope'))).rejects.toThrow(/real time/);
    expect(calls).toHaveLength(0);
  });

  it('is honest on platforms without Task Scheduler', async () => {
    const { execFile, calls } = fakeExec();
    const os = createOsScheduler({ platform: 'darwin', execFile, ...dev });
    expect(os.supported).toBe(false);
    await expect(os.register('r1', at)).rejects.toThrow(/only windows/i);
    expect(await os.unregister('r1')).toBe('unsupported');
    expect(calls).toHaveLength(0);
  });
});
