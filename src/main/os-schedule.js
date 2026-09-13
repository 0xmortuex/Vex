// === Asking the operating system to wake Vex for a reminder ================
//
// A reminder's timer lives in the main process, which handles every case
// except one: Vex is not running at the moment. For that, Windows Task
// Scheduler holds a one-shot task that launches Vex at the time with
// `--reminder=<id>`; on startup the reminders engine sees the reminder is due
// and shows it. If Vex is already running the launch just hits the single-
// instance lock and hands its argv to the running copy.
//
// Windows PowerShell 5.1 (System32) is used rather than schtasks.exe because
// schtasks reads /sd and /st in the machine's short-date locale, and a
// reminder set on a dd/MM machine would land on the wrong day on an MM/dd one.
// The trigger below is an ISO string parsed with an explicit format.
//
// Two settings matter and are easy to get wrong:
//   * ExecutionTimeLimit must be zero. The default (3 days) makes Task
//     Scheduler KILL the launched process when the limit passes — which is the
//     user's browser, mid-session.
//   * StartWhenAvailable, so a machine asleep at the moment still runs the task
//     when it wakes, instead of skipping it.
//
// Everything is injected so the exact PowerShell can be tested without running it.
const TASK_PATH = '\\Vex\\';

// PowerShell single-quoted string: the only escape is a doubled quote.
const ps = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const pad = (n) => String(n).padStart(2, '0');
const isoMinute = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function taskName(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw new Error('Reminder id is not safe for a task name');
  return 'Vex Reminder ' + id;
}

// The command line Windows must run to bring Vex up. In development Electron's
// binary needs the app directory as its first argument; the packaged Vex.exe
// does not. `extraArgs` carries anything the running Vex needs repeated — a
// --user-data-dir, above all: the reminder lives in that profile's store, and
// a Vex woken into a different one would find nothing to show.
const quoteArg = (a) => (/[\s"]/.test(a) ? '"' + String(a).replace(/"/g, '\\"') + '"' : String(a));
function launchSpec({ execPath, appPath, packaged, id, extraArgs = [] }) {
  const args = [];
  if (!packaged) args.push(quoteArg(appPath));
  for (const a of extraArgs) args.push(quoteArg(a));
  args.push('--reminder=' + id);
  return { execute: execPath, argument: args.join(' ') };
}

function registerScript({ id, at, execPath, appPath, packaged, extraArgs }) {
  const name = taskName(id);
  const { execute, argument } = launchSpec({ execPath, appPath, packaged, id, extraArgs });
  const start = isoMinute(at);
  const end = isoMinute(new Date(at.getTime() + 24 * 3600 * 1000));
  return [
    '$ErrorActionPreference = "Stop"',
    `$action = New-ScheduledTaskAction -Execute ${ps(execute)} -Argument ${ps(argument)}`,
    `$trigger = New-ScheduledTaskTrigger -Once -At ([datetime]::ParseExact(${ps(start)}, 'yyyy-MM-ddTHH:mm', $null))`,
    // An end boundary lets Windows delete the task itself a minute after it
    // has expired, so a reminder Vex never got to clean up does not linger.
    `$trigger.EndBoundary = ([datetime]::ParseExact(${ps(end)}, 'yyyy-MM-ddTHH:mm', $null)).ToString('s')`,
    '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -DeleteExpiredTaskAfter (New-TimeSpan -Minutes 1)',
    `Register-ScheduledTask -TaskName ${ps(name)} -TaskPath ${ps(TASK_PATH)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
    `(Get-ScheduledTask -TaskPath ${ps(TASK_PATH)} -TaskName ${ps(name)} | Get-ScheduledTaskInfo).NextRunTime.ToString('o')`,
  ].join('; ');
}

function unregisterScript(id) {
  const name = taskName(id);
  return [
    '$ErrorActionPreference = "Stop"',
    `if (Get-ScheduledTask -TaskPath ${ps(TASK_PATH)} -TaskName ${ps(name)} -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskPath ${ps(TASK_PATH)} -TaskName ${ps(name)} -Confirm:$false; 'removed' } else { 'absent' }`,
  ].join('; ');
}

function createOsScheduler({ platform, execFile, execPath, appPath, packaged, extraArgs = [], log, timeoutMs = 30000 }) {
  const note = typeof log === 'function' ? log : () => {};
  const shell = process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe';

  function run(script) {
    return new Promise((resolve, reject) => {
      execFile(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const detail = String(stderr || '').trim().split(/\r?\n/)[0] || err.message;
            return reject(new Error(detail));
          }
          resolve(String(stdout || '').trim());
        });
    });
  }

  const unsupported = () => new Error('Only Windows can wake Vex for a reminder; on this system it fires while Vex is running');

  return {
    supported: platform === 'win32',
    scriptFor: { register: registerScript, unregister: unregisterScript },

    // Resolves to the next run time Windows reports, so the caller can prove
    // the task exists rather than trust that the command returned quietly.
    async register(id, at) {
      if (platform !== 'win32') throw unsupported();
      if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new Error('A reminder needs a real time');
      const out = await run(registerScript({ id, at, execPath, appPath, packaged, extraArgs }));
      note(`[Reminders] Windows task registered for ${id}, next run ${out}`);
      return out;
    },

    async unregister(id) {
      if (platform !== 'win32') return 'unsupported';
      const out = await run(unregisterScript(id));
      note(`[Reminders] Windows task for ${id}: ${out}`);
      return out;
    },
  };
}

module.exports = { createOsScheduler, registerScript, unregisterScript, launchSpec, taskName, TASK_PATH };
