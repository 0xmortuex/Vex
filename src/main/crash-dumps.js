// === Crash dumps that stay on this computer ==================================
//
// Without a crash reporter a crashed Vex or page process leaves nothing but a
// line in crash-log.json. With one, Chromium's crash handler writes a minidump
// for the crash. Vex starts it with uploadToServer:false and NO submit address,
// so there is nowhere for a dump to be sent: the files are for the owner (to
// keep, or to attach to a bug report by hand), nothing else (audit E3).
//
//   * They are kept in <profile>/crashes (reports/*.dmp). Not in the backups
//     (those copy a fixed list of settings files), not in sync (it carries
//     named settings keys), and not in the profile encryption (it covers files
//     in the profile folder, not this subfolder).
//   * A dump is a snapshot of the memory of a crashed process: it can hold text
//     from pages that were open, and anything typed into them. Health says so.
//   * They are deleted after 14 days (sweep).
//   * Health lists them (list); the problem report can include their names and
//     sizes when the person asks, never the files.
const path = require('path');

const FOLDER = 'crashes';
const KEEP_DAYS = 14;
// Where Chromium's crash handler puts a dump while it is waiting, and after.
const SUBFOLDERS = ['reports', 'pending', 'completed', 'new'];
const DUMP_NAME = /^[A-Za-z0-9._-]+\.dmp$/;

// Before the app is ready. -> { dir } or throws (the caller reports it: a failed
// start of the reporter must never stop Vex starting, but it is never silent).
function startLocalDumps({ app, crashReporter, userData }) {
  const dir = path.join(userData, FOLDER);
  app.setPath('crashDumps', dir);
  crashReporter.start({ uploadToServer: false, compress: true });
  if (crashReporter.getUploadToServer() !== false) throw new Error('crash dumps would be uploaded: refusing to run the crash reporter');
  return { dir };
}

function dumpsIn(dir, fs) {
  const out = [];
  for (const sub of SUBFOLDERS) {
    let names;
    try { names = fs.readdirSync(path.join(dir, sub)); }
    catch (err) { if (err && err.code === 'ENOENT') continue; throw err; }
    for (const name of names) {
      if (!DUMP_NAME.test(name)) continue;
      const file = path.join(dir, sub, name);
      let st;
      try { st = fs.lstatSync(file); }
      catch (err) { if (err && err.code === 'ENOENT') continue; throw err; }   // deleted since the listing
      if (!st.isFile()) continue;                 // never follow a link or enter a folder
      out.push({ name, file, bytes: st.size, at: Math.round(st.mtimeMs) });
    }
  }
  return out;
}

// For Health: the newest first, without full paths. -> { dir, keepDays, files: [{ name, bytes, at }], error? }
function list({ dir, fs, limit = 20 }) {
  try {
    const files = dumpsIn(dir, fs).sort((a, b) => b.at - a.at).slice(0, limit).map(({ name, bytes, at }) => ({ name, bytes, at }));
    return { dir, keepDays: KEEP_DAYS, files };
  } catch (err) {
    return { dir, keepDays: KEEP_DAYS, files: [], error: err.message };
  }
}

// Deletes dumps older than the keep time. Safe because: it only ever touches regular files named *.dmp directly inside
// the four dump folders of the crashes folder (a name with a separator, a link or a folder never matches), these are
// diagnostic copies made by a crash and nothing in Vex reads them back, and one file that cannot be deleted is reported
// and skipped, never stopping the rest. -> { deleted, kept, failed: [{ name, error }] }
function sweep({ dir, fs, now = Date.now(), keepDays = KEEP_DAYS, log }) {
  const note = typeof log === 'function' ? log : () => {};
  const cutoff = now - keepDays * 24 * 3600 * 1000;
  const res = { deleted: 0, kept: 0, failed: [] };
  for (const f of dumpsIn(dir, fs)) {
    if (f.at >= cutoff) { res.kept++; continue; }
    try { fs.unlinkSync(f.file); res.deleted++; }
    catch (err) { res.failed.push({ name: f.name, error: err.message }); note('[CrashDumps] could not delete ' + f.name + ': ' + err.message); }
  }
  return res;
}

module.exports = { startLocalDumps, list, sweep, FOLDER, KEEP_DAYS, SUBFOLDERS, DUMP_NAME };
