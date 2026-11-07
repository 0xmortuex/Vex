// "What changed since the last launch": an integrity report.
//
// At each launch Vex compares SHA-256 hashes of its own program files
// (Vex.exe, resources/app.asar, the .dll files next to Vex.exe), of its Start
// menu and Desktop shortcuts, and of four configuration files Vex owns
// (site-rules.json, permissions.json, session-routing.json,
// extension-installs.json) with the ones it recorded last time, and tells the
// Attention Inbox what differs.
//
// HONEST LIMITS. The record sits in the same profile folder as the thing it
// watches, so a program running as you that is careful can recompute it. This
// catches accidents (a half-finished copy, an antivirus quarantine, a tool that
// rewrote a shortcut, a file edited by hand) and clumsy tampering. It is not a
// defence against a determined same-user attacker, and the text shown says so.
// It never repairs anything.
//
// WHEN THINGS ARE RECORDED
//   program files + shortcuts  re-recorded silently when the Vex version changed (an update
//                              legitimately replaces them); compared when it did not.
//   configuration files        hashed at start-up, BEFORE Vex touches them (captureConfigs),
//                              and again when Vex quits normally (recordQuit, cleanExit:true).
//                              Compared only when the last session ended normally and the
//                              version is the same, so a crash or an update never produces
//                              "changed outside Vex".
// COST. Files are hashed in 1 MB chunks, yielding between reads, after start-up,
// and a file whose size and modified time are unchanged keeps its recorded hash
// (so a normal launch hashes nothing). Files over maxFileBytes are skipped.
// Every failure is reported to `log`; none stops Vex.
'use strict';
const crypto = require('crypto');
const nodePath = require('path');

const BASELINE = 'integrity-baseline.json';
const MAX_DLLS = 80;
const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
const CONFIG_FILES = Object.freeze({
  'site-rules': 'site-rules.json',
  'permissions': 'permissions.json',
  'session-routing': 'session-routing.json',
  'extensions': 'extension-installs.json',
});

