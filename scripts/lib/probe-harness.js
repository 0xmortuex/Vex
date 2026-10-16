// One launcher and one stopper for every Vex probe (T0-005).
//
// Why: on 2026-10-03 a probe's SendKeys typed into the owner's window, and on
// 2026-10-11 a probe cleanup that matched a profile folder named "A" killed
// every program on the owner's PC. Both came from a probe doing more than "run
// my own Electron and stop my own Electron".
//
// What this enforces:
//   * the app starts from source or an explicit exe, never from dist\win-unpacked
//     (the owner runs that copy), with VEX_NO_OS_SCHEDULE=1 forced on, and with
//     a --user-data-dir that is a fresh folder under the OS temp directory
//     (never %APPDATA%\vex or %APPDATA%\game-control-center);
//   * every started PID is written to <tmp>/vex-probe-pids.log;
//   * stopping goes through stopOwned(): the live ExecutablePath and
//     CommandLine of the PID must still be the ones this harness started
//     (exe and the exact profile folder) before anything is killed, then only
//     that PID and its verified descendants are killed, each by PID.
//     A mismatch THROWS and kills nothing. There is no kill-by-name and no
//     kill-by-pattern in this file, and tests/main/probeSafety.test.js fails
//     the build if one appears in scripts/;
//   * there is no keyboard or mouse input to the OS here, and the same test
//     rejects scripts that add any.
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const PID_LOG = path.join(os.tmpdir(), 'vex-probe-pids.log');

const norm = (p) => path.resolve(String(p)).toLowerCase();
const isInside = (child, parent) => { const c = norm(child), p = norm(parent); return c === p || c.startsWith(p + path.sep); };

// Folders no probe may use as a profile, whatever the caller passes.
function forbiddenProfileRoots(env = process.env) {
  const out = [];
  const appData = env.APPDATA || (env.USERPROFILE ? path.join(env.USERPROFILE, 'AppData', 'Roaming') : '');
  if (appData) out.push(path.join(appData, 'vex'), path.join(appData, 'game-control-center'));
  const local = env.LOCALAPPDATA || '';
  if (local) out.push(path.join(local, 'vex'), path.join(local, 'Programs', 'Vex'));
  return out;
}

// Throws unless `dir` is a folder under the OS temp directory that is not a real profile.
function assertTempProfile(dir, env = process.env) {
  if (!dir) throw new Error('probe-harness: no profile folder');
  const resolved = path.resolve(dir);
  for (const bad of forbiddenProfileRoots(env)) {
    if (isInside(resolved, bad)) throw new Error('probe-harness: refusing the real profile folder ' + resolved);
  }
  if (!isInside(resolved, os.tmpdir()) || norm(resolved) === norm(os.tmpdir())) {
    throw new Error('probe-harness: a probe profile must be a folder under ' + os.tmpdir() + ', got ' + resolved);
  }
  return resolved;
}

// Throws for an exe inside the owner's dist\win-unpacked.
function assertNotOwnersCopy(exe) {
  if (typeof exe === 'string' && isInside(exe, path.join(REPO, 'dist', 'win-unpacked'))) {
    throw new Error('probe-harness: refusing to run the owner\'s dist\\win-unpacked copy; build a test copy in another folder');
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function logPid(rec) {
  fs.appendFileSync(PID_LOG, JSON.stringify({ ...rec, at: new Date().toISOString(), by: path.basename(require.main ? require.main.filename : 'unknown') }) + '\n');
}

// opts: { exe, args = ['.'], cwd = REPO, userDataDir?, port?, env?, stdio?, detached? }
// exe defaults to the repo's electron. `port: true` picks a free remote-debugging port
// (async: use launchWithPort). Returns { child, pid, exe, userDataDir, port }.
function launch(opts = {}) {
  let exe = opts.exe || require(path.join(REPO, 'node_modules', 'electron'));
  if (/[\\/]/.test(exe)) exe = path.resolve(exe); // a relative exe must mean the same file to spawn and to the owner check
  assertNotOwnersCopy(exe);
  const args = (opts.args || ['.']).slice();
  const given = args.find(a => /^--user-data-dir=/.test(a));
  let userDataDir;
  if (given) userDataDir = assertTempProfile(given.slice('--user-data-dir='.length));
  else {
    userDataDir = assertTempProfile(opts.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'vex-probe-')));
    args.push('--user-data-dir=' + userDataDir);
  }
  const port = Number(opts.port) || 0;
  if (port && !args.some(a => /^--remote-debugging-port=/.test(a))) args.push('--remote-debugging-port=' + port);
  const child = spawn(exe, args, {
    cwd: opts.cwd || REPO,
    windowsHide: true,
    stdio: opts.stdio || ['ignore', 'pipe', 'pipe'],
    detached: !!opts.detached,
    // Forced last: no caller can switch the Windows scheduled tasks back on.
    env: { ...process.env, ...(opts.env || {}), VEX_NO_OS_SCHEDULE: '1' },
  });
  if (!child.pid) throw new Error('probe-harness: could not start ' + exe);
  const handle = { child, pid: child.pid, exe, userDataDir, port: port || null };
  logPid({ pid: handle.pid, exe, profile: userDataDir });
  return handle;
}

