// What the updater remembers between runs, so an update can never go missing
// without Vex saying so (src/main/updates.js, js/update-notifier.js).
//
// Four small pieces, all plain files in userData/updates:
//
//   update-log.txt        one line per step ("checked", "downloaded", "installer
//                         started", "did not install"), the last 200 kept. The
//                         update cover and Settings > About show it.
//   staged-update.json    a downloaded, verified installer waiting to be run. It
//                         survives a restart: the in-memory copy used to be the
//                         only record, so a Vex that was closed any other way
//                         than through "Update now" forgot the download and the
//                         next start offered it all over again (found 2026-11-01).
//   pending-update.json   written right before the installer runs. The next start
//                         reads it and knows what happened: the new version is
//                         running (good, and still on trial until the window is up),
//                         the old one is (the installer did not install), or the
//                         new one failed to come up twice and Vex went back.
//   installKind()         is this copy an installed Vex? Only an installed copy
//                         can be updated by the installer: it upgrades the
//                         INSTALLED Vex, never a folder the person runs Vex from.
//
// Rollback is a small state machine (createRollback). It never loops: each
// version pair is tried once, and a rollback that fails is said, not retried.
// The installer it runs is the one that installed the version being left (kept
// by updates.js as the differential base), hashed when the update was armed and
// hashed again before it is started.
const crypto = require('crypto');
const nodePath = require('path');

const LOG_FILE = 'update-log.txt';
const STAGED_FILE = 'staged-update.json';
const PENDING_FILE = 'pending-update.json';
// Files in the updates folder that cleanup() must never delete.
const STATE_FILES = Object.freeze([LOG_FILE, STAGED_FILE, PENDING_FILE]);
const LOG_LINES = 200;
// The new version has to reach "ready" within this many starts; after the
// second start that did not, the third start puts the old version back.
const FAILED_STARTS_BEFORE_ROLLBACK = 2;
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}[0-9A-Za-z.+-]{0,40}$/;

function readJson(fs, file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  catch (err) { throw new Error(nodePath.basename(file) + ' is damaged (' + err.message + ')', { cause: err }); }
}
function writeJson(fs, dir, file, value) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  // vex-allow-plain-write: written to a temp file and renamed over the original, which is never truncated
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

// ---- the log ----------------------------------------------------------------

function createUpdateLog({ fs, dir, now = () => Date.now(), warn = () => {}, maxLines = LOG_LINES }) {
  const file = nodePath.join(dir, LOG_FILE);
  let writes = 0;
  // Kept on this computer only; the target folder of an in-place update has to be readable in it.
  const one = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').slice(0, 400);
  function lines() {
    try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  }
  // A failing log must never stop an update, but it is never silent either.
  function add(message) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(file, new Date(now()).toISOString() + '  ' + one(message) + '\n');
      if (++writes % 50 === 0) {
        const all = lines();
        if (all.length > maxLines * 2) fs.writeFileSync(file, all.slice(-maxLines).join('\n') + '\n');
      }
    } catch (err) { warn('[Updates] the update log could not be written: ' + err.message); }
  }
  // The last `n` lines, oldest first. Reading can fail (and says so).
  function tail(n = maxLines) { return lines().slice(-Math.min(n, maxLines)); }
  return { add, tail, file };
}

// ---- the staged download ----------------------------------------------------

function createStagedStore({ fs, dir }) {
  const file = nodePath.join(dir, STAGED_FILE);
  return {
    file,
    save(rec) { writeJson(fs, dir, file, { version: rec.version, file: rec.file, sha512: rec.sha512, size: rec.size, at: rec.at }); },
    read() {
      const v = readJson(fs, file);
      if (!v) return null;
      if (!VERSION.test(String(v.version)) || typeof v.file !== 'string' || typeof v.sha512 !== 'string' || !Number.isSafeInteger(v.size)) throw new Error(STAGED_FILE + ' is not a staged update');
      return { version: v.version, file: v.file, sha512: v.sha512, size: v.size, at: Number(v.at) || 0 };
    },
    clear() { fs.rmSync(file, { force: true }); },
  };
}

// ---- is this copy installed? ------------------------------------------------

// 'installed'  Vex.exe sits beside the "Uninstall Vex.exe" the installer writes;
// 'folder'     a packaged Vex run from a folder (dist\win-unpacked, a copied
//              folder): the installer would upgrade a DIFFERENT Vex, or make a
//              second one, and this copy would stay as it is;
// 'dev'        running from source (npm start).
function installKind({ execPath, isPackaged, platform = process.platform, fs }) {
  if (!isPackaged) return { kind: 'dev', folder: nodePath.dirname(execPath) };
  if (platform !== 'win32') return { kind: 'folder', folder: nodePath.dirname(execPath) };
  const folder = nodePath.dirname(execPath);
  let names;
  try { names = fs.readdirSync(folder); }
  catch (err) { throw new Error('Vex could not look at its own folder to see whether it is installed: ' + err.message, { cause: err }); }
  return { kind: names.some(n => /^Uninstall .*\.exe$/i.test(n)) ? 'installed' : 'folder', folder };
}

