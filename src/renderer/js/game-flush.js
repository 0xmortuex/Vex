// === Flush drafts and sessions at game launch (T1-041) ======================
//
// A blue screen already happened while a game was running. A game is the one
// moment the machine is most likely to fall over, and the moment Vex is least
// likely to be looked at, so the instant a game (or its launcher) starts Vex
// writes down what a crash would otherwise lose:
//
//   session     the open tabs and groups, as the single replaceable
//               "Auto-saved" session (js/sessions.js), so a restart brings
//               the tabs back even if the profile never got to save them
//   notes       the note and sticky note being typed (js/notes-panel.js)
//   typed text  what is in plain text boxes of open pages, the scroll
//               positions (js/tab-snapshots.js: crash-proof tabs, with its own
//               rules about what it never takes)
//   storage     every setting and list still waiting in the write queue
//               (js/storage.js)
//
// It reads names of programs only (game state comes from the existing watch);
// it never touches the game. One run at most every 90 seconds, so a launcher
// that opens and closes does not write the profile in a loop. Each step that
// fails is reported (Problems and the ledger line), never skipped silently.
//
// Switch: Settings › Game mode › "Save my work when a game starts" (on).
const GameFlush = {
  KEY: 'vex.game.flush',            // 'off' turns it off
  LAST_KEY: 'vex.game.flush.last',  // { at, app, trigger, done:[...], failed:[...] }
  MIN_GAP_MS: 90000,

  _running: null,
  _lastAt: 0,

  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'on' : 'off'); return !!on; },

  last() {
    try { const v = JSON.parse(localStorage.getItem(this.LAST_KEY) || 'null'); return v && typeof v === 'object' ? v : null; }
    catch (err) { throw new Error('The last save before a game is not readable: ' + err.message, { cause: err }); }
  },

  _now() { return Date.now(); },
  _private() { return !!(typeof window !== 'undefined' && window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },

  // The steps. Each returns a short word for what it saved, or '' when there was
  // nothing to save (not a failure). A throw is a failure and is reported.
  steps() {
    return [
      ['session', async () => {
        if (this._private()) return '';   // a private window is never saved
        if (typeof SessionManager === 'undefined' || typeof TabManager === 'undefined' || !(TabManager.tabs || []).length) return '';
        SessionManager.saveCurrentSession('Auto-saved before a game ' + new Date().toLocaleString(), null, { auto: true });
        return 'the open tabs';
      }],
      ['notes', async () => {
        if (typeof NotesPanel === 'undefined') return '';
        let any = false;
        if (typeof NotesPanel._editorDirty === 'function' && NotesPanel._editorDirty()) any = true;
        if (typeof NotesPanel.flush === 'function') NotesPanel.flush();
        if (typeof NotesPanel._flushSticky === 'function') NotesPanel._flushSticky();
        return any ? 'the note being typed' : '';
      }],
      ['typed text', async () => {
        if (this._private() || typeof TabSnapshots === 'undefined' || !TabSnapshots.isOn()) return '';
        const r = await TabSnapshots.tick();
        return r && r.formsKept ? 'text typed into ' + r.formsKept + ' page box' + (r.formsKept === 1 ? '' : 'es') : (r ? 'scroll positions' : '');
      }],
      ['storage', async () => {
        if (typeof PersistentStorage === 'undefined' || typeof PersistentStorage._flush !== 'function') return '';
        await PersistentStorage._flush();
        return 'your settings and lists';
      }],
    ];
  },

  // → { ran, done:[word], failed:[{step, error}] }. { ran:false } when switched off or too soon.
  async run(trigger, app) {
    if (!this.enabled()) return { ran: false, why: 'off' };
    if (this._running) return this._running;
    const now = this._now();
    if (now - this._lastAt < this.MIN_GAP_MS) return { ran: false, why: 'recent' };
    this._lastAt = now;
    this._running = this._run(trigger, app).finally(() => { this._running = null; });
    return this._running;
  },

  async _run(trigger, app) {
    const done = [];
    const failed = [];
    for (const [name, step] of this.steps()) {
      try { const w = await step(); if (w) done.push(w); }
      catch (err) {
        failed.push({ step: name, error: (err && err.message) || String(err) });
        if (typeof VexProblems !== 'undefined') VexProblems.note('Game mode', 'Could not save ' + name + ' before the game', err);
      }
    }
    const record = { at: this._now(), app: String(app || ''), trigger: String(trigger || ''), done, failed };
    localStorage.setItem(this.LAST_KEY, JSON.stringify(record));
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({
        feature: 'game-flush',
        what: done.length ? 'Saved ' + done.join(', ') + (app ? ' before ' + app : ' before a game') : 'Checked for unsaved work before a game: none',
        why: (trigger === 'launcher' ? 'A game launcher opened' : 'A game started') + '; a crash or a blue screen would not lose it now' + (failed.length ? '. Could not save: ' + failed.map(f => f.step).join(', ') : ''),
      });
    }
    return { ran: true, done, failed };
  },

  // A game came up: on the first sight of it.
  onState(s) {
    if (!s) return;
    const key = s.game ? 'game:' + (s.id || s.app || '') : (s.launcher ? 'launcher:' + (s.launcherApp || '') : '');
    if (!key) { this._seen = ''; return; }
    if (key === this._seen) return;
    this._seen = key;
    this.run(s.game ? 'game' : 'launcher', s.game ? s.app : s.launcherApp)
      .catch(err => { if (typeof VexProblems !== 'undefined') VexProblems.note('Game mode', 'The save before a game failed', err); });
  },
};

if (typeof window !== 'undefined') window.GameFlush = GameFlush;
if (typeof module !== 'undefined' && module.exports) module.exports = { GameFlush };