function createIntegrityReport({ fs, userDataPath, appDir, execPath, appVersion, packaged, shortcuts = [], readShortcut = null, signatureMode = () => 'unknown', writeFile = null, now = () => Date.now(), maxFileBytes = 300 * 1024 * 1024, log = console, yieldNow = () => new Promise(r => setImmediate(r)) }) {
  if (!userDataPath || !fs) throw new Error('The integrity report needs the profile folder and fs');
  const baselineFile = nodePath.join(userDataPath, BASELINE);
  const write = writeFile || ((file, text) => { fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file); });
  let launchConfigs = null;      // hashed before Vex touched them this session
  let cached = null;             // the run's promise

  function readBaseline() {
    let text;
    try { text = fs.readFileSync(baselineFile, 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') return null; log.warn('[Integrity] the record could not be read, so a new one will be made:', err.message); return null; }
    try {
      const b = JSON.parse(text);
      if (!b || b.v !== 1 || typeof b.files !== 'object' || !b.files) throw new Error('not a record');
      return b;
    } catch (err) { log.warn('[Integrity] the record is damaged, so a new one will be made:', err.message); return null; }
  }
  const saveBaseline = (b) => { try { write(baselineFile, JSON.stringify(b)); } catch (err) { log.warn('[Integrity] could not save the record:', err.message); } };

  // --- hashing -----------------------------------------------------------------
  function hashStream(file) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      const s = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
      s.on('data', c => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
    });
  }
  // { sha256, size, mtimeMs } | { absent: true } | { skipped } ; keeps the recorded hash when size and mtime are unchanged.
  async function fileEntry(file, previous) {
    let st;
    try { st = fs.statSync(file); }
    catch (err) { if (err.code === 'ENOENT') return { absent: true }; throw err; }
    if (!st.isFile()) return { skipped: 'not a file' };
    if (st.size > maxFileBytes) return { skipped: 'too large', size: st.size };
    if (previous && previous.sha256 && previous.size === st.size && previous.mtimeMs === st.mtimeMs) return previous;
    await yieldNow();
    return { sha256: await hashStream(file), size: st.size, mtimeMs: st.mtimeMs };
  }
  const textHash = (text) => crypto.createHash('sha256').update(text).digest('hex');

  // Small configuration files, read synchronously (a few KB): the whole point is to do it early.
  function hashConfigsSync() {
    const out = {};
    for (const [name, rel] of Object.entries(CONFIG_FILES)) {
      const file = nodePath.join(userDataPath, rel);
      try {
        const st = fs.statSync(file);
        out[name] = st.size > MAX_CONFIG_BYTES ? { skipped: 'too large' } : { sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), size: st.size };
      } catch (err) {
        out[name] = err.code === 'ENOENT' ? { absent: true } : { error: err.code || 'unreadable' };
      }
    }
    return out;
  }
  function captureConfigs() { if (!launchConfigs) launchConfigs = hashConfigsSync(); return launchConfigs; }

  function shortcutEntries() {
    const out = {};
    if (!readShortcut) return out;
    for (const { id, file } of shortcuts) {
      if (!file || !fs.existsSync(file)) { out[id] = { absent: true }; continue; }
      try {
        const l = readShortcut(file) || {};
        out[id] = { sha256: textHash(JSON.stringify([l.target || '', l.args || '', l.cwd || '', l.icon || '', l.appUserModelId || ''])), target: String(l.target || '').slice(0, 260) };
      } catch (err) { out[id] = { error: err.message }; }
    }
    return out;
  }

  async function programFiles(previous) {
    const prev = previous || {};
    const out = {};
    out['Vex.exe'] = await fileEntry(execPath, prev['Vex.exe']);
    out['resources/app.asar'] = await fileEntry(nodePath.join(appDir, 'resources', 'app.asar'), prev['resources/app.asar']);
    let names = [];
    try { names = fs.readdirSync(appDir).filter(n => /\.dll$/i.test(n)).sort(); }
    catch (err) { log.warn('[Integrity] could not list the program folder:', err.message); }
    for (const n of names.slice(0, MAX_DLLS)) out[n] = await fileEntry(nodePath.join(appDir, n), prev[n]);
    return out;
  }

  // What differs between two entries: 'changed' | 'added' | 'removed' | null.
  function diffEntry(was, is) {
    if (!was && !is) return null;
    if (!was) return is.absent || is.skipped || is.error ? null : 'added';
    if (!is) return was.absent ? null : 'removed';
    if (was.absent && is.absent) return null;
    if (was.absent) return 'added';
    if (is.absent) return 'removed';
    if (was.sha256 && is.sha256) return was.sha256 === is.sha256 ? null : 'changed';
    return null;   // skipped or unreadable on either side: nothing can be said
  }

  async function runOnce() {
    if (!packaged) return { ok: true, skipped: 'not a packaged build', notes: [] };
    const baseline = readBaseline();
    const configsNow = captureConfigs();
    const files = await programFiles(baseline && baseline.files);
    const shortcutsNow = shortcutEntries();
    const notes = [];

    if (baseline && baseline.appVersion === appVersion) {
      const exe = diffEntry(baseline.files['Vex.exe'], files['Vex.exe']);
      if (exe) notes.push({ id: 'exe', change: exe });
      const asar = diffEntry(baseline.files['resources/app.asar'], files['resources/app.asar']);
      if (asar) notes.push({ id: 'asar', change: asar });
      const dlls = [...new Set([...Object.keys(baseline.files), ...Object.keys(files)])].filter(n => /\.dll$/i.test(n) && diffEntry(baseline.files[n], files[n]));
      if (dlls.length) notes.push({ id: 'dll', count: dlls.length, names: dlls.slice(0, 5) });
      for (const { id } of shortcuts) {
        const d = diffEntry((baseline.shortcuts || {})[id], shortcutsNow[id]);
        if (d && d !== 'added') notes.push({ id: 'shortcut', where: id, change: d });
      }
      if (baseline.cleanExit === true) {
        for (const name of Object.keys(CONFIG_FILES)) {
          const d = diffEntry((baseline.configs || {})[name], configsNow[name]);
          if (d) notes.push({ id: 'config', name, change: d });
        }
      }
    }
    // One-time: the update feed has no signature check yet (src/main/update-signature.js).
    const noted = (baseline && baseline.notedUnsignedFeed) === true;
    const mode = signatureMode();
    if (mode === 'off' && !noted) notes.push({ id: 'feed-unsigned' });

    saveBaseline({ v: 1, appVersion, recordedAt: now(), files, shortcuts: shortcutsNow, configs: configsNow, cleanExit: false, notedUnsignedFeed: noted || mode === 'off' });
    if (notes.length) log.log('[Integrity] ' + notes.map(n => n.id + (n.name ? ':' + n.name : '')).join(', '));
    return { ok: true, notes };
  }

  // Cached: the first caller starts it, later callers get the same answer.
  function run() {
    if (!cached) cached = runOnce().catch(err => { log.error('[Integrity] the check failed:', err); return { ok: false, error: err.message, notes: [] }; });
    return cached;
  }

  // Vex is quitting normally: remember the configuration files as Vex left them.
  function recordQuit() {
    if (!packaged) return false;
    try {
      const b = readBaseline();
      if (!b || b.appVersion !== appVersion) return false;   // the check did not run this session: leave the old record alone
      b.configs = hashConfigsSync();
      b.cleanExit = true;
      saveBaseline(b);
      return true;
    } catch (err) { log.warn('[Integrity] could not record the quit state:', err.message); return false; }
  }

  return { captureConfigs, run, recordQuit, hashConfigsSync, BASELINE };
}

module.exports = { createIntegrityReport, CONFIG_FILES, BASELINE };
