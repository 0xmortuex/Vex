// === Startup-persistence check (T3-122): a READ-ONLY list ====================
//
// What starts by itself when you sign in to Windows, listed so you can look it
// over. Three places, each read and nothing else:
//   * the Run and RunOnce registry keys (current user and machine, plus the
//     32-bit view): `reg query <key>`;
//   * the two Startup folders: a plain directory listing with Node's fs;
//   * the names of Scheduled Tasks: `schtasks /query /fo csv /nh`.
//
// The two Windows programs are started with execFile and a FIXED argument list
// from the allow-list below: no shell, nothing from a page, a profile or the
// renderer reaches the command line. Nothing is written, deleted, disabled or
// started. There is no "remove" here on purpose: the list says where an entry
// lives so the person can deal with it in Task Manager > Startup apps, the
// Startup folder or Task Scheduler themselves.
//
// Vex's own entries (the "Open at login" value, the reminder wake-up tasks in
// \Vex\) are marked as Vex's, so they are not mistaken for something unknown.
//
// "New since last time" is worked out by the window from the ids returned here
// (js/startup-check.js keeps the previous list); main keeps no history.
//
// Unsigned flag (Wave 5): a second, separate step (startup:signatures) works out which program each
// entry starts and asks Windows who signed it, the same read-only Get-AuthenticodeSignature call the
// download check uses (main/file-check.js; the file path travels in an environment variable, never in a
// script). It runs only when the person presses "Check who signed these", never in the background. A
// registry value and a Startup-folder program have a path. Wave 6: a shortcut (.lnk) is resolved to its
// target with Electron's shell.readShortcutLink (it only reads the file), and a Scheduled Task's program is
// read from the "Task To Run" column of one more read-only `schtasks /query /fo csv /v /nh` (fixed arguments,
// no task name sent anywhere); the program they lead to is checked like the others, and the result says
// which way it was found (via: 'shortcut' | 'task'). A task that runs a COM handler or several actions, a
// shortcut to a folder or a web address, and anything that cannot be read are still reported as not
// checked, with the reason, rather than guessed. "Unsigned" is a fact about the file, not a verdict: plenty
// of honest small tools are unsigned.
const fs = require('fs');
const path = require('path');

