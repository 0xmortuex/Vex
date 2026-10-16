// === Strict study block, with a cooldown instead of a lock ====================
//
// You start a study session on purpose: a name, a list of sites that may be open
// and a length. For that time a navigation to any other site is bounced back
// (the same place Focus mode bounces from: FocusMode.guard). To go anyway you
//
//   1. press "Leave anyway", which starts a 60-second wait;
//   2. type why (a few words, kept in the log on this computer);
//   3. when the wait ends the button opens the site and gives it a 10-minute pass.
//
// It is never a lock. The wait is the whole cost and it always ends; the session
// ends by itself at its end time; "End the study block now" in Settings needs only
// a confirmation (logged as an override); switching the feature off in Settings or
// Minimal Vex ends it. Vex's own pages, local files and the sites on the list are
// never bounced, and a restart does not extend a session past its end.
//
//   VexStudyBlock.hostAllowed(url, allow)  pure: may this address be open?
//   VexStudyBlock.leaveStatus(askedAt, reason, now, cooldownSec)  pure: { ok, wait, why }
//   VexStudyBlock.start({ name, allow, minutes }) / .end(how) / .active() / .until()
//
// Local only: nothing is sent anywhere.
const VexStudyBlock = {
  KEY: 'vex.studyBlock',          // { session, presets, passes, log }
  PREF: 'vex.studyBlock.enabled',
  COOLDOWN_SEC: 60,
  PASS_MIN: 10,
  MIN_REASON: 8,                  // characters
  MAX_LOG: 100,
  MAX_PRESETS: 12,
  MAX_ALLOW: 60,
  MAX_MINUTES: 480,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    localStorage.setItem(this.PREF, on ? 'on' : 'off');
    if (!on && this.active()) this.end('switched-off');
  },

  // ---- pure --------------------------------------------------------------------
  normalizeHost(raw) {
    let t = String(raw == null ? '' : raw).trim().toLowerCase();
    t = t.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
    if (!t) return '';
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(t)) throw new Error('"' + raw + '" is not a site name');
    return t;
  },
  cleanAllow(list) {
    const out = [];
    for (const x of Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/)) {
      const h = this.normalizeHost(x);
      if (h && !out.includes(h)) out.push(h);
    }
    if (out.length > this.MAX_ALLOW) throw new Error('At most ' + this.MAX_ALLOW + ' sites on one list');
    return out;
  },
  // Vex's own pages and local files are never part of the question.
  isInternal(url) {
    return !/^https?:/i.test(String(url || ''));
  },
  hostAllowed(url, allow) {
    if (this.isInternal(url)) return true;
    let host;
    try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return true; }   // not an address: not ours to judge
    return (allow || []).some(a => host === a || host.endsWith('.' + a));
  },
  // askedAt: when "Leave anyway" was pressed. -> { ok, wait (seconds still to wait), why }
  leaveStatus(askedAt, reason, now = Date.now(), cooldownSec = this.COOLDOWN_SEC) {
    if (!Number.isFinite(askedAt)) return { ok: false, wait: cooldownSec, why: 'Press Leave anyway to start the wait.' };
    const wait = Math.max(0, Math.ceil((askedAt + cooldownSec * 1000 - now) / 1000));
    if (String(reason || '').trim().length < this.MIN_REASON) return { ok: false, wait, why: 'Write why, in at least ' + this.MIN_REASON + ' characters.' };
    if (wait > 0) return { ok: false, wait, why: 'Wait ' + wait + ' s.' };
    return { ok: true, wait: 0, why: '' };
  },

  // ---- state --------------------------------------------------------------------
  _read() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { throw new Error('The study block could not be read: ' + err.message); }
    const d = { session: null, presets: [], passes: {}, log: [] };
    if (!raw) return d;
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The saved study block is damaged: ' + err.message); }
    if (!o || typeof o !== 'object') return d;
    if (o.session && typeof o.session === 'object' && Number.isFinite(o.session.until) && Array.isArray(o.session.allow)) d.session = o.session;
    if (Array.isArray(o.presets)) d.presets = o.presets.filter(p => p && typeof p.name === 'string' && Array.isArray(p.allow)).slice(0, this.MAX_PRESETS);
    if (o.passes && typeof o.passes === 'object') d.passes = o.passes;
    if (Array.isArray(o.log)) d.log = o.log.slice(-this.MAX_LOG);
    return d;
  },
  _write(d) {
    try { localStorage.setItem(this.KEY, JSON.stringify(d)); }
    catch (err) { throw new Error('The study block could not be saved: ' + err.message, { cause: err }); }
  },
  _changed() {
    try { document.dispatchEvent(new CustomEvent('vex:study-block')); } catch (err) { console.error('[StudyBlock] event failed:', err); }
    if (typeof AttentionState !== 'undefined') AttentionState.changed();
  },
  _logAdd(d, entry) { d.log.push({ at: Date.now(), ...entry }); if (d.log.length > this.MAX_LOG) d.log.splice(0, d.log.length - this.MAX_LOG); },

  // The session, ended by itself when its time is up.
  session(now = Date.now()) {
    if (!this.enabled()) return null;
    const d = this._read();
    if (!d.session) return null;
    if (d.session.until <= now) {
      this._logAdd(d, { kind: 'ended', name: d.session.name, how: 'time' });
      d.session = null; d.passes = {};
      this._write(d);
      this._changed();
      return null;
    }
    return d.session;
  },
  active() { return !!this.session(); },
  until() { const s = this.session(); return s ? s.until : 0; },
  presets() { return this._read().presets; },
  log() { return this._read().log.slice(); },

  savePreset(name, allow) {
    const n = String(name || '').trim();
    if (!n) throw new Error('Give the list a name, for example the course');
    if (n.length > 60) throw new Error('Keep the name under 60 characters');
    const a = this.cleanAllow(allow);
    if (!a.length) throw new Error('Add at least one site that may stay open');
    const d = this._read();
    const i = d.presets.findIndex(p => p.name.toLowerCase() === n.toLowerCase());
    const p = { name: n, allow: a };
    if (i >= 0) d.presets[i] = p;
    else { if (d.presets.length >= this.MAX_PRESETS) throw new Error('At most ' + this.MAX_PRESETS + ' saved lists'); d.presets.push(p); }
    this._write(d);
    return p;
  },
  removePreset(name) {
    const d = this._read();
    d.presets = d.presets.filter(p => p.name.toLowerCase() !== String(name).toLowerCase());
    this._write(d);
  },

  // FlashMind is always allowed: it is the study tool.
  alwaysAllowed() {
    const out = [];
    try { if (typeof FlashMindBridge !== 'undefined') out.push(this.normalizeHost(FlashMindBridge.url())); } catch (err) { console.error('[StudyBlock] FlashMind address:', err); }
    return out.filter(Boolean);
  },

  start({ name, allow, minutes }) {
    if (!this.enabled()) throw new Error('The study block is switched off in Settings');
    if (this.active()) throw new Error('A study block is already running');
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < 5 || m > this.MAX_MINUTES) throw new Error('Length is whole minutes from 5 to ' + this.MAX_MINUTES);
    const list = this.cleanAllow(allow);
    if (!list.length) throw new Error('Add at least one site that may stay open');
    const d = this._read();
    const now = Date.now();
    d.session = { id: 's' + now.toString(36), name: String(name || 'Study').trim().slice(0, 60) || 'Study', allow: [...new Set(list.concat(this.alwaysAllowed()))], startedAt: now, until: now + m * 60000 };
    d.passes = {};
    this._logAdd(d, { kind: 'started', name: d.session.name, minutes: m });
    this._write(d);
    this._changed();
    return d.session;
  },

  // how: 'override' (Settings button), 'left' (after the wait), 'switched-off', 'done'
  end(how = 'done', reason = '') {
    const d = this._read();
    if (!d.session) return false;
    this._logAdd(d, { kind: 'ended', name: d.session.name, how, reason: String(reason || '').slice(0, 300) });
    d.session = null; d.passes = {};
    this._write(d);
    this._changed();
    return true;
  },

  hasPass(host, now = Date.now()) {
    const p = this._read().passes[host];
    return Number.isFinite(p) && p > now;
  },
  grantPass(host, reason, now = Date.now()) {
    const d = this._read();
    d.passes[host] = now + this.PASS_MIN * 60000;
    this._logAdd(d, { kind: 'left', host, reason: String(reason || '').slice(0, 300) });
    this._write(d);
  },

  // ---- the navigation hook (FocusMode.guard) ---------------------------------------------
  // Returns true when the navigation was bounced.
  guard(webview, url) {
    const s = this.session();
    if (!s) return false;
    if (this.hostAllowed(url, s.allow)) return false;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return false; }
    if (this.hasPass(host)) return false;
    try { if (webview.canGoBack()) webview.goBack(); else webview.loadURL(typeof START_URL !== 'undefined' ? START_URL : 'about:blank'); }
    catch (err) { console.error('[StudyBlock] could not step back:', err); }
    this.openLeave({ webview, url, host, session: s });
    return true;
  },

  openLeave({ webview, url, host, session }) {
    document.getElementById('vex-study-leave')?.remove();
    const ov = document.createElement('div');
    ov.id = 'vex-study-leave';
    ov.className = 'vexsr-ov';
    ov.innerHTML = '<div class="vexsr-card" role="dialog" aria-modal="true" aria-labelledby="vex-study-leave-t"><div class="vexsr-head"><span class="vexsr-title" id="vex-study-leave-t"></span></div><div class="vexsr-sub" data-info></div><div class="vex-platform-body" data-body></div></div>';
    ov.querySelector('#vex-study-leave-t').textContent = 'Study block: ' + session.name;
    ov.querySelector('[data-info]').textContent = host + ' is not on this block\'s list. It ends at ' + new Date(session.until).toTimeString().slice(0, 5) + '.';
    const body = ov.querySelector('[data-body]');
    const G = VexSettingsGroups;
    let askedAt = NaN, timer = null;
    const reason = document.createElement('input');
    reason.type = 'text'; reason.placeholder = 'Why do you need ' + host + ' now?'; reason.maxLength = 300;
    reason.setAttribute('aria-label', 'Why you need this site now');
    reason.style.cssText = 'width:100%;box-sizing:border-box;margin:8px 0';
    reason.disabled = true;
    const note = G.note('Press Leave anyway to start a ' + this.COOLDOWN_SEC + '-second wait. You can stay in the block at any time.');
    const stay = G.button('Stay in the study block', () => close(), { primary: true });
    const go = G.button('Open ' + host, () => {
      const st = this.leaveStatus(askedAt, reason.value);
      if (!st.ok) { note.textContent = st.why; return; }
      try { this.grantPass(host, reason.value.trim()); } catch (err) { note.textContent = err.message; return; }
      close();
      try { webview.loadURL(url); } catch (err) { window.showToast?.('Could not open that page: ' + err.message, 'error'); }
    });
    go.disabled = true;
    const ask = G.button('Leave anyway', () => {
      askedAt = Date.now(); ask.disabled = true; reason.disabled = false; reason.focus(); tick();
    });
    const tick = () => {
      if (!ov.isConnected) return;
      const st = this.leaveStatus(askedAt, reason.value);
      note.textContent = st.ok ? 'You can open ' + host + ' now.' : st.why;
      go.disabled = !st.ok;
      if (st.wait > 0 || !st.ok) timer = setTimeout(tick, 500);
    };
    reason.addEventListener('input', () => { clearTimeout(timer); tick(); });
    const close = () => { clearTimeout(timer); ov.remove(); };
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
    row.append(stay, ask, go);
    body.append(note, reason, row);
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.body.appendChild(ov);
    stay.focus({ preventScroll: true });
  },

  // ---- Settings -------------------------------------------------------------------------------
  group(el) {
    const G = VexSettingsGroups;
    const s = this.session();
    if (s) {
      el.appendChild(G.note('Running: ' + s.name + ', until ' + new Date(s.until).toTimeString().slice(0, 5) + '. Allowed: ' + s.allow.join(', ')));
      el.appendChild(G.button('End the study block now', async () => {
        const ok = await window.vexConfirm({ title: 'End the study block?', message: 'This ends it without the wait. It is written in the log as an override.', okLabel: 'End it', danger: true });
        if (!ok) return;
        try { this.end('override'); window.showToast?.('Study block ended'); this._redraw(el); } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { danger: true }));
    } else {
      el.appendChild(G.note('Pick the sites that may stay open and a length. Everything else is bounced; leaving takes a 60-second wait and a few words of why. You are never locked in.'));
      el.appendChild(G.button('Start a study block', () => this._startDialog(el), { primary: true }));
    }
    const presets = this.presets();
    el.appendChild(G.note(presets.length ? 'Saved lists: ' + presets.map(p => p.name + ' (' + p.allow.length + ')').join(', ') : 'No saved lists yet. Starting a block can save its list.'));
    el.appendChild(G.button('Show the log', () => {
      const { body } = G.dialog({ id: 'vex-study-log', title: 'Study block log', sub: 'Kept on this computer only.' });
      const log = this.log().reverse();
      if (!log.length) body.appendChild(G.note('Nothing yet.'));
      for (const e of log) body.appendChild(G.note(new Date(e.at).toLocaleString() + ': ' + e.kind + (e.name ? ' ' + e.name : '') + (e.host ? ' ' + e.host : '') + (e.how ? ' (' + e.how + ')' : '') + (e.reason ? ': ' + e.reason : '')));
    }));
  },
  _redraw(el) { el.textContent = ''; const l = document.createElement('label'); l.className = 'setting-label'; l.textContent = 'Study block'; el.appendChild(l); this.group(el); },

  async _startDialog(el) {
    const presets = this.presets();
    const hint = presets.length ? '\nSaved: ' + presets.map(p => p.name).join(', ') + ' (type a saved name to use its list)' : '';
    const first = await window.vexPrompt({ title: 'Study block: sites that may stay open', message: 'Sites separated by spaces or commas, or the name of a saved list. FlashMind is always allowed.' + hint, label: 'Sites', placeholder: 'wikipedia.org khanacademy.org', okLabel: 'Next' });
    if (first == null) return;
    const preset = presets.find(p => p.name.toLowerCase() === first.trim().toLowerCase());
    let allow;
    try { allow = preset ? preset.allow : this.cleanAllow(first); } catch (err) { window.showToast?.(err.message, 'error'); return; }
    const mins = await window.vexPrompt({ title: 'How long?', message: 'Minutes, 5 to ' + this.MAX_MINUTES + '.', label: 'Minutes', value: '50', okLabel: 'Start' });
    if (mins == null) return;
    try {
      if (!preset) {
        const nm = await window.vexPrompt({ title: 'Save this list?', message: 'Give it a name (the course, say) to reuse it, or leave empty to skip.', label: 'Name', okLabel: 'Save' });
        if (nm && nm.trim()) this.savePreset(nm, allow);
      }
      this.start({ name: preset ? preset.name : 'Study', allow, minutes: Number(mins) });
      window.showToast?.('Study block started');
      this._redraw(el);
    } catch (err) { window.showToast?.(err.message, 'error'); }
  },
};

if (typeof window !== 'undefined') {
  window.VexStudyBlock = VexStudyBlock;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'study-block',
      title: 'Study block',
      keywords: 'study block strict focus allowlist cooldown exam revise distraction',
      build: (el) => VexStudyBlock.group(el),
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'study-block', label: 'Study Block', hint: 'Start or end a study session with an allowlist', icon: 'graduation', action: () => { if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('Study block'); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStudyBlock };
