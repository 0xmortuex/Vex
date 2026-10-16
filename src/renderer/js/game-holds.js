// === Held while you played: every Vex message from a Game mode session, in one list ========
//
// The after-game pit stop (js/game-pitstop.js) counts what the Attention Budget refused. That
// leaves out most of what Vex says: a plain toast ("Saved", "Copied", an error) is shown
// straight away without asking the budget, and Windows notifications are held by the main
// process. While a game is on the screen none of that is seen, so none of it is lost track of.
// This keeps a short log of it and shows ONE list, "Held while you played":
//
//   the toasts Vex showed while Game mode was on      (js/app.js showToast -> noteToast)
//   the ones the Attention Budget refused             (VexAttention.denied(), reason "quiet")
//   the Windows notifications the main process held   (window.vex.attention.denied())
//   what waits in the Attention Inbox since the game began
//
// Nothing is changed about when a toast is shown, and nothing leaves this computer. The log
// lives in this window's storage, holds the last 200 messages of the latest session, and is
// emptied when the next game starts or when you clear it.
//
// Word rules ("community announcement text rules"): a few plain words you choose. An item
// that contains a FLAG word is put first and marked; one that contains a HIDE word is left out
// of the list (and counted, so it is not secret). They are plain substrings, case-insensitive:
// there are no patterns, so a rule cannot misbehave. Typical use: flag "maintenance" and
// "patch", hide "giveaway", so an announcement about the game you are in comes first.
const GameHolds = {
  ENABLED_KEY: 'vex.gameHolds.enabled',    // '0' = off
  LOG_KEY: 'vex.gameHolds.log',            // { start, end, items: [{ t, text, from, via }] }
  RULES_KEY: 'vex.gameHolds.rules',        // [{ word, mode: 'flag' | 'hide' }]
  FEATURE: 'game-holds',
  MAX_ITEMS: 200,
  MAX_RULES: 20,
  MAX_WORD: 40,
  DEDUPE_MS: 60 * 1000,

  enabled() { try { return localStorage.getItem(this.ENABLED_KEY) !== '0'; } catch (err) { console.error('[GameHolds] the switch could not be read:', err.message); return true; } },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? '1' : '0'); },

  _now() { return Date.now(); },

  // ---- the session log -------------------------------------------------------------
  _readLog() {
    const raw = localStorage.getItem(this.LOG_KEY);
    if (raw === null) return { start: 0, end: 0, items: [] };
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The held-while-playing log is not readable', { cause: err }); }
    if (!v || typeof v !== 'object' || !Array.isArray(v.items)) return { start: 0, end: 0, items: [] };
    return { start: Number(v.start) || 0, end: Number(v.end) || 0, items: v.items.filter(i => i && typeof i.text === 'string' && Number.isFinite(i.t)) };
  },
  _writeLog(log) { localStorage.setItem(this.LOG_KEY, JSON.stringify(log)); },
  log() { return this._readLog(); },
  clear() { localStorage.removeItem(this.LOG_KEY); },

  gameOn() {
    if (typeof AttentionState === 'undefined') return false;
    return AttentionState.get().sources.some(s => s.id === 'game');
  },

  // A game started or ended (vex:attention-state). A new game empties the log of the last one.
  onState() {
    if (!this.enabled()) return;
    const on = this.gameOn();
    const log = this._readLog();
    if (on && (!log.start || log.end)) { this._writeLog({ start: this._now(), end: 0, items: [] }); return; }
    if (!on && log.start && !log.end) { log.end = this._now(); this._writeLog(log); }
  },

  // Called by showToast for every toast. Only while Game mode is on; never throws into the toast.
  noteToast(message, type) {
    if (!this.enabled() || !this.gameOn()) return false;
    try {
      const text = String(message == null ? '' : message).replace(/\s+/g, ' ').trim().slice(0, 160);
      if (!text) return false;
      const log = this._readLog();
      if (!log.start || log.end) { log.start = this._now(); log.end = 0; log.items = []; }
      const now = this._now();
      if (log.items.some(i => i.text === text && now - i.t < this.DEDUPE_MS)) return false;
      log.items.push({ t: now, text, from: type === 'error' ? 'error' : 'Vex', via: 'toast' });
      while (log.items.length > this.MAX_ITEMS) log.items.shift();
      this._writeLog(log);
      return true;
    } catch (err) {
      // A toast must still show; the failure is recorded, not hidden.
      console.error('[GameHolds] could not note a toast:', err);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Game holds', 'Could not note a toast shown during a game', err);
      return false;
    }
  },

  // ---- the word rules --------------------------------------------------------------
  rules() {
    const raw = localStorage.getItem(this.RULES_KEY);
    if (raw === null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The word rules are not readable', { cause: err }); }
    return Array.isArray(v) ? v.filter(r => r && typeof r.word === 'string' && (r.mode === 'flag' || r.mode === 'hide')) : [];
  },
  addRule(word, mode) {
    const w = String(word == null ? '' : word).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!w) throw new Error('Type a word or a short phrase');
    if (w.length > this.MAX_WORD) throw new Error('A rule is at most ' + this.MAX_WORD + ' characters');
    if (mode !== 'flag' && mode !== 'hide') throw new Error('A rule flags or hides');
    const rules = this.rules();
    if (rules.some(r => r.word === w)) throw new Error('"' + w + '" already has a rule. Remove it first to change it.');
    if (rules.length >= this.MAX_RULES) throw new Error('At most ' + this.MAX_RULES + ' rules');
    rules.push({ word: w, mode });
    localStorage.setItem(this.RULES_KEY, JSON.stringify(rules));
    return rules;
  },
  removeRule(word) {
    const rules = this.rules().filter(r => r.word !== word);
    localStorage.setItem(this.RULES_KEY, JSON.stringify(rules));
    return rules;
  },
  // Pure. items: [{ text, ... }] -> { shown: [{ ...item, flag: 'word' | '' }], hidden: n }. A hide word wins over a flag word.
  applyRules(items, rules) {
    const shown = [];
    let hidden = 0;
    for (const it of items) {
      const hay = (String(it.text) + ' ' + String(it.from || '')).toLowerCase();
      if (rules.some(r => r.mode === 'hide' && hay.includes(r.word))) { hidden++; continue; }
      const f = rules.find(r => r.mode === 'flag' && hay.includes(r.word));
      shown.push({ ...it, flag: f ? f.word : '' });
    }
    shown.sort((a, b) => (b.flag ? 1 : 0) - (a.flag ? 1 : 0) || b.t - a.t);
    return { shown, hidden };
  },

  // ---- gathering everything held since the session began ------------------------------
  // -> [{ t, text, from, via, n }], newest first, one row per distinct message.
  async collect() {
    const log = this._readLog();
    const since = log.start;
    if (!since) return [];
    const out = log.items.map(i => ({ t: i.t, text: i.text, from: i.from, via: 'shown in Vex', n: 1 }));
    if (typeof VexAttention !== 'undefined') {
      for (const d of VexAttention.denied()) {
        if (d && d.t >= since && /^quiet/.test(String(d.reason || '')) && d.title) out.push({ t: d.t, text: String(d.title), from: d.feature, via: 'held back', n: d.n || 1 });
      }
    }
    const bridge = typeof window !== 'undefined' && window.vex && window.vex.attention;
    if (bridge && typeof bridge.denied === 'function') {
      const os = await bridge.denied();
      for (const d of Array.isArray(os) ? os : []) {
        if (d && d.t >= since && /^quiet/.test(String(d.reason || '')) && d.title) out.push({ t: d.t, text: String(d.title), from: d.feature, via: 'Windows notification', n: d.n || 1 });
      }
    }
    if (typeof AttentionInbox !== 'undefined' && typeof AttentionInbox.list === 'function') {
      for (const r of AttentionInbox.list()) if (r.ts >= since) out.push({ t: r.ts, text: String(r.title), from: r.label || r.feature, via: 'waiting in the Attention Inbox', n: 1 });
    }
    const seen = new Map();
    for (const it of out.sort((a, b) => b.t - a.t)) {
      const k = it.text + '|' + it.from;
      const prev = seen.get(k);
      if (prev) prev.n += it.n; else seen.set(k, { ...it });
    }
    return [...seen.values()];
  },

  _when(t, now = this._now()) {
    const m = Math.round((now - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
  },

  // ---- the list ----------------------------------------------------------------------------
  async open() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('Dialogs are not loaded');
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const log = this._readLog();
    const { body } = VexSettingsGroups.dialog({ id: 'vex-game-holds', title: 'Held while you played', sub: 'Everything Vex said while Game mode was on: toasts, held notices and Windows notifications.' });
    if (!log.start) { body.appendChild(VexSettingsGroups.note('No game session has been noted yet. Play with Game mode on and this list fills in.')); }
    const items = await this.collect();
    const { shown, hidden } = this.applyRules(items, this.rules());
    const head = document.createElement('div');
    head.className = 'vex-platform-note';
    head.textContent = log.start
      ? 'Session from ' + new Date(log.start).toLocaleString() + (log.end ? ' to ' + new Date(log.end).toLocaleTimeString() : ' (still on)') + '. ' + shown.length + ' shown' + (hidden ? ', ' + hidden + ' left out by your words' : '') + '.'
      : '';
    if (head.textContent) body.appendChild(head);
    const list = document.createElement('div');
    list.className = 'vexsr-list';
    for (const it of shown) {
      const row = document.createElement('div');
      row.className = 'vexsr-rule';
      const t = document.createElement('span'); t.className = 'vexsr-host'; t.style.wordBreak = 'normal';
      const a = document.createElement('div'); a.textContent = (it.flag ? '[' + it.flag + '] ' : '') + it.text + (it.n > 1 ? ' (x' + it.n + ')' : '');
      const b = document.createElement('div'); b.className = 'vexsr-mode'; b.textContent = it.from + ' - ' + it.via + ' - ' + this._when(it.t);
      t.append(a, b);
      row.appendChild(t);
      list.appendChild(row);
    }
    if (log.start && !shown.length) list.appendChild(VexSettingsGroups.note(hidden ? 'Everything was left out by your words.' : 'Nothing was held.'));
    body.appendChild(list);
    this._rulesUi(body);
    body.appendChild(VexSettingsGroups.button('Clear this list', async () => {
      if (await vexConfirm({ title: 'Clear the list?', message: 'This forgets the messages noted during the last game.', okLabel: 'Clear' })) { this.clear(); document.getElementById('vex-game-holds')?.remove(); }
    }));
  },

  _rulesUi(body) {
    const box = document.createElement('div');
    box.className = 'attention-list';
    const lab = document.createElement('div'); lab.className = 'setting-label'; lab.textContent = 'Your words (announcements and other text)';
    box.appendChild(lab);
    const redraw = () => { document.getElementById('vex-game-holds')?.remove(); this.open().catch(err => window.showToast?.(err.message, 'error')); };
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    for (const r of this.rules()) {
      const line = document.createElement('div'); line.className = 'setting-row';
      const s = document.createElement('span'); s.textContent = (r.mode === 'flag' ? 'Put first: ' : 'Leave out: ') + r.word;
      line.appendChild(s);
      line.appendChild(VexSettingsGroups.button('Remove', () => { try { this.removeRule(r.word); redraw(); } catch (err) { fail(err); } }));
      box.appendChild(line);
    }
    for (const mode of ['flag', 'hide']) {
      box.appendChild(VexSettingsGroups.button(mode === 'flag' ? 'Put a word first' : 'Leave a word out', async () => {
        const w = await vexPrompt({ title: mode === 'flag' ? 'Put items with this word first' : 'Leave out items with this word', label: 'A word or short phrase (not a pattern)', value: '', okLabel: 'Add' });
        if (w == null) return;
        try { this.addRule(w, mode); redraw(); } catch (err) { fail(err); }
      }));
    }
    body.appendChild(box);
  },

  init() {
    if (this._wired || typeof document === 'undefined') return false;
    this._wired = true;
    document.addEventListener('vex:attention-state', () => { try { this.onState(); } catch (err) { console.error('[GameHolds]', err); } });
    this.onState();
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('While Game mode is on, Vex notes every toast it shows, and lists them with what the Attention Budget held back and what Windows notifications were held. Open the list from the after-game card or with Ctrl+K, "Held while you played". It stays on this computer.'));
    const row = document.createElement('label');
    row.className = 'setting-toggle-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.enabled();
    cb.addEventListener('change', () => this.setEnabled(cb.checked));
    row.append(cb, document.createTextNode(' Note the toasts shown during Game mode'));
    el.appendChild(row);
    el.appendChild(VexSettingsGroups.button('Open the list', () => this.open().catch(err => window.showToast?.(err.message, 'error')), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.GameHolds = GameHolds;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'game-holds', title: 'Held while you played', keywords: 'game mode toasts notifications held list announcements words', before: 'about', build: (el) => GameHolds.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'game-holds', label: 'Held while you played', hint: 'Every toast and notice Vex held or showed while Game mode was on', icon: 'gamepad', action: () => GameHolds.open().catch(err => window.showToast?.(err.message, 'error')) });
  }
  GameHolds.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { GameHolds };
