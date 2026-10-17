// === The unlock window of an encrypted profile (T3-123) ====================
//
// When the profile is encrypted (main/profile-crypt.js) the settings file cannot
// be read until the passphrase (or the recovery code) has opened it, and that is
// before Vex's own window exists. This is a small window of its own that asks
// for it: it loads one local page (renderer/profile-unlock.html, no script from
// anywhere else) and has two channels:
//   profilecrypt:unlock  (mode 'passphrase' | 'recovery', secret) -> { ok, error? }
//   profilecrypt:quit    closes Vex
// Wrong answers are counted here and slow down exactly as the Vex lock does
// (lock-pin.js waitFor): five wrong tries, then 30 s, 1 min, 2 min ... up to an hour.
// The wait lives in this process only; the cost of one try (scrypt, about 0.3 s and
// 64 MB) is what limits a guesser who copied the folder.
//
// createUnlockGate() returns { ready, finish }. `ready` is already resolved when the
// profile is not encrypted, so an ordinary profile pays nothing. It resolves when
// the key is open. finish() closes the window; main calls it once Vex's own window
// has been created, so the app never has zero windows in between.
// A profile lock that cannot be read (damaged header) ends in an error box and
// exit: starting as if the profile were unencrypted would write plaintext next to
// ciphertext.
const nodePath = require('path');
const { waitFor, waitText } = require('./lock-pin');

const MAX_FAILS = 5;

function createUnlockGate({ app, BrowserWindow, ipcMain, dialog, profileCrypt, startupError = null, htmlFile, preloadFile, now = () => Date.now(), log = console }) {
  let problem = startupError;
  let locked = false;
  if (!problem) {
    try { locked = profileCrypt.isLocked(); }
    catch (err) { problem = err; }
  }
  if (problem) {
    log.error('[ProfileLock] ' + problem.message);
    app.whenReady().then(() => {
      dialog.showErrorBox('Vex cannot open this profile', problem.message + '\n\nNothing was changed. To get your data back without Vex, close Vex and run: node scripts/profile-decrypt.js --profile "<profile folder>" (see docs/profile-lock.md).');
      app.exit(1);
    }).catch((err) => { log.error('[ProfileLock] could not show the error:', err); app.exit(1); });
    return { ready: new Promise(() => {}), finish() {} };
  }
  if (!locked) return { ready: Promise.resolve(), finish() {} };

  let win = null, unlocked = false, resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const state = { fails: 0, rounds: 0, waitUntil: 0 };
  const fromWindow = (e) => !!win && !win.isDestroyed() && e.sender === win.webContents;

  ipcMain.handle('profilecrypt:unlock', async (e, mode, secret) => {
    if (!fromWindow(e)) throw new Error('Only the unlock window does this');
    if (unlocked) return { ok: true };
    const left = state.waitUntil - now();
    if (left > 0) return { ok: false, error: 'Too many tries - wait ' + waitText(left) };
    try {
      if (mode === 'recovery') await profileCrypt.unlockWithRecovery(secret);
      else if (mode === 'passphrase') await profileCrypt.unlock(secret);
      else throw new Error('Unknown way to unlock');
    } catch (err) {
      if (!err || (err.code !== 'WRONG_SECRET' && err.code !== 'BAD_INPUT')) throw err;
      state.fails += 1;
      if (state.fails >= MAX_FAILS) {
        state.fails = 0; state.rounds += 1;
        const wait = waitFor(state.rounds);
        state.waitUntil = now() + wait;
        return { ok: false, error: 'Too many tries - wait ' + waitText(wait) };
      }
      return { ok: false, error: err.message };
    }
    unlocked = true;
    resolveReady();
    return { ok: true };
  });
  ipcMain.on('profilecrypt:quit', (e) => { if (fromWindow(e)) app.quit(); });

  app.whenReady().then(() => {
    win = new BrowserWindow({
      width: 480, height: 440, show: false, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true,
      title: 'Unlock Vex',
      webPreferences: { preload: preloadFile, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
    });
    win.setMenuBarVisibility(false);
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.once('ready-to-show', () => win.show());
    // Closing the window without unlocking is a quit: there is nothing else to show.
    win.on('closed', () => { win = null; if (!unlocked) app.quit(); });
    win.loadFile(htmlFile).catch((err) => { log.error('[ProfileLock] the unlock page could not be loaded:', err); dialog.showErrorBox('Vex cannot ask for the passphrase', err.message); app.exit(1); });
  }).catch((err) => { log.error('[ProfileLock] the unlock window could not be made:', err); app.exit(1); });

  return { ready, finish() { if (win && !win.isDestroyed()) win.close(); } };
}

module.exports = { createUnlockGate, MAX_FAILS, htmlFileIn: (dir) => nodePath.join(dir, 'renderer', 'profile-unlock.html') };
