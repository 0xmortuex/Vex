// === Pre-game checklist and homework gate (T1-023) ===========================
//
// Opt-in, and OFF until you turn it on. You write a short list of things that
// should be done before you play (homework, a chore, a reminder to yourself);
// when a game launcher opens or a game from your Game mode list starts, one
// small card shows the list, plus two things Vex can see for itself:
//
//   a note you were typing that is not saved yet   (it is saved for you too)
//   downloads that are still running
//
// What it is NOT: it never blocks anything, never closes or delays a game, never
// touches a game or another program, and has no lock, no timer and no penalty.
// The card is an ordinary card in Vex's own window, and "Play anyway" (or just
// ignoring it) is always the whole of the choice. A card shown while the game is
// already running waits in the Attention Inbox instead (Game mode quiets Vex).
//
// Items can repeat daily ("homework" is done again tomorrow). The list is a
// setting on this computer and goes nowhere.
//
// Two more things are opt-in, each with its own switch (both off):
//
//   "Patched yesterday, servers OK"   the card says whether the game's patch notes
//       page (patch radar) changed in the last three days, and what the status pages
//       you listed under "Is it me or the game?" say right now. The status read is
//       the same public, read-only one that feature makes; nothing of yours is sent
//       and no game server is contacted. The card never waits for it.
//   "Study earns game minutes"   your study time today (the study ledger) is turned
//       into game minutes at the ratio you set, set against the minutes you played
//       today (counted from the game state Vex already has). It is a number on the
//       card. It locks nothing and blocks nothing: "Play anyway" stays the whole choice.
const GameChecklist = {
  ON_KEY: 'vex.game.checklist',            // 'on' when you turned it on; anything else is off
  ITEMS_KEY: 'vex.game.checklist.items',   // [{ id, text, done, repeat:'daily'|'', doneOn:'YYYY-MM-DD' }]
  NEWS_KEY: 'vex.game.checklist.news',     // 'on': the patch + server line on the card
  EARN_KEY: 'vex.game.checklist.earn',     // { on, ratio, played: { 'YYYY-MM-DD': minutes } }
  PATCH_DAYS: 3,
  RATIO_MAX: 10,
  MAX_ITEMS: 20,
  MAX_TEXT: 120,
  GAP_MS: 30 * 60 * 1000,                  // the card does not come back within half an hour

  _ui: null,
  _shownAt: 0,
  _seen: '',

  enabled() { try { return localStorage.getItem(this.ON_KEY) === 'on'; } catch { return false; } },
  setEnabled(on) { localStorage.setItem(this.ON_KEY, on ? 'on' : 'off'); if (!on) this.hide(); return !!on; },

  _today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  _note(what, err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Game mode', what, err); },

  // ---- the list ----------------------------------------------------------------------
  _raw() {
    let raw = null;
    try { raw = localStorage.getItem(this.ITEMS_KEY); } catch (err) { throw new Error('The checklist could not be read: ' + err.message, { cause: err }); }
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved checklist is not readable: ' + err.message, { cause: err }); }
    return Array.isArray(v) ? v.filter(i => i && typeof i.id === 'string' && typeof i.text === 'string') : [];
  },
  // A daily item that was ticked on another day is not ticked today.
  items() {
    const today = this._today();
    return this._raw().map(i => ({ id: i.id, text: i.text, repeat: i.repeat === 'daily' ? 'daily' : '', done: i.done === true && (i.repeat !== 'daily' || i.doneOn === today), doneOn: i.doneOn || '' }));
  },
  _save(list) { localStorage.setItem(this.ITEMS_KEY, JSON.stringify(list)); },
  addItem(text, { daily = false } = {}) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, this.MAX_TEXT);
    if (!t) throw new Error('Type what should be done before you play');
    const list = this._raw();
    if (list.length >= this.MAX_ITEMS) throw new Error('The checklist is full (' + this.MAX_ITEMS + ' items)');
    const item = { id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: t, repeat: daily ? 'daily' : '', done: false, doneOn: '' };
    list.push(item);
    this._save(list);
    return item;
  },
  removeItem(id) {
    const list = this._raw();
    if (!list.some(i => i.id === id)) throw new Error('That item is not in the checklist');
    this._save(list.filter(i => i.id !== id));
  },
  setDone(id, done) {
    const list = this._raw();
    const it = list.find(i => i.id === id);
    if (!it) throw new Error('That item is not in the checklist');
    it.done = !!done;
    it.doneOn = done ? this._today() : '';
    this._save(list);
    return it;
  },
  pending() { return this.items().filter(i => !i.done); },

  // ---- study minutes earn game minutes (opt-in) ----------------------------------------------
  earn() {
    let raw = null;
    try { raw = localStorage.getItem(this.EARN_KEY); } catch (err) { throw new Error('The study-for-game-time setting could not be read: ' + err.message, { cause: err }); }
    if (raw == null) return { on: false, ratio: 1, played: {} };
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved study-for-game-time setting is not readable: ' + err.message, { cause: err }); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('The saved study-for-game-time setting is not readable');
    const ratio = Number(v.ratio);
    const played = v.played && typeof v.played === 'object' && !Array.isArray(v.played) ? v.played : {};
    return { on: v.on === true, ratio: ratio > 0 && ratio <= this.RATIO_MAX ? ratio : 1, played };
  },
  setEarn({ on, ratio } = {}) {
    const e = this.earn();
    if (on !== undefined) e.on = !!on;
    if (ratio !== undefined) {
      const r = Number(ratio);
      if (!(r > 0 && r <= this.RATIO_MAX)) throw new Error('Game minutes per study minute: a number above 0, up to ' + this.RATIO_MAX);
      e.ratio = Math.round(r * 100) / 100;
    }
    localStorage.setItem(this.EARN_KEY, JSON.stringify(e));
    return e;
  },
  // A game ran from `start` to `end` (ms): add the minutes to the day it started on.
  _addPlayed(start, end) {
    const min = Math.round((end - start) / 60000);
    if (min < 1) return 0;
    const e = this.earn();
    const d = new Date(start);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    e.played[key] = (Number(e.played[key]) || 0) + min;
    const keep = Object.keys(e.played).sort().slice(-14);
    e.played = Object.fromEntries(keep.map(k => [k, e.played[k]]));
    localStorage.setItem(this.EARN_KEY, JSON.stringify(e));
    return min;
  },
  // → { ok, text }, or null when the setting is off.
  earnedLine(now = Date.now()) {
    const e = this.earn();
    if (!e.on) return null;
    if (typeof VexStudyLedger === 'undefined' || typeof VexStudyLedger.minutesBetween !== 'function') return { ok: false, text: 'Study minutes cannot be counted in this window' };
    if (!VexStudyLedger.enabled()) return { ok: false, text: 'Study minutes are not being counted: switch on the study ledger to earn game time' };
    const d = new Date(now);
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const studied = VexStudyLedger.minutesBetween(from, from + 86400000);
    const earned = Math.floor(studied * e.ratio);
    const played = Number(e.played[this._today()]) || 0;
    const left = earned - played;
    return { ok: left >= 0, studied, earned, played, left, text: studied + ' min of study earned ' + earned + ' min of game time today; you have played ' + played + ' min' + (left >= 0 ? ', ' + left + ' min left' : ', ' + (-left) + ' min over') };
  },

  // ---- patched yesterday, servers OK (opt-in) ---------------------------------------------------
  newsOn() { try { return localStorage.getItem(this.NEWS_KEY) === 'on'; } catch { return false; } },
  setNews(on) { localStorage.setItem(this.NEWS_KEY, on ? 'on' : 'off'); return !!on; },
  // The newest patch-notes change for a listed game within PATCH_DAYS, or null.
  patchLine(gameId, now = Date.now()) {
    if (!gameId || typeof PatchRadar === 'undefined' || typeof PatchRadar.pages !== 'function') return null;
    const pages = PatchRadar.pages(gameId).filter(p => p.changedAt > 0);
    if (!pages.length) return null;
    const newest = pages.reduce((a, b) => (b.changedAt > a.changedAt ? b : a));
    const day = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    const ago = Math.round((day(now) - day(newest.changedAt)) / 86400000);
    if (ago < 0 || ago >= this.PATCH_DAYS) return null;
    const when = ago === 0 ? 'today' : ago === 1 ? 'yesterday' : ago + ' days ago';
    return { id: 'patch', ok: true, text: 'Patch notes changed ' + when + (newest.latest ? ': ' + String(newest.latest).slice(0, 80) : '') };
  },
  // The services you listed under "Is it me or the game?", read now.
  async serverLine() {
    if (typeof VexServiceCheck === 'undefined' || !VexServiceCheck.enabled()) return null;
    if (!VexServiceCheck.pages().length) return null;
    let results;
    try { results = await VexServiceCheck.fetchStatus(); }
    catch (err) { this._note('The status pages could not be read for the checklist', err); return { id: 'servers', ok: false, text: 'Server status could not be read: ' + err.message }; }
    const bad = VexServiceCheck.incidents(results);
    if (bad.length) return { id: 'servers', ok: false, text: bad.map(r => (r.name || r.host) + ': ' + (r.description || r.indicator)).join('; ') };
    const unread = results.filter(r => !r.ok).length;
    if (unread === results.length) return { id: 'servers', ok: false, text: 'No status page could be read' };
    return { id: 'servers', ok: true, text: 'Servers OK' + (unread ? ' (' + unread + ' page' + (unread === 1 ? '' : 's') + ' unreadable)' : '') };
  },

  // ---- what Vex can see itself ------------------------------------------------------------
  // → [{ id, ok, text }]. A check that cannot be made is left out, not reported as fine.
  checks() {
    const out = [];
    if (typeof NotesPanel !== 'undefined' && typeof NotesPanel._editorDirty === 'function') {
      const dirty = !!NotesPanel._editorDirty();
      if (dirty) { try { NotesPanel.flush(); } catch (err) { this._note('Could not save the note being typed', err); } }
      out.push({ id: 'draft', ok: true, text: dirty ? 'A note you were typing was not saved: it has been saved now' : 'No unsaved note' });
    }
    if (typeof DownloadsPanel !== 'undefined' && Array.isArray(DownloadsPanel.downloads)) {
      const n = DownloadsPanel.downloads.filter(d => d && d.state === 'progressing').length;
      out.push({ id: 'downloads', ok: n === 0, text: n ? n + ' download' + (n === 1 ? ' is' : 's are') + ' still running' : 'No downloads running' });
    }
    return out;
  },

  // ---- when to show --------------------------------------------------------------------------
  // The newest game:state: a launcher opening, or a listed game starting.
  onState(s) {
    if (!s) return false;
    // Minutes played, for "study earns game minutes": counted only while that is on.
    if (s.game && !this._playStart) this._playStart = Date.now();
    else if (!s.game && this._playStart) {
      const started = this._playStart;
      this._playStart = 0;
      if (this.earn().on) this._addPlayed(started, Date.now());
    }
    if (!this.enabled()) return false;
    const key = s.game ? (s.listed ? 'game:' + (s.id || s.app) : '') : (s.launcher ? 'launcher:' + (s.launcherApp || '') : '');
    if (!key) { if (!s.game) this._seen = ''; return false; }
    if (key === this._seen) return false;
    this._seen = key;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return false;
    if (Date.now() - this._shownAt < this.GAP_MS) return false;
    const gameId = s.game && s.listed ? String(s.id || '') : '';
    const pending = this.pending();
    const bad = this.checks().filter(c => !c.ok);
    const news = this.newsOn() && !!this.patchLine(gameId);
    const earn = this.earn().on;
    if (!pending.length && !bad.length && !news && !earn) return false;
    this._shownAt = Date.now();
    this._gameId = gameId;
    this.deliver(s.game ? (s.app || 'your game') : (s.launcherApp || 'a launcher'));
    return true;
  },

  deliver(app) {
    if (typeof VexAttention === 'undefined') { this.show(app); return 'shown'; }
    const n = this.pending().length;
    const d = VexAttention.request({ feature: 'game-checklist', urgency: 'useful', id: String(Date.now()), title: 'Before you play' + (app ? ' ' + app : ''), body: n ? n + ' thing' + VexPlural.s(n) + ' on your list' : 'Something to look at first', action: { label: 'Open', key: 'open' }, label: 'Pre-game checklist' });
    if (d.route === 'toast') { this.show(app); return 'shown'; }
    return d.route;
  },

  // ---- the card ----------------------------------------------------------------------------------
  _style() {
    if (document.getElementById('game-checklist-style')) return;
    const st = document.createElement('style');
    st.id = 'game-checklist-style';
    st.textContent = `
      #game-checklist { position:fixed; z-index:9100; right:14px; bottom:14px; width:min(360px,92vw); max-height:min(80vh,520px); overflow:auto; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:12px; box-shadow:0 14px 40px var(--vex-shadow-color, rgba(0,0,0,.28)); padding:12px 14px; font-size:12.5px; }
      #game-checklist h2 { margin:0 0 6px; font-size:14px; font-weight:650; display:flex; align-items:center; gap:8px; }
      #game-checklist label { display:flex; gap:8px; align-items:center; padding:4px 0; cursor:pointer; }
      #game-checklist .gc-check { color:var(--text-muted); font-size:11.5px; padding:2px 0; }
      #game-checklist .gc-btns { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
      #game-checklist button { font-size:12px; color:var(--text); background:none; border:1px solid var(--border); border-radius:6px; padding:4px 10px; cursor:pointer; }
      #game-checklist button.gc-primary { background:var(--primary, #4f8cff); color:var(--on-primary, #fff); border-color:transparent; }
    `;
    document.head.appendChild(st);
  },

  hide() {
    if (!this._ui) return;
    this._ui.remove();
    this._ui = null;
    document.removeEventListener('keydown', this._onKey, true);
  },

  show(app) {
    if (typeof document === 'undefined') return null;
    this.hide();
    this._style();
    const root = document.createElement('div');
    root.id = 'game-checklist';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Before you play');
    const add = (parent, tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; parent.appendChild(el); return el; };
    const h = add(root, 'h2');
    const ic = add(h, 'span');
    if (window.VexIcons) ic.innerHTML = VexIcons.svg('gamepad', { size: 16 });
    add(h, 'span', null, 'Before you play' + (app ? ' ' + app : ''));
    const items = this.items();
    for (const it of items) {
      const lab = add(root, 'label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = it.done;
      box.setAttribute('aria-label', it.text);
      box.addEventListener('change', () => { try { this.setDone(it.id, box.checked); } catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); } });
      lab.appendChild(box);
      add(lab, 'span', null, it.text);
    }
    if (!items.length) add(root, 'div', 'gc-check', 'Your list is empty. Add things to it in Settings › Game mode.');
    for (const c of this.checks()) add(root, 'div', 'gc-check', (c.ok ? 'Fine: ' : 'Look at: ') + c.text);
    // Study minutes against game minutes, and the patch and server line: each only when switched on.
    const line = (c) => add(root, 'div', 'gc-check', (c.ok ? 'Fine: ' : 'Look at: ') + c.text);
    try {
      const earned = this.earnedLine();
      if (earned) line(earned);
    } catch (err) { this._note('The study and game time line could not be made', err); add(root, 'div', 'gc-check', 'Look at: ' + err.message); }
    if (this.newsOn()) {
      const patch = this.patchLine(this._gameId);
      if (patch) line(patch);
      const wait = add(root, 'div', 'gc-check', 'Reading the status pages...');
      this.serverLine().then((c) => { if (c) { wait.textContent = (c.ok ? 'Fine: ' : 'Look at: ') + c.text; } else wait.remove(); })
        .catch((err) => { this._note('The server line failed', err); wait.textContent = 'Look at: ' + err.message; });
    }
    const btns = add(root, 'div', 'gc-btns');
    // "Play anyway" never depends on the list: it only puts the card away.
    const go = add(btns, 'button', 'gc-primary', 'Play anyway');
    go.type = 'button';
    go.addEventListener('click', () => this.hide());
    if (typeof SettingsUI !== 'undefined' && typeof SettingsUI.openSection === 'function') {
      const ed = add(btns, 'button', null, 'Edit the list');
      ed.type = 'button';
      ed.addEventListener('click', () => { this.hide(); SettingsUI.openSection('setting-game-helpers'); });
    }
    document.body.appendChild(root);
    if (typeof VexLayer !== 'undefined') VexLayer.track(root, { tier: 'panel', id: 'game-checklist', keep: true });
    this._ui = root;
    this._onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) this.hide(); };
    document.addEventListener('keydown', this._onKey, true);
    return root;
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle('game-checklist', (key) => { if (key === 'open') return this.show(''); throw new Error('Unknown checklist action ' + key); });
    return true;
  },
};

if (typeof window !== 'undefined') window.GameChecklist = GameChecklist;
if (typeof module !== 'undefined' && module.exports) module.exports = { GameChecklist };
