// === Secure lock options (T3-123) ===============================================
//
// Vex already has a lock: a PIN, Ctrl+Alt+L, "lock when idle", checked by the main
// process (js/vex-lock.js, src/main/lock-pin.js). This adds, all opt-in and all off
// until you switch them on:
//   * a passphrase (8 to 128 characters) or a PIN stored with scrypt, made by the main
//     process, instead of a 4-12 digit PIN stored with PBKDF2;
//   * lock when Vex is minimized (main watches the window and tells this one to lock);
//   * a plain report of which secret files are encrypted by Windows and which parts of
//     your profile are NOT encrypted at all;
//   * the way out when you forget it: a button on the lock screen that, after you type
//     ERASE SECURE DATA, erases the secret files (passwords, authenticator accounts,
//     passkeys, tokens, sync key), signs you out of every site (cookies and logins)
//     and removes the lock, then restarts Vex.
//
// What the lock is and is not: a privacy screen that main enforces, not encryption of your
// profile. Your notes, history, bookmarks and the pages' own logins are readable by anyone with
// your Windows account whether Vex is locked or not; the secret files are encrypted by Windows
// for your account whether it is locked or not. Nothing here adds cryptography of its own,
// and nothing encrypts more of the profile: that needs a recovery-code design that has not been
// agreed, and a lost key would mean lost data. See docs/security-tier3-threat-notes.md.
//
// Nobody is locked out by default: nothing here is on until you turn it on, and the reset
// below is the written-down way back in.
const VexSecureLock = {
  ENABLED_KEY: 'vex.secureLock.enabled',
  MINIMIZE_KEY: 'vex.secureLock.minimize',
  FEATURE: 'secure-lock',
  PHRASE: 'ERASE SECURE DATA',

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) === 'true'; }
    catch (err) { console.error('[SecureLock] the switch could not be read:', err); return false; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); this.syncMinimize(); },
  minimizeLock() {
    try { return localStorage.getItem(this.MINIMIZE_KEY) === 'true'; }
    catch (err) { console.error('[SecureLock] the switch could not be read:', err); return false; }
  },
  setMinimizeLock(on) { localStorage.setItem(this.MINIMIZE_KEY, on ? 'true' : 'false'); this.syncMinimize(); },

  // Tells main whether to lock on minimize. Only ever on when the extras are on, a lock exists and the
  // person asked for it.
  syncMinimize() {
    const want = this.enabled() && this.minimizeLock() && typeof VexLock !== 'undefined' && VexLock.hasPin();
    if (window.vex && typeof window.vex.applockLockOnMinimize === 'function') window.vex.applockLockOnMinimize(!!want);
    return !!want;
  },

  // ---- pure ----------------------------------------------------------------------------------
  // Why a new secret is refused, or '' when it will do. Main checks again.
  secretProblem(secret) {
    const s = String(secret == null ? '' : secret);
    if (/^\d{4,12}$/.test(s)) return '';
    if (/^\d+$/.test(s)) return 'A PIN is 4 to 12 digits. For anything else use a passphrase of at least 8 characters, with letters.';
    if (s.length < 8) return 'A passphrase is at least 8 characters';
    if (s.length > 128) return 'A passphrase is at most 128 characters';
    return '';
  },
  // The report line for one secure file.
  storeLine(s) {
    const state = { encrypted: 'encrypted by Windows for your account', plain: 'NOT encrypted (readable text)', unknown: 'present, format not recognised', empty: 'empty', absent: 'not present' }[s.state] || s.state;
    return s.label + ': ' + state;
  },

  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  _fail(err) { window.showToast?.((err && err.message) || String(err), 'error'); },

  // ---- set a passphrase or PIN -----------------------------------------------------------------------
  async setSecret() {
    if (!this.enabled()) throw new Error('Secure lock options are switched off in Settings');
    if (typeof VexLock === 'undefined') throw new Error('The lock is not loaded');
    // Changing the way in needs the way in: the current PIN or passphrase, when there is one.
    if (VexLock.hasPin() && !(await VexLock.recheck({ title: 'Change the lock', message: 'You are about to replace the lock.', okLabel: 'Continue' }))) return false;
    const a = await window.vexPrompt({ title: 'New PIN or passphrase', message: 'A PIN is 4 to 12 digits. A passphrase is 8 to 128 characters. If you forget it, the only way back in is the erase-and-reset on the lock screen, which erases your saved passwords and authenticator accounts and signs you out of every site.', label: 'PIN or passphrase', password: true, okLabel: 'Next' });
    if (a === null) return false;
    const bad = this.secretProblem(a);
    if (bad) throw new Error(bad);
    const b = await window.vexPrompt({ title: 'Again', label: 'Type it again', password: true, okLabel: 'Save' });
    if (b === null) return false;
    if (a !== b) throw new Error('The two are not the same');
    await VexLock.setSecret(a);
    this.syncMinimize();
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    window.showToast?.('Saved - Ctrl+Alt+L locks Vex');
    return true;
  },

  // ---- what is encrypted ---------------------------------------------------------------------------------
  async showStores() {
    if (!window.vex || typeof window.vex.applockStores !== 'function') throw new Error('The report is not available in this window');
    const r = await window.vex.applockStores();
    const { body } = VexSettingsGroups.dialog({ id: 'secure-lock-stores', title: 'What is encrypted', sub: 'The lock is a privacy screen, not encryption. This is what Windows encrypts for your account, and what is not encrypted at all.' });
    body.appendChild(this._el('div', 'setting-label', 'Secret files'));
    const ul = this._el('ul', 'ad-new');
    for (const s of r.stores) ul.appendChild(this._el('li', '', this.storeLine(s)));
    body.appendChild(ul);
    body.appendChild(this._el('div', 'setting-label', 'Not encrypted by Vex'));
    const ul2 = this._el('ul', 'ad-new');
    for (const t of r.notEncrypted) ul2.appendChild(this._el('li', '', t));
    body.appendChild(ul2);
    body.appendChild(this._el('p', 'setting-info', 'Anyone who can sign in to your Windows account can read the second list, locked or not. Use a Windows account password, and BitLocker for the whole disk, for that.'));
  },

  // ---- the lock screen: "Forgot it?" -------------------------------------------------------------------------
  // Called by VexLock.lock() with the lock screen element. Only when the person turned the extras on.
  decorateLockScreen(screen) {
    if (!this.enabled() || !screen) return null;
    const wrap = this._el('div', 'vex-lock-forgot');
    wrap.style.cssText = 'position:absolute;left:0;right:0;bottom:24px;display:flex;justify-content:center;pointer-events:none';
    const det = document.createElement('details');
    det.style.cssText = 'pointer-events:auto;max-width:420px;padding:8px 12px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:10px;font-size:12px';
    const sum = this._el('summary', '', 'Forgot it?');
    sum.style.cursor = 'pointer';
    const info = this._el('p', '', 'There is no way to recover it. You can erase your saved passwords, authenticator accounts, passkeys, tokens and sync key, sign you out of every site (all cookies and logins) and remove the lock. Your notes, bookmarks and history stay. Type ' + this.PHRASE + ' to do it.');
    info.style.margin = '8px 0';
    const input = document.createElement('input');
    input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('aria-label', 'Type ' + this.PHRASE);
    input.placeholder = this.PHRASE;
    input.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:8px';
    const go = this._el('button', 'btn-danger', 'Erase secure data and remove the lock');
    go.type = 'button'; go.disabled = true;
    const msg = this._el('div', '', '');
    msg.setAttribute('aria-live', 'polite');
    input.addEventListener('input', () => { go.disabled = input.value !== this.PHRASE; });
    go.addEventListener('click', async () => {
      go.disabled = true;
      try { await this.reset(input.value); msg.textContent = 'Done. Vex is restarting.'; }
      catch (err) { msg.textContent = (err && err.message) || String(err); go.disabled = input.value !== this.PHRASE; }
    });
    det.append(sum, info, input, go, msg);
    wrap.appendChild(det);
    screen.appendChild(wrap);
    return wrap;
  },
  async reset(typed) {
    if (typed !== this.PHRASE) throw new Error('Type ' + this.PHRASE + ' exactly');
    if (!window.vex || typeof window.vex.applockReset !== 'function') throw new Error('The reset is not available in this window');
    const r = await window.vex.applockReset(typed);
    if (!r || r.ok !== true) throw new Error('The reset did not finish');
    return r;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Options for the Vex lock. It is a privacy screen that the main process enforces, not encryption of your profile: your notes, history and the pages\' logins are readable by anyone with your Windows account, locked or not, and Windows encrypts the secret files for your account either way. Nothing here is on until you switch it on, and nobody is locked out by default.'));
    body.appendChild(S.toggle('Secure lock options', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE); window.VexSettingsGroups?.inject(); }));
    if (!this.enabled()) return;
    body.appendChild(S.button(typeof VexLock !== 'undefined' && VexLock.isScryptRecord() ? 'Change the PIN or passphrase...' : 'Use a passphrase or a scrypt PIN...', () => { this.setSecret().then(() => window.VexSettingsGroups?.inject()).catch((e) => this._fail(e)); }));
    body.appendChild(S.toggle('Lock when Vex is minimized', this.minimizeLock(), (on) => { this.setMinimizeLock(on); }, typeof VexLock !== 'undefined' && VexLock.hasPin() ? '' : 'needs a PIN first'));
    body.appendChild(S.button('What is encrypted...', () => { this.showStores().catch((e) => this._fail(e)); }));
    body.appendChild(S.note('If you forget the PIN or passphrase, the lock screen shows "Forgot it?". It erases your saved passwords, authenticator accounts, passkeys, tokens and sync key and signs you out of every site after you type ' + this.PHRASE + ', removes the lock and restarts Vex. Someone sitting at your computer could use it to get past the lock screen to your notes, bookmarks and history (not to your passwords or logged-in sites): the lock does not protect against someone who can use your Windows account.'));
  },

  init() {
    this.syncMinimize();
  },
};

if (typeof window !== 'undefined') {
  window.VexSecureLock = VexSecureLock;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'secure-lock', title: 'Secure lock options', keywords: 'lock pin passphrase scrypt minimize encrypted forgot reset erase', before: 'about', render: (body) => VexSecureLock.settingsRows(body) });
  }
  document.addEventListener('DOMContentLoaded', () => { try { VexSecureLock.init(); } catch (err) { console.error('[SecureLock] could not start:', err); } });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSecureLock };
