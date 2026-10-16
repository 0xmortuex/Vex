// === The secure stores, and what the lock does and does not protect (T3-123) ==
//
// Vex keeps its secrets in a few files that are encrypted by the operating
// system (Electron safeStorage: Windows DPAPI, tied to the signed-in Windows
// account) or by main's SecretStore (the same DPAPI under a "VEXENC1" header).
// This module only does two things with them:
//   describe()  report which of them exist and whether they look encrypted
//   wipe()      delete exactly these files, after the person typed the
//               confirmation phrase (the "I forgot my passphrase" path)
//
// It adds NO cryptography of its own. The lock (src/main/lock-pin.js) is a
// privacy screen plus a gate main enforces; the files stay encrypted by the
// operating system whether the lock is on or off. Encrypting more of the
// profile (notes, clips, history, the whole folder) is deliberately not done:
// it needs a recovery-code design the owner has not agreed, and a lost key would
// mean lost data (docs/security-tier3-threat-notes.md).
const fs = require('fs');
const path = require('path');

const CONFIRM_PHRASE = 'ERASE SECURE DATA';

// Every file here holds a secret. Order is the order shown.
const SECURE_FILES = Object.freeze([
  { id: 'vault', file: 'vault.dat', label: 'Saved passwords' },
  { id: 'totp', file: 'totp.dat', label: 'Authenticator accounts' },
  { id: 'passkeys', file: 'passkeys.dat', label: 'Passkeys' },
  { id: 'github', file: 'github-token.enc', label: 'GitHub read-only token' },
  { id: 'ai-token', file: 'ai-token.enc', label: 'AI service token' },
  { id: 'mcp-auth', file: 'mcp-auth.enc', label: 'Tool-server sign-ins' },
  { id: 'mail', file: 'mail-accounts.enc', label: 'Mail accounts' },
  { id: 'sync-key', file: 'sync-key.bin', label: 'Sync key' },
  { id: 'sync-meta', file: 'sync-meta.json', label: 'Sync details' },
]);

// What lives in the window's own storage and is NOT encrypted by Vex. Said
// plainly in the lock's settings so the lock is not mistaken for encryption.
const NOT_ENCRYPTED = Object.freeze([
  'Notes, bookmarks, history and read-later',
  'Clips and the clipboard history',
  'Open tabs and the pages\' own cookies and logins',
  'Settings and the lock record itself (a salted hash)',
]);

function headerKind(buf) {
  if (!buf || !buf.length) return 'empty';
  if (buf.subarray(0, 8).equals(Buffer.from('VEXENC1\0'))) return 'encrypted';
  const head = buf.subarray(0, 3).toString('latin1');
  if (head === 'v10' || head === 'v11' || head === 'v20') return 'encrypted';
  // DPAPI blob (older Electron): version 1 provider GUID begins 01 00 00 00 D0 8C 9D DF.
  if (buf.length >= 8 && buf.readUInt32LE(0) === 1 && buf.readUInt32LE(4) === 0xDF9D8CD0) return 'encrypted';
  const c = String.fromCharCode(buf[0]);
  if (c === '{' || c === '[') return 'plain';
  return 'unknown';
}

function describe({ userDataPath, fsMod = fs }) {
  if (!userDataPath) throw new Error('describe: no profile folder');
  return SECURE_FILES.map((s) => {
    const file = path.join(userDataPath, s.file);
    let fd = null;
    try {
      let size;
      try { size = fsMod.statSync(file).size; }
      catch (e) { if (e && e.code === 'ENOENT') return { id: s.id, label: s.label, exists: false, state: 'absent', bytes: 0 }; throw e; }
      const head = Buffer.alloc(8);
      fd = fsMod.openSync(file, 'r');
      const n = fsMod.readSync(fd, head, 0, 8, 0);
      return { id: s.id, label: s.label, exists: true, state: headerKind(head.subarray(0, n)), bytes: size };
    } catch (err) {
      throw new Error('Could not read ' + s.file + ': ' + err.message, { cause: err });
    } finally {
      if (fd !== null) { try { fsMod.closeSync(fd); } catch (e) { console.error('[secure-stores] could not close', s.file, e.message); } }
    }
  });
}

// Deletes the files above (and their .bak) and nothing else. The phrase must
// match exactly; a wrong one throws before anything is touched. A file that
// cannot be removed throws, naming what was already gone.
function wipe({ userDataPath, confirm, fsMod = fs }) {
  if (!userDataPath) throw new Error('wipe: no profile folder');
  if (confirm !== CONFIRM_PHRASE) throw new Error('Type ' + CONFIRM_PHRASE + ' exactly to erase the secure data');
  const removed = [], absent = [];
  for (const s of SECURE_FILES) {
    const file = path.join(userDataPath, s.file);
    let had = false;
    for (const f of [file, file + '.bak']) {
      try { fsMod.unlinkSync(f); had = true; }
      catch (e) {
        if (e && e.code === 'ENOENT') continue;
        throw new Error('Could not erase ' + s.label + ' (' + e.message + '). Already erased: ' + (removed.join(', ') || 'nothing'), { cause: e });
      }
    }
    (had ? removed : absent).push(s.label);
  }
  return { removed, absent };
}

// Policy lives in ipc-policy.js: Vex's own window only, closed in private windows.
//   applock:make-record  a scrypt record for a new PIN or passphrase (main-window only)
//   applock:stores       the report above plus what is not encrypted
//   applock:reset        wipe, drop the lock record, restart (the explicit recovery path)
function registerAppLock({ ipcMain, app, userDataPath, mainWindowOf, makeRecord, dropLockRecord, relaunch = true }) {
  const fromMain = (e) => {
    const w = mainWindowOf();
    if (!w || w.isDestroyed() || e.sender !== w.webContents || e.senderFrame !== w.webContents.mainFrame) throw new Error('Only the main Vex window does this');
  };
  ipcMain.handle('applock:make-record', async (e, secret) => { fromMain(e); return JSON.stringify(await makeRecord(secret)); });
  ipcMain.handle('applock:stores', async (e) => { fromMain(e); return { stores: describe({ userDataPath }), notEncrypted: NOT_ENCRYPTED.slice(), phrase: CONFIRM_PHRASE }; });
  ipcMain.handle('applock:reset', async (e, confirm) => {
    fromMain(e);
    const receipt = wipe({ userDataPath, confirm });
    // Only after the secrets are gone does the lock go: the other order would
    // leave a profile that is open with its secrets still in it.
    await dropLockRecord();
    if (relaunch) { app.relaunch(); app.exit(0); }
    return { ok: true, ...receipt };
  });
}

module.exports = { describe, wipe, headerKind, registerAppLock, SECURE_FILES, NOT_ENCRYPTED, CONFIRM_PHRASE };
