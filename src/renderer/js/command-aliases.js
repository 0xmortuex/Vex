// === Shortcut words for the command bar =====================================
//
// "pr" opens the PR desk. A word you type into Ctrl+K and always finish by
// picking the same command becomes that command's shortcut: after you have
// done it a few times (3 by default) Vex makes the word an alias, says so, and
// from then on the command is the first result for that word. You can also
// make one yourself, change where one goes, or delete any of them in Settings.
//
// What is kept is on this computer only (localStorage, never synced): the
// words you typed that ended in a command, and how many times. Nothing about
// results that were not commands (Go to, Search, tabs, tools) is kept, and a
// shortcut you delete is remembered as unwanted so it is not learned again.
//
// The command bar reaches this file in two places (js/command.js): after it
// has ranked its results, apply() puts the aliased command first, and when a
// result is run, learn() is told which word was typed.
const VexAliases = {
  KEY: 'vex.commandAliases',
  PREFS_KEY: 'vex.commandAliases.prefs',
  MAX_ALIASES: 100,
  MAX_TYPED: 150,
  NAME: /^[a-z0-9][a-z0-9._-]{0,15}$/,
  DEFAULT_PREFS: { enabled: true, learn: true, threshold: 3 },
  // Rows that are not commands, however they were picked.
  NOT_COMMANDS: new Set(['url', 'search', 'calc']),

  // ---- preferences ----
  cleanPrefs(p) {
    const d = this.DEFAULT_PREFS;
    const o = (p && typeof p === 'object') ? p : {};
    const t = Math.round(Number(o.threshold));
    return {
      enabled: o.enabled === undefined ? d.enabled : o.enabled === true,
      learn: o.learn === undefined ? d.learn : o.learn === true,
      threshold: Number.isFinite(t) ? Math.min(10, Math.max(2, t)) : d.threshold,
    };
  },
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREFS_KEY) || 'null'); } catch { raw = null; }
    return this.cleanPrefs(raw);
  },
  savePrefs(p) {
    const clean = this.cleanPrefs({ ...this.prefs(), ...p });
    localStorage.setItem(this.PREFS_KEY, JSON.stringify(clean));
    return clean;
  },

  // ---- the store ----
  // { aliases: { word: { id, auto, at } }, typed: { word: { commandId: { n, at } } }, blocked: [word] }
  all() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || '{}'); }
    catch (err) { throw new Error('Your command shortcuts could not be read', { cause: err }); }
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    return { aliases: obj(o.aliases), typed: obj(o.typed), blocked: Array.isArray(o.blocked) ? o.blocked.filter(w => typeof w === 'string').slice(-200) : [] };
  },
  _save(s) { localStorage.setItem(this.KEY, JSON.stringify(s)); },

  normalize(word) { return String(word == null ? '' : word).trim().toLowerCase(); },

  // The commands a word may point at, by id and by what they are called.
  _commands() { return (typeof CommandBar !== 'undefined' && CommandBar.commands) ? CommandBar.commands : []; },
  _labelOf(c) { try { return String(c.label || c.id); } catch { return String(c.id); } },
  commandFor(text, commands) {
    const t = this.normalize(text);
    if (!t) return null;
    const list = commands || this._commands();
    return list.find(c => c.id.toLowerCase() === t)
      || list.find(c => this._labelOf(c).toLowerCase() === t)
      || null;
  },

  // The word cleaned, or an Error that says what is wrong with it.
  check(word, commandId, commands) {
    const w = this.normalize(word);
    if (!this.NAME.test(w)) throw new Error('A shortcut word is 1 to 16 letters, digits, dots or dashes, with no spaces');
    const list = commands || this._commands();
    const target = list.find(c => c.id === commandId);
    if (!target) throw new Error('There is no command called "' + commandId + '"');
    // A word that is already another command's own name would hide it.
    const clash = list.find(c => c.id !== commandId && (c.id.toLowerCase() === w || this._labelOf(c).toLowerCase() === w));
    if (clash) throw new Error('"' + w + '" is already the name of "' + this._labelOf(clash) + '"');
    return w;
  },

  // ---- the aliases ----
  list(commands) {
    const s = this.all();
    const cmds = commands || this._commands();
    return Object.entries(s.aliases).map(([word, a]) => {
      const c = cmds.find(x => x.id === a.id);
      return { word, id: a.id, label: c ? this._labelOf(c) : a.id, missing: !c, auto: !!a.auto, at: a.at || 0 };
    }).sort((a, b) => a.word.localeCompare(b.word));
  },

  set(word, commandId, opts, commands) {
    const w = this.check(word, commandId, commands);
    const s = this.all();
    if (!s.aliases[w] && Object.keys(s.aliases).length >= this.MAX_ALIASES) throw new Error('At most ' + this.MAX_ALIASES + ' shortcut words — delete one first');
    s.aliases[w] = { id: commandId, auto: !!(opts && opts.auto), at: (opts && opts.now) || Date.now() };
    s.blocked = s.blocked.filter(b => b !== w);
    this._save(s);
    return w;
  },

  // A learned word that is deleted is not learned again; one you made is simply gone.
  remove(word) {
    const w = this.normalize(word);
    const s = this.all();
    const was = s.aliases[w];
    if (!was) return false;
    delete s.aliases[w];
    delete s.typed[w];
    if (was.auto && !s.blocked.includes(w)) s.blocked.push(w);
    this._save(s);
    return was;
  },

  // The learned counts and the blocked words, to start again. Words you made stay.
  forgetLearned() {
    const s = this.all();
    let n = 0;
    for (const [w, a] of Object.entries(s.aliases)) if (a.auto) { delete s.aliases[w]; n++; }
    s.typed = {};
    s.blocked = [];
    this._save(s);
    return n;
  },

  // Shortcuts that installed Vex Packs offer (js/packs-consumers.js). Kept in
  // memory only: never written into the person's own list, and gone when the
  // pack is switched off or removed. The person's own word always wins.
  _pack: new Map(),
  setPackEntries(list) {
    const m = new Map();
    for (const e of Array.isArray(list) ? list : []) {
      const w = this.normalize(e && e.word);
      if (!this.NAME.test(w) || typeof e.command !== 'string' || !e.command || m.has(w)) continue;
      m.set(w, e.command);
    }
    this._pack = m;
    return m.size;
  },

  lookup(word) {
    if (!this.prefs().enabled) return null;
    const w = this.normalize(word);
    const a = this.all().aliases[w];
    if (a) return a.id;
    return this._pack.get(w) || null;
  },

  // ---- the command bar's two calls ----
  // `results` after ranking; the aliased command goes first, once.
  apply(q, results, commands, shown) {
    const w = this.normalize(q);
    if (!w || !this.NAME.test(w)) return results;
    const id = this.lookup(w);
    if (!id) return results;
    const c = (commands || this._commands()).find(x => x.id === id);
    if (!c || (typeof shown === 'function' && !shown(c))) return results;
    const rest = results.filter(r => !(r && r.id === id));
    // A copy: the command keeps its own hint everywhere else.
    const first = Object.create(c, {
      hint: { value: 'Your shortcut "' + w + '"', enumerable: true },
    });
    return [first, ...rest];
  },

  // `typed` is what was in the box when `item` was run; `index` the row it was.
  learn(typed, item, commands, index) {
    if (!this.prefs().learn) return null;
    const w = this.normalize(typed);
    if (!this.NAME.test(w) || !item || !item.id || this.NOT_COMMANDS.has(item.id)) return null;
    const cmds = commands || this._commands();
    const c = cmds.find(x => x.id === item.id);
    if (!c) return null;
    const s = this.all();
    if (s.blocked.includes(w)) return null;
    // Picked as the first row, it needed no shortcut — and one that already
    // exists did its job.
    if (index === 0 && !s.aliases[w]) return null;
    // A word that is another command's name is not a shortcut for this one.
    if (cmds.some(x => x.id !== c.id && (x.id.toLowerCase() === w || this._labelOf(x).toLowerCase() === w))) return null;
    const now = Date.now();
    const row = s.typed[w] || (s.typed[w] = {});
    const e = row[c.id] || (row[c.id] = { n: 0, at: 0 });
    e.n = Math.min(999, e.n + 1);
    e.at = now;
    const words = Object.keys(s.typed);
    if (words.length > this.MAX_TYPED) {
      const last = (k) => Math.max(0, ...Object.values(s.typed[k]).map(x => x.at || 0));
      words.sort((a, b) => last(a) - last(b)).slice(0, words.length - this.MAX_TYPED).forEach(k => delete s.typed[k]);
    }
    let learned = null;
    const here = s.aliases[w];
    const need = this.prefs().threshold;
    if (!here && e.n >= need && Object.keys(s.aliases).length < this.MAX_ALIASES) {
      s.aliases[w] = { id: c.id, auto: true, at: now };
      learned = { word: w, id: c.id, label: this._labelOf(c) };
    } else if (here && here.auto && here.id !== c.id && e.n >= need && e.n > ((row[here.id] || {}).n || 0)) {
      // You now pick something else for this word more often than the old one.
      s.aliases[w] = { id: c.id, auto: true, at: now };
      learned = { word: w, id: c.id, label: this._labelOf(c), retargeted: true };
    }
    this._save(s);
    if (learned) this._told(learned);
    return learned;
  },

  _told(l) {
    if (typeof window === 'undefined' || typeof window.showToast !== 'function') return;
    const text = 'Shortcut learned: type "' + l.word + '" to get ' + l.label;
    const extra = {
      action: { label: 'Undo', title: 'Forget the shortcut word "' + l.word + '"', run: () => { try { this.remove(l.word); } catch (err) { window.showToast('That could not be undone: ' + err.message, 'error'); } } },
    };
    // Learned without being asked, so it goes through the attention gate.
    if (typeof VexAttention !== 'undefined') VexAttention.toast({ feature: 'command-aliases', urgency: 'ambient', id: l.word }, text, 'info', 7000, extra);
    else window.showToast(text, 'info', 7000, extra);
  },

  // ---- commands and the Settings group ----
  async addInteractively() {
    const w = await window.vexPrompt({ title: 'New shortcut word', message: 'The word you will type into Ctrl+K, 1 to 16 letters or digits.', label: 'Shortcut word', okLabel: 'Next' });
    if (w == null) return null;
    const name = await window.vexPrompt({ title: 'Which command?', message: 'The name of the command "' + this.normalize(w) + '" should run, as it appears in Ctrl+K.', label: 'Command', okLabel: 'Make shortcut' });
    if (name == null) return null;
    return this._make(w, name);
  },

  _make(word, commandName) {
    const c = this.commandFor(commandName);
    if (!c) throw new Error('There is no command called "' + String(commandName).trim() + '" — type it as it appears in Ctrl+K');
    const w = this.set(word, c.id, { auto: false });
    return { word: w, id: c.id, label: this._labelOf(c) };
  },

  register() {
    if (typeof CommandBar === 'undefined' || !CommandBar.commands) return;
    if (CommandBar.commands.some(c => c.id === 'alias-add')) return;
    CommandBar.commands.push(
      { id: 'alias-add', label: 'Make a Shortcut Word for a Command…', hint: 'A short word you type into Ctrl+K that opens a command first — "pr" for the PR desk', icon: 'zap',
        action: async () => { try { const r = await this.addInteractively(); if (r) window.showToast?.('Type "' + r.word + '" to get ' + r.label, 'success'); } catch (err) { window.showToast?.(err.message, 'error'); } } },
      { id: 'aliases', label: 'Shortcut Words', hint: 'The words that open a command first: the ones you made and the ones Vex learned — edit or delete them', icon: 'zap',
        action: () => { if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('settings-aliases'); } },
    );
  },

  buildSettings(body) {
    const G = window.VexSettingsGroup;
    const redraw = () => G.refresh('settings-aliases');
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const p = this.prefs();
    body.append(
      G.toggle('Put a shortcut word’s command first', p.enabled, (on) => { this.savePrefs({ enabled: on }); }),
      G.toggle('Learn shortcut words from what I pick', p.learn, (on) => { this.savePrefs({ learn: on }); },
        'after ' + p.threshold + ' times, nothing leaves this computer'),
    );
    let items;
    try { items = this.list(); } catch (err) { body.append(G.note(err.message)); return; }
    const box = document.createElement('div');
    box.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius);padding:4px 10px;margin-top:10px';
    if (!items.length) {
      box.append(G.note('None yet. Type a word into Ctrl+K and pick the same command a few times, or make one below.'));
    }
    for (const a of items) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;flex-wrap:wrap';
      const word = document.createElement('code');
      word.textContent = a.word;
      const arrow = document.createElement('span');
      arrow.style.color = 'var(--text-muted)';
      arrow.textContent = '→';
      const target = document.createElement('span');
      target.style.cssText = 'flex:1;min-width:120px;font-size:12.5px';
      target.textContent = a.label + (a.missing ? ' (this command no longer exists)' : '');
      const tag = document.createElement('span');
      tag.style.cssText = 'font-size:10.5px;color:var(--text-muted)';
      tag.textContent = a.auto ? 'learned' : 'yours';
      row.append(word, arrow, target, tag,
        G.button('Change', async () => {
          try {
            const name = await window.vexPrompt({ title: 'Shortcut "' + a.word + '"', message: 'The command it should run, as it appears in Ctrl+K.', label: 'Command', value: a.label, okLabel: 'Save' });
            if (name == null) return;
            const c = this.commandFor(name);
            if (!c) throw new Error('There is no command called "' + String(name).trim() + '"');
            this.set(a.word, c.id, { auto: false });
            redraw();
          } catch (err) { fail(err); }
        }),
        G.button('Delete', () => {
          try {
            const was = this.remove(a.word);
            redraw();
            if (was && window.VexUndo && window.VexUndo.offer) window.VexUndo.offer({ message: 'Deleted the shortcut "' + a.word + '"', undo: () => { try { this.set(a.word, was.id, { auto: was.auto }); G.refresh('settings-aliases'); } catch (err) { fail(err); } } });
          } catch (err) { fail(err); }
        }, 'danger'));
      box.append(row);
    }
    body.append(box);

    // Make one.
    const list = document.createElement('datalist');
    list.id = 'alias-command-names';
    for (const c of this._commands()) { const o = document.createElement('option'); o.value = this._labelOf(c); list.append(o); }
    const word = document.createElement('input');
    word.className = 'set-input'; word.maxLength = 16; word.placeholder = 'pr'; word.style.maxWidth = '110px';
    const cmd = document.createElement('input');
    cmd.className = 'set-input'; cmd.placeholder = 'Command name'; cmd.setAttribute('list', 'alias-command-names'); cmd.style.minWidth = '200px';
    const add = G.button('Add shortcut', () => {
      try {
        const r = this._make(word.value, cmd.value);
        window.showToast?.('Type "' + r.word + '" to get ' + r.label, 'success');
        redraw();
      } catch (err) { fail(err); }
    });
    const make = document.createElement('div');
    make.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px';
    make.append(word, cmd, add, list);
    word.setAttribute('aria-label', 'Shortcut word');
    cmd.setAttribute('aria-label', 'Command it runs');
    body.append(make);

    body.append(G.button('Forget what was learned', async () => {
      try {
        if (!(await window.vexConfirm({ title: 'Forget learned shortcut words?', message: 'The shortcuts Vex learned and the counts behind them are removed. The ones you made stay.', okLabel: 'Forget them', danger: true }))) return;
        const n = this.forgetLearned();
        window.showToast?.('Forgot ' + n + ' learned shortcut' + (n === 1 ? '' : 's'));
        redraw();
      } catch (err) { fail(err); }
    }, 'danger'));
  },

  start() {
    this.register();
    if (window.VexSettingsGroup) {
      window.VexSettingsGroup.add({ id: 'settings-aliases', title: 'Command shortcut words', info: 'A word you type into Ctrl+K that puts one command first — "pr" for the PR desk. Learned from what you pick, or made by you.', build: (body) => this.buildSettings(body) });
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexAliases = VexAliases;
  if (typeof document !== 'undefined' && document.getElementById('command-overlay')) VexAliases.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAliases };
