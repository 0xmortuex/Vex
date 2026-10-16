// === Panel state strip and unread ledger ========================================
//
// The sidebar icon of a panel already carries its unread count (js/panel-badges.js
// reads the "(5)" at the front of the page title). This adds what a person who
// lives in panels wants beside it:
//
//   in a call   a timer, from the microphone/camera/screen signal Vex already has
//   now playing the song and artist the player itself published to the system
//               (navigator.mediaSession), read only from a panel that is making
//               a sound; a title and an artist, nothing else of the page
//   ledger      every change of a panel's unread count ("Discord 3 to 11 at 21:04"),
//               kept as numbers and times only: no names, no text
//   since you last looked
//               how much a panel gained since you last had it open
//
// Nothing here reads a message. The counts come from the title polling that was
// already running, and the media session is the player's own public label.
//
// The strip is a thin row of chips at the bottom of the window, OFF until the
// person turns it on (Settings, Panels and messages); the small "playing" mark
// on the sidebar icon and the ledger are on with the feature.
const PanelState = {
  KEYS: { on: 'vex.panelState.on', strip: 'vex.panelState.strip', ledger: 'vex.panelState.ledger', looked: 'vex.panelState.looked' },
  MAX_LEDGER: 300,
  POLL_MS: 15000,
  _counts: {},        // the last counts we saw, panel -> n
  _callSince: {},     // panel -> ms when its call was first seen
  _playing: {},       // panel -> { title, artist, at }
  _polled: {},        // panel -> ms of the last media session read
  _wired: false,
  _now() { return Date.now(); },

  // ---- storage -------------------------------------------------------------------
  _read(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try { const v = JSON.parse(raw); return v == null ? fallback : v; }
    catch (err) { throw new Error('The saved panel state "' + key + '" is not readable', { cause: err }); }
  },
  enabled() { return localStorage.getItem(this.KEYS.on) !== '0'; },
  setEnabled(on) {
    localStorage.setItem(this.KEYS.on, on ? '1' : '0');
    if (!on) this._clearMarks();
    this.render();
  },
  stripOn() { return this.enabled() && localStorage.getItem(this.KEYS.strip) === '1'; },
  setStrip(on) { localStorage.setItem(this.KEYS.strip, on ? '1' : '0'); this.render(); },

  ledger() { const v = this._read(this.KEYS.ledger, []); return Array.isArray(v) ? v.filter(e => e && typeof e.p === 'string' && Number.isFinite(e.ts)) : []; },
  clearLedger() { localStorage.removeItem(this.KEYS.ledger); localStorage.removeItem(this.KEYS.looked); this.render(); },
  looked() { const v = this._read(this.KEYS.looked, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; },

  // ---- the ledger ------------------------------------------------------------------
  // Called with every sweep's counts. A panel with no entry is asleep: it is left alone.
  noteCounts(counts, now = this._now()) {
    const ledger = this.ledger();
    let changed = false;
    for (const [panel, n] of Object.entries(counts || {})) {
      let prev = this._counts[panel];
      if (prev === undefined) { const last = ledger.filter(e => e.p === panel).pop(); prev = last ? last.to : 0; }
      if (n !== prev) { ledger.push({ p: panel, from: prev, to: n, ts: now }); changed = true; }
      this._counts[panel] = n;
    }
    for (const p of Object.keys(this._counts)) if (!(counts && p in counts)) delete this._counts[p];
    if (changed) {
      while (ledger.length > this.MAX_LEDGER) ledger.shift();
      localStorage.setItem(this.KEYS.ledger, JSON.stringify(ledger));
    }
    return changed;
  },
  // Newest first, optionally of one panel and after a time.
  history({ panel, since = 0, limit = 50 } = {}) {
    return this.ledger().filter(e => (!panel || e.p === panel) && e.ts > since).slice(-limit).reverse();
  },
  noteLooked(panel, now = this._now()) {
    if (!panel || typeof panel !== 'string') return;
    const l = this.looked();
    l[panel] = now;
    localStorage.setItem(this.KEYS.looked, JSON.stringify(l));
  },
  // How much the panel gained since it was last open: { gained, since }.
  sinceLooked(panel) {
    const since = Number(this.looked()[panel]) || 0;
    let gained = 0;
    for (const e of this.ledger()) if (e.p === panel && e.ts > since && e.to > e.from) gained += e.to - e.from;
    return { gained, since };
  },

  // ---- the live state of one panel -----------------------------------------------------
  unread(panel) { return this._counts[panel] || 0; },
  _capture(panel) {
    const c = typeof SidebarManager !== 'undefined' && SidebarManager.panelCapture ? SidebarManager.panelCapture[panel] : null;
    return !!(c && (c.mic || c.camera || c.screen));
  },
  inCall(panel) {
    if (this._capture(panel)) return true;
    return !!document.querySelector('.sidebar-icon[data-panel="' + (window.CSS && CSS.escape ? CSS.escape(panel) : panel) + '"] .icon-badge.discord-call');
  },
  playing(panel) { return this._playing[panel] || null; },
  state(panel) {
    const callSince = this._callSince[panel] || 0;
    return { panel, unread: this.unread(panel), inCall: this.inCall(panel), callSince, playing: this.playing(panel), ...this.sinceLooked(panel) };
  },
  panels() {
    const names = new Set([...Object.keys(this._counts), ...Object.keys(this._callSince), ...Object.keys(this._playing)]);
    return Array.from(names).map(p => this.state(p)).filter(s => s.unread > 0 || s.inCall || s.playing);
  },
  label(panel) { return typeof SidebarManager !== 'undefined' && SidebarManager.panelLabel ? SidebarManager.panelLabel(panel) : panel; },

  _clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
  },

  // ---- reading what the player published ------------------------------------------------------
  MEDIA_SCRIPT: '(() => { const m = navigator.mediaSession && navigator.mediaSession.metadata; return m ? { title: String(m.title || "").slice(0, 120), artist: String(m.artist || "").slice(0, 120) } : null; })()',
  async _pollPlaying(panel, wv, now) {
    let audible = false;
    try { audible = !!(wv && typeof wv.isCurrentlyAudible === 'function' && wv.isCurrentlyAudible()); } catch { audible = false; }   // still attaching: nothing is playing yet
    if (!audible) { delete this._playing[panel]; delete this._polled[panel]; return false; }
    if (now - (this._polled[panel] || 0) < this.POLL_MS && this._playing[panel]) return true;
    this._polled[panel] = now;
    try {
      const meta = await window.vexGuestEval(wv, this.MEDIA_SCRIPT, false, 2000);
      this._playing[panel] = { title: meta && meta.title ? String(meta.title) : '', artist: meta && meta.artist ? String(meta.artist) : '', at: now };
    } catch (err) {
      // The page may be loading; say it once per panel so a real fault is seen, not retried every sweep.
      if (!this._warned) this._warned = new Set();
      if (!this._warned.has(panel)) { this._warned.add(panel); window.VexProblems?.note('Panels', 'Could not read what ' + this.label(panel) + ' is playing', err); }
      this._playing[panel] = { title: '', artist: '', at: now };
    }
    return true;
  },

  // ---- what Autopilot says needs you ---------------------------------------------------------------
  // Autopilot's own stream (mail, GitHub, reminders, watched pages) counted for the strip: only
  // numbers and the top title are kept here, never read out of the mail. Refreshed at most every
  // AUTOPILOT_MS, and only while the strip is on, so the stream is not built for nothing.
  AUTOPILOT_MS: 120000,
  _ap: null,          // { now, today, at, top } of the last read
  _apBusy: false,
  async refreshAutopilot(now = this._now()) {
    const ap = globalThis.VexAutopilot;
    if (!ap || typeof ap.stream !== 'function') { this._ap = null; return null; }
    if (this._apBusy || (this._ap && now - this._ap.at < this.AUTOPILOT_MS)) return this._ap;
    this._apBusy = true;
    try {
      const g = await ap.stream({ now });
      const now_ = (g.now || []).length, today = (g.today || []).length;
      const first = (g.now || [])[0] || (g.today || [])[0];
      this._ap = { now: now_, today, at: now, top: first ? String(first.title || '') : '', problems: (g.problems || []).length };
    } finally { this._apBusy = false; }
    return this._ap;
  },
  autopilotState() { return this._ap && (this._ap.now || this._ap.today) ? this._ap : null; },
  describeAutopilot(a) {
    const bits = [];
    if (a.now) bits.push(a.now + ' need you now');
    if (a.today) bits.push(a.today + ' today');
    return bits.join(', ') + (a.top ? ' (' + a.top.slice(0, 60) + ')' : '');
  },

  // ---- one sweep (every PanelBadges sweep, 5 s) ---------------------------------------------------
  async tick(counts, now = this._now()) {
    if (!this.enabled()) return;
    this.noteCounts(counts, now);
    // Calls: remember when each began, forget it when it ends.
    const names = new Set([...Object.keys(counts || {}), ...Object.keys(this._callSince)]);
    for (const p of names) {
      if (this.inCall(p)) { if (!this._callSince[p]) this._callSince[p] = now; }
      else delete this._callSince[p];
    }
    // Sound: only a panel that is audible is looked into.
    const mgr = typeof SidebarManager !== 'undefined' ? SidebarManager : null;
    if (mgr && mgr.panelWebviews) {
      for (const p of Object.keys(mgr.panelWebviews)) await this._pollPlaying(p, mgr.panelWebviews[p], now);
      for (const p of Object.keys(this._playing)) if (!mgr.panelWebviews[p]) delete this._playing[p];
    }
    // Autopilot's count is refreshed only for the strip, and a failure is said, not swallowed.
    if (this.stripOn()) {
      try { await this.refreshAutopilot(now); }
      catch (err) { window.VexProblems?.note('Panels', 'Could not read what Autopilot says needs you', err); }
    }
    this.render();
  },

  // ---- drawing ------------------------------------------------------------------------------------
  _icon(panel) { return document.querySelector('.sidebar-icon[data-panel="' + (window.CSS && CSS.escape ? CSS.escape(panel) : panel) + '"]'); },
  _clearMarks() { document.querySelectorAll('.sidebar-icon > .icon-badge.ps-play').forEach(b => b.remove()); document.getElementById('panel-state-strip')?.remove(); },
  describe(s) {
    const bits = [];
    if (s.unread) bits.push(s.unread + ' unread' + (s.gained ? ', ' + s.gained + ' since you last looked' : ''));
    if (s.inCall) bits.push('in a call' + (s.callSince ? ' ' + this._clock(this._now() - s.callSince) : ''));
    if (s.playing) bits.push('playing ' + [s.playing.title, s.playing.artist].filter(Boolean).join(' - '));
    return bits.join('; ');
  },
  render() {
    if (typeof document === 'undefined') return;
    if (!this.enabled()) { this._clearMarks(); return; }
    // The small "playing" mark on a sidebar icon.
    document.querySelectorAll('.sidebar-icon[data-panel] > .icon-badge.ps-play').forEach(b => { if (!this._playing[b.parentElement.dataset.panel]) b.remove(); });
    for (const [panel, p] of Object.entries(this._playing)) {
      const btn = this._icon(panel);
      if (!btn) continue;
      let b = btn.querySelector(':scope > .icon-badge.ps-play');
      if (!b) { b = document.createElement('span'); b.className = 'icon-badge ps-play'; b.setAttribute('aria-hidden', 'true'); if (typeof VexIcons !== 'undefined') b.innerHTML = VexIcons.svg('music', { size: 10 }); btn.appendChild(b); }
      b.title = 'Playing ' + [p.title, p.artist].filter(Boolean).join(' - ');
    }
    // Their description for screen readers and the hover text, one line per panel.
    for (const s of this.panels()) { const btn = this._icon(s.panel); if (btn) btn.setAttribute('aria-description', this.describe(s)); }
    this._renderStrip();
  },
  _style() {
    if (document.getElementById('panel-state-style')) return;
    const st = document.createElement('style');
    st.id = 'panel-state-style';
    st.textContent = `
      .sidebar-icon > .icon-badge.ps-play { position:absolute; bottom:1px; right:1px; width:14px; height:14px; border-radius:50%; background:var(--primary, #4f8cff); color:var(--on-primary, #fff); display:flex; align-items:center; justify-content:center; pointer-events:none; }
      #panel-state-strip { position:fixed; left:12px; bottom:10px; z-index:900; display:flex; flex-wrap:wrap; gap:6px; max-width:min(70vw,720px); pointer-events:none; }
      #panel-state-strip button { pointer-events:auto; font-size:11.5px; color:var(--text); background:var(--bg); border:1px solid var(--border); border-radius:999px; padding:3px 10px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.18); }
      #panel-state-strip button:hover { border-color:var(--primary, #4f8cff); }
    `;
    document.head.appendChild(st);
  },
  _renderStrip() {
    let strip = document.getElementById('panel-state-strip');
    const items = this.stripOn() ? this.panels() : [];
    const ap = this.stripOn() ? this.autopilotState() : null;
    const quiet = typeof AttentionState !== 'undefined' && AttentionState.get().sources.some(x => x.id === 'game' || x.id === 'meeting');
    if ((!items.length && !ap) || quiet) { if (strip) strip.remove(); return; }
    this._style();
    if (!strip) { strip = document.createElement('div'); strip.id = 'panel-state-strip'; strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'Panel state'); document.body.appendChild(strip); }
    strip.textContent = '';
    if (ap) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Autopilot: ' + this.describeAutopilot(ap);
      b.title = 'Open Autopilot';
      b.addEventListener('click', () => {
        const a = globalThis.VexAutopilot;
        if (!a || typeof a.showPanel !== 'function') { window.VexProblems?.note('Panels', 'Autopilot is not available to open', new Error('VexAutopilot.showPanel is missing')); return; }
        a.showPanel().catch((err) => window.VexProblems?.note('Panels', 'Could not open Autopilot', err));
      });
      strip.appendChild(b);
    }
    for (const s of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = this.label(s.panel) + ': ' + this.describe(s);
      b.title = 'Open ' + this.label(s.panel);
      b.addEventListener('click', () => { try { SidebarManager.showPanel(s.panel); } catch (err) { window.VexProblems?.note('Panels', 'Could not open ' + this.label(s.panel), err); } });
      strip.appendChild(b);
    }
  },

  init() {
    if (this._wired || typeof window === 'undefined') return false;
    this._wired = true;
    window.addEventListener('vex:panel-unread', (e) => {
      this.tick((e.detail && e.detail.counts) || {}).catch((err) => {
        console.error('[PanelState] a sweep failed:', err);
        window.VexProblems?.note('Panels', 'The panel state could not be refreshed', err);
      });
    });
    // Opening a panel is "looking" at it.
    document.addEventListener('vex:panel-changed', (e) => {
      const d = e.detail || {};
      if (this.enabled()) { this.noteLooked(d.panel); if (d.beside) this.noteLooked(d.beside); }
    });
    document.addEventListener('vex:media-capture', (e) => { if (e.detail && e.detail.where === 'panel') this.render(); });
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.PanelState = PanelState;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => PanelState.init());
    else PanelState.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { PanelState };
