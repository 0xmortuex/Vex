// === First open of the day ====================================================
//
// The Morning Brief assumed a morning. Measured on this profile, 69 percent of
// visits are after 16:00 and 11 percent between 09:00 and 12:00, so a clock
// hour is the wrong trigger. The trigger here is the first time the window
// comes back after being away for N hours (default 4), whenever that is.
//
//   * No timer. Leaving is stamped when the window loses focus, goes hidden or
//     closes; coming back is checked when it gets focus again or at start-up.
//   * What it does is a choice (Settings › First open of the day):
//       offer  (default)  one calm notice with a button that opens the brief
//       open              opens a New Tab (where the brief is) by itself; the
//                         Ledger records it and Undo closes that tab
//       off               does nothing
//   * Other features that want "first open after being away" listen for the
//     document event `vex:first-open` ({ detail: { awayMs, at } }) instead of a
//     morning hour. The reading digest and the weekly review keep their own
//     schedules; this is the hook to key them from. The reading digest is keyed
//     from it when you switch on "Also make the reading digest" (js/reading-digest.js
//     onFirstOpen), and the weekly review is offered a move to Sunday evening
//     (js/weekly-review.js offerEvening).
//   * The hours people actually come back at are counted (24 numbers, no
//     times) so Settings can say "you usually come back around 18:00".
//
// Nothing is sent anywhere. The reminder, OTP and emergency paths do not pass
// through here at all.

