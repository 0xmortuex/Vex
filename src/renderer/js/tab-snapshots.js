// === Crash-proof tabs =======================================================
//
// Every 30 seconds, the pages you have open are sampled for two things a crash
// or a power cut would otherwise lose: how far down you were, and the text you
// had typed into plain text boxes. They go to main (tabsnap:save), which keeps
// them OS-encrypted (main/tab-snapshots.js). After a restart, when a restored
// tab has loaded, they are put back — scroll only if the page is still at the
// top, text only into boxes that are still empty. Nothing is ever overwritten.
//
// What is never taken:
//   * private, Tor, burner and routed tabs (VexTabPolicy.canReadWebview/canPersist);
//   * password fields, and every field in a form that has one, or on a page
//     with a password box outside a form (a login or sign-up page);
//   * card, one-time-code and username fields (autocomplete) and any field
//     whose name or id suggests a secret;
//   * email, phone and number boxes — only text, search, url and textareas;
//   * anything on a page that is not http(s).
// Switch it off in Settings and nothing is sampled; "Forget" empties the store.

// These two run INSIDE the page (their source is sent to it), so they use
// nothing from this file.
function vexSnapshotCapture(opts) {
  var out = { scroll: { x: Math.round(window.scrollX || 0), y: Math.round(window.scrollY || 0) }, fields: [] };
  if (!opts || !opts.forms) return out;
  var TYPES = { text: 1, search: 1, url: 1, '': 1 };
  var SECRET = /pass|pwd|pin|cvv|cvc|card|ccnum|ssn|otp|token|secret|iban|security|verification|auth/i;
  var AUTO = /cc-|password|one-time-code|username|current-|new-/i;
  var pageHasPassword = !!document.querySelector('input[type="password"]');
  var nodes = document.querySelectorAll('input, textarea');
  for (var i = 0; i < nodes.length && out.fields.length < 40; i++) {
    var el = nodes[i];
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' && !(String(el.getAttribute('type') || '').toLowerCase() in TYPES)) continue;
    if (!el.value || el.value.length > 20000 || el.disabled || el.readOnly) continue;
    if (SECRET.test((el.name || '') + ' ' + (el.id || ''))) continue;
    if (AUTO.test(el.getAttribute('autocomplete') || '')) continue;
    if (el.form ? el.form.querySelector('input[type="password"]') : (tag === 'input' && pageHasPassword)) continue;
    var sel = null;
    if (el.id) sel = '#' + CSS.escape(el.id);
    else if (el.name) sel = tag + '[name="' + String(el.name).replace(/["\\]/g, '\\$&') + '"]';
    if (!sel) continue;
    var idx = 0;
    try { idx = Array.prototype.indexOf.call(document.querySelectorAll(sel), el); } catch (e) { continue; }
    if (idx < 0) continue;
    out.fields.push({ s: sel, i: idx, v: el.value });
  }
  return out;
}

function vexSnapshotApply(entry) {
  var put = 0;
  var fields = (entry && entry.fields) || [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var el = null;
    try { el = document.querySelectorAll(f.s)[f.i]; } catch (e) { el = null; }
    if (!el || el.value || el.disabled || el.readOnly) continue;
    var type = String(el.getAttribute('type') || '').toLowerCase();
    if (el.tagName.toLowerCase() === 'input' && !(type === '' || type === 'text' || type === 'search' || type === 'url')) continue;
    var proto = el.tagName.toLowerCase() === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, f.v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    put++;
  }
  var sc = entry && entry.scroll;
  var scrolled = false;
  if (sc && sc.y > 0 && (window.scrollY || 0) < 20) { window.scrollTo(sc.x || 0, sc.y); scrolled = true; }
  return { fields: put, scrolled: scrolled };
}

const TabSnapshots = {
  ON_KEY: 'vex.tabSnapshots',
  FORMS_KEY: 'vex.tabSnapshotForms',
  EVERY_MS: 30000,
  _job: null,
  _restore: null,       // entries from the last run still waiting for their page
  _formsKept: null,     // what main said on the last save
  _busy: false,

  _get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? d : v; } catch { return d; } },
  _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (err) { console.warn('[TabSnapshots] could not save', k, err.message); } },
  isOn() { return this._get(this.ON_KEY, true) !== false; },
  formsOn() { return this._get(this.FORMS_KEY, true) !== false; },
  _msg(err) { return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); },

  // The address a snapshot is filed under: without the #fragment.
  key(url) { try { const u = new URL(String(url)); if (u.protocol !== 'https:' && u.protocol !== 'http:') return null; u.hash = ''; return u.toString(); } catch { return null; } },

  _withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer')), ms))]); },
  _wvReady(wv) { try { return !!wv && !wv.isLoading(); } catch { return false; } },

  // Which tabs may be sampled right now, with their live page.
  _candidates() {
    if (typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') return [];
    const out = [];
    for (const tab of TabManager.tabs || []) {
      if (!tab || tab.sleeping || tab._lazy) continue;
      const wv = WebviewManager.webviews.get(tab.id);
      if (!wv) continue;
      const policy = window.VexTabPolicy;
      if (!policy || !policy.canPersist(tab) || !policy.canReadWebview(wv)) continue;
      out.push({ tab, wv });
    }
    return out;
  },

  async loadSaved() {
    if (!window.vex || !window.vex.tabSnapshots) return;
    try {
      const r = await window.vex.tabSnapshots.load();
      this._restore = Array.isArray(r.entries) ? r.entries.slice() : [];
      this._formsKept = r.formsKept;
    } catch (err) {
      this._restore = [];
      console.error('[TabSnapshots] could not read the saved snapshots:', this._msg(err));
    }
  },

  async _applyPending() {
    if (!this._restore || !this._restore.length) return;
    for (const { tab, wv } of this._candidates()) {
      if (!this._wvReady(wv)) continue;
      const k = this.key(tab.url);
      const at = this._restore.findIndex(e => e.url === k);
      if (at < 0) continue;
      const entry = this._restore[at];
      // Removed first: a page that fails is not retried into a reload loop.
      this._restore.splice(at, 1);
      try {
        const r = await this._withTimeout(wv.executeJavaScript('(' + vexSnapshotApply.toString() + ')(' + JSON.stringify(entry) + ')', false), 3000);
        if (r && (r.fields || r.scrolled)) window.showToast?.('Restored what you had on "' + (tab.title || k) + '"' + (r.fields ? ' (' + r.fields + ' text box' + (r.fields === 1 ? '' : 'es') + ')' : ''), 'info');
      } catch (err) { console.warn('[TabSnapshots] could not restore a page:', this._msg(err)); }
    }
  },

  async tick() {
    if (this._busy || !this.isOn() || !window.vex || !window.vex.tabSnapshots) return null;
    this._busy = true;
    try {
      if (this._restore === null) await this.loadSaved();
      await this._applyPending();
      const forms = this.formsOn();
      const waiting = new Set((this._restore || []).map(e => e.url));
      const entries = [];
      const keepUrls = new Set();
      for (const tab of (typeof TabManager !== 'undefined' ? TabManager.tabs || [] : [])) {
        const k = tab && this.key(tab.url || tab.originalUrl);
        if (k) keepUrls.add(k);
      }
      for (const { tab, wv } of this._candidates()) {
        const k = this.key(tab.url);
        // Not before its old snapshot has been given its chance, and not
        // while the page is still loading (it would read an empty form).
        if (!k || waiting.has(k) || !this._wvReady(wv)) continue;
        try {
          const cap = await this._withTimeout(wv.executeJavaScript('(' + vexSnapshotCapture.toString() + ')(' + JSON.stringify({ forms }) + ')', false), 2000);
          // Sent even when empty: a form that was sent or cleared must replace
          // its old snapshot, not leave it to be restored after a crash.
          if (cap) {
            entries.push({ url: k, scroll: cap.scroll, fields: cap.fields }); keepUrls.delete(k);
            // Kept in memory too: a page killed under us is reloaded where it was
            // (js/webview.js, render-process-gone). Only for tabs this sampler may read.
            if (cap.scroll) tab._lastScroll = { x: cap.scroll.x, y: cap.scroll.y, url: k };
          }
        } catch (err) { console.warn('[TabSnapshots] skipped a page:', this._msg(err)); }
      }
      const r = await window.vex.tabSnapshots.save({ entries, keepUrls: [...keepUrls].slice(0, 200) });
      this._formsKept = r.formsKept;
      return r;
    } catch (err) {
      console.error('[TabSnapshots] could not save:', this._msg(err));
      return null;
    } finally { this._busy = false; }
  },

  start() {
    if (this._job || typeof VexJobs === 'undefined') return;
    this._job = VexJobs.every('Crash-proof tabs', this.EVERY_MS, () => this.tick(), { deferOnBattery: true });
  },
  stop() { if (this._job) { this._job.stop(); this._job = null; } },

  async forget() {
    await window.vex.tabSnapshots.clear();
    this._restore = [];
  },

  mountSettings() {
    const PS = window.ProtectSettings;
    if (!PS) return null;
    const body = PS.group({ id: 'settings-tab-snapshots', title: 'Session recovery: crash-proof tabs', intro: 'Every 30 seconds Vex keeps the scroll position and the text you have typed into plain boxes, encrypted on this computer, so a crash or power cut does not lose them.' });
    if (!body || body.dataset.ready) return body;
    body.dataset.ready = '1';
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin:6px 0';
    note.textContent = 'Never taken: password fields (or any field in a form with one), card and one-time-code fields, email, phone and number boxes, and anything from a private, Tor or burner tab.';
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin:4px 0';
    body.append(
      PS.toggle({ text: 'Keep my place and typed text for crash recovery', checked: this.isOn(), onChange: (on) => { this._set(this.ON_KEY, on); if (on) this.start(); else this.stop(); } }),
      PS.toggle({ text: 'Include text typed into plain boxes', hint: 'otherwise only the scroll position', checked: this.formsOn(), onChange: (on) => this._set(this.FORMS_KEY, on) }),
      note,
      PS.button('Forget saved snapshots', async () => {
        const ok = await vexConfirm({ title: 'Forget saved snapshots?', message: 'The saved scroll positions and typed text are deleted. Your open tabs are not affected.', okLabel: 'Forget', danger: true });
        if (!ok) return;
        try { await this.forget(); status.textContent = 'Saved snapshots deleted.'; }
        catch (err) { status.textContent = 'Could not delete them: ' + this._msg(err); }
      }, { icon: 'trash', danger: true }),
      status,
    );
    if (this._formsKept === false) status.textContent = 'OS encryption is not available on this computer, so typed text is not stored at all; only addresses and scroll positions are.';
    return body;
  },
};

if (typeof window !== 'undefined') {
  window.TabSnapshots = TabSnapshots;
  const boot = () => {
    try { TabSnapshots.mountSettings(); } catch (err) { console.error('[TabSnapshots] settings group failed:', err); }
    // After the saved tabs are back; a page waits for its turn anyway.
    setTimeout(() => { try { if (TabSnapshots.isOn()) TabSnapshots.start(); } catch (err) { console.error('[TabSnapshots] could not start:', err); } }, 8000);
  };
  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') boot();
    else document.addEventListener('DOMContentLoaded', boot);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { TabSnapshots, vexSnapshotCapture, vexSnapshotApply };