// Is another Vex INSTALLED (registered with Windows) somewhere? The installer, run
// with --updated, upgrades and, from a different folder, would replace that
// registered install, so a folder copy must not run it into its own folder when
// one exists. `regQuery(key)` returns `reg query <key> /s` text ('' when the key
// is missing) and is injected so tests need no registry. Looks at the Uninstall
// keys (DisplayName "Vex" with its InstallLocation) and at Programs\Vex.
const UNINSTALL_KEYS = ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'];
const normFolder = p => String(p || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
function parseUninstallBlocks(text) {
  const found = [];
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (/^HK/i.test(raw)) { cur = {}; found.push(cur); continue; }
    const m = raw.match(/^\s+(\w+)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/);
    if (m && cur) cur[m[1]] = m[2].trim();
  }
  return found.filter(b => b.DisplayName === 'Vex' && b.InstallLocation).map(b => b.InstallLocation.replace(/^"|"$/g, ''));
}
function findRegisteredInstall({ fs, env = process.env, regQuery }) {
  const candidates = [];
  for (const key of UNINSTALL_KEYS) candidates.push(...parseUninstallBlocks(regQuery(key)));
  if (env.LOCALAPPDATA) candidates.push(nodePath.join(env.LOCALAPPDATA, 'Programs', 'Vex'));
  for (const folder of candidates) {
    let names;
    try { names = fs.readdirSync(folder); } catch (err) { if (err.code === 'ENOENT' || err.code === 'ENOTDIR') continue; throw new Error('Vex could not look at ' + folder + ': ' + err.message, { cause: err }); }
    if (names.some(n => /^Uninstall .*\.exe$/i.test(n)) && names.some(n => /^Vex\.exe$/i.test(n))) return { folder };
  }
  return null;
}
// A folder copy next to a registered install in ANOTHER folder: { kind:'folder', folder, other }.
function withOtherInstall(copy, found) {
  if (!copy || copy.kind !== 'folder' || !found || normFolder(found.folder) === normFolder(copy.folder)) return copy;
  return { ...copy, other: found.folder };
}

// What a person is told when this copy cannot be updated from inside.
function notInstalledMessage(copy, current) {
  return `This copy of Vex ${current} is running from source code, so it cannot update itself. Install Vex with Vex-Setup.exe to get automatic updates.`;
}