async function launchWithPort(opts = {}) { return launch({ ...opts, port: opts.port || await freePort() }); }

// ---- inspecting and stopping -------------------------------------------------

function powershell(command) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('probe-harness: powershell failed: ' + String(r.stderr || '').trim().split(/\r?\n/)[0]);
  return r.stdout;
}

// [{ pid, ppid, exe, cmd }] for every process. Windows (CIM); elsewhere `ps`.
function processTable() {
  if (process.platform === 'win32') {
    const out = powershell('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress').trim();
    if (!out) return [];
    const rows = JSON.parse(out);
    return (Array.isArray(rows) ? rows : [rows]).map(r => ({ pid: r.ProcessId, ppid: r.ParentProcessId, exe: r.ExecutablePath || '', cmd: r.CommandLine || '' }));
  }
  const r = spawnSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8' });
  if (r.error) throw r.error;
  return r.stdout.split('\n').filter(Boolean).map(l => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m ? { pid: +m[1], ppid: +m[2], exe: (m[3].split(' ')[0] || ''), cmd: m[3] } : null; }).filter(Boolean);
}

// Does this live process still look like the one the harness started?
function isOwned(row, handle) {
  if (!row) return false;
  if (!row.exe || norm(row.exe) !== norm(handle.exe)) return false;
  const want = '--user-data-dir=' + handle.userDataDir;
  const cmd = row.cmd.toLowerCase().replace(/"/g, '');
  return cmd.includes(want.toLowerCase());
}

// PIDs below `rootPid` by parent links (not including it).
function descendantsOf(rootPid, table) {
  const kids = new Map();
  for (const r of table) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r.pid); }
  const out = [], seen = new Set([rootPid]);
  const queue = [rootPid];
  while (queue.length) {
    for (const k of kids.get(queue.shift()) || []) if (!seen.has(k) && k !== rootPid) { seen.add(k); out.push(k); queue.push(k); }
  }
  return out;
}

function killPid(pid) {
  if (!Number.isInteger(pid) || pid <= 4) throw new Error('probe-harness: refusing to kill pid ' + pid);
  if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
  else { try { process.kill(pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
}

// Stops the process the harness started and the processes below it. Returns
// { killed: [pids], alreadyGone: bool }. Throws, killing nothing, when the PID
// is alive but is no longer the process that was started (a recycled PID).
// `table` is injectable for tests.
function stopOwned(handle, table) {
  const rows = table || processTable();
  const root = rows.find(r => r.pid === handle.pid);
  if (!root) return { killed: [], alreadyGone: true };
  if (!isOwned(root, handle)) {
    throw new Error(`probe-harness: pid ${handle.pid} is alive but is not the process this probe started (exe ${root.exe || '?'}); not killing it`);
  }
  const below = descendantsOf(handle.pid, rows);
  // Deepest first, root last, every one by PID.
  const order = below.reverse().concat(handle.pid);
  for (const pid of order) killPid(pid);
  return { killed: order, alreadyGone: false };
}

// Waits (sync, bounded) for a PID to leave the table, then removes the profile.
function removeProfile(handle, timeoutMs = 15000) {
  assertTempProfile(handle.userDataDir);
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { fs.rmSync(handle.userDataDir, { recursive: true, force: true }); return true; }
    catch (err) {
      if (Date.now() > until) { console.warn('probe-harness: could not remove ' + handle.userDataDir + ': ' + err.message); return false; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
}

// stopOwned + removeProfile; for `finally` blocks.
function dispose(handle, { keepProfile = false } = {}) {
  const r = stopOwned(handle);
  if (!keepProfile) removeProfile(handle);
  return r;
}

module.exports = { launch, launchWithPort, freePort, stopOwned, removeProfile, dispose, processTable, descendantsOf, isOwned, assertTempProfile, assertNotOwnersCopy, forbiddenProfileRoots, PID_LOG, REPO };