// The only registry keys ever queried.
const RUN_KEYS = Object.freeze([
  { id: 'hkcu-run', key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', where: 'Registry: current user, Run' },
  { id: 'hkcu-runonce', key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce', where: 'Registry: current user, RunOnce' },
  { id: 'hklm-run', key: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', where: 'Registry: all users, Run' },
  { id: 'hklm-runonce', key: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce', where: 'Registry: all users, RunOnce' },
  { id: 'hklm-run32', key: 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', where: 'Registry: all users (32-bit), Run' },
]);
const SCHTASKS_ARGS = Object.freeze(['/query', '/fo', 'csv', '/nh']);
const EXEC_TIMEOUT_MS = 15000;
const EXEC_MAX_BUFFER = 8 * 1024 * 1024;
const MAX_ENTRIES = 400;
const MAX_SIGNATURE_CHECKS = 40;
const SIGNATURE_CONCURRENCY = 4;
const PROGRAM_EXT = '(?:exe|com|scr|bat|cmd|ps1|vbs|js|msi|dll|cpl)';

// `reg query` prints the key, then one line per value:
//     Name    REG_SZ    data
// A value name may contain spaces; the type token ends it.
function parseRegQuery(output) {
  const out = [];
  for (const raw of String(output == null ? '' : output).split(/\r?\n/)) {
    const m = /^\s{2,}(.+?)\s{2,}(REG_[A-Z_]+)\s{0,}(.*)$/.exec(raw);
    if (!m) continue;
    out.push({ name: m[1].trim(), type: m[2], data: m[3].trim() });
  }
  return out;
}

// One CSV line of `schtasks /query /fo csv /nh`: "TaskName","Next Run Time","Status".
function parseCsvLine(line) {
  const cells = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}
function parseSchtasks(output) {
  const out = [];
  const seen = new Set();
  for (const raw of String(output == null ? '' : output).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = parseCsvLine(raw);
    const name = (cells[0] || '').trim();
    // `/nh` still prints a repeated header on some Windows versions.
    if (!name.startsWith('\\') || name === 'TaskName') continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, next: (cells[1] || '').trim(), status: (cells[2] || '').trim() });
  }
  return out;
}

// Is this entry Vex's own? execPath is the running program.
function isVexEntry({ text = '', name = '', execPath = '' }) {
  const hay = (String(text) + ' ' + String(name)).toLowerCase();
  if (/^\\vex\\/i.test(String(name))) return true;
  const exe = execPath ? path.basename(execPath).toLowerCase() : '';
  if (exe && exe !== 'electron.exe' && hay.includes(exe)) return true;
  return /(^|[\\/\s"'])vex\.exe\b/.test(hay);
}

// Microsoft's own tasks are many hundreds; they are counted, not listed.
function isMicrosoftTask(name) { return /^\\Microsoft\\/i.test(String(name)); }

function listStartupFolder(dir, fsMod = fs) {
  let names;
  try { names = fsMod.readdirSync(dir, { withFileTypes: true }); }
  catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return { entries: [] };
    return { entries: [], error: 'Could not read ' + dir + ': ' + err.message };
  }
  const entries = [];
  for (const d of names) {
    if (!d.isFile() || /^desktop\.ini$/i.test(d.name)) continue;
    let size, mtime;
    try { const st = fsMod.statSync(path.join(dir, d.name)); size = st.size; mtime = st.mtimeMs; }
    catch (err) { return { entries, error: 'Could not read ' + path.join(dir, d.name) + ': ' + err.message }; }
    entries.push({ name: d.name, size, mtime });
  }
  return { entries };
}

function runQuery(execFile, file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: EXEC_TIMEOUT_MS, maxBuffer: EXEC_MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        // `reg query` exits 1 for a key that does not exist: an empty key, not a failure.
        if (file === 'reg' && /unable to find the specified registry key or value/i.test(String(stderr || '') + String(err.message))) { resolve({ ok: true, out: '' }); return; }
        resolve({ ok: false, error: (file + ' ' + args.join(' ') + ': ' + ((stderr && String(stderr).trim()) || err.message)).slice(0, 300) });
        return;
      }
      resolve({ ok: true, out: String(stdout || '') });
    });
  });
}

// -> { ok, platform, at, items:[{ id, kind, where, name, data, vex }], microsoftTasks, errors:[] }
// items[].id is stable (kind + place + name) so two lists can be compared.
async function scan({ execFile = require('child_process').execFile, env = process.env, execPath = process.execPath, platform = process.platform, fsMod = fs, now = Date.now } = {}) {
  if (platform !== 'win32') return { ok: false, platform, at: now(), items: [], microsoftTasks: 0, errors: [], error: 'The startup check reads Windows startup places, so it is only available on Windows' };
  const items = [];
  const errors = [];

  for (const k of RUN_KEYS) {
    const r = await runQuery(execFile, 'reg', ['query', k.key]);
    if (!r.ok) { errors.push(r.error); continue; }
    for (const v of parseRegQuery(r.out)) {
      items.push({ id: 'reg|' + k.id + '|' + v.name, kind: 'registry', where: k.where, name: v.name, data: v.data.slice(0, 500), vex: isVexEntry({ text: v.data, name: v.name, execPath }) });
    }
  }

  const folders = [];
  if (env.APPDATA) folders.push({ id: 'user-startup', dir: path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), where: 'Startup folder: current user' });
  if (env.ProgramData) folders.push({ id: 'all-startup', dir: path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StartUp'), where: 'Startup folder: all users' });
  for (const f of folders) {
    const r = listStartupFolder(f.dir, fsMod);
    if (r.error) errors.push(r.error);
    for (const e of r.entries) {
      items.push({ id: 'folder|' + f.id + '|' + e.name, kind: 'folder', where: f.where, name: e.name, data: f.dir, vex: isVexEntry({ text: e.name, name: e.name, execPath }) });
    }
  }

  const t = await runQuery(execFile, 'schtasks', SCHTASKS_ARGS.slice());
  let microsoftTasks = 0;
  if (!t.ok) errors.push(t.error);
  else {
    for (const task of parseSchtasks(t.out)) {
      if (isMicrosoftTask(task.name)) { microsoftTasks++; continue; }
      items.push({ id: 'task|' + task.name, kind: 'task', where: 'Scheduled task', name: task.name, data: [task.status, task.next && task.next !== 'N/A' ? 'next run ' + task.next : ''].filter(Boolean).join(', '), vex: isVexEntry({ name: task.name, execPath }) });
    }
  }

  return { ok: true, platform, at: now(), items: items.slice(0, MAX_ENTRIES), truncated: items.length > MAX_ENTRIES, microsoftTasks, errors };
}

// The program a command line starts: "C:\X\x.exe" --a, C:\X\x.exe /s, or one that uses %APPDATA%. '' when none can be read.
function programFromCommand(command, env = process.env) {
  const text = String(command || '').replace(/%([^%]+)%/g, (m, v) => env[v] || env[v.toUpperCase()] || m).trim();
  const quoted = /^"([^"]+)"/.exec(text);
  if (quoted) return quoted[1];
  const m = new RegExp('^(.+?\\.' + PROGRAM_EXT + ')(?=\\s|$|,)', 'i').exec(text);
  return m ? m[1] : '';
}

