// === Why did Vex do that? ====================================================
//
// Everything Vex does by itself (sleeps a tab, groups tabs, files a download,
// changes the theme because the sun set, starts a focus block) writes one line
// here: what it did, why, and a token that says how to put it back. Ctrl+K
// "Why did that happen?" lists the last 50 with Undo and "Stop doing this".
//
//   VexLedger.note({ feature: 'tab-cleanup', what: 'Closed 3 idle tabs', why: 'They were unused for 14 days',
//                    undo: { kind: 'reopen-tabs', urls: [...] } });
//   VexLedger.registerUndo('reopen-tabs', async (token) => { ... });
//
// Differences from VexUndo (the 10-second toast): the token is plain data kept
// in storage (vex.ledger), so the offer survives the toast AND a restart; the
// code that carries it out is registered by the module under a `kind` name each
// time Vex starts. An undo whose kind nobody has registered (the feature is not
// in this build any more) says so instead of doing nothing.
//
// "Stop doing this" switches the feature off through VexRegistry, the same way
// the usage dashboard and the kill switch do.
//
// Only what Vex did on its own belongs here. Things you pressed a button for
// are your actions and keep their own Undo toast (js/vex-undo.js).
const VexLedger = {
  KEY: 'vex.ledger',
  MAX: 200,          // kept
  SHOW: 50,          // listed
  TOKEN_MAX: 4096,   // bytes of JSON in one undo token

  _entries: null,
  _undo: new Map(),
  _stop: new Map(),
  _listeners: [],
  _seq: 0,
  _now() { return Date.now(); },

  // ---- storage -------------------------------------------------------------
  _load() {
    if (this._entries) return this._entries;
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { console.error('[Ledger] the ledger could not be read:', err.message); }
    let list = [];
    if (raw) {
      try { const v = JSON.parse(raw); if (v && v.v === 1 && Array.isArray(v.entries)) list = v.entries.filter(e => this._valid(e)); else console.error('[Ledger] the ledger has an unknown shape and is started again'); }
      catch (err) { console.error('[Ledger] the ledger is not readable and is started again:', err.message); }
    }
    this._entries = list;
    this._seq = list.reduce((n, e) => Math.max(n, e.id), 0);
    return list;
  },
  _valid(e) {
    return e && Number.isInteger(e.id) && Number.isFinite(e.at) && typeof e.feature === 'string' && typeof e.what === 'string' && typeof e.why === 'string'
      && (e.undo == null || (typeof e.undo === 'object' && typeof e.undo.kind === 'string'));
  },
  _save() {
    try { localStorage.setItem(this.KEY, JSON.stringify({ v: 1, entries: this._entries })); return true; }
    catch (err) { console.error('[Ledger] the ledger could not be saved:', err.message); return false; }
  },
  _emit() {
    for (const fn of this._listeners.slice()) { try { fn(); } catch (err) { console.error('[Ledger] a listener failed:', err); } }
  },
  onChange(fn) { this._listeners.push(fn); },

  // ---- writing --------------------------------------------------------------
  // Throws for a line that is not complete: a bad call site is a bug to see.
  // stop: for an action whose feature has no switch in the registry, a token naming how
  // to stop it (registerStop); otherwise 'Stop doing this' goes through the registry.
  record({ feature, what, why, undo, stop } = {}) {
    const text = (v, name, max) => {
      if (typeof v !== 'string' || !v.trim()) throw new Error('A ledger line needs ' + name);
      return v.trim().slice(0, max);
    };
    const f = text(feature, 'the feature that did it', 64);
    const w = text(what, 'what it did', 200);
    const y = text(why, 'why', 300);
    let token = null;
    if (undo != null) {
      if (typeof undo !== 'object' || typeof undo.kind !== 'string' || !undo.kind) throw new Error('An undo token needs a kind');
      const json = JSON.stringify(undo);
      if (json.length > this.TOKEN_MAX) throw new Error('The undo token for "' + w + '" is too large to keep');
      token = JSON.parse(json);
    }
    let stopToken = null;
    if (stop != null) {
      if (typeof stop !== 'object' || typeof stop.kind !== 'string' || !stop.kind) throw new Error('A stop token needs a kind');
      const json = JSON.stringify(stop);
      if (json.length > this.TOKEN_MAX) throw new Error('The stop token for "' + w + '" is too large to keep');
      stopToken = JSON.parse(json);
    }
    const list = this._load();
    const entry = { id: ++this._seq, at: this._now(), feature: f, what: w, why: y, undo: token, stop: stopToken, undone: false, stopped: false };
    list.push(entry);
    if (list.length > this.MAX) list.splice(0, list.length - this.MAX);
    this._save();
    this._emit();
    return entry;
  },

  // For the places Vex acts on its own: a ledger problem is reported, and the
  // action it describes is never held up by it.
  note(line) {
    try { return this.record(line); }
    catch (err) {
      console.error('[Ledger] could not note "' + (line && line.what) + '":', err);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Ledger', 'Could not note what Vex did', err);
      return null;
    }
  },

  registerStop(kind, fn) {
    if (typeof kind !== 'string' || !kind) throw new Error('A stop kind needs a name');
    if (typeof fn !== 'function') throw new Error('Stop "' + kind + '" needs a function');
    this._stop.set(kind, fn);
  },

  registerUndo(kind, fn) {
    if (typeof kind !== 'string' || !kind) throw new Error('An undo kind needs a name');
    if (typeof fn !== 'function') throw new Error('Undo "' + kind + '" needs a function');
    this._undo.set(kind, fn);
  },

  // ---- reading --------------------------------------------------------------
  list(n = this.SHOW) { return this._load().slice(-n).reverse(); },
  get(id) { return this._load().find(e => e.id === id) || null; },
  canUndo(entry) { return !!entry && !!entry.undo && !entry.undone; },
  // Is there a way to stop the thing that did this: a switch in the registry, or a stop token.
  canStop(entry) {
    if (!entry || entry.stopped) return false;
    if (entry.stop) return true;
    const m = typeof VexRegistry !== 'undefined' ? VexRegistry.get(entry.feature) : null;
    return !!m && m.killSwitch === 'usage';
  },

  // ---- acting ---------------------------------------------------------------
  async undo(id) {
    const e = this.get(id);
    if (!e) throw new Error('That line is no longer in the ledger');
    if (!e.undo) throw new Error('"' + e.what + '" cannot be undone');
    if (e.undone) throw new Error('"' + e.what + '" was already undone');
    const fn = this._undo.get(e.undo.kind);
    if (!fn) throw new Error('Cannot undo "' + e.what + '": nothing in this build knows how (' + e.undo.kind + ')');
    await fn(e.undo, e);
    e.undone = true;
    e.undoneAt = this._now();
    this._save();
    this._emit();
    return e;
  },

  // Switch the feature that did this off, through the registry.
  async stopDoing(id) {
    const e = this.get(id);
    if (!e) throw new Error('That line is no longer in the ledger');
    if (e.stop) {
      const fn = this._stop.get(e.stop.kind);
      if (!fn) throw new Error('Cannot stop "' + e.what + '": nothing in this build knows how (' + e.stop.kind + ')');
      await fn(e.stop, e);
    } else {
      if (typeof VexRegistry === 'undefined') throw new Error('The feature registry is not loaded');
      if (!VexRegistry.has(e.feature)) throw new Error('"' + e.feature + '" is not a feature that can be switched off');
      await VexRegistry.switchOff(e.feature);
    }
    // Every line from that feature is now stopped, so the list says it once.
    for (const x of this._load()) if (x.feature === e.feature && !!x.stop === !!e.stop) x.stopped = true;
    this._save();
    this._emit();
    return e;
  },

  forget() {
    this._entries = [];
    this._save();
    this._emit();
  },

  _reset() { this._entries = null; this._undo.clear(); this._stop.clear(); this._listeners = []; this._seq = 0; },
};

if (typeof window !== 'undefined') window.VexLedger = VexLedger;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLedger };
