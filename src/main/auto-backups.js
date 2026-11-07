// === Rolling automatic backup ================================================
//
// Settings > Backup saves a file when the person asks, and Vex backs up around
// an update (update-backups.js). Between those, a profile reset or a bad edit
// could lose weeks of notes and rules. This keeps a rolling copy, if the person
// turns it on (default OFF):
//
//   one backup a day            auto-daily-<date>-<time>.json    newest 7 kept
//   one more, a week apart      auto-weekly-<date>-<time>.json   newest 4 kept
//
// in userData/backups, beside the update backups (whose list and pruning never
// see these names), and, if the person chose a second folder (OneDrive,
// Documents ...), a copy of each there too. The file is exactly what Settings >
// Backup saves (js/backup.js, VexBackup.snapshot): the window makes it, because
// the notes and the settings only the window can read are part of it. This
// module decides WHETHER it may be made now, checks it, and keeps it.
//
// It stays out of the way:
//   - not while a game is running, not on battery power, not inside the
//     person's quiet hours: it says why it skipped and the window asks again;
//   - at most one backup a day, one failure notice a day;
//   - never at start-up: the window asks a minute or more after it has loaded;
//   - whole or not at all: written beside the file and renamed into place, so a
//     crash or a full disk leaves the older backups alone and no half file.
//
// It never holds secrets: the file is scrubbed here again with the backup's own
// secret filter (VexBackup._blocked), whatever the window handed in, and the
// checksum is made over what was kept.
'use strict';

const nodePath = require('path');

const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const MAX_BYTES = 10 * 1024 * 1024;
const STAMP = '(\\d{4})-(\\d{2})-(\\d{2})-(\\d{2})(\\d{2})(\\d{2})';
const NAME = new RegExp(`^auto-(daily|weekly)-${STAMP}\\.json$`);

const pad = (n) => String(n).padStart(2, '0');
const stampOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const errCode = (err) => (err && err.code) || 'unknown error';

function parseName(name) {
  const m = NAME.exec(name);
  if (!m) return null;
  return { name, kind: m[1], at: new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]).getTime() };
}

// Removes what must not be in the file and re-seals it. -> { data, removed }.
function scrub(data, VexBackup) {
  const items = {};
  let removed = 0;
  for (const [key, value] of Object.entries(data.items || {})) {
    if (!key.startsWith('vex.') || typeof value !== 'string' || VexBackup._blocked(key)) { removed++; continue; }
    items[key] = value;
  }
  const out = { ...data, items };
  delete out.integrity;
  if (out.v === 1) out.v = VexBackup.VERSION;   // a version-1 payload is resealed as the current one
  return { data: VexBackup.seal(out), removed };
}

// The newest backup (of the lists given) that reads and passes its checksum.
// candidates: [{ name, at, read: () => text }] in any order. -> { name, at } | null.
function newestValid(candidates, VexBackup) {
  for (const c of [...candidates].sort((a, b) => b.at - a.at)) {
    try {
      const data = JSON.parse(c.read());
      if (!VexBackup.describe(data)) continue;
      VexBackup.verify(data);
      return { name: c.name, at: c.at };
    } catch { continue; }   // vex-allow-empty-catch: an unreadable or damaged file is not "valid"; the next newest is tried
  }
  return null;
}

