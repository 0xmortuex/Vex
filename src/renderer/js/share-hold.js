// === Hold more sign-in fills while the screen is shared (T3-114) =================
//
// Screen-share safe mode (js/screen-share-safe.js) already holds notices, private tab
// titles and (its own switch) the saved-login offers while a share is on. This is the
// rest of what would put a secret on the shared screen, behind ONE more switch that is
// off until the person ticks it ("Also hold the passkey chooser, 2FA codes, emailed codes
// and the AI's sign-in while sharing", Settings, Safer browsing helpers):
//
//   passkey   the chooser that opens under a field marked for passkeys (js/passkeys.js) lists the
//             names of the accounts that have one
//   totp      the 2FA code filled from the authenticator, on its own or when the person asks
//             (js/totp-autofill.js)
//   emailcode the emailed code filled into the page (js/email-code-autofill.js)
//   agent     the AI agent's "sign in" step (js/agent-executor.js), which is told in words that it
//             was held and to hand the page over instead
//
// Nothing is queued or retried: a fill that was held is simply not done, and the pill of
// Screen-share safe mode counts it. "Off for this share" on that pill lets them through again,
// and so does the end of the share. Each place asks `VexShareHold.holds(kind)` first.
const VexShareHold = {
  KEY: 'vex.shareHold',            // 'on' turns it on; off by default
  LABELS: { passkey: 'the passkey chooser', totp: '2FA codes', emailcode: 'emailed codes', agent: 'the AI sign-in' },
  MESSAGE: 'Held while your screen is shared. Choose "Off for this share" on the small pill, then try again',

  _held: new Set(),

  enabled() { try { return localStorage.getItem(this.KEY) === 'on'; } catch (err) { console.error('[ShareHold]', err.message); return false; } },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? 'on' : 'off');
    this._held.clear();
    return !!on;
  },

  // Is this kind of fill held right now? Counts the first one of each kind on the pill of Screen-share safe mode.
  holds(kind) {
    if (!Object.prototype.hasOwnProperty.call(this.LABELS, kind)) throw new Error('VexShareHold: unknown kind ' + kind);
    const safe = typeof VexScreenShareSafe !== 'undefined' ? VexScreenShareSafe : null;
    if (!safe || typeof safe.active !== 'function' || !safe.active() || !this.enabled()) { this._held.clear(); return false; }
    if (!this._held.has(kind)) {
      this._held.add(kind);
      if (typeof safe.noteHeld === 'function') safe.noteHeld();
    }
    return true;
  },
  heldKinds() { return Array.from(this._held).map(k => this.LABELS[k]); },
};

if (typeof window !== 'undefined') window.VexShareHold = VexShareHold;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexShareHold };
