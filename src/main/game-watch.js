// === Is a game running? ======================================================
//
// With 16 GB of RAM and an 8 GB graphics card, a browser and a game compete.
// Ollama itself costs nothing idle (29 MB, no GPU — measured), but a model
// used a minute ago holds ~5.5 GB of VRAM for the next five, and background
// tabs hold RAM. Vex should notice the game and get out of its way.
//
// Windows already knows. SHQueryUserNotificationState is how Windows decides
// to hold notifications back while you play: it reports a full-screen Direct3D
// app (exclusive full screen) or a busy full-screen app (borderless
// full-screen, which is how most games run now). It needs no permissions and
// reads nothing from the game.
//
// It is only reachable from native code, so one small hidden helper runs for
// as long as Vex does, asks every few seconds, and prints a line only when the
// answer changes. windowsHide: no console ever appears. It exits by itself
// when Vex's process is gone, so it can never be left running.
//
// The helper is a tiny C# program, compiled ONCE with the compiler every
// Windows 10/11 already has (.NET Framework 4's csc.exe) and kept in Vex's
// data folder. The first version was a PowerShell loop — measured at 135 MB of
// RAM, on a 16 GB machine this exists to give RAM back to. PowerShell stays
// as the fallback if the compiler is ever missing.

const POLL_S = 5;
const HELPER_NAME = 'vex-game-watch.exe';

const CSHARP = [
  'using System;',
  'using System.Diagnostics;',
  'using System.Runtime.InteropServices;',
  'using System.Threading;',
  'static class VexGameWatch {',
  '  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);',
  '  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);',
  '  static int Main(string[] args) {',
  '    int parent = int.Parse(args[0]); int seconds = args.Length > 1 ? int.Parse(args[1]) : 5;',
  '    string last = null;',
  '    while (true) {',
  '      try { Process.GetProcessById(parent); } catch { return 0; }',
  '      int s = 0; SHQueryUserNotificationState(out s);',
  '      uint pid = 0; GetWindowThreadProcessId(GetForegroundWindow(), out pid);',
  '      string name = "";',
  '      if (pid != 0) { try { using (var p = Process.GetProcessById((int)pid)) name = p.ProcessName; } catch { } }',
  '      string line = s + "|" + name;',
  '      if (line != last) { Console.Out.WriteLine(line); Console.Out.Flush(); last = line; }',
  '      Thread.Sleep(seconds * 1000);',
  '    }',
  '  }',
  '}',
].join('\n');

// Compile the helper into `dir` unless an up-to-date one is already there.
// → the exe path, or null (no compiler, or it failed) so the caller falls back.
async function ensureHelper({ fs, path, execFile, dir, windir, crypto }) {
  const want = crypto.createHash('sha256').update(CSHARP).digest('hex');
  const exe = path.join(dir, HELPER_NAME);
  const stamp = path.join(dir, HELPER_NAME + '.sha256');
  try { if (fs.existsSync(exe) && fs.readFileSync(stamp, 'utf8').trim() === want) return exe; } catch { /* rebuild */ }
  const candidates = ['Framework64', 'Framework'].map(f => path.join(windir || 'C:\\Windows', 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe'));
  const csc = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!csc) return null;
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'vex-game-watch.cs');
  fs.writeFileSync(src, CSHARP, 'utf8');
  const ok = await new Promise((resolve) => execFile(csc, ['/nologo', '/optimize+', '/target:exe', '/out:' + exe, src], { windowsHide: true, timeout: 60000 }, (err) => resolve(!err)));
  if (!ok || !fs.existsSync(exe)) return null;
  fs.writeFileSync(stamp, want, 'utf8');
  return exe;
}