// The program an entry starts, as an absolute path of a file that exists, or { why } when it cannot be known.
// Registry data looks like  "C:\Program Files\X\x.exe" --background  or  C:\X\x.exe /s  or use %APPDATA%.
// Wave 6: readShortcut(file) -> { target } (Electron's shell.readShortcutLink, which only reads the shortcut) resolves a
// .lnk, and taskCommand is the "Task To Run" text of the verbose task list for a scheduled task. Without them the answer
// is still "not checked" with the reason, never a guess. { path, via } says how the program was found.
function targetOf(item, { env = process.env, fsMod = fs, readShortcut = null, taskCommand = '' } = {}) {
  let candidate;
  let via = '';
  if (item.kind === 'task') {
    if (!taskCommand) return { why: "a scheduled task's program is not in the list Windows prints" };
    if (/^(com handler|n\/a|multiple actions)/i.test(String(taskCommand).trim())) return { why: 'the task runs ' + String(taskCommand).trim().toLowerCase() + ', not one program Vex can name' };
    candidate = programFromCommand(taskCommand, env);
    if (!candidate) return { why: 'no program path could be read from what the task runs' };
    via = 'task';
  } else if (item.kind === 'folder') {
    if (/\.lnk$/i.test(item.name)) {
      if (typeof readShortcut !== 'function') return { why: 'a shortcut is not signed itself; the program it points to is not read here' };
      let info;
      try { info = readShortcut(path.join(String(item.data || ''), item.name)); }
      catch (err) { return { why: 'the shortcut could not be read (' + ((err && err.message) || err) + ')' }; }
      candidate = programFromCommand(info && info.target ? '"' + info.target + '"' : '', env);
      if (!candidate) return { why: 'the shortcut does not point to a program (a folder, a web address or a Windows feature)' };
      via = 'shortcut';
    } else candidate = path.join(String(item.data || ''), item.name);
  } else if (item.kind === 'registry') {
    candidate = programFromCommand(item.data, env);
    if (!candidate) return { why: 'no program path could be read from its value' };
  } else return { why: 'unknown kind of entry' };
  if (!/^[A-Za-z]:[\\/]/.test(candidate)) return { why: 'the program is not given with a full path' };
  try {
    if (!fsMod.statSync(candidate).isFile()) return { why: 'the path is not a file' };
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return { why: 'the program is not there any more' };
    throw new Error('Could not look at ' + candidate + ': ' + err.message, { cause: err });
  }
  return via ? { path: candidate, via } : { path: candidate };
}

// The "Task To Run" column of the verbose task list: name -> command text. One read-only query with a fixed
// argument list; no task name from anywhere. Column 2 is the task name and column 9 what it runs (the order Windows
// uses in every language; with /nh there is no header row to read it from).
const SCHTASKS_VERBOSE_ARGS = Object.freeze(['/query', '/fo', 'csv', '/v', '/nh']);
function parseSchtasksCommands(output) {
  const out = new Map();
  for (const raw of String(output == null ? '' : output).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = parseCsvLine(raw);
    const name = (cells[1] || '').trim();
    if (!name.startsWith('\\') || name === 'TaskName') continue;
    const command = (cells[8] || '').trim();
    if (command && !out.has(name)) out.set(name, command);
  }
  return out;
}
async function taskCommands({ execFile = require('child_process').execFile } = {}) {
  const r = await runQuery(execFile, 'schtasks', SCHTASKS_VERBOSE_ARGS.slice());
  if (!r.ok) throw new Error('The programs the scheduled tasks run could not be read: ' + r.error);
  return parseSchtasksCommands(r.out);
}

