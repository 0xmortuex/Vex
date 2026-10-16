// === Tidy up the downloads folder ==========================================
//
// Proposes sorting the loose files of ONE folder (the folder Vex saves
// downloads to) into <Type>/<year-month> subfolders, shows exactly what would
// move, and only acts when the user confirms. Every batch is written to a log
// first-hand so it can be undone completely.
//
// Hard rules, enforced here and not by the caller:
//   - only regular files directly inside `dir` are considered; nothing in a
//     subfolder, no symlinks, no directories, no hidden or in-progress files
//   - a move is fs.renameSync inside `dir`: the same volume by construction.
//     Nothing is copied, and nothing is ever deleted
//   - a destination that exists is never overwritten: the file gets a
//     " (n)" suffix instead
//   - an undo puts a file back only if its new place is still there and the
//     old name is free; otherwise it is left and reported
//   - the plan lives here, in memory; apply takes a plan id, never paths
const path = require('path');
const crypto = require('crypto');

const TYPES = {
  Images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif', 'ico', 'tif', 'tiff'],
  Documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'csv', 'md', 'epub'],
  Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'],
  Installers: ['exe', 'msi', 'msix', 'appx', 'dmg', 'iso'],
  Video: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v'],
  Audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma'],
};
const BY_EXT = new Map();
for (const [type, list] of Object.entries(TYPES)) for (const e of list) BY_EXT.set(e, type);
// Still being written, or Windows' own: never touched.
const IN_PROGRESS = new Set(['crdownload', 'part', 'partial', 'tmp', 'download', 'opdownload']);
const DAY = 24 * 3600 * 1000;

