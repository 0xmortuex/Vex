// Vex's one backup of the profile around an update. The file is exactly what
// Settings › Backup saves (js/backup.js: { v: 1, at, app, items, stores }), so
// the normal Restore reads it; it is kept in userData/backups instead of
// Downloads, and only the newest five are kept. Settings › Backup lists them.
//
// It is made at one of two moments, whichever comes first for a version:
//   - by the update cover (js/update-notifier.js) right before Vex closes to
//     install; if it cannot be made, nothing installs until the person chooses;
//   - at the first start of a new version that was installed some other way
//     (an installer run by hand, "Install anyway" after a failed backup), from
//     vex-persist.json before anything has read it (safe-mode.js calls it).
// Both are named
//   before-<new version>-<YYYY-MM-DD-HHMMSS>.json
//
// Until v18.59 the first-start copy was a second system: a raw copy of
// vex-persist.json in userData/settings-backups (secrets and all, five kept,
// restored by copying the file back). Those copies are converted once into
// this folder as settings-<label>-<date>.json (label: the version they were
// taken under, "first-run" or "before-restore"), with the secrets taken out,
// and only then removed. One that cannot be converted stays where it was.
const nodePath = require('path');
const { VexBackup } = require('../renderer/js/backup.js');

const KEEP = 5;
const VERSION = '\\d{1,5}\\.\\d{1,5}\\.\\d{1,5}[0-9A-Za-z.+-]{0,40}';
const STAMP = '(\\d{4})-(\\d{2})-(\\d{2})-(\\d{2})(\\d{2})(\\d{2})';
const NAME = new RegExp(`^(?:before-(${VERSION})|settings-(${VERSION}|first-run|before-restore))-${STAMP}\\.json$`);
const MAX_BYTES = 10 * 1024 * 1024;
const LEGACY = /^vex-persist-(.+)\.json$/;