// -> { ok, results: [{ id, name, path, status, signer, unsigned, why }], checked, unsigned }
// status is Windows' own word (Valid, NotSigned, HashMismatch, ...) or 'unchecked'. Bounded and cached per path.
async function checkSignatures({ scanFn = scan, signatureOf, env = process.env, fsMod = fs, readShortcut = null, taskCommandsFn = null } = {}) {
  if (typeof signatureOf !== 'function') throw new Error('There is no way to read signatures here');
  const listed = await scanFn();
  if (!listed.ok) return { ok: false, error: listed.error || 'The startup places could not be read', results: [], checked: 0, unsigned: 0 };
  const results = [];
  const jobs = [];
  // Scheduled tasks and shortcuts are resolved to the program they start (Wave 6), so they are checked like the rest.
  let commands = new Map();
  if (taskCommandsFn && listed.items.some(i => i.kind === 'task')) {
    try { commands = await taskCommandsFn(); }
    catch (err) { return { ok: false, error: err.message, results: [], checked: 0, unsigned: 0 }; }
  }
  for (const item of listed.items) {
    const t = targetOf(item, { env, fsMod, readShortcut, taskCommand: item.kind === 'task' ? commands.get(item.name) || '' : '' });
    if (!t.path) { results.push({ id: item.id, name: item.name, path: t.path || '', status: 'unchecked', signer: '', unsigned: false, why: t.why }); continue; }
    if (jobs.length >= MAX_SIGNATURE_CHECKS) { results.push({ id: item.id, name: item.name, path: t.path, status: 'unchecked', signer: '', unsigned: false, why: 'only the first ' + MAX_SIGNATURE_CHECKS + ' programs are checked' }); continue; }
    jobs.push({ item, path: t.path, via: t.via || '' });
  }
  const cache = new Map();
  const ask = (p) => { if (!cache.has(p)) cache.set(p, Promise.resolve().then(() => signatureOf(p))); return cache.get(p); };
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const s = await ask(j.path);
      const status = String((s && s.status) || 'unknown');
      results.push({ id: j.item.id, name: j.item.name, path: j.path, via: j.via, status, signer: String((s && s.signer) || ''), unsigned: status === 'NotSigned', why: (s && s.why) || '' });
    }
  };
  await Promise.all(Array.from({ length: Math.min(SIGNATURE_CONCURRENCY, jobs.length) }, worker));
  return { ok: true, results, checked: jobs.length, unsigned: results.filter(r => r.unsigned).length };
}

// Policy lives in ipc-policy.js (UI_ONLY, closed in a private window).
function registerStartupCheck({ ipcMain, scanFn = scan, signatureOf = null }) {
  ipcMain.handle('startup:list', () => scanFn());
  ipcMain.handle('startup:signatures', () => {
    const sig = signatureOf || require('./file-check').createFileCheck({ fs, crypto: require('crypto'), execFile: require('child_process').execFile, platform: process.platform }).signature;
    // Shortcuts are read with Electron's shell.readShortcutLink (it only reads the .lnk); where Electron is not there (a
    // test) they stay "not checked" with their reason.
    const e = require('electron');
    const readShortcut = e && e.shell && typeof e.shell.readShortcutLink === 'function' ? (f) => e.shell.readShortcutLink(f) : null;
    return checkSignatures({ scanFn, signatureOf: sig, readShortcut, taskCommandsFn: () => taskCommands({}) });
  });
}

module.exports = { checkSignatures, targetOf, programFromCommand, taskCommands, parseSchtasksCommands, SCHTASKS_VERBOSE_ARGS, scan, parseRegQuery, parseSchtasks, parseCsvLine, isVexEntry, isMicrosoftTask, listStartupFolder, registerStartupCheck, RUN_KEYS, SCHTASKS_ARGS };
