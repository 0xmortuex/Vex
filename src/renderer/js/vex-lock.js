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
  get _fails() { const n = Number(localStorage.getItem(this.FAILS_KEY)); return Number.isFinite(n) && n > 0 ? n : 0; },
  set _fails(n) { if (n > 0) localStorage.setItem(this.FAILS_KEY, String(n)); else localStorage.removeItem(this.FAILS_KEY); },
  // Never more than one wait from now: a clock that jumped would otherwise
  // leave Vex refusing the right PIN for as long as the jump.
  get _waitUntil() { const t = Number(localStorage.getItem(this.WAIT_KEY)); return Number.isFinite(t) && t > 0 ? Math.min(t, Date.now() + this.WAIT_MS) : 0; },
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

  clearPin() { localStorage.removeItem(this.PIN_KEY); },

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
    document.activeElement?.blur?.();
    const el = document.createElement('div');
    el.className = 'vex-lock-screen';
    // The role is on the card: a full-window [role=dialog] is capped at
    // 95% × 90% by the dialog rule in accessibility-ui.css, which left Vex showing round
    // the edges.
    el.innerHTML = `<form class="vex-lock-card" role="dialog" aria-label="Vex is locked">
        <div class="vex-lock-icon">${VexIcons.svg('lock', { size: 30 })}</div>
        <div class="vex-lock-title">Vex is locked</div>
        <input type="password" inputmode="numeric" autocomplete="off" maxlength="12" aria-label="PIN" placeholder="PIN">
        <button type="submit">Unlock</button>
        <div class="vex-lock-msg" aria-live="polite"></div>
      </form>`;
    document.body.appendChild(el);
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
      if (this._waitUntil && Date.now() < this._waitUntil) { msg.textContent = 'Too many tries — wait ' + Math.ceil((this._waitUntil - Date.now()) / 1000) + ' s'; return; }
      if (await this.check(input.value)) {
        try { await this.unlock(input.value); }
        catch (err) { input.value = ''; msg.textContent = err.message; }
        return;
      }
      this._fails++;
      input.value = '';
      // Five wrong in a row: thirty seconds before the next try.
      if (this._fails >= 5) { this._waitUntil = Date.now() + this.WAIT_MS; this._fails = 0; msg.textContent = 'Too many tries — wait 30 s'; }
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
    localStorage.removeItem(this.LOCKED_KEY);
    this._watch?.disconnect();
    this._watch = null;
    for (const node of this._inerted || []) node.removeAttribute('inert');
    this._inerted = [];
    document.body.classList.remove('vex-locked');
    this._el?.remove();
    this._el = null;
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