function createUpdateBackups({ fs, dir, now = () => new Date(), log = console }) {
  const stamp = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };

  // Newest first. The time is the one in the name: a copied folder keeps it.
  // kind: 'before' (made around an update) or 'settings' (an older copy of
  // the settings, converted from settings-backups).
  function list() {
    let names;
    try { names = fs.readdirSync(dir); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    return names
      .map(name => ({ name, m: name.match(NAME) }))
      .filter(x => x.m)
      .map(({ name, m }) => ({
        name,
        kind: m[1] ? 'before' : 'settings',
        version: m[1] || m[2],
        at: new Date(+m[3], +m[4] - 1, +m[5], +m[6], +m[7], +m[8]).getTime(),
        bytes: fs.statSync(nodePath.join(dir, name)).size,
      }))
      .sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1));
  }

  function prune() {
    const removed = [];
    for (const old of list().slice(KEEP)) {
      try { fs.rmSync(nodePath.join(dir, old.name), { force: true }); removed.push(old.name); }
      catch (err) { log.warn('[Updates] could not delete the old backup', old.name + ':', err.message); }
    }
    return removed;
  }

  // Whole or not at all.
  function writeFile(name, text) {
    const file = nodePath.join(dir, name);
    const tmp = file + '.tmp';
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      log.warn('[Updates] the backup could not be written:', err.message);
      try { fs.rmSync(tmp, { force: true }); } catch (rmErr) { log.warn('[Updates] could not delete', tmp + ':', rmErr.message); }
      // The code, not the message: the message is a full path on this machine.
      throw new Error(`Vex could not save the backup in its backups folder (${err.code || 'unknown error'})`, { cause: err });
    }
    return file;
  }

  // `text` is the backup the interface made (VexBackup.snapshot). It is
  // checked to be one before it is kept.
  function save(version, text) {
    if (typeof text !== 'string' || !text) throw new Error('The backup was empty');
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('The backup is larger than 10 MB, which is more than Vex keeps before an update');
    let data;
    try { data = JSON.parse(text); } catch (err) { throw new Error('The backup was not readable', { cause: err }); }
    if (!data || data.v !== 1 || !data.items || typeof data.items !== 'object') throw new Error('The backup was not in Vex\'s backup format');
    const name = `before-${version}-${stamp(now())}.json`;
    if (!NAME.test(name)) throw new Error('Not a version Vex names a backup after: ' + String(version).slice(0, 40));
    const file = writeFile(name, text);
    const removed = prune();
    return { name, file, bytes: Buffer.byteLength(text), removed };
  }

  // The keys of vex-persist.json a backup may hold. `everything` keeps what a
  // restore can write (all but the secrets); otherwise it is what Settings ›
  // Backup saves with no box ticked (VexBackup.collect).
  function itemsOf(persisted, everything) {
    const items = {};
    let skipped = 0;
    for (const [key, value] of Object.entries(persisted)) {
      if (!key.startsWith('vex.') || typeof value !== 'string') continue;
      if (VexBackup._blocked(key)) { skipped++; continue; }
      if (!everything) {
        if (Object.keys(VexBackup.OPTIONAL).some(w => VexBackup._isOptional(key, w))) continue;
        if (VexBackup._isLocal(key)) continue;
      }
      items[key] = value;
    }
    return { items, skipped };
  }

  function readPersisted(file) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('the settings file is not a set of settings');
    return value;
  }

  // The first start of `version`: back up the settings as the version before
  // left them, unless the update cover already did since that version started
  // (`since`, ms). -> null when there is nothing to back up or it was made
  // already, else what save() returns. Throws when it cannot be made.
  function saveAtFirstStart({ version, from, persistFile, since = 0 }) {
    let have;
    try { have = list(); }
    catch (err) { throw new Error(`Vex could not read its backups folder (${err.code || 'unknown error'})`, { cause: err }); }
    const done = have.find(b => b.kind === 'before' && b.version === version && b.at >= since - 2000);
    if (done) return null;
    let persisted;
    try { persisted = readPersisted(persistFile); }
    catch (err) {
      if (err.code === 'ENOENT') return null;
      throw new Error('Vex could not read its settings to back them up (' + (err.code || err.message) + ')', { cause: err });
    }
    const { items, skipped } = itemsOf(persisted, false);
    const data = { v: 1, at: now().toISOString(), app: from || '', includes: [], skipped, items, stores: {}, madeAt: 'first-start' };
    return save(version, JSON.stringify(data, null, 2));
  }

  // Once: settings-backups/vex-persist-<label>.json -> backups/settings-<label>-<date>.json.
  // -> { moved: [names], failed: [{ name, error }] }. A file is removed only
  // after its converted copy is written; one that fails stays and is named.
  function migrateLegacy(legacyDir) {
    const out = { moved: [], failed: [] };
    let names;
    try { names = fs.readdirSync(legacyDir); } catch (err) { if (err.code === 'ENOENT') return out; throw err; }
    for (const old of names) {
      const m = old.match(LEGACY);
      if (!m) continue;
      const from = nodePath.join(legacyDir, old);
      try {
        const persisted = readPersisted(from);
        const { items, skipped } = itemsOf(persisted, true);
        const name = `settings-${m[1]}-${stamp(new Date(fs.statSync(from).mtimeMs))}.json`;
        if (!NAME.test(name)) throw new Error('not a label Vex names a backup after');
        const isVersion = new RegExp(`^${VERSION}$`).test(m[1]);
        const data = { v: 1, at: new Date(fs.statSync(from).mtimeMs).toISOString(), app: isVersion ? m[1] : '', includes: [], skipped, items, stores: {}, madeAt: 'settings-snapshot' };
        writeFile(name, JSON.stringify(data, null, 2));
        fs.rmSync(from);
        out.moved.push(name);
      } catch (err) {
        out.failed.push({ name: old, error: err.message });
      }
    }
    try { if (!fs.readdirSync(legacyDir).length) fs.rmdirSync(legacyDir); }
    catch (err) { log.warn('[Updates] could not remove the old settings-backups folder:', err.message); }
    return out;
  }

  function read(name) {
    if (typeof name !== 'string' || !NAME.test(name)) throw new Error('That is not a backup Vex made before an update');
    return fs.readFileSync(nodePath.join(dir, name), 'utf8');
  }

  return { save, saveAtFirstStart, migrateLegacy, list, read, prune, dir };
}

module.exports = { createUpdateBackups, KEEP };