// A folder copy is updated in place: the installer is told to install into the
// copy's own folder with /D=<folder>. NSIS reads /D only as the LAST argument,
// unquoted even when the path has spaces, with no trailing backslash.
function installTarget(folder) {
  const dir = String(folder || '').replace(/[\\/]+$/, '');
  if (!/^[A-Za-z]:\\/.test(dir) || /["\r\n]/.test(dir)) throw new Error('Vex will not update into this folder: ' + String(folder).slice(0, 120));
  return dir;
}
// The installer command: the fixed flags, then /D= last for a folder copy.
function installerArgs(baseArgs, target) { return target ? [...baseArgs, '/D=' + installTarget(target)] : [...baseArgs]; }

// Can the installer write into the copy's own folder? A real write, because
// Program Files without admin rights refuses it. A visible error, not a no-op.
function checkWritable(fs, folder, env = process.env) {
  const probe = nodePath.join(folder, '.vex-update-write-test-' + process.pid);
  try { fs.writeFileSync(probe, 'x'); fs.rmSync(probe, { force: true }); }
  catch (err) {
    const pf = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(Boolean).some(p => folder.toLowerCase().startsWith(String(p).toLowerCase()));
    throw new Error(`Vex cannot write to its own folder (${folder}): ${err.code || err.message}.` + (pf ? ' It is inside Program Files, which needs administrator rights; move the folder or install Vex with Vex-Setup.exe.' : ' Move the folder somewhere you can write, or install Vex with Vex-Setup.exe.'), { cause: err });
  }
}

// ---- the rollback state machine ---------------------------------------------

// States of pending-update.json:
//   installing         armed; the installer is about to run (or just ran)
//   trial              the new version started; it has not yet reached "ready"
//   rolling-back       the third start found two failed starts: the old installer was run
//   rolled-back        terminal: the old version is back; `to` is not offered again
//   rollback-failed    terminal: the old installer was run and the new version is still here
//   not-installed      terminal: the installer ran (or not) and the old version is still here
//   broken-no-backup   terminal: the new version fails to start and no old installer was kept
// Terminal states stay until the person has seen them (acknowledge()).
function createRollback({ fs, dir, currentVersion, now = () => Date.now(), hashFile }) {
  const file = nodePath.join(dir, PENDING_FILE);
  const read = () => readJson(fs, file);
  const write = rec => writeJson(fs, dir, file, rec);

  // Before the installer runs. `baseFile` is the installer of the version being
  // left (null if none was kept): hashed now so the rollback can be checked later.
  async function arm({ from, to, baseFile, target = null }) {
    let base = null, baseNote = '';
    if (baseFile) {
      try {
        const h = await hashFile(baseFile);
        base = { file: baseFile, sha512: h.sha512, size: h.size };
      } catch (err) { baseNote = 'the installer of ' + from + ' could not be read (' + (err.code || err.message) + ')'; }
    } else baseNote = 'no installer of ' + from + ' was kept';
    write({ state: 'installing', from, to, base, target, starts: 0, at: now() });
    return { armed: true, canGoBack: !!base, note: baseNote };
  }

  // The first thing a start does. Returns what the interface should know.
  function onStart() {
    const m = read();
    if (!m) return { kind: 'none' };
    const { from, to } = m;
    const out = (kind, extra = {}) => ({ kind, from, to, target: m.target || null, ...extra });
    const update = (patch) => { Object.assign(m, patch, { at: now() }); write(m); };
    const terminal = new Set(['rolled-back', 'rollback-failed', 'not-installed', 'broken-no-backup']);
    if (terminal.has(m.state)) return out(m.state, { stale: true });

    if (m.state === 'installing') {
      if (currentVersion === to) { update({ state: 'trial', starts: 1 }); return out('trial', { starts: 1 }); }
      if (currentVersion === from) { update({ state: 'not-installed' }); return out('not-installed'); }
      fs.rmSync(file, { force: true });
      return { kind: 'none' };
    }
    if (m.state === 'trial') {
      if (currentVersion !== to) { fs.rmSync(file, { force: true }); return { kind: 'none' }; }
      const failed = m.starts;    // starts of `to` that never reached "ready"
      if (failed < FAILED_STARTS_BEFORE_ROLLBACK) { update({ starts: m.starts + 1 }); return out('trial', { starts: m.starts }); }
      if (!m.base) { update({ state: 'broken-no-backup' }); return out('broken-no-backup', { failed }); }
      update({ state: 'rolling-back' });
      return out('rollback', { failed, base: m.base });
    }
    if (m.state === 'rolling-back') {
      if (currentVersion === from) { update({ state: 'rolled-back' }); return out('rolled-back'); }
      update({ state: 'rollback-failed' });
      return out('rollback-failed');
    }
    fs.rmSync(file, { force: true });
    return { kind: 'none' };
  }

  // The window is up and the interface said so. Ends the trial.
  function markReady() {
    const m = read();
    if (!m || m.state !== 'trial' || m.to !== currentVersion) return { kind: 'none' };
    fs.rmSync(file, { force: true });
    return { kind: 'ready', from: m.from, to: m.to };
  }

  // The rollback installer, hashed again right before it may run.
  async function checkedBase(base) {
    if (!base || typeof base.file !== 'string') throw new Error('No installer of the older version was kept.');
    let got;
    try { got = await hashFile(base.file); }
    catch (err) { throw new Error('The kept installer of the older version cannot be read (' + (err.code || err.message) + ').', { cause: err }); }
    if (got.sha512 !== base.sha512 || got.size !== base.size) throw new Error('The kept installer of the older version changed on disk since it was checked, so Vex will not run it.');
    return base.file;
  }

  // Vex did not close, so the installer will not run: the marker must not make
  // the next start report an install that was never tried.
  function disarm() {
    const m = read();
    if (m && m.state === 'installing') fs.rmSync(file, { force: true });
  }

  // The person has seen a terminal state.
  function acknowledge() {
    const m = read();
    if (m && m.state !== 'installing' && m.state !== 'trial' && m.state !== 'rolling-back') fs.rmSync(file, { force: true });
  }
  // A version that was rolled back from: not offered again.
  function blockedVersion() { const m = read(); return m && (m.state === 'rolled-back' || m.state === 'rollback-failed') ? m.to : null; }
  // Installer files that must survive cleanup while a trial or rollback needs them.
  function keepFiles() { const m = read(); return m && m.base && m.base.file ? [m.base.file] : []; }

  return { arm, disarm, onStart, markReady, checkedBase, acknowledge, blockedVersion, keepFiles, read, file };
}

function hashFileWith(fs) {
  return file => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    let size = 0;
    fs.createReadStream(file)
      .on('data', chunk => { size += chunk.length; hash.update(chunk); })
      .on('error', reject)
      .on('end', () => resolve({ sha512: hash.digest('base64'), size }));
  });
}

module.exports = { createUpdateLog, createStagedStore, createRollback, installKind, notInstalledMessage, installTarget, installerArgs, checkWritable, findRegisteredInstall, withOtherInstall, parseUninstallBlocks, hashFileWith, STATE_FILES, LOG_FILE, STAGED_FILE, PENDING_FILE, LOG_LINES, FAILED_STARTS_BEFORE_ROLLBACK };
