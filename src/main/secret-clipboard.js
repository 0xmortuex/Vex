// === Copying a secret (password, one-time code) — cleared by the main process ===
//
// The renderer used to write the secret with navigator.clipboard and, 30 s
// later, read it back to see whether it was still there. Chromium refuses that
// read once Vex has lost the focus — and switching to the app you paste into
// is exactly what people do — so the clear silently never happened and the
// password stayed in the clipboard.
//
// Here Electron's clipboard does both, focus or no focus. Only a keyed hash of
// the secret is kept while it waits (the key is random per run, so the hash
// cannot be checked against a list of guesses), and the clipboard is emptied
// only if it still holds that same text: something the person copied since is
// never overwritten. Whatever is still waiting when Vex quits is checked and
// cleared then.
const crypto = require('crypto');

function createSecretClipboard({ clipboard, schedule = setTimeout, cancel = clearTimeout }) {
  if (!clipboard || typeof clipboard.writeText !== 'function' || typeof clipboard.readText !== 'function') throw new Error('secret clipboard needs Electron’s clipboard');
  const key = crypto.randomBytes(32);
  const digest = (text) => crypto.createHmac('sha256', key).update(String(text), 'utf8').digest();
  const pending = new Set();

  function clearIfUnchanged(entry) {
    pending.delete(entry);
    let now;
    try { now = clipboard.readText(); }
    catch (err) { console.error('[secret-clipboard] could not read the clipboard to clear it:', err.message); return false; }
    if (!now || !crypto.timingSafeEqual(digest(now), entry.hash)) return false;
    clipboard.clear();
    return true;
  }

  // Puts `text` on the clipboard; empties it after `seconds` if unchanged.
  function write(text, seconds = 30) {
    const secret = String(text == null ? '' : text);
    if (!secret) throw new Error('There is nothing to copy');
    const wait = Number.isInteger(seconds) && seconds >= 5 && seconds <= 300 ? seconds : 30;
    clipboard.writeText(secret);
    const entry = { hash: digest(secret), timer: null };
    entry.timer = schedule(() => clearIfUnchanged(entry), wait * 1000);
    if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
    pending.add(entry);
    return { ok: true, seconds: wait };
  }

  // Vex is quitting: a secret still waiting is cleared now, not left behind.
  function flush() {
    let cleared = 0;
    for (const entry of [...pending]) { cancel(entry.timer); if (clearIfUnchanged(entry)) cleared++; }
    return cleared;
  }

  return { write, flush, pendingCount: () => pending.size };
}

function registerSecretClipboard({ ipcMain, clipboard, app }) {
  const service = createSecretClipboard({ clipboard });
  // Policy: Vex's own windows only (ipc-policy.js, UI_ONLY_CHANNELS).
  ipcMain.handle('clipboard:write-secret', (_e, text, seconds) => service.write(text, seconds));
  if (app && typeof app.on === 'function') app.on('will-quit', () => { service.flush(); });
  return service;
}

module.exports = { createSecretClipboard, registerSecretClipboard };
