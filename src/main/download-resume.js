// === Carrying on a download after Vex was closed ===============================
//
// When Vex quits, Chromium cancels every download in flight AND deletes the
// half-written file, so there is nothing to resume from. Measured on Electron 42
// (local Range server, 24 MB file, quit at about 8 MB): the file is gone, but a
// HARD LINK made to it while it was downloading survives, with every byte that
// was written. A new session can then be handed that file with
// session.createInterruptedDownload() and resume() fetches only the rest
// (the request carries "Range: bytes=<size>-" and "If-Range: <etag>"), and the
// finished file's SHA-256 matched.
//
// So while a download runs, and only when the person turned this on, a second
// name for the partial file is kept beside it ("<file>.vexpart-<n>") and a small
// record says where the download came from. On the next start the record is
// handed back to Chromium. A server that does not honour Range, or a file that
// changed, makes Chromium refuse: the download then ends "interrupted" and the
// record and the partial file are removed, never retried in a loop.
//
// Only paths ending in ".vexpart-<n>" are ever deleted here, and only ones this
// module recorded.
const path = require('path');

const PART_RE = /\.vexpart-\d+$/;
const MIN_BYTES = 5 * 1024 * 1024;          // smaller files are fetched again, not tracked
const MAX_RECORDS = 20;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;    // a week-old partial is not worth the disk space

function createResumeStore({ fs, file, now = () => Date.now() }) {
  let list = null;

  function load() {
    if (list) return list;
    list = [];
    if (!fs.existsSync(file)) return list;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(raw)) throw new Error('the list is not an array');
      list = raw.filter(r => r && typeof r.id === 'string' && typeof r.savePath === 'string' && Array.isArray(r.urlChain) && r.urlChain.length && Array.isArray(r.parts));
    } catch (err) {
      console.error('[Downloads] could not read the list of downloads to carry on, starting a new one:', err.message);
      list = [];
    }
    return list;
  }
  function save() {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list));
    fs.renameSync(tmp, file);
  }
  // Removes a partial file this module made. Anything else is refused.
  function dropPart(p) {
    if (!PART_RE.test(String(p))) throw new Error('Not one of the carry-on files: ' + p);
    try { fs.unlinkSync(p); }
    catch (err) { if (err.code !== 'ENOENT') console.error('[Downloads] could not remove ' + p + ':', err.message); }
  }

  // Is a download worth keeping a second name for? -> '' or the reason it is not.
  function eligible({ url, totalBytes, eTag, lastModified, ephemeral }) {
    if (ephemeral) return 'a private, off-the-record or Tor download is never kept across a restart';
    if (!/^https?:\/\//i.test(String(url || ''))) return 'only http(s) downloads can be carried on';
    if (!(totalBytes >= MIN_BYTES)) return 'its size is unknown or small';
    if (!eTag && !lastModified) return 'the server gave no way to check the file is unchanged';
    return '';
  }

  // Make the second name for the file that is being written at `source`.
  // `gen` is 1 for a first download and counts up each time one is picked up again, because
  // the name Chromium is writing to is the one it deletes when Vex quits.
  function track(rec, source, gen = 1) {
    const l = load();
    const part = path.join(path.dirname(rec.savePath), path.basename(rec.savePath) + '.vexpart-' + gen);
    if (fs.existsSync(part)) dropPart(part);
    fs.linkSync(source, part);                       // throws on a drive without hard links; the caller says so
    const old = l.findIndex(r => r.id === rec.id);
    const record = { ...rec, parts: [part], partPath: part, gen, at: now() };
    if (old >= 0) l[old] = record; else l.push(record);
    while (l.length > MAX_RECORDS) forget(l[0].id);
    save();
    return record;
  }

  // The download ended or the person cancelled it: the record and the second name go.
  function forget(id) {
    const l = load();
    const i = l.findIndex(r => r.id === id);
    if (i < 0) return false;
    for (const p of l[i].parts) dropPart(p);
    l.splice(i, 1);
    save();
    return true;
  }

  function all() { return load().slice(); }

  // Records older than a week, or whose partial file is gone, are removed.
  function sweep() {
    const l = load();
    const gone = [];
    for (const r of l.slice()) {
      const missing = !r.partPath || !fs.existsSync(r.partPath);
      if (missing || now() - (r.at || 0) > MAX_AGE_MS) { forget(r.id); gone.push({ id: r.id, why: missing ? 'its partial file is gone' : 'it is more than a week old' }); }
    }
    return gone;
  }

  // What to hand to session.createInterruptedDownload for a record. Throws saying why not.
  function plan(rec) {
    let st;
    try { st = fs.statSync(rec.partPath); }
    catch (err) { throw new Error('The partial file of ' + path.basename(rec.savePath) + ' is gone (' + err.code + ')'); }
    if (!st.isFile() || st.size <= 0) throw new Error('The partial file of ' + path.basename(rec.savePath) + ' is empty');
    if (rec.totalBytes > 0 && st.size >= rec.totalBytes) throw new Error('The partial file of ' + path.basename(rec.savePath) + ' is not smaller than the whole file');
    if (!rec.eTag && !rec.lastModified) throw new Error('There is no way to check that ' + path.basename(rec.savePath) + ' is unchanged');
    return {
      path: rec.partPath, urlChain: rec.urlChain, mimeType: rec.mimeType || '', offset: st.size,
      length: rec.totalBytes || 0, lastModified: rec.lastModified || '', eTag: rec.eTag || '', startTime: rec.startTime || 0,
    };
  }

  return { track, forget, all, sweep, plan, eligible, dropPart };
}

module.exports = { createResumeStore, PART_RE, MIN_BYTES, MAX_RECORDS, MAX_AGE_MS };
