// === Getting back in when Vex will not start ================================
//
// Everything else in Vex assumes it starts. When it does not — an extension
// that breaks the session, a setting that crashes a panel, a bad update — there
// is nothing to click, because the thing you would click is what failed. The
// browser that holds your tabs, passwords and notes has to have a way back in.
//
// Two parts, both here so they can be tested without starting anything:
//
//   The boot guard. Every launch writes "starting" before the window appears
//   and "started" once the interface is up. A launch that finds the previous
//   one still marked "starting" knows it crashed on the way; after two of
//   those in a row, Vex starts in SAFE MODE — no extensions, no panels, no
//   session restore — and says so, instead of failing a third time.
//
//   The backup at the first start of a new version. The first launch of a
//   new version asks `backupFirstStart` (update-backups.js, saveAtFirstStart)
//   to back the settings up as the version before left them, unless the
//   update cover already did. What happened, or why it failed, is in what
//   begin() returns (updateBackup) so the interface can say it: Vex has been
//   updated by then, so a failed backup cannot stop the update, but it is
//   never only a line in a log.
const path = require('path');

const STATE = 'boot-state.json';
const FAILS_BEFORE_SAFE = 2;

function createBootGuard({ dir, fs, argv = [], version = '0.0.0', backupFirstStart = null, now = () => Date.now(), log }) {
  const note = typeof log === 'function' ? log : () => {};
  const stateFile = path.join(dir, STATE);

  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (raw && typeof raw === 'object') return { phase: String(raw.phase || 'started'), fails: Number(raw.fails) || 0, version: String(raw.version || ''), at: Number(raw.at) || 0, from: String(raw.from || '') };
    } catch { /* first run, or unreadable: treat as a clean start */ }
    return { phase: 'started', fails: 0, version: '', at: 0, from: '' };
  }

  function write(state) {
    try { fs.writeFileSync(stateFile, JSON.stringify(state)); return true; }
    catch (err) { note('[SafeMode] could not record the boot state: ' + err.message); return false; }
  }

  // Called as early in main as possible. Returns what this launch should do.
  function begin() {
    const prev = read();
    const asked = argv.some(a => a === '--safe-mode');
    // A launch that never reached "started" crashed on the way up. One may be
    // a power cut or a kill; two in a row is Vex's own fault.
    const crashed = prev.phase === 'starting';
    const fails = crashed ? prev.fails + 1 : 0;
    const safeMode = asked || fails >= FAILS_BEFORE_SAFE;
    const upgraded = prev.version && prev.version !== version;
    // The version this one replaced, carried through the failed launches that
    // follow an update, so safe mode can offer to go back to it.
    const from = upgraded ? prev.version : (crashed ? prev.from : '');
    write({ phase: 'starting', fails, version, at: now(), from });
    const updateBackup = (upgraded || !prev.version) ? backUp(prev) : null;
    if (crashed) note(`[SafeMode] the previous launch did not finish starting (${fails} in a row)`);
    if (safeMode) note('[SafeMode] starting in safe mode: no extensions' + (asked ? ' (asked for with --safe-mode)' : ''));
    return { safeMode, fails, crashed, asked, upgradedFrom: upgraded ? prev.version : null, brokenSinceUpdateFrom: fails >= FAILS_BEFORE_SAFE && from ? from : null, updateBackup };
  }

  // -> null (nothing to do), { ok: true, name, version } or { ok: false, error, version }.
  function backUp(prev) {
    if (typeof backupFirstStart !== 'function') return null;
    try {
      const saved = backupFirstStart({ version, from: prev.version || '', since: prev.at || 0 });
      if (!saved) return null;
      note('[SafeMode] backup at the first start of ' + version + ' kept: ' + saved.name);
      return { ok: true, name: saved.name, version };
    } catch (err) {
      note('[SafeMode] could not back up the settings at the first start of ' + version + ': ' + err.message);
      return { ok: false, error: err.message, version };
    }
  }

  // Called when the interface is really up. Until this, the launch counts as
  // crashed.
  function started() {
    return write({ phase: 'started', fails: 0, version, at: now() });
  }

  return { begin, started, stateFile };
}

module.exports = { createBootGuard, STATE, FAILS_BEFORE_SAFE };
