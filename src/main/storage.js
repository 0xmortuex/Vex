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
      change(updated);
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
    set(key, value) { return mutate(data => { data[key] = value; }); },
    delete(key) { return mutate(data => { delete data[key]; }); },
    clearKeys(keys) { return mutate(data => { for (const key of keys) delete data[key]; }, true); },
    flush() { return pending; },
  };
}
module.exports = { createPreferenceStore };
