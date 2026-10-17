// === Screen-share safe mode (T3-114) ===========================================
//
// While your screen is being shared (a Discord stream, a Meet call, any page that
// asked for display-capture and was allowed) other people see what you see. Five
// things that would show up on it are held back for as long as the share lasts:
//
//   notices        the attention state gets a "sharing" source (js/attention-state.js), so
//                  anything that is not urgent waits in the Attention Inbox, and the small
//                  in-app toasts are not drawn. Reminders and things you asked for are
//                  urgent and still arrive.
//   tab titles     the title of a tab on a bank, a payment or sign-in page, a mail or password
//                  site, or a chat (js/sensitive-pages.js) is blurred in the tab strip, and the
//                  sidebar panels that list names and unread counts are blurred too.
//   sign-in offers the saved-login fill and its account chooser, the remembered-email fill and the
//                  "use a strong password" card (js/passwords.js) wait while you share: they
//                  would show a user name or a password on the shared screen. The pill counts
//                  how many were held, and the next click in the field after the share works as
//                  usual. Its own switch (on).
//   New Tab        the Recent (history) list of the New Tab page is emptied and hidden: Today
//                  builds the page's data without it while you share, and again with it when the
//                  share ends (js/today.js, through the existing New Tab payload). Its own switch (on).
//   a small pill   "Share-safe mode on" with "Off for this share", so it is never a mystery why
//                  a toast did not appear, and it can be switched off at once.
//
// It starts and ends on the same signal Vex already has for "this tab or panel is sharing
// the screen" (vex:media-capture, kind 'screen'; the tab's own recorder is not a share).
// It does not record, capture, send or store anything about the share, and it never
// touches the page being shared. Each start is written to "Why did that happen?" with an
// Undo that switches it off for this share.
const VexScreenShareSafe = {
  KEY: 'vex.shareSafe',               // 'off' turns it off; on by default
  VAULT_KEY: 'vex.shareSafe.vault',   // 'off': sign-in offers are not held while sharing (on by default)
  HISTORY_KEY: 'vex.shareSafe.history', // 'off': the New Tab Recent list stays while sharing (on by default)
  PANELS: ['panel-authenticator', 'panel-history', 'panel-recall', 'panel-whatsapp', 'panel-discord'],

  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? 'on' : 'off');
    this.apply();
    return !!on;
  },

  _flag(key) { try { return localStorage.getItem(key) !== 'off'; } catch { return true; } },
  vaultOn() { return this._flag(this.VAULT_KEY); },
  historyOn() { return this._flag(this.HISTORY_KEY); },
  setVault(on) { localStorage.setItem(this.VAULT_KEY, on ? 'on' : 'off'); this.apply(); return !!on; },
  setHistory(on) { localStorage.setItem(this.HISTORY_KEY, on ? 'on' : 'off'); this.apply(); this._refreshNewTab(); return !!on; },
  _refreshNewTab() {
    if (typeof VexToday === 'undefined' || typeof VexToday.refresh !== 'function') return;
    VexToday.refresh().catch((err) => { console.error('[ShareSafe] could not rebuild the New Tab data:', err); window.VexProblems?.note('Screen-share safe mode', 'The New Tab page could not be updated for the share', err); });
  },
  // Hold sign-in offers / the New Tab Recent list right now?
  vaultHeld() { return this.active() && this.vaultOn(); },
  historyHeld() { return this.active() && this.historyOn(); },
  // A sign-in offer was held back: counted, and shown on the pill.
  noteHeld() {
    this._held++;
    this._pillText();
    return this._held;
  },

  _held: 0,
  _sharers: new Set(),       // 'tab:<id>' / 'panel:<name>' while sharing
  _paused: false,            // "Off for this share"
  _on: false,                // what is currently applied
  _pill: null,

  // Is the safe mode in force right now? (AttentionState reads this.)
  active() { return this.enabled() && !this._paused && this._sharers.size > 0; },
  sharing() { return this._sharers.size > 0; },

  // A vex:media-capture detail. The tab's own recorder (where 'vex') is not a share.
  onCapture(d) {
    if (!d || d.kind !== 'screen' || (d.where !== 'tab' && d.where !== 'panel') || d.id == null) return false;
    const key = d.where + ':' + d.id;
    const before = this._sharers.size;
    if (d.active) this._sharers.add(key); else this._sharers.delete(key);
    if (this._sharers.size === 0) this._paused = false;       // a new share starts with the mode on again
    if (before === 0 && this._sharers.size > 0) { this._began = true; this._held = 0; }
    this.apply();
    return true;
  },
  onTabClosed(id) {
    if (this._sharers.delete('tab:' + id)) { if (this._sharers.size === 0) this._paused = false; this.apply(); }
  },

  // Blur the title of a tab that must not show on a shared screen.
  markTabElement(el, tab) {
    if (!this._on || !tab || typeof VexSensitive === 'undefined') return;
    if (VexSensitive.hidesTitle(tab.url)) el.dataset.shareHidden = '1';
  },

  _style() {
    if (typeof document === 'undefined' || document.getElementById('share-safe-style')) return;
    const st = document.createElement('style');
    st.id = 'share-safe-style';
    st.textContent = `
      html.vex-sharing #toast-container { visibility: hidden !important; }
      html.vex-sharing .tab-item[data-share-hidden] .tab-title, html.vex-sharing .tab-item[data-share-hidden] .tab-note-line { filter: blur(6px); }
      ${this.PANELS.map(p => 'html.vex-sharing #' + p).join(', ')} { filter: blur(9px); }
      #share-safe-pill { position: fixed; z-index: 100200; right: 12px; bottom: 12px; display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 12px; color: var(--text); background: var(--surface, var(--bg)); border: 1px solid var(--border); border-radius: 999px; box-shadow: 0 6px 20px var(--vex-shadow-color, rgba(0,0,0,.3)); }
      #share-safe-pill button { font-size: 11.5px; color: var(--text); background: none; border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; cursor: pointer; }`;
    document.head.appendChild(st);
  },

  _refreshTitles(on) {
    if (typeof TabManager === 'undefined' || typeof document === 'undefined') return;
    for (const el of document.querySelectorAll('.tab-item[data-share-hidden]')) delete el.dataset.shareHidden;
    if (!on) return;
    for (const tab of TabManager.tabs) {
      const el = document.querySelector('.tab-item[data-tab-id="' + String(tab.id).replace(/"/g, '') + '"]');
      if (el) this.markTabElement(el, tab);
    }
  },

  _showPill(on) {
    if (this._pill) { this._pill.remove(); this._pill = null; }
    if (!on || typeof document === 'undefined') return;
    const pill = document.createElement('div');
    pill.id = 'share-safe-pill';
    pill.setAttribute('role', 'status');
    const t = document.createElement('span');
    t.id = 'share-safe-pill-text';
    t.textContent = this._pillLine();
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Off for this share';
    b.addEventListener('click', () => this.pauseForThisShare());
    pill.append(t, b);
    document.body.appendChild(pill);
    this._pill = pill;
  },

  _pillLine() {
    return 'Share-safe mode: notices held, private titles hidden' + (this.vaultOn() ? ', sign-in offers held' + (this._held ? ' (' + this._held + ')' : '') : '') + (this.historyOn() ? ', New Tab history hidden' : '');
  },
  _pillText() {
    const el = typeof document !== 'undefined' ? document.getElementById('share-safe-pill-text') : null;
    if (el) el.textContent = this._pillLine();
  },

  pauseForThisShare() {
    this._paused = true;
    this.apply();
    return true;
  },

  // Bring what is on screen in line with active(). Idempotent.
  apply() {
    const on = this.active();
    const changed = on !== this._on;
    this._on = on;
    if (typeof document !== 'undefined') {
      this._style();
      document.documentElement.classList.toggle('vex-sharing', on);
      this._refreshTitles(on);
      this._showPill(on);
    }
    if (changed && typeof AttentionState !== 'undefined' && typeof AttentionState.changed === 'function') AttentionState.changed();
    // The New Tab page's data is built again, without (or with) its Recent list.
    if (changed) this._refreshNewTab();
    if (on && changed && this._began) {
      this._began = false;
      if (typeof VexLedger !== 'undefined') {
        VexLedger.record({ feature: 'screen-share-safe', what: 'Held notices and hid private tab titles while you share your screen',
          why: 'A tab or panel started sharing the screen, and what is on it is seen by everyone watching', undo: { kind: 'share-safe-off' } });
      }
    }
    return on;
  },

  init() {
    if (this._wired || typeof document === 'undefined') return false;
    this._wired = true;
    document.addEventListener('vex:media-capture', (e) => this.onCapture(e && e.detail));
    document.addEventListener('vex:tab-closed', (e) => { if (e && e.detail) this.onTabClosed(e.detail.tabId); });
    window.addEventListener('vex:tab-url-changed', () => { if (this._on) this._refreshTitles(true); });
    if (typeof VexLedger !== 'undefined') VexLedger.registerUndo('share-safe-off', async () => { this.pauseForThisShare(); });
    return true;
  },
};

if (typeof window !== 'undefined') { window.VexScreenShareSafe = VexScreenShareSafe; VexScreenShareSafe.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexScreenShareSafe };
