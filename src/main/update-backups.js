// A backup of the profile made right before each update installs (the update
// cover, js/update-notifier.js). The file is exactly what Settings › Backup
// saves (js/backup.js: { v: 1, at, app, items, stores }), so the normal
// Restore reads it; it is kept in userData/backups instead of Downloads, as
//   before-<new version>-<YYYY-MM-DD-HHMMSS>.json
// and only the newest three are kept. Settings › Backup lists them.
const nodePath = require('path');

const KEEP = 3;
const NAME = /^before-(\d{1,5}\.\d{1,5}\.\d{1,5}[0-9A-Za-z.+-]{0,40})-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/;
const MAX_BYTES = 10 * 1024 * 1024;

function createUpdateBackups({ fs, dir, now = () => new Date(), log = console }) {
  const stamp = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };

  // Newest first. The time is the one in the name: a copied folder keeps it.
  function list() {
    let names;
    try { names = fs.readdirSync(dir); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    return names
      .map(name => ({ name, m: name.match(NAME) }))
      .filter(x => x.m)
      .map(({ name, m }) => ({
        name,
        version: m[1],
        at: new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]).getTime(),
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

  // `text` is the backup the interface made (VexBackup.snapshot). It is
  // checked to be one before it is kept, and written whole or not at all.
  function save(version, text) {
    if (typeof text !== 'string' || !text) throw new Error('The backup was empty');
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('The backup is larger than 10 MB, which is more than Vex keeps before an update');
    let data;
    try { data = JSON.parse(text); } catch (err) { throw new Error('The backup was not readable', { cause: err }); }
    if (!data || data.v !== 1 || !data.items || typeof data.items !== 'object') throw new Error('The backup was not in Vex\'s backup format');
    const name = `before-${version}-${stamp(now())}.json`;
    if (!NAME.test(name)) throw new Error('Not a version Vex names a backup after: ' + String(version).slice(0, 40));
    const file = nodePath.join(dir, name);
    const tmp = file + '.tmp';
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      log.warn('[Updates] the backup before the update could not be written:', err.message);
      try { fs.rmSync(tmp, { force: true }); } catch (rmErr) { log.warn('[Updates] could not delete', tmp + ':', rmErr.message); }
      // The code, not the message: the message is a full path on this machine.
      throw new Error(`Vex could not save the backup in its backups folder (${err.code || 'unknown error'})`, { cause: err });
    }
    const removed = prune();
    return { name, file, bytes: Buffer.byteLength(text), removed };
  }

  function read(name) {
    if (typeof name !== 'string' || !NAME.test(name)) throw new Error('That is not a backup Vex made before an update');
    return fs.readFileSync(nodePath.join(dir, name), 'utf8');
  }

  return { save, list, read, prune, dir };
}

module.exports = { createUpdateBackups, KEEP };
