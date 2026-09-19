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
  ITERATIONS: 150000,
  _locked: false,
  _fails: 0,

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
    const input = el.querySelector('input');
    const msg = el.querySelector('.vex-lock-msg');
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this._waitUntil && Date.now() < this._waitUntil) { msg.textContent = 'Too many tries — wait ' + Math.ceil((this._waitUntil - Date.now()) / 1000) + ' s'; return; }
      if (await this.check(input.value)) { this.unlock(); return; }
      this._fails++;
      input.value = '';
      // Five wrong in a row: thirty seconds before the next try.
      if (this._fails >= 5) { this._waitUntil = Date.now() + 30000; this._fails = 0; msg.textContent = 'Too many tries — wait 30 s'; }
      else msg.textContent = 'Wrong PIN';
    });
    input.focus();
    this._el = el;
    return true;
  },

  unlock() {
    this._locked = false;
    this._fails = 0;
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
    window.vex?.onLockVex?.(() => this.lock());
    VexJobs.every('Lock when idle', 30000, () => this._idleCheck(), { when: 'background' });
  },
};

if (typeof window !== 'undefined') window.VexLock = VexLock;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLock };
