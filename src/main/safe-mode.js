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
const FEATURE_FAILS_BEFORE_OFF = 2;
const FEATURE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function createBootGuard({ dir, fs, argv = [], version = '0.0.0', backupFirstStart = null, now = () => Date.now(), log }) {
  const note = typeof log === 'function' ? log : () => {};
  const stateFile = path.join(dir, STATE);

  // `current` is the feature that was being started when the launch last wrote
  // its state; `featureFails` counts, per feature, the launches in a row that
  // died while it was the one starting (feature isolation, see begin()).
  const cleanFails = (v) => {
    const out = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, n] of Object.entries(v)) if (FEATURE_ID.test(k) && Number.isInteger(n) && n > 0 && n < 100) out[k] = n;
    }
    return out;
  };

  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (raw && typeof raw === 'object') return { phase: String(raw.phase || 'started'), fails: Number(raw.fails) || 0, version: String(raw.version || ''), at: Number(raw.at) || 0, from: String(raw.from || ''), current: FEATURE_ID.test(String(raw.current || '')) ? String(raw.current) : '', featureFails: cleanFails(raw.featureFails) };
    } catch { /* first run, or unreadable: treat as a clean start */ }
    return { phase: 'started', fails: 0, version: '', at: 0, from: '', current: '', featureFails: {} };
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
    let fails = crashed ? prev.fails + 1 : 0;
    // Feature isolation: a launch that died while one named feature was
    // starting counts against that feature. When the same feature was the one
    // starting in FEATURE_FAILS_BEFORE_OFF launches in a row, it alone is left
    // out of this launch (disabledFeatures) and the app starts normally,
    // instead of the whole app going to safe mode for one feature's fault.
    const featureFails = crashed ? { ...prev.featureFails } : {};
    const disabledFeatures = [];
    if (crashed && prev.current) {
      featureFails[prev.current] = (featureFails[prev.current] || 0) + 1;
      if (featureFails[prev.current] >= FEATURE_FAILS_BEFORE_OFF) {
        disabledFeatures.push(prev.current);
        delete featureFails[prev.current];
        // These launches are explained by the feature, so they do not count
        // toward safe mode — but only when no other launch in the run died
        // somewhere else (fails above the feature's own count).
        if (fails <= FEATURE_FAILS_BEFORE_OFF) fails = 0;
        note(`[SafeMode] the feature "${prev.current}" was starting in ${FEATURE_FAILS_BEFORE_OFF} launches that did not finish; it is left out of this one`);
      }
    }
    const safeMode = asked || fails >= FAILS_BEFORE_SAFE;
    const upgraded = prev.version && prev.version !== version;
    // The version this one replaced, carried through the failed launches that
    // follow an update, so safe mode can offer to go back to it.
    const from = upgraded ? prev.version : (crashed ? prev.from : '');
    write({ phase: 'starting', fails, version, at: now(), from, current: '', featureFails });
    const updateBackup = (upgraded || !prev.version) ? backUp(prev) : null;
    if (crashed) note(`[SafeMode] the previous launch did not finish starting (${fails} in a row)`);
    if (safeMode) note('[SafeMode] starting in safe mode: no extensions' + (asked ? ' (asked for with --safe-mode)' : ''));
    return { safeMode, fails, crashed, asked, disabledFeatures, upgradedFrom: upgraded ? prev.version : null, brokenSinceUpdateFrom: fails >= FAILS_BEFORE_SAFE && from ? from : null, updateBackup };
  }

  // The interface reports the feature it is about to start and, when it has
  // started, that it did (js/vex-breaker.js bootStep). A launch that dies
  // between the two is blamed on that feature by the next begin(). The state is
  // written at both ends so a crash after "done" is never blamed on it.
  function featureStarting(id) {
    if (!FEATURE_ID.test(String(id))) throw new Error('Not a feature id: ' + String(id).slice(0, 40));
    const cur = read();
    if (cur.phase !== 'starting') return false;      // the launch already finished: nothing to blame
    return write({ ...cur, current: id });
  }
  function featureStarted(id) {
    const cur = read();
    if (cur.phase !== 'starting' || cur.current !== id) return false;
    return write({ ...cur, current: '' });
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
    return write({ phase: 'started', fails: 0, version, at: now(), current: '', featureFails: {} });
  }

  return { begin, started, featureStarting, featureStarted, stateFile };
}

module.exports = { createBootGuard, STATE, FAILS_BEFORE_SAFE, FEATURE_FAILS_BEFORE_OFF, FEATURE_ID };
