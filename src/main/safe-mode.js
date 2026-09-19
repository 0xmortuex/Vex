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
//   The settings snapshot. The first launch of a new version copies
//   vex-persist.json aside first, so an update that breaks a setting can be
//   undone: the copy is the settings as they were under the version before.
//   Five are kept.
const path = require('path');

const STATE = 'boot-state.json';
const SNAPSHOT_DIR = 'settings-backups';
const MAX_SNAPSHOTS = 5;
const FAILS_BEFORE_SAFE = 2;

function createBootGuard({ dir, fs, argv = [], version = '0.0.0', settingsFile, now = () => Date.now(), log }) {
  const note = typeof log === 'function' ? log : () => {};
  const stateFile = path.join(dir, STATE);
  const snapshotDir = path.join(dir, SNAPSHOT_DIR);

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
    if (upgraded || !prev.version) snapshotSettings(prev.version || 'first-run');
    if (crashed) note(`[SafeMode] the previous launch did not finish starting (${fails} in a row)`);
    if (safeMode) note('[SafeMode] starting in safe mode: no extensions, no panels, no session restore' + (asked ? ' (asked for with --safe-mode)' : ''));
    return { safeMode, fails, crashed, asked, upgradedFrom: upgraded ? prev.version : null, brokenSinceUpdateFrom: fails >= FAILS_BEFORE_SAFE && from ? from : null };
  }

  // Called when the interface is really up. Until this, the launch counts as
  // crashed.
  function started() {
    return write({ phase: 'started', fails: 0, version, at: now() });
  }

  // The settings as they are now, kept under the version that wrote them.
  function snapshotSettings(label) {
    if (!settingsFile) return null;
    try {
      if (!fs.existsSync(settingsFile)) return null;
      try { fs.mkdirSync(snapshotDir, { recursive: true }); } catch { /* already there */ }
      const name = 'vex-persist-' + String(label || 'unknown').replace(/[^\w.-]/g, '_') + '.json';
      const to = path.join(snapshotDir, name);
      fs.copyFileSync(settingsFile, to);
      prune();
      note('[SafeMode] settings snapshot kept: ' + name);
      return to;
    } catch (err) { note('[SafeMode] could not snapshot the settings: ' + err.message); return null; }
  }

  function snapshots() {
    try {
      return fs.readdirSync(snapshotDir)
        .filter(n => /^vex-persist-.*\.json$/.test(n))
        .map(n => ({ name: n, label: n.replace(/^vex-persist-|\.json$/g, ''), path: path.join(snapshotDir, n), at: (() => { try { return fs.statSync(path.join(snapshotDir, n)).mtimeMs; } catch { return 0; } })() }))
        .sort((a, b) => b.at - a.at);
    } catch { return []; }
  }

  function prune() {
    const extra = snapshots().slice(MAX_SNAPSHOTS);
    for (const s of extra) { try { fs.unlinkSync(s.path); } catch { /* gone already */ } }
  }

  // Put a snapshot back. The current settings are snapshotted first, so a
  // restore is itself undoable.
  function restoreSettings(name) {
    const found = snapshots().find(s => s.name === name || s.label === name);
    if (!found) throw new Error('No settings backup called "' + name + '"');
    snapshotSettings('before-restore');
    fs.copyFileSync(found.path, settingsFile);
    note('[SafeMode] settings restored from ' + found.name);
    return found;
  }

  return { begin, started, snapshotSettings, snapshots, restoreSettings, stateFile, snapshotDir };
}

module.exports = { createBootGuard, STATE, SNAPSHOT_DIR, MAX_SNAPSHOTS, FAILS_BEFORE_SAFE };