function typeOf(name) {
  const ext = path.extname(name).replace(/^\./, '').toLowerCase();
  return { ext, type: BY_EXT.get(ext) || 'Other' };
}
function bucketOf(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// motw (mark-of-the-web.js, T3-111): when given, each move is wrapped so a file's "downloaded from the
// internet" mark is read first and checked after; one that could not be kept is counted in `markLost`.
function createDownloadTidy({ fs, logFile, onMoved, motw, now = () => Date.now() }) {
  const plans = new Map();   // id -> { dir, moves }

  function readLog() {
    try {
      if (!fs.existsSync(logFile)) return [];
      const v = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      return Array.isArray(v) ? v : [];
    } catch (err) { throw new Error('The tidy-up log could not be read: ' + err.message, { cause: err }); }
  }
  function writeLog(entries) {
    // Written beside, then renamed over: a crash cannot leave half a log.
    const tmp = logFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entries.slice(-50), null, 1));
    fs.renameSync(tmp, logFile);
  }
  const rename = (from, to, lost) => {
    if (!motw) { fs.renameSync(from, to); return; }
    const r = motw.move(from, to, () => fs.renameSync(from, to));
    if (r.carried && !r.kept && !r.restored) lost.push(path.basename(to));
  };
  const unique = (target) => {
    if (!fs.existsSync(target)) return target;
    const ext = path.extname(target), base = target.slice(0, target.length - ext.length);
    for (let i = 1; i < 1000; i++) { const c = `${base} (${i})${ext}`; if (!fs.existsSync(c)) return c; }
    throw new Error('Too many files share the name ' + path.basename(target));
  };

  // What would move. Nothing is changed.
  function plan(dir, { minAgeDays = 7 } = {}) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('The downloads folder is not a full path');
    if (!fs.statSync(dir).isDirectory()) throw new Error('The downloads folder is not a folder');
    if (!Number.isFinite(minAgeDays) || minAgeDays < 0 || minAgeDays > 3650) throw new Error('Choose an age between 0 and 3650 days');
    const t = now();
    const moves = [];
    const skipped = { tooNew: 0, inProgress: 0, other: 0 };
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile()) { skipped.other++; continue; }          // folders, symlinks
      const name = ent.name;
      if (name.startsWith('.') || name.toLowerCase() === 'desktop.ini') { skipped.other++; continue; }
      const { ext, type } = typeOf(name);
      if (IN_PROGRESS.has(ext)) { skipped.inProgress++; continue; }
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (t - st.mtimeMs < minAgeDays * DAY) { skipped.tooNew++; continue; }
      const folder = path.join(type, bucketOf(st.mtimeMs));
      moves.push({ name, from: full, folder, to: path.join(dir, folder, name), type, size: st.size, modified: st.mtimeMs });
    }
    const id = crypto.randomBytes(8).toString('hex');
    plans.set(id, { dir: path.resolve(dir), moves });
    if (plans.size > 5) plans.delete(plans.keys().next().value);
    return { id, dir, minAgeDays, moves: moves.map(m => ({ name: m.name, folder: m.folder.split(path.sep).join('/'), type: m.type, size: m.size, modified: m.modified })), skipped };
  }

  // Do a plan the user saw. The log entry is written BEFORE the first rename
  // (marked pending) and finalised after, so a crash mid-batch is undoable.
  function apply(planId) {
    const p = plans.get(planId);
    if (!p) throw new Error('That preview has expired. Preview again.');
    plans.delete(planId);
    const batch = { id: crypto.randomBytes(8).toString('hex'), at: now(), dir: p.dir, moves: [], undoneAt: null, pending: true };
    const failed = [];
    const log = readLog();
    log.push(batch);
    writeLog(log);
    const createdDirs = new Set();
    const markLost = [];
    for (const m of p.moves) {
      try {
        // Re-check at the moment of the move: still there, still loose in dir.
        if (path.dirname(m.from) !== p.dir) throw new Error('not directly in the folder');
        const st = fs.lstatSync(m.from);
        if (!st.isFile()) throw new Error('no longer a plain file');
        const destDir = path.dirname(m.to);
        if (path.dirname(path.dirname(destDir)) !== p.dir) throw new Error('destination outside the folder');
        const typeDir = path.dirname(destDir);
        if (!fs.existsSync(typeDir)) { fs.mkdirSync(typeDir); createdDirs.add(typeDir); }
        if (!fs.existsSync(destDir)) { fs.mkdirSync(destDir); createdDirs.add(destDir); }
        const to = unique(m.to);
        rename(m.from, to, markLost);
        batch.moves.push({ from: m.from, to });
        if (typeof onMoved === 'function') { try { onMoved(m.from, to); } catch { /* bookkeeping only */ } }
      } catch (err) { failed.push({ name: m.name, error: err.message }); }
    }
    batch.pending = false;
    batch.created = [...createdDirs];
    writeLog(log);
    return { id: batch.id, moved: batch.moves.length, failed, markLost };
  }

  function history() {
    return readLog().map(b => ({ id: b.id, at: b.at, dir: b.dir, count: Array.isArray(b.moves) ? b.moves.length : 0, undone: !!b.undoneAt }));
  }

  // Put a batch back (the newest not-yet-undone one when no id is given).
  function undo(batchId) {
    const log = readLog();
    const batch = batchId ? log.find(b => b.id === batchId) : [...log].reverse().find(b => !b.undoneAt && b.moves && b.moves.length);
    if (!batch) throw new Error('There is nothing to undo');
    if (batch.undoneAt) throw new Error('That tidy-up was already undone');
    const restored = [], left = [], markLost = [];
    for (const m of [...batch.moves].reverse()) {
      try {
        // Only inside the folder the batch worked in.
        if (path.dirname(m.from) !== batch.dir || !String(m.to).startsWith(batch.dir + path.sep)) throw new Error('not a place this tidy-up used');
        if (!fs.existsSync(m.to)) throw new Error('the file is no longer there');
        if (fs.existsSync(m.from)) throw new Error('a file with the old name is there now');
        rename(m.to, m.from, markLost);
        restored.push(m.from);
        if (typeof onMoved === 'function') { try { onMoved(m.to, m.from); } catch { /* bookkeeping only */ } }
      } catch (err) { left.push({ name: path.basename(m.to), error: err.message }); }
    }
    // Folders this tidy-up made, only if now empty (rmdir refuses otherwise),
    // innermost first.
    for (const d of [...(batch.created || [])].sort((x, y) => y.length - x.length)) {
      if (!d.startsWith(batch.dir + path.sep)) continue;
      try { fs.rmdirSync(d); } catch { /* not empty: leave it */ }
    }
    if (!left.length) batch.undoneAt = now();
    else batch.moves = batch.moves.filter(m => left.some(l => l.name === path.basename(m.to)));
    writeLog(log);
    return { id: batch.id, restored: restored.length, left, markLost };
  }

  return { plan, apply, undo, history, typeOf, bucketOf };
}

module.exports = { createDownloadTidy, TYPES };
