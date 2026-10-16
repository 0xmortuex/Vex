// === Lock Vex with a PIN ====================================================
//
// Stepping away from the computer leaves every tab, the mail panel, Discord
// and the password vault a click from whoever sits down. Locking covers the
// window with a PIN screen and hides every page underneath (hidden, not
// blurred — a blur can still be read). Ctrl+Alt+L, Ctrl+K › Lock Vex, or by
// itself after a set time with no keyboard or mouse input anywhere on the
// computer (Windows' own idle time, so watching a video in another app counts
// as idle only if you are not touching anything).
//
// It is a privacy screen, not encryption: your profile on disk is readable by
// anyone with your Windows account, locked or not. The PIN is stored only as
// a salted PBKDF2 hash.
const VexLock = {
  PIN_KEY: 'vex.lockPin',
  IDLE_KEY: 'vex.lockIdleMin',
  // Being locked is remembered: it was only in memory, so closing Vex and
  // starting it again opened it unlocked (found 2026-09-29).
  LOCKED_KEY: 'vex.locked',
  ITERATIONS: 150000,
  _locked: false,
  // Wrong tries and the wait they earn are stored too: kept in memory, a
  // restart gave five fresh tries straight away, so the thirty-second wait
  // was no brake on guessing (found 2026-09-29).
  FAILS_KEY: 'vex.lockFails',
  WAIT_KEY: 'vex.lockWaitUntil',
  WAIT_MS: 30000,
  // Each round of five wrong PINs doubles the wait, up to an hour, the same
  // as main's own count (src/main/lock-pin.js waitFor; audit SE2).
  ROUNDS_KEY: 'vex.lockRounds',
  MAX_WAIT_MS: 60 * 60 * 1000,
  get _fails() { const n = Number(localStorage.getItem(this.FAILS_KEY)); return Number.isFinite(n) && n > 0 ? n : 0; },
  set _fails(n) { if (n > 0) localStorage.setItem(this.FAILS_KEY, String(n)); else localStorage.removeItem(this.FAILS_KEY); },
  get _rounds() { const n = Number(localStorage.getItem(this.ROUNDS_KEY)); return Number.isFinite(n) && n > 0 ? n : 0; },
  set _rounds(n) { if (n > 0) localStorage.setItem(this.ROUNDS_KEY, String(n)); else localStorage.removeItem(this.ROUNDS_KEY); },
  _waitFor(round) { return Math.min(this.WAIT_MS * 2 ** (Math.max(1, round) - 1), this.MAX_WAIT_MS); },
  _waitText(ms) { const s = Math.ceil(ms / 1000); return s < 120 ? s + ' s' : Math.ceil(s / 60) + ' min'; },
  // Never more than one wait from now: a clock that jumped would otherwise
  // leave Vex refusing the right PIN for as long as the jump.
  get _waitUntil() { const t = Number(localStorage.getItem(this.WAIT_KEY)); return Number.isFinite(t) && t > 0 ? Math.min(t, Date.now() + this._waitFor(this._rounds)) : 0; },
  set _waitUntil(t) { if (t > 0) localStorage.setItem(this.WAIT_KEY, String(t)); else localStorage.removeItem(this.WAIT_KEY); },

  hasPin() { try { return !!JSON.parse(localStorage.getItem(this.PIN_KEY) || 'null'); } catch { return false; } },

  async _hash(pin, salt) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: this.ITERATIONS }, key, 256);
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  },

  async setPin(pin) {
    if (!/^\d{4,12}$/.test(String(pin))) throw new Error('A PIN is 4 to 12 digits');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem(this.PIN_KEY, JSON.stringify({ salt: btoa(String.fromCharCode(...salt)), hash: await this._hash(pin, salt) }));
    // Main checks the PIN when Vex is unlocked (src/main/lock-pin.js), so it
    // is saved there before "PIN saved" is said.
    if (typeof PersistentStorage !== 'undefined') await PersistentStorage._flush();
  },

  clearPin() { localStorage.removeItem(this.PIN_KEY); if (typeof VexSecureLock !== 'undefined') VexSecureLock.syncMinimize(); },

  // A record made by main with scrypt (js/secure-lock.js, T3-123): a PIN or a passphrase. The window
  // cannot check one (Web Crypto has no scrypt), so unlocking and the re-check go straight to main,
  // which also keeps the wrong-try count.
  isScryptRecord() { try { const r = JSON.parse(localStorage.getItem(this.PIN_KEY) || 'null'); return !!r && r.kdf === 'scrypt'; } catch { return false; } },

  // Stores the record main made for a new PIN or passphrase. Main is asked first, so a refused
  // secret (too short) throws here and nothing is stored.
  async setSecret(secret) {
    if (!window.vex?.applockMakeRecord) throw new Error('Vex could not make the lock record');
    const record = await window.vex.applockMakeRecord(String(secret));
    JSON.parse(record);
    localStorage.setItem(this.PIN_KEY, record);
    this._fails = 0; this._rounds = 0; this._waitUntil = 0;
    if (typeof PersistentStorage !== 'undefined') await PersistentStorage._flush();
  },

  // Asked again before a secret is shown or copied (a saved password, the sync
  // recovery code): the Vex PIN when one is set, checked by main with the same
  // wrong-PIN count as unlocking; otherwise a plain confirmation, so someone
  // passing by at least has to mean it. -> true to go ahead.
  async recheck({ title, message, okLabel = 'Continue' }) {
    if (!this.hasPin()) return !!(await window.vexConfirm({ title, message, okLabel }));
    const pin = await window.vexPrompt({ title, message: message + ' Enter your Vex PIN to continue.', label: 'Vex PIN', password: true, okLabel });
    if (pin === null) return false;
    let result;
    try { result = await window.vex.verifyLockPin(String(pin).trim().slice(0, 128)); }
    catch (err) { window.showToast?.('Could not check the PIN: ' + err.message, 'error'); return false; }
    if (!result || !result.ok) { window.showToast?.((result && result.error) || 'Wrong PIN', 'error'); return false; }
    return true;
  },

  async check(pin) {
    const stored = JSON.parse(localStorage.getItem(this.PIN_KEY) || 'null');
    if (!stored) return false;
    const salt = Uint8Array.from(atob(stored.salt), c => c.charCodeAt(0));
    return (await this._hash(pin, salt)) === stored.hash;
  },

  idleMinutes() { const n = Number(localStorage.getItem(this.IDLE_KEY)); return Number.isFinite(n) && n > 0 ? n : 0; },
  setIdleMinutes(n) { localStorage.setItem(this.IDLE_KEY, String(Math.max(0, Number(n) || 0))); },

  locked() { return this._locked; },

  lock() {
    if (this._locked) return true;
    if (!this.hasPin()) { window.showToast?.('Set a PIN first — Settings › Privacy & Security › Lock Vex', 'error'); return false; }
    this._locked = true;
    localStorage.setItem(this.LOCKED_KEY, '1');
    // Main refuses the vault and new private windows while this is set.
    window.vex?.setLockState?.(true);
    document.body.classList.add('vex-locked');
    window.dispatchEvent(new CustomEvent('vex-locked'));   // Away mode starts by itself (js/away-mode.js)
    document.activeElement?.blur?.();
    const el = document.createElement('div');
    el.className = 'vex-lock-screen';
    // The role is on the card: a full-window [role=dialog] is capped at
    // 95% × 90% by the dialog rule in accessibility-ui.css, which left Vex showing round
    // the edges.
    el.innerHTML = `<form class="vex-lock-card" role="dialog" aria-label="Vex is locked">
        <div class="vex-lock-icon">${VexIcons.svg('lock', { size: 30 })}</div>
        <div class="vex-lock-title">Vex is locked</div>
        <input type="password" autocomplete="off" maxlength="128" aria-label="PIN or passphrase" placeholder="PIN or passphrase">
        <button type="submit">Unlock</button>
        <div class="vex-lock-msg" aria-live="polite"></div>
      </form>`;
    document.body.appendChild(el);
    // The "forgot it" recovery path, when the person turned it on (js/secure-lock.js).
    if (typeof VexSecureLock !== 'undefined') VexSecureLock.decorateLockScreen(el);
    // Everything but the PIN screen is inert: Tab walked the focus to the
    // buttons behind it, and a panel opened by a shortcut sat there usable
    // (found 2026-09-29). Anything added to the page while locked is made
    // inert too.
    this._inerted = [];
    const shut = (node) => {
      if (node === el || node.nodeType !== 1 || node.hasAttribute('inert')) return;
      node.setAttribute('inert', '');
      this._inerted.push(node);
    };
    for (const child of [...document.body.children]) shut(child);
    this._watch = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) shut(n);
    });
    this._watch.observe(document.body, { childList: true });
    const input = el.querySelector('input');
    const msg = el.querySelector('.vex-lock-msg');
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.isScryptRecord()) {
        try { await this.unlock(input.value); }
        catch (err) { input.value = ''; msg.textContent = err.message; }
        return;
      }
      if (this._waitUntil && Date.now() < this._waitUntil) { msg.textContent = 'Too many tries — wait ' + this._waitText(this._waitUntil - Date.now()); return; }
      if (await this.check(input.value)) {
        try { await this.unlock(input.value); }
        catch (err) { input.value = ''; msg.textContent = err.message; }
        return;
      }
      this._fails++;
      input.value = '';
      // Five wrong in a row: a wait before the next try, longer each round.
      if (this._fails >= 5) {
        this._rounds = this._rounds + 1;
        const wait = this._waitFor(this._rounds);
        this._waitUntil = Date.now() + wait; this._fails = 0;
        msg.textContent = 'Too many tries — wait ' + this._waitText(wait);
      }
      else msg.textContent = 'Wrong PIN';
    });
    input.focus();
    this._el = el;
    return true;
  },

  // Only main opens Vex, and only for the right PIN: the window saying so
  // was enough before, and DevTools' console could say it (audit B1).
  async unlock(pin) {
    if (!window.vex?.unlockLock) throw new Error('Vex could not ask to be unlocked');
    const r = await window.vex.unlockLock(String(pin ?? ''));
    if (!r || r.ok !== true) throw new Error((r && r.error) || 'Vex stayed locked');
    this._open();
  },

  // Take the lock screen away, once main has unlocked.
  _open() {
    this._locked = false;
    this._fails = 0;
    this._rounds = 0;
    localStorage.removeItem(this.LOCKED_KEY);
    this._watch?.disconnect();
    this._watch = null;
    for (const node of this._inerted || []) node.removeAttribute('inert');
    this._inerted = [];
    document.body.classList.remove('vex-locked');
    this._el?.remove();
    this._el = null;
    // Vex Sync waits for this to send saved passwords and authenticator
    // accounts again (js/sync-engine.js).
    window.dispatchEvent(new CustomEvent('vex-unlocked'));
  },

  async _idleCheck() {
    const min = this.idleMinutes();
    if (!min || this._locked || !this.hasPin()) return;
    if ((await window.vex.idleSeconds()) >= min * 60) this.lock();
  },

  init() {
    // Locked when Vex was closed: start locked. Without a PIN there is
    // nothing to unlock with, so the old flag is dropped instead.
    if (localStorage.getItem(this.LOCKED_KEY) === '1') {
      if (this.hasPin()) this.lock();
      else localStorage.removeItem(this.LOCKED_KEY);
    }
    window.vex?.onLockVex?.(() => this.lock());
    VexJobs.every('Lock when idle', 30000, () => this._idleCheck(), { when: 'background' });
  },
};

if (typeof window !== 'undefined') window.VexLock = VexLock;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLock };
