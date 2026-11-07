// === When the graphics process keeps crashing ================================
//
// A failing graphics driver kills Chromium's GPU process again and again; every
// time the whole interface flickers or freezes, and Vex only wrote "helper
// process gone" and carried on (audit A10). Safe mode left the GPU alone.
//
// The ladder:
//   1. every GPU child-process-gone that is a real crash is counted (the same
//      exit-kinds filter as the crash log is applied by the caller);
//   2. the third one in a session writes a small flag file in the profile
//      (gpu-fallback.json). Nothing else changes during that session: switching
//      acceleration off needs a restart;
//   3. on the NEXT start, BEFORE the app is ready (app.disableHardwareAcceleration
//      does nothing afterwards), acceleration is switched off, and the person is
//      told once (takeNotice -> the Attention Inbox);
//   4. --safe-mode, and the automatic safe mode, start with it off too;
//   5. Settings has a switch to turn it back on. Its value, vex.gpuAccel, is
//      read straight from vex-persist.json (the interface mirrors localStorage
//      there): 'on' clears the flag and keeps acceleration on, 'off' keeps it
//      off by choice, anything else leaves the ladder in charge.
// It fails safe: an unreadable or unwritable flag file is reported and means
// "acceleration stays as it is".
const path = require('path');

const FILE = 'gpu-fallback.json';
const PERSIST = 'vex-persist.json';
const SETTING = 'vex.gpuAccel';
const THRESHOLD = 3;

function createGpuLadder({ dir, fs, version = '', now = () => Date.now(), threshold = THRESHOLD, log }) {
  const note = typeof log === 'function' ? log : () => {};
  const flagFile = path.join(dir, FILE);
  let crashes = 0;
  let tripped = false;

  // -> { at, count, version, told } or null (no flag).
  function readFlag() {
    let raw;
    try { raw = fs.readFileSync(flagFile, 'utf8'); }
    catch (err) {
      if (err && err.code === 'ENOENT') return null;
      note('[GPU] the fallback flag could not be read: ' + err.message);
      return null;
    }
    try {
      const j = JSON.parse(raw);
      if (!j || typeof j !== 'object') throw new Error('not an object');
      return { at: Number(j.at) || 0, count: Number(j.count) || threshold, version: String(j.version || ''), told: j.told === true };
    } catch (err) {
      note('[GPU] the fallback flag is not valid JSON and is ignored: ' + err.message);
      return null;
    }
  }
  function writeFlag(flag) {
    try { fs.writeFileSync(flagFile, JSON.stringify(flag)); return true; }
    catch (err) { note('[GPU] could not write the fallback flag: ' + err.message); return false; }
  }
  function clearFlag() {
    try { fs.unlinkSync(flagFile); return true; }
    catch (err) { if (err && err.code === 'ENOENT') return true; note('[GPU] could not remove the fallback flag: ' + err.message); return false; }
  }

  // The person's choice, from the mirrored settings file: 'on' | 'off' | null.
  function readChoice() {
    let raw;
    try { raw = fs.readFileSync(path.join(dir, PERSIST), 'utf8'); }
    catch (err) { if (err && err.code !== 'ENOENT') note('[GPU] could not read the graphics choice: ' + err.message); return null; }
    try {
      const v = JSON.parse(raw)[SETTING];
      return v === 'on' || v === 'off' ? v : null;
    } catch (err) { note('[GPU] the settings file could not be read for the graphics choice: ' + err.message); return null; }
  }

  // One GPU process that really crashed. -> { count, tripped } (tripped: this call wrote the flag).
  function noteGpuGone() {
    crashes++;
    let justTripped = false;
    if (crashes >= threshold && !tripped) {
      tripped = writeFlag({ at: now(), count: crashes, version, told: false });
      justTripped = tripped;
      if (tripped) note('[GPU] the graphics process crashed ' + crashes + ' times; hardware acceleration will be off at the next start');
    }
    return { count: crashes, tripped: justTripped };
  }

  // Before the app is ready. app: electron's app (injected). -> { disabled, reason, error? }
  function applyAtBoot({ app, safeMode = false, argv = [] }) {
    const asked = safeMode || argv.some(a => a === '--safe-mode');
    const choice = readChoice();
    const flag = readFlag();
    let reason = null;
    if (asked) reason = 'safe mode';
    else if (choice === 'off') reason = 'you turned it off';
    else if (flag && choice === 'on') { clearFlag(); note('[GPU] hardware acceleration was switched back on by choice'); }
    else if (flag) reason = 'the graphics process crashed ' + flag.count + ' times';
    if (!reason) return { disabled: false, reason: null };
    if (app.isReady()) {
      const error = 'hardware acceleration can only be switched off before Vex is ready';
      note('[GPU] ' + error);
      return { disabled: false, reason, error };
    }
    app.disableHardwareAcceleration();
    note('[GPU] hardware acceleration is off: ' + reason);
    return { disabled: true, reason };
  }

  // The one-time message for the interface: after the crashes, not for safe mode
  // or a choice. Marks it told. -> { count, at } or null.
  function takeNotice() {
    const flag = readFlag();
    if (!flag || flag.told) return null;
    if (readChoice() !== null) return null;
    if (!writeFlag({ ...flag, told: true })) return null;      // cannot record it: do not say it again and again
    return { count: flag.count, at: flag.at };
  }

  // For Settings: is it off because of the crashes right now?
  function status() {
    const flag = readFlag();
    return { crashFallback: !!flag, count: flag ? flag.count : 0, at: flag ? flag.at : 0, sessionCrashes: crashes };
  }

  return { noteGpuGone, applyAtBoot, takeNotice, status, readFlag, readChoice, flagFile };
}

module.exports = { createGpuLadder, FILE, SETTING, THRESHOLD };
