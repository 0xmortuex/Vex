const fs = require('fs');
const { atomicWrite } = require('./file-store');

// One main-process writer for the preferences shared by all renderer windows.
function createPreferenceStore(file) {
  let cache;
  let pending = Promise.resolve();
  function load() {
    if (cache !== undefined) return cache;
    function decode(target) {
      const value = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preference store');
      require('../renderer/js/data-contracts').json(value);
      return value;
    }
    try { cache = decode(file); }
    catch (error) {
      if (error.code === 'ENOENT') { cache = {}; return cache; }
      try { cache = decode(file + '.bak'); }
      catch { throw error; }
      pending = pending.then(() => atomicWrite(file, JSON.stringify(cache), { backup: false }));
      pending.catch(() => {});
    }
    return cache;
  }
  function mutate(change, eraseBackup = false) {
    load();
    const next = pending.catch(() => {}).then(async () => {
      const updated = { ...cache };
      // Nothing changed: the file is not written. Every setItem in the
      // interface comes here, most with the value already saved, and each one
      // rewrote the whole file (1.3 MB) and its .bak, about once a minute
      // (found 2026-10-09). Decided here, in the queue, so a write still
      // waiting ahead of this one is what it is compared with.
      if (change(updated) === false) return true;
      updated.__vexPreferenceStore = 1;
      await atomicWrite(file, JSON.stringify(updated), { backup: !eraseBackup });
      if (eraseBackup) await fs.promises.rm(file + '.bak', { force: true });
      cache = updated;
      return true;
    });
    pending = next;
    return next;
  }
  return {
    load,
    set(key, value) { return mutate(data => { if (Object.hasOwn(data, key) && data[key] === value) return false; data[key] = value; }); },
    delete(key) { return mutate(data => { if (!Object.hasOwn(data, key)) return false; delete data[key]; }); },
    // Many keys in one write: [[key, value], ...], a null value deleting the
    // key. The renderer saves what changed in the last 300 ms this way; one
    // persist-set per key rewrote the whole file (and its .bak) once per key.
    apply(entries) {
      return mutate(data => {
        let changed = false;
        for (const [key, value] of entries) {
          if (value === null) { if (Object.hasOwn(data, key)) { delete data[key]; changed = true; } }
          else if (!(Object.hasOwn(data, key) && data[key] === value)) { data[key] = value; changed = true; }
        }
        if (!changed) return false;
      });
    },
    clearKeys(keys) { return mutate(data => { for (const key of keys) delete data[key]; }, true); },
    flush() { return pending; },
  };
}
module.exports = { createPreferenceStore };
