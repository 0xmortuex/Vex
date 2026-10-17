// === Settings' side of the encrypted profile lock (T3-123) =================
//
// The engine is main/profile-crypt.js; these are the calls Vex's own window makes from
// Settings › Encrypted profile lock. Policy (ipc-policy.js): Vex's own window only, closed in
// private windows. Every call that changes anything runs with the preference file and the
// encrypted data-store keys held, so no save lands in between (storage.js exclusive,
// file-store.js exclusive), and takes the passphrase from the window: main never stores it.
//   profilecrypt:status        { enabled, state, locked, files, plainCopies }
//   profilecrypt:enable        (passphrase)                -> { recoveryCode, files, leftovers, plainCopies }
//   profilecrypt:disable       (mode, secret)              -> { files }       back to plaintext
//   profilecrypt:change        (current, next)
//   profilecrypt:new-recovery  (passphrase)                -> { recoveryCode }
// The unlock window has its own two channels (main/profile-unlock.js).
const fs = require('fs');
const nodePath = require('path');
const { profileFiles } = require('./profile-crypt');

// The keys of vex-storage/ (main/file-store.js JsonStore) kept encrypted besides the preference
// file. Chosen because only the data store reads them: not theme / gui-style (the start page
// reads those files directly), not settings (the ad blocker reads that one directly).
const STORAGE_KEYS = Object.freeze(['tabs', 'groups', 'stacks', 'shortcuts', 'writeLikeMe', 'sync-records', 'sync-tombstones', 'sync-known-devices']);

// The files that are checked to be valid settings before anything is changed. The other copies
// (.bak, generations, kept damaged files) go in as they are: a damaged copy is still worth keeping.
const MUST_PARSE = /^(?:vex-persist(?:-volatile)?\.json|vex-storage\/[A-Za-z0-9_-]+\.json)$/;
function validate(rel, bytes) {
  if (!MUST_PARSE.test(rel)) return;
  try { JSON.parse(bytes.toString('utf8')); }
  catch (e) { throw new Error(rel + ' is not readable as it is (' + e.message + '). Nothing was changed; repair it with Health first.', { cause: e }); }
}

// Plaintext copies the lock cannot reach: the settings backups made around updates, and the old
// settings-backups folder. Counted so Settings can say so; they are not touched.
function plainCopies(userDataPath) {
  let count = 0;
  for (const dir of ['backups', 'settings-backups']) {
    try { count += fs.readdirSync(nodePath.join(userDataPath, dir)).length; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return count;
}

function registerProfileLock({ ipcMain, profileCrypt, preferences, dataStore, userDataPath, mainWindowOf }) {
  const fromMain = (e) => {
    const w = mainWindowOf();
    if (!w || w.isDestroyed() || e.sender !== w.webContents || e.senderFrame !== w.webContents.mainFrame) throw new Error('Only the main Vex window does this');
  };
  const files = () => profileFiles(userDataPath, fs, STORAGE_KEYS);
  const exclusive = (fn) => preferences.exclusive(() => dataStore.exclusive(STORAGE_KEYS, fn));

  ipcMain.handle('profilecrypt:status', async (e) => {
    fromMain(e);
    return { ...profileCrypt.status(), files: files().length, plainCopies: plainCopies(userDataPath) };
  });
  ipcMain.handle('profilecrypt:enable', async (e, passphrase) => {
    fromMain(e);
    const r = await exclusive(() => profileCrypt.enable({ passphrase, files: files(), validate }));
    return { ...r, plainCopies: plainCopies(userDataPath) };
  });
  ipcMain.handle('profilecrypt:disable', async (e, mode, secret) => {
    fromMain(e);
    if (mode !== 'passphrase' && mode !== 'recovery') throw new Error('Unknown way to unlock');
    return exclusive(() => profileCrypt.disable({ [mode === 'recovery' ? 'recoveryCode' : 'passphrase']: secret, files: files(), validate }));
  });
  ipcMain.handle('profilecrypt:change', async (e, current, next) => {
    fromMain(e);
    await profileCrypt.changePassphrase({ current, next });
    return { ok: true };
  });
  ipcMain.handle('profilecrypt:new-recovery', async (e, passphrase) => {
    fromMain(e);
    return profileCrypt.newRecoveryCode({ passphrase });
  });
}

module.exports = { registerProfileLock, STORAGE_KEYS, plainCopies, validate };
