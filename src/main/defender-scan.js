// === "Scan now with Windows Defender" (T3-110, Wave 6) ======================
//
// The owner approved running Defender's own command-line scanner on ONE file. The shortcut in
// defender-shortcut.js (open Windows Security, show the file) stays; this is the scan itself.
//
//   MpCmdRun.exe -Scan -ScanType 3 -File <path>
//
// What keeps it small and safe:
//   - the PROGRAM is found here, never named by a window: Windows Defender's platform folder
//     (%ProgramData%\Microsoft\Windows Defender\Platform\<newest>\MpCmdRun.exe) or the one in
//     %ProgramFiles%\Windows Defender. Nothing from PATH, nothing from the interface;
//   - the FILE comes from one of two places only: a file Vex downloaded itself (main knows the list:
//     isDownloadedFile) or a file picked in a dialog that main opens. The window cannot send any other path;
//   - the exact command is shown in a confirm that main raises, and nothing runs without a "Scan";
//   - spawn with shell:false and an argument ARRAY: the path is one argument, never part of a command line
//     that something could split. An absolute plain file only: no wildcard, no folder, no link, no network path;
//   - one scan at a time; a time limit (the child is Vex's own, so Vex may stop it); output is read, cut to
//     a few thousand characters and handed back as text. Nothing is uploaded: MpCmdRun scans on this computer.
//
// Windows only. On another system it says so.
const nodeFs = require('fs');
const nodePath = require('path');

const MAX_OUTPUT = 4000;
const TIMEOUT_MS = 15 * 60 * 1000;

function parseVersion(name) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:-\d+)?$/.exec(name);
  return m ? m.slice(1, 5).map(n => Number(n || 0)) : null;
}
function cmpVersion(a, b) { for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

function createDefenderScan({ spawn, confirm, pickFile, isDownloadedFile, fs = nodeFs, env = process.env, platform = process.platform, timeoutMs = TIMEOUT_MS } = {}) {
  if (typeof spawn !== 'function') throw new Error('The Defender scan needs spawn');
  if (typeof confirm !== 'function') throw new Error('The Defender scan needs a confirm box');
  if (typeof pickFile !== 'function') throw new Error('The Defender scan needs a file picker');
  if (typeof isDownloadedFile !== 'function') throw new Error('The Defender scan needs the downloads list');
  let running = false;

  function isFile(p) { try { return fs.lstatSync(p).isFile(); } catch (err) { if (err && err.code === 'ENOENT') return false; throw err; } }

  // The scanner: the newest platform copy, else the one in Program Files. Throws when Defender is not there.
  function findScanner() {
    const found = [];
    if (env.ProgramData) {
      const base = nodePath.join(env.ProgramData, 'Microsoft', 'Windows Defender', 'Platform');
      let names = [];
      try { names = fs.readdirSync(base); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
      for (const n of names) {
        const v = parseVersion(n);
        const exe = nodePath.join(base, n, 'MpCmdRun.exe');
        if (v && isFile(exe)) found.push({ v, exe });
      }
    }
    if (found.length) return found.sort((a, b) => cmpVersion(b.v, a.v))[0].exe;
    if (env.ProgramFiles) {
      const exe = nodePath.join(env.ProgramFiles, 'Windows Defender', 'MpCmdRun.exe');
      if (isFile(exe)) return exe;
    }
    throw new Error('Microsoft Defender\'s scanner (MpCmdRun.exe) was not found on this computer. Another antivirus may be in charge.');
  }

  // A path the scanner may be given: absolute, plain, an existing regular file.
  function checkTarget(p) {
    if (typeof p !== 'string' || !p) throw new Error('There is no file to scan');
    if (/["*?<>|]/.test(p) || Array.from(p).some(c => c.charCodeAt(0) < 32)) throw new Error('That file name has characters a scan will not take');
    if (!nodePath.win32.isAbsolute(p) || /^[\\/]{2}/.test(p)) throw new Error('Only a file on a drive of this computer can be scanned');
    const full = nodePath.resolve(p);
    let st;
    try { st = fs.lstatSync(full); }
    catch (err) { if (err && err.code === 'ENOENT') throw new Error('That file is not there any more', { cause: err }); throw err; }
    if (!st.isFile()) throw new Error('Only a plain file is scanned, not a folder or a link');
    return full;
  }

  // source 'download': the path must be a file Vex downloaded. source 'pick': a dialog raised here chooses it.
  async function scan({ source, path: given } = {}) {
    if (platform !== 'win32') throw new Error('Microsoft Defender is part of Windows; there is nothing to run on this system');
    if (running) throw new Error('A scan is already running');
    let target;
    if (source === 'download') {
      if (!isDownloadedFile(given)) throw new Error('Only a file Vex downloaded can be scanned from the downloads list. Use "Scan a file..." to pick another.');
      target = checkTarget(given);
    } else if (source === 'pick') {
      const picked = await pickFile();
      if (!picked) return { ok: false, canceled: true };
      target = checkTarget(picked);
    } else {
      throw new Error('A scan is for a download or a picked file');
    }
    const exe = findScanner();
    const args = ['-Scan', '-ScanType', '3', '-File', target];
    const yes = await confirm({
      title: 'Scan this file with Microsoft Defender?',
      message: 'Vex will run:\n\n"' + exe + '" ' + args.map(a => /\s/.test(a) ? '"' + a + '"' : a).join(' ') + '\n\nThe file is scanned on this computer; nothing is uploaded. Defender may quarantine it if it finds a threat.',
      okLabel: 'Scan',
    });
    if (!yes) throw new Error('The scan was cancelled');
    running = true;
    try { return await run(exe, args, target); }
    finally { running = false; }
  }

  function run(exe, args, target) {
    return new Promise((resolve, reject) => {
      let out = '';
      let timedOut = false;
      let child;
      try { child = spawn(exe, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (err) { reject(new Error('The scanner could not be started: ' + err.message, { cause: err })); return; }
      const take = (b) => { if (out.length < MAX_OUTPUT * 4) out += b.toString('utf8'); };
      if (child.stdout) child.stdout.on('data', take);
      if (child.stderr) child.stderr.on('data', take);
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
      child.on('error', (err) => { clearTimeout(timer); reject(new Error('The scanner could not be run: ' + err.message, { cause: err })); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) { reject(new Error('The scan took longer than ' + Math.round(timeoutMs / 60000) + ' minutes and was stopped')); return; }
        const text = out.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_OUTPUT);
        // MpCmdRun: 0 = scanned and no threat; 2 = a threat was found or the scan failed. The text says which.
        resolve({ ok: true, exitCode: code, clean: code === 0, threat: code === 2, file: nodePath.basename(target), text });
      });
    });
  }

  return { scan, findScanner, checkTarget };
}

module.exports = { createDefenderScan, MAX_OUTPUT };