// The PowerShell side. Passed as -EncodedCommand, so no quoting survives to
// be got wrong.
function script(parentPid) {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Add-Type -Namespace VexGame -Name Native -MemberDefinition @'",
    '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);',
    '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();',
    '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);',
    "'@",
    "$last = ''",
    'while ($true) {',
    '  if (-not (Get-Process -Id ' + Number(parentPid) + ' -ErrorAction SilentlyContinue)) { exit }',
    '  $s = 0; [void][VexGame.Native]::SHQueryUserNotificationState([ref]$s)',
    '  $p = 0; [void][VexGame.Native]::GetWindowThreadProcessId([VexGame.Native]::GetForegroundWindow(), [ref]$p)',
    "  $n = ''; if ($p) { $proc = Get-Process -Id $p -ErrorAction SilentlyContinue; if ($proc) { $n = $proc.ProcessName } }",
    '  $line = "$s|$n"',
    '  if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }',
    '  Start-Sleep -Seconds ' + POLL_S,
    '}',
  ].join('\n');
}

// QUERY_USER_NOTIFICATION_STATE:
//   2 QUNS_BUSY                 a full-screen app (borderless games, videos)
//   3 QUNS_RUNNING_D3D_FULL_SCREEN  an exclusive full-screen Direct3D app
//   others: not full screen, screen saver, presentation mode, quiet hours
// A full-screen window that is Vex itself (a video in a tab) is not a game.
function interpret(line, ownNames) {
  const [stateText, procRaw = ''] = String(line || '').trim().split('|');
  const state = Number(stateText);
  const proc = procRaw.trim();
  const own = (ownNames || []).some(n => n && proc.toLowerCase() === String(n).toLowerCase());
  const fullScreen = state === 3 || state === 2;
  return { state, app: proc, game: fullScreen && !own && !!proc };
}

function createGameWatch({ spawn, platform = process.platform, parentPid = process.pid, ownNames = [], onChange, log, helper = null }) {
  let child = null;
  let current = { game: false, app: '', state: 0 };
  let buffer = '';
  let stopped = true;
  let helperPath = null;          // the compiled exe, once ensured
  let helperTried = false;
  const note = typeof log === 'function' ? log : () => {};

  function handle(line) {
    const next = interpret(line, ownNames);
    const changed = next.game !== current.game || (next.game && next.app !== current.app);
    current = next;
    if (changed && typeof onChange === 'function') { try { onChange({ game: next.game, app: next.app }); } catch (err) { note('[GameWatch] listener failed: ' + err.message); } }
  }

  // The compiled helper when there is one; PowerShell otherwise. Calls made
  // while the helper is still being built share that one attempt — a second
  // caller must not launch the heavy PowerShell fallback in the meantime.
  let starting = null;
  function start() {
    if (platform !== 'win32') return Promise.resolve(false);   // the signal is Windows-only
    if (child) return Promise.resolve(true);
    if (starting) return starting;
    starting = startOnce().finally(() => { starting = null; });
    return starting;
  }
  async function startOnce() {
    stopped = false;
    if (!helperTried && typeof helper === 'function') {
      helperTried = true;
      try { helperPath = await helper(); } catch (err) { note('[GameWatch] could not build the helper: ' + err.message); helperPath = null; }
      if (child || stopped) return !!child;          // started or stopped meanwhile
    }
    try {
      if (helperPath) {
        child = spawn(helperPath, [String(parentPid), String(POLL_S)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      } else {
        const encoded = Buffer.from(script(parentPid), 'utf16le').toString('base64');
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      }
    } catch (err) { note('[GameWatch] could not start: ' + err.message); child = null; return false; }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const l of lines) if (l.trim()) handle(l);
    });
    child.on('exit', () => {
      child = null;
      // Died without being told to (killed by something else): the state is
      // unknown, which must read as "no game" rather than stick at "game".
      if (current.game) handle('0|');
      if (!stopped) note('[GameWatch] helper exited');
    });
    return true;
  }

  function stop() {
    stopped = true;
    if (child) { try { child.kill(); } catch { /* gone */ } child = null; }
    if (current.game) handle('0|');
  }

  return { start, stop, state: () => ({ game: current.game, app: current.app }), running: () => !!child, usingHelper: () => !!helperPath, _handle: handle };
}

module.exports = { createGameWatch, interpret, script, ensureHelper, CSHARP };
