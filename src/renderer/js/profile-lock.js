// === Encrypted profile lock (T3-123): encryption at rest for the personal stores ===
//
// Opt-in. The engine and its safety design live in the main process (src/main/profile-crypt.js):
// a passphrase AND a recovery code (shown once, never stored), a verified snapshot before anything is
// touched, every file decrypted back and compared before any plaintext is removed, and a switch back
// to plain files. This file is only Settings' side: the switch that shows the options, the dialogs, and
// the one-time display of the recovery code.
//
// What it protects: the settings file (which holds the notes, clips, clipboard history, history,
// journal, ledger, bookmarks, and every other vex.* value) and the open tabs, groups, stacks, shortcuts
// and sync records. What it does not: said in "What is and is not encrypted" below. If it is forgotten
// there is the recovery code; if both are lost the data is gone, which is the point of encryption.
const VexProfileLock = {
  ENABLED_KEY: 'vex.profileLock.enabled',
  FEATURE: 'profile-lock',

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) === 'true'; }
    catch (err) { console.error('[ProfileLock] the switch could not be read:', err); return false; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); this.registerCommands(); },

  // ---- pure ----------------------------------------------------------------------------------
  // Why a passphrase is refused, or '' when it will do. Main checks again. Unlike the Vex lock, a bare PIN
  // is not offered here: the key is derived from this text, so it has to resist guessing offline.
  passphraseProblem(p) {
    const s = String(p == null ? '' : p);
    if (s.length < 8) return 'A passphrase is at least 8 characters. A few words together are easier to remember than symbols.';
    if (s.length > 128) return 'A passphrase is at most 128 characters';
    if (/^\d+$/.test(s)) return 'Digits alone are easy to guess offline. Use words or letters as well.';
    return '';
  },
  // The recovery code in the groups it was made in, and the group asked back to prove it was saved.
  codeGroups(code) { return String(code || '').split('-').filter(Boolean); },
  confirmGroup(code) { const g = this.codeGroups(code); return g[g.length - 1] || ''; },
  statusLine(st) {
    if (!st || !st.enabled) return 'Not encrypted. Your profile files are readable text.';
    if (st.state === 'decrypting') return 'Switching back to plain files was interrupted. Start Vex again and use "Switch back to plain files" to finish.';
    return st.locked ? 'Encrypted and locked.' : 'Encrypted. Unlocked for this session, so Vex can read it.';
  },
  // "What is and is not encrypted", from the status (plainCopies: how many backup files are in the profile folder).
  coverage(st) {
    const copies = st && Number.isFinite(st.plainCopies) ? st.plainCopies : 0;
    return {
      covered: [
        'Notes, clips and the clipboard history',
        'Browsing history, the journal and the ledger',
        'Bookmarks, settings and every other saved value (the whole settings file)',
        'Open tabs, tab groups, stacks and shortcuts',
        'Vex Sync records kept on this computer',
      ],
      notCovered: [
        'The pages\' own cookies, logins and cache (Chromium keeps them)',
        'Downloaded files and the Vex Recall / knowledge-base indexes',
        'Passwords, authenticator accounts, passkeys and tokens: Windows already encrypts those for your account',
        'Small helper stores (reminders, quiet hours, extension data) and extension storage',
        'Settings backups made around updates: ' + (copies ? copies + ' file(s) in the profile folder are NOT encrypted. Delete them yourself if they matter.' : 'none are on disk now, and none are made while the profile is encrypted.'),
        'Bits of old plaintext Windows may leave in free disk space. Use BitLocker for the whole disk.',
        'While Vex is unlocked and running the key is in its memory',
      ],
    };
  },

  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  _fail(err) { window.showToast?.((err && err.message) || String(err), 'error'); },
  _api(name) {
    if (!window.vex || typeof window.vex[name] !== 'function') throw new Error('The encrypted profile lock is not available in this window');
    return window.vex[name].bind(window.vex);
  },
  async status() { return this._api('profileCryptStatus')(); },

  // ---- the recovery code, shown once ------------------------------------------------------------------
  // Shown until the person copies it or says they saved it, then asked for its last group so a code that
  // was not really written down is caught while the passphrase still opens everything.
  async showRecoveryCode(code, { title = 'Your recovery code' } = {}) {
    const html = '<div style="font:600 18px/1.6 Consolas,monospace;letter-spacing:1px;user-select:all;padding:10px 12px;border:1px solid var(--border);border-radius:8px;text-align:center">' + String(code).replace(/[^0-9A-Z-]/g, '') + '</div>';
    const message = 'This code opens your profile if you forget the passphrase. Vex shows it ONCE and does not keep it. Write it down or store it in a safe place, away from this computer. Anyone who has it can open your profile.';
    for (;;) {
      let copy = false;
      const saved = await window.vexConfirm({ title, message, html, okLabel: 'I have saved it', cancelLabel: 'Close', extra: { label: 'Copy (clears in 60 s)', run: () => { copy = true; } } });
      if (copy) {
        await this._api('copySecret')(String(code), 60);
        window.showToast?.('Copied. It leaves the clipboard in 60 seconds.');
        continue;
      }
      if (!saved) {
        const sure = await window.vexConfirm({ title: 'Close without saving the code?', message: 'Without the code, a forgotten passphrase means the data cannot be opened. You can make a new code any time with "New recovery code", while you still know the passphrase.', okLabel: 'Close anyway', cancelLabel: 'Show the code again', danger: true });
        if (sure) return false;
        continue;
      }
      const group = this.confirmGroup(code);
      const typed = await window.vexPrompt({ title: 'Check the code', message: 'Type the LAST group of four characters of the code you saved.', label: 'Last group', placeholder: 'XXXX', okLabel: 'Check' });
      if (typed === null) continue;
      if (String(typed).trim().toUpperCase() === group) return true;
      window.showToast?.('That is not the last group of the code. Look at what you saved, or copy the code again.', 'error');
    }
  },

  // ---- switch on ---------------------------------------------------------------------------------------------
  async turnOn() {
    if (!this.enabled()) throw new Error('The encrypted profile lock is switched off in Settings');
    const st = await this.status();
    if (st.enabled) throw new Error('The profile is already encrypted');
    const go = await window.vexConfirm({
      title: 'Encrypt your profile?',
      message: 'Vex will take a verified backup, encrypt the settings file (notes, clips, history, journal, ledger and the rest) and your open tabs in place, check that every file opens again, and only then remove the plain copies. If anything fails it stops and your files stay as they are. From then on Vex asks for the passphrase every time it starts. If you lose BOTH the passphrase and the recovery code, the data cannot be opened by anyone, including you.',
      okLabel: 'Choose a passphrase', cancelLabel: 'Not now',
    });
    if (!go) return false;
    const a = await window.vexPrompt({ title: 'New passphrase', message: '8 to 128 characters. It is asked at every start.', label: 'Passphrase', password: true, okLabel: 'Next' });
    if (a === null) return false;
    const bad = this.passphraseProblem(a);
    if (bad) throw new Error(bad);
    const b = await window.vexPrompt({ title: 'Again', label: 'Type it again', password: true, okLabel: 'Encrypt' });
    if (b === null) return false;
    if (a !== b) throw new Error('The two are not the same');
    window.showToast?.('Encrypting... this takes a few seconds');
    const r = await this._api('profileCryptEnable')(a);
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    window.showToast?.('Your profile is encrypted');
    if (r.leftovers && r.leftovers.length) await window.vexAlert({ title: 'Some plain copies are still on disk', message: 'These could not be removed: ' + r.leftovers.join(', ') + '. Delete them yourself from the profile folder once Vex is closed.' });
    await this.showRecoveryCode(r.recoveryCode);
    return true;
  },

  // ---- switch back ---------------------------------------------------------------------------------------------
  async turnOff() {
    const st = await this.status();
    if (!st.enabled) throw new Error('The profile is not encrypted');
    const go = await window.vexConfirm({ title: 'Switch back to plain files?', message: 'Every encrypted file is decrypted, checked against the encrypted copy, and only then replaced. Your profile folder becomes readable text again. Vex stops asking for the passphrase.', okLabel: 'Continue', cancelLabel: 'Cancel' });
    if (!go) return false;
    let viaCode = false;
    let secret = await window.vexPrompt({ title: 'Passphrase', message: 'Type your passphrase.', label: 'Passphrase', password: true, okLabel: 'Switch back', extra: { label: 'Use my recovery code instead', run: () => { viaCode = true; } } });
    if (viaCode) secret = await window.vexPrompt({ title: 'Recovery code', message: 'Type the recovery code you saved.', label: 'Recovery code', password: true, okLabel: 'Switch back' });
    if (secret === null) return false;
    await this._api('profileCryptDisable')(viaCode ? 'recovery' : 'passphrase', String(secret));
    window.showToast?.('Your profile is plain files again');
    return true;
  },

  async changePassphrase() {
    const st = await this.status();
    if (!st.enabled) throw new Error('The profile is not encrypted');
    const cur = await window.vexPrompt({ title: 'Current passphrase', label: 'Passphrase', password: true, okLabel: 'Next' });
    if (cur === null) return false;
    const a = await window.vexPrompt({ title: 'New passphrase', message: '8 to 128 characters.', label: 'New passphrase', password: true, okLabel: 'Next' });
    if (a === null) return false;
    const bad = this.passphraseProblem(a);
    if (bad) throw new Error(bad);
    const b = await window.vexPrompt({ title: 'Again', label: 'Type it again', password: true, okLabel: 'Save' });
    if (b === null) return false;
    if (a !== b) throw new Error('The two are not the same');
    await this._api('profileCryptChange')(cur, a);
    window.showToast?.('Passphrase changed. The recovery code still works.');
    return true;
  },

  async newRecoveryCode() {
    const st = await this.status();
    if (!st.enabled) throw new Error('The profile is not encrypted');
    const cur = await window.vexPrompt({ title: 'Make a new recovery code', message: 'The old code stops working. Type your passphrase.', label: 'Passphrase', password: true, okLabel: 'Make it' });
    if (cur === null) return false;
    const r = await this._api('profileCryptNewRecovery')(cur);
    await this.showRecoveryCode(r.recoveryCode, { title: 'Your new recovery code' });
    return true;
  },

  async showCoverage() {
    const st = await this.status();
    const c = this.coverage(st);
    const { body } = VexSettingsGroups.dialog({ id: 'profile-lock-coverage', title: 'What is and is not encrypted', sub: 'Encryption at rest protects the files when Vex is closed or locked, from someone who copies your folder or reads it with your Windows account.' });
    body.appendChild(this._el('div', 'setting-label', 'Encrypted when the lock is on'));
    const a = this._el('ul', 'ad-new'); for (const t of c.covered) a.appendChild(this._el('li', '', t)); body.appendChild(a);
    body.appendChild(this._el('div', 'setting-label', 'Not covered'));
    const b = this._el('ul', 'ad-new'); for (const t of c.notCovered) b.appendChild(this._el('li', '', t)); body.appendChild(b);
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('profilelock:', this.enabled() ? [
      { id: 'profilelock:open', label: 'Encrypted profile lock', icon: 'shield', hint: 'Encrypt your notes, history and settings at rest', action: () => { if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('setting-profile-lock'); } },
    ] : []);
    return true;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Encrypts the settings file (your notes, clips, history, journal, ledger and every other saved value) and your open tabs on disk, with a passphrase and a recovery code. Vex takes a verified backup first, checks every file opens again before removing the plain copy, and stops with your files untouched if anything fails. It asks for the passphrase every time Vex starts. Nothing is on until you switch it on, and you can switch back to plain files. If you lose both the passphrase and the recovery code, nobody can open the data.'));
    body.appendChild(S.toggle('Encrypted profile lock', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE); window.VexSettingsGroups?.inject(); }, 'Ctrl+K > Encrypted profile lock'));
    if (!this.enabled()) return;
    const line = this._el('div', 'setting-info', 'Checking...');
    line.setAttribute('aria-live', 'polite');
    body.appendChild(line);
    const refresh = () => this.status().then((st) => { line.textContent = this.statusLine(st); return st; }).catch((e) => { line.textContent = (e && e.message) || String(e); });
    refresh();
    const run = (fn) => () => { fn.call(this).then(() => { refresh(); }).catch((e) => { this._fail(e); refresh(); }); };
    body.appendChild(S.button('Encrypt my profile...', run(this.turnOn)));
    body.appendChild(S.button('Change passphrase...', run(this.changePassphrase)));
    body.appendChild(S.button('New recovery code...', run(this.newRecoveryCode)));
    body.appendChild(S.button('Switch back to plain files...', run(this.turnOff)));
    body.appendChild(S.button('What is and is not encrypted...', () => { this.showCoverage().catch((e) => this._fail(e)); }));
    body.appendChild(S.note('If Vex will not start, close it and run: node scripts/profile-decrypt.js --profile "<your profile folder>" with VEX_PROFILE_PASSPHRASE (or VEX_PROFILE_RECOVERY) set. It gets the files back to plain text without Vex. See docs/profile-lock.md.'));
  },

  init() { this.registerCommands(); },
};

if (typeof window !== 'undefined') {
  window.VexProfileLock = VexProfileLock;
  VexProfileLock.registerCommands();
  document.addEventListener('DOMContentLoaded', () => { try { VexProfileLock.init(); } catch (err) { console.error('[ProfileLock] could not start:', err); } });
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'profile-lock', title: 'Encrypted profile lock', keywords: 'encrypt encryption profile passphrase recovery code notes history at rest decrypt lock', before: 'about', render: (body) => VexProfileLock.settingsRows(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexProfileLock };
