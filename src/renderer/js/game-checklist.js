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
// Items can repeat daily ("homework" is done again tomorrow). Nothing here is
// sent anywhere; the list is a setting on this computer.
const GameChecklist = {
  ON_KEY: 'vex.game.checklist',            // 'on' when you turned it on; anything else is off
  ITEMS_KEY: 'vex.game.checklist.items',   // [{ id, text, done, repeat:'daily'|'', doneOn:'YYYY-MM-DD' }]
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
    if (!s || !this.enabled()) return false;
    const key = s.game ? (s.listed ? 'game:' + (s.id || s.app) : '') : (s.launcher ? 'launcher:' + (s.launcherApp || '') : '');
    if (!key) { if (!s.game) this._seen = ''; return false; }
    if (key === this._seen) return false;
    this._seen = key;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return false;
    if (Date.now() - this._shownAt < this.GAP_MS) return false;
    const pending = this.pending();
    const bad = this.checks().filter(c => !c.ok);
    if (!pending.length && !bad.length) return false;
    this._shownAt = Date.now();
    this.deliver(s.game ? (s.app || 'your game') : (s.launcherApp || 'a launcher'));
    return true;
  },

  deliver(app) {
    if (typeof VexAttention === 'undefined') { this.show(app); return 'shown'; }
    const n = this.pending().length;
    const d = VexAttention.request({ feature: 'game-checklist', urgency: 'useful', id: String(Date.now()), title: 'Before you play' + (app ? ' ' + app : ''), body: n ? n + ' thing' + (n === 1 ? '' : 's') + ' on your list' : 'Something to look at first', action: { label: 'Open', key: 'open' }, label: 'Pre-game checklist' });
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
      #game-checklist button.gc-primary { background:var(--primary, #4f8cff); color:#fff; border-color:transparent; }
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