function createAutoBackups({ fs, dir, configFile, VexBackup, now = () => Date.now(), gates = {}, log = console }) {
  if (!VexBackup) throw new Error('createAutoBackups needs the backup format');
  // A failure is remembered here too: if the disk is what failed, the note on disk may not be writable either, and the
  // backup must still not be retried every hour.
  let failedAt = 0;
  const g = { game: () => false, battery: () => false, quiet: () => false, encrypted: () => false, ...gates };

  // ---- the person's choices (a small file in the profile) -------------------
  function loadConfig() {
    let raw;
    try { raw = fs.readFileSync(configFile, 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') return { on: false, folder2: null, lastOkAt: 0, lastFailAt: 0, lastError: '' }; throw err; }
    let c;
    try { c = JSON.parse(raw); } catch (err) { throw new Error('The automatic backup settings cannot be read', { cause: err }); }
    return {
      on: c.on === true,
      folder2: typeof c.folder2 === 'string' && c.folder2 ? c.folder2 : null,
      lastOkAt: Number.isFinite(c.lastOkAt) ? c.lastOkAt : 0,
      lastFailAt: Number.isFinite(c.lastFailAt) ? c.lastFailAt : 0,
      lastError: typeof c.lastError === 'string' ? c.lastError.slice(0, 300) : '',
    };
  }
  function writeAtomic(file, text) {
    const tmp = file + '.' + process.pid + '.tmp';
    try {
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch (rmErr) { log.warn('[AutoBackup] could not delete', tmp + ':', errCode(rmErr)); }
      throw err;
    }
  }
  function saveConfig(c) {
    fs.mkdirSync(nodePath.dirname(configFile), { recursive: true });
    writeAtomic(configFile, JSON.stringify(c));
  }

  function checkFolder(folder) {
    if (typeof folder !== 'string' || !folder || folder.length > 500 || !nodePath.isAbsolute(folder)) throw new Error('Choose a folder on this PC (a full path)');
    let st;
    try { st = fs.statSync(folder); } catch (err) { throw new Error('That folder cannot be opened (' + errCode(err) + ')', { cause: err }); }
    if (!st.isDirectory()) throw new Error('That is not a folder');
    return folder;
  }

  function state() {
    const c = loadConfig();
    const have = list();
    return { ...c, newest: have[0] ? have[0].at : 0, count: have.length, keepDaily: KEEP_DAILY, keepWeekly: KEEP_WEEKLY };
  }
  // { on?, folder2? } (folder2 null clears it)
  function setConfig(next) {
    const c = loadConfig();
    if (!next || typeof next !== 'object') throw new Error('Nothing to set');
    if ('on' in next) { if (typeof next.on !== 'boolean') throw new Error('On or off'); c.on = next.on; }
    if ('folder2' in next) c.folder2 = next.folder2 === null ? null : checkFolder(next.folder2);
    saveConfig(c);
    return state();
  }

  // ---- the files --------------------------------------------------------------
  function listIn(folder) {
    let names;
    try { names = fs.readdirSync(folder); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    const out = [];
    for (const n of names) {
      const p = parseName(n);
      if (!p) continue;
      let bytes = 0;
      try { bytes = fs.statSync(nodePath.join(folder, n)).size; } catch (err) { log.warn('[AutoBackup] could not size', n + ':', errCode(err)); }
      out.push({ ...p, bytes });
    }
    return out.sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1));
  }
  function list() { return listIn(dir); }

  function pruneIn(folder) {
    const removed = [];
    const have = listIn(folder);
    for (const kind of [['daily', KEEP_DAILY], ['weekly', KEEP_WEEKLY]]) {
      for (const old of have.filter(b => b.kind === kind[0]).slice(kind[1])) {
        try { fs.rmSync(nodePath.join(folder, old.name), { force: true }); removed.push(old.name); }
        catch (err) { log.warn('[AutoBackup] could not delete the old backup', old.name + ':', errCode(err)); }
      }
    }
    return removed;
  }
  const prune = () => pruneIn(dir);

  function read(name) {
    if (typeof name !== 'string' || !NAME.test(name)) throw new Error('That is not a backup Vex made automatically');
    return fs.readFileSync(nodePath.join(dir, name), 'utf8');
  }

  // ---- may one be made now? ---------------------------------------------------
  // -> { due: true } or { due: false, why }. why: off | profile-encrypted | today | failed-today | game | battery | quiet
  function due() {
    const c = loadConfig();
    if (!c.on) return { due: false, why: 'off' };
    if (g.encrypted()) return { due: false, why: 'profile-encrypted' };
    const t = now();
    const newest = list()[0];
    if (newest && dayOf(newest.at) === dayOf(t)) return { due: false, why: 'today' };
    const failed = Math.max(c.lastFailAt, failedAt);
    if (failed && dayOf(failed) === dayOf(t)) return { due: false, why: 'failed-today' };
    if (g.game()) return { due: false, why: 'game' };
    if (g.battery()) return { due: false, why: 'battery' };
    if (g.quiet()) return { due: false, why: 'quiet' };
    return { due: true };
  }

  // `text` is VexBackup.snapshot() as JSON. -> { ok: true, name, bytes, weekly, removed, second } or { ok: false, skipped } or { ok: false, error }.
  function save(text) {
    const gate = due();
    if (!gate.due) return { ok: false, skipped: gate.why };
    const c = loadConfig();
    const t = now();
    try {
      if (typeof text !== 'string' || !text) throw new Error('The backup was empty');
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('The backup is larger than 10 MB');
      let data;
      try { data = JSON.parse(text); } catch (err) { throw new Error('The backup was not readable', { cause: err }); }
      if (!VexBackup.describe(data)) throw new Error('The backup was not in Vex\'s backup format');
      VexBackup.verify(data);                              // a damaged snapshot is never kept
      const { data: clean, removed: stripped } = scrub(data, VexBackup);
      const body = JSON.stringify(clean, null, 2);
      fs.mkdirSync(dir, { recursive: true });
      const when = new Date(t);
      const names = [`auto-daily-${stampOf(when)}.json`];
      const lastWeekly = list().find(b => b.kind === 'weekly');
      const weekly = !lastWeekly || t - lastWeekly.at >= WEEK_MS;
      if (weekly) names.push(`auto-weekly-${stampOf(when)}.json`);
      for (const n of names) writeAtomic(nodePath.join(dir, n), body);
      const removed = prune();
      const out = { ok: true, name: names[0], bytes: Buffer.byteLength(body), weekly, removed, stripped, second: null };
      if (c.folder2) {
        try {
          checkFolder(c.folder2);
          for (const n of names) writeAtomic(nodePath.join(c.folder2, n), body);
          pruneIn(c.folder2);
          out.second = { ok: true };
        } catch (err) {
          // The copy here is safe; only the second copy failed, and that is said.
          out.second = { ok: false, error: 'The second copy could not be written (' + errCode(err) + ' ' + (err.message || '').slice(0, 120) + ')' };
          log.warn('[AutoBackup] the second copy failed:', errCode(err));
        }
      }
      c.lastOkAt = t; c.lastFailAt = 0; c.lastError = out.second && !out.second.ok ? out.second.error : '';
      saveConfig(c);
      return out;
    } catch (err) {
      const msg = 'Vex could not save the automatic backup (' + errCode(err) + (err.code ? '' : ': ' + String(err.message).slice(0, 160)) + ')';
      log.warn('[AutoBackup]', msg);
      failedAt = t;
      try { c.lastFailAt = t; c.lastError = msg; saveConfig(c); } catch (cfgErr) { log.warn('[AutoBackup] could not record the failure:', errCode(cfgErr)); }
      return { ok: false, error: msg };
    }
  }

  return { state, setConfig, list, read, due, save, prune, dir };
}

module.exports = { createAutoBackups, newestValid, scrub, parseName, KEEP_DAILY, KEEP_WEEKLY, NAME };