const VexFirstOpen = {
  KEY: 'vex.firstOpen',            // { v, lastSeen, lastFirst, hist: [24] }
  PREF: 'vex.firstOpen.prefs',     // { mode, awayHours }
  MIN_HOURS: 1,
  MAX_HOURS: 48,
  DEFAULT_HOURS: 4,
  SAVE_EVERY_MS: 5 * 60 * 1000,    // leaving is kept in memory; storage is written this often
  MODES: ['off', 'offer', 'open'],
  _state: null,
  _lastSaved: 0,
  _wired: false,

  // ---- preferences ----------------------------------------------------------------
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); } catch { raw = null; }
    const mode = raw && this.MODES.includes(raw.mode) ? raw.mode : 'offer';
    const h = raw && Number(raw.awayHours);
    return { mode, awayHours: Number.isFinite(h) ? Math.min(this.MAX_HOURS, Math.max(this.MIN_HOURS, h)) : this.DEFAULT_HOURS, digest: !!(raw && raw.digest === true) };
  },
  setPrefs(patch) {
    const next = { ...this.prefs(), ...patch };
    if (!this.MODES.includes(next.mode)) throw new Error('The mode is off, offer or open');
    const h = Number(next.awayHours);
    if (!Number.isFinite(h) || h < this.MIN_HOURS || h > this.MAX_HOURS) throw new Error('Away time is between ' + this.MIN_HOURS + ' and ' + this.MAX_HOURS + ' hours');
    if (typeof next.digest !== 'boolean') throw new Error('The reading digest choice is on or off');
    try { localStorage.setItem(this.PREF, JSON.stringify({ mode: next.mode, awayHours: h, digest: next.digest })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return this.prefs();
  },
  enabled() { return this.prefs().mode !== 'off'; },
  // Minimal Vex: off, and back to what it was.
  setEnabled(on) {
    if (on) return this.setPrefs({ mode: this._priorMode || 'offer' });
    const cur = this.prefs().mode;
    if (cur !== 'off') this._priorMode = cur;
    return this.setPrefs({ mode: 'off' });
  },

  // ---- state ----------------------------------------------------------------------
  _read() {
    if (this._state) return this._state;
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); }
    catch (err) { raw = null; window.VexProblems?.note('First open', 'The record of your visits could not be read, so it starts again', err); }
    const ok = raw && typeof raw === 'object';
    const hist = ok && Array.isArray(raw.hist) && raw.hist.length === 24 ? raw.hist.map(n => Math.max(0, Math.min(9999, Number(n) || 0))) : new Array(24).fill(0);
    this._state = { v: 1, lastSeen: ok ? Number(raw.lastSeen) || 0 : 0, lastFirst: ok ? Number(raw.lastFirst) || 0 : 0, hist };
    return this._state;
  },
  _save(force = false, now = Date.now()) {
    if (!force && now - this._lastSaved < this.SAVE_EVERY_MS) return false;
    try { localStorage.setItem(this.KEY, JSON.stringify(this._read())); this._lastSaved = now; return true; }
    catch (err) { window.VexProblems?.note('First open', 'Could not save when you were last here', err); return false; }
  },

  // ---- pure decision --------------------------------------------------------------
  // away: has the window been gone long enough (and not been briefed since)?
  decide(state, now, awayHours) {
    if (!state.lastSeen) return { first: false, awayMs: 0, why: 'no earlier visit' };
    const awayMs = now - state.lastSeen;
    if (awayMs < awayHours * 3600 * 1000) return { first: false, awayMs, why: 'away less than ' + awayHours + ' h' };
    return { first: true, awayMs, why: 'away ' + Math.round(awayMs / 3600000) + ' h' };
  },

  // The hour people usually come back at, once there are enough to say.
  usualHour(state = this._read()) {
    const total = state.hist.reduce((a, b) => a + b, 0);
    if (total < 5) return null;
    let best = 0;
    for (let h = 1; h < 24; h++) if (state.hist[h] > state.hist[best]) best = h;
    return best;
  },

  // ---- leaving and coming back -------------------------------------------------------
  noteLeaving(now = Date.now()) {
    const s = this._read();
    s.lastSeen = now;
    this._save(false, now);
  },
  // -> true when this was a first open and it was acted on.
  noteReturn(now = Date.now()) {
    const s = this._read();
    const { mode, awayHours } = this.prefs();
    const d = this.decide(s, now, awayHours);
    s.lastSeen = now;
    if (!d.first) { this._save(false, now); return false; }
    s.lastFirst = now;
    s.hist[new Date(now).getHours()] = Math.min(9999, s.hist[new Date(now).getHours()] + 1);
    this._save(true, now);
    if (mode === 'off') return false;
    try { document.dispatchEvent(new CustomEvent('vex:first-open', { detail: { awayMs: d.awayMs, at: now } })); }
    catch (err) { window.VexProblems?.note('First open', 'A listener for the first open failed', err); }
    this._act(mode, d.awayMs);
    return true;
  },

  _act(mode, awayMs) {
    const hours = Math.max(1, Math.round(awayMs / 3600000));
    const open = () => {
      if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not loaded');
      return TabManager.createTab(typeof START_URL !== 'undefined' ? START_URL : 'vex://start', true, null, { allowDuplicate: false });
    };
    if (mode === 'open') {
      const id = open();
      if (typeof VexLedger !== 'undefined') {
        VexLedger.note({ feature: 'first-open', what: 'Opened your New Tab brief', why: 'You were away for about ' + hours + ' h and this is the first time you are back',
          undo: { kind: 'first-open-close', tabId: id }, stop: { kind: 'first-open-off' } });
      }
      return;
    }
    // offer: one useful notice, held in the Attention Inbox when the cap says so.
    if (typeof VexAttention === 'undefined') throw new Error('The attention gate is not loaded');
    VexAttention.notify({ feature: 'first-open', label: 'First open of the day', urgency: 'useful', id: new Date().toDateString(), title: 'Welcome back', body: 'You were away about ' + hours + ' h. Your brief is ready on a new tab.', action: { label: 'Open the brief', key: 'open' } },
      () => window.showToast?.('Welcome back. Your brief is ready.', 'info', 12000, { action: { label: 'Open the brief', run: () => { try { open(); } catch (err) { window.showToast?.(err.message, 'error'); } } } }));
  },

  // ---- wiring ----------------------------------------------------------------------------
  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('first-open-close', async (token) => {
        if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
        if (!TabManager.tabs.some(t => t.id === token.tabId)) throw new Error('That tab is already closed');
        TabManager.closeTab(token.tabId);
      });
      VexLedger.registerStop('first-open-off', () => { this.setPrefs({ mode: 'off' }); });
    }
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('first-open', (key) => {
        if (key !== 'open') throw new Error('Unknown action ' + key);
        return TabManager.createTab(typeof START_URL !== 'undefined' ? START_URL : 'vex://start', true);
      });
    }
    // At start-up the stamp left by the last run is what we compare with.
    this.noteReturn();
    window.addEventListener('blur', () => this.noteLeaving());
    window.addEventListener('beforeunload', () => { this.noteLeaving(); this._save(true); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { this.noteLeaving(); this._save(true); } else this.noteReturn();
    });
    window.addEventListener('focus', () => this.noteReturn());
    return true;
  },

  // ---- Settings ------------------------------------------------------------------------------
  group(el) {
    const p = this.prefs();
    const usual = this.usualHour();
    el.appendChild(VexSettingsGroups.note('Opens your brief the first time you are back after being away, instead of at a fixed morning hour. ' + (usual == null ? 'It learns when you usually come back after a few days.' : 'You usually come back around ' + String(usual).padStart(2, '0') + ':00.')));
    const row = (label, control) => { const r = document.createElement('div'); r.className = 'setting-toggle-row'; const s = document.createElement('span'); s.textContent = label; r.append(s, control); el.appendChild(r); };
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'What to do on the first open');
    for (const [v, t] of [['offer', 'Offer the brief'], ['open', 'Open a New Tab by itself'], ['off', 'Do nothing']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
    sel.value = p.mode;
    sel.addEventListener('change', () => { try { this.setPrefs({ mode: sel.value }); } catch (err) { window.showToast?.(err.message, 'error'); sel.value = this.prefs().mode; } });
    row('On the first open', sel);
    const hrs = document.createElement('input');
    hrs.type = 'number'; hrs.min = String(this.MIN_HOURS); hrs.max = String(this.MAX_HOURS); hrs.value = String(p.awayHours);
    hrs.setAttribute('aria-label', 'Hours away that count as a new day');
    hrs.addEventListener('change', () => { try { this.setPrefs({ awayHours: Number(hrs.value) }); } catch (err) { window.showToast?.(err.message, 'error'); hrs.value = String(this.prefs().awayHours); } });
    row('Hours away that count', hrs);
    const dg = document.createElement('input');
    dg.type = 'checkbox'; dg.checked = p.digest; dg.setAttribute('aria-label', 'Also make the reading digest on the first open');
    dg.addEventListener('change', () => { try { this.setPrefs({ digest: dg.checked }); } catch (err) { window.showToast?.(err.message, 'error'); dg.checked = this.prefs().digest; } });
    row('Also make the reading digest on the first open (instead of a morning hour)', dg);
  },
};

if (typeof window !== 'undefined') {
  window.VexFirstOpen = VexFirstOpen;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'first-open', title: 'First open of the day', keywords: 'first open morning brief away evening welcome back hours', before: 'about', build: (el) => VexFirstOpen.group(el) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFirstOpen };
