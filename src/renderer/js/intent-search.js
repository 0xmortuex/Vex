// === Intent search across settings, features and commands (T3-078) ===============
//
// "make text bigger", "stop notifications", "why is it slow", "back up my stuff":
// people say what they want, not the name of the setting. This finds the right
// place from the words, with no model and nothing sent anywhere:
//
//   settings  the sections Settings lists, by the words each is known by
//             (SettingsUI.KEYWORDS, the same table its own search reads);
//   features  the catalogue (js/feature-catalog.js): name, `phrases` (written
//             for exactly this) and the sentence on what it is for;
//   commands  the Ctrl+K command list: label and hint.
//
// A small synonym table joins the words people use for one thing (bigger, larger,
// zoom, scale), and every query word has to be explained: a result must cover
// at least 60 percent of the words (all of them for a one- or two-word ask).
// tests/renderer/intentSearch.test.js asks 30 phrases and checks which place
// comes first.
//
//   VexIntent.resolve(query, data)  pure: data = { settings, features, commands } -> ranked list
//   VexIntent.collect()             reads the live modules into that shape
//   VexIntent.results(raw)          the rows Ctrl+K shows (below the commands that match)
const VexIntent = {
  PREF: 'vex.intentSearch.enabled',
  MAX_RESULTS: 4,
  MIN_COVERAGE: 0.6,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save the setting: ' + err.message); }
    return !!on;
  },

  // Words that carry no meaning of their own in a request.
  FILLER: new Set(['a', 'an', 'the', 'my', 'me', 'i', 'it', 'is', 'are', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'do', 'does', 'how', 'can', 'could', 'would', 'vex', 'please', 'want', 'need', 'make', 'get', 'let', 'show', 'set', 'turn', 'this', 'that', 'with', 'so', 'why', 'what', 'when', 'where', 'stop', 'too', 'much', 'all', 'up', 'out', 'off', 'take', 'open', 'use', 'change', 'enable', 'disable', 'switch', 'go', 'give', 'who', 'using', 'be', 'have', 'has', 'no', 'not', 'be', 'about', 'from', 'into', 'at']),

  // Words that mean the same thing for this purpose. A query word in a row stands for every word of it.
  SYNONYMS: [
    ['bigger', 'larger', 'big', 'large', 'huge', 'zoom', 'scale', 'size', 'enlarge', 'increase', 'magnify'],
    ['smaller', 'small', 'tiny', 'shrink', 'reduce', 'decrease'],
    ['text', 'font', 'fonts', 'letters', 'typeface', 'reading'],
    ['dark', 'night', 'black', 'dim'],
    ['light', 'bright', 'white', 'day'],
    ['theme', 'colour', 'colours', 'color', 'colors', 'look', 'appearance', 'skin', 'style'],
    ['notifications', 'notification', 'notify', 'alerts', 'alert', 'toasts', 'popups', 'badge', 'badges', 'ping', 'pings', 'interrupt', 'interrupting', 'noisy'],
    ['quiet', 'silent', 'mute', 'muted', 'silence', 'hush', 'calm', 'distractions', 'distracting'],
    ['slow', 'slower', 'sluggish', 'lag', 'laggy', 'freezing', 'freeze', 'hang', 'hanging', 'performance', 'speed', 'faster', 'fast'],
    ['memory', 'ram', 'bellek'],
    ['battery', 'power', 'laptop', 'unplugged', 'energy'],
    ['password', 'passwords', 'login', 'logins', 'credentials', 'signin'],
    ['backup', 'export', 'restore', 'import', 'transfer', 'archive'],
    ['data', 'stuff', 'everything'],
    ['sync', 'devices', 'phone', 'computers'],
    ['download', 'downloads', 'downloaded', 'files', 'folder'],
    ['tidy', 'clean', 'cleanup', 'organise', 'organize', 'sort', 'declutter'],
    ['tab', 'tabs'],
    ['duplicate', 'duplicates', 'copies', 'twins', 'repeated'],
    ['block', 'blocker', 'ads', 'ad', 'adverts', 'advertisements', 'trackers', 'tracking'],
    ['private', 'privacy', 'incognito', 'anonymous', 'hide', 'hidden'],
    ['search', 'find', 'lookup', 'locate'],
    ['engine', 'google', 'bing', 'duckduckgo', 'brave'],
    ['startup', 'start', 'launch', 'opening', 'boot', 'restart'],
    ['shortcut', 'shortcuts', 'hotkey', 'hotkeys', 'keys', 'keyboard', 'keybindings'],
    ['reminder', 'reminders', 'remind', 'alarm', 'timer', 'schedule', 'due'],
    ['problem', 'problems', 'bug', 'broken', 'crash', 'crashes', 'crashing', 'error', 'errors', 'issue', 'report', 'diagnostics'],
    ['language', 'translate', 'translation', 'turkish', 'english', 'dil'],
    ['game', 'games', 'gaming', 'playing', 'play'],
    ['video', 'videos', 'youtube', 'media', 'movie', 'stream'],
    ['ai', 'assistant', 'chatbot', 'model', 'ollama', 'claude', 'llm'],
    ['undo', 'revert', 'rollback', 'undone', 'reversed'],
    ['permission', 'permissions', 'allow', 'access', 'camera', 'microphone', 'location'],
    ['homepage', 'home', 'newtab', 'landing', 'greeting'],
    ['screenshot', 'screenshots', 'snip', 'capture', 'grab', 'screengrab'],
    ['listen', 'aloud', 'speak', 'narrate', 'hear', 'tts', 'voice'],
    ['new', 'recent', 'discover', 'features', 'try', 'unused', 'introduce'],
  ],

  _fold(s) {
    const tr = (typeof VexTr !== 'undefined' && VexTr.fold) ? VexTr : null;
    const t = tr ? tr.fold(String(s == null ? '' : s)) : String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    return t;
  },
  _words(s) { return this._fold(s).split(/[^a-z0-9À-￿]+/).filter(Boolean); },

  _synIndex: null,
  _syn() {
    if (this._synIndex) return this._synIndex;
    const m = new Map();
    for (const row of this.SYNONYMS) for (const w of row) { if (!m.has(w)) m.set(w, new Set()); for (const x of row) m.get(w).add(x); }
    this._synIndex = m;
    return m;
  },

  // Each meaningful query word with the words that would also answer it.
  terms(query) {
    const syn = this._syn();
    const out = [];
    for (const w of this._words(query)) {
      if (this.FILLER.has(w) || w.length < 2) continue;
      const alts = new Set([w]);
      const plain = w.replace(/(ing|ed|es|s)$/, '');
      if (plain.length >= 3) alts.add(plain);
      for (const a of [...alts]) if (syn.has(a)) for (const x of syn.get(a)) alts.add(x);
      out.push({ word: w, exact: new Set([w, plain]), alts });
    }
    return out;
  },

  // How well one field explains one term: 0, or a weight times 1 (the word itself) or 0.6 (a synonym).
  _hit(words, term) {
    let best = 0;
    for (const w of words) {
      for (const a of term.alts) {
        if (a.length < 2) continue;
        if (w === a || (a.length >= 3 && w.startsWith(a))) best = Math.max(best, term.exact.has(a) ? 1 : 0.6);
      }
    }
    return best;
  },

  // target: { kind, id, label, words: { name: string, phrases: string, extra: string } }
  // A short field that matches is a better answer than the same match in a long list of words.
  _focus(words) { return 0.6 + 0.4 * Math.min(1, 10 / Math.max(10, words.length)); },

  score(target, terms) {
    if (!terms.length) return 0;
    const name = this._words(target.name), phrases = this._words(target.phrases), extra = this._words(target.extra);
    const fn = this._focus(name), fp = this._focus(phrases), fe = this._focus(extra);
    let total = 0, covered = 0, strong = 0;
    for (const t of terms) {
      const a = this._hit(name, t) * 3 * fn, b = this._hit(phrases, t) * 2 * fp, c = this._hit(extra, t) * fe;
      const h = Math.max(a, b, c);
      if (h > 0) { covered++; total += h; if (Math.max(a, b) > 0) strong++; }
    }
    // One word is enough when it is a name or phrase hit and the other words are just the ask
    // ("listen to this article"); three or more words need 60 percent of them.
    const n = terms.length;
    if (n === 1 ? covered < 1 : n === 2 ? (covered < 1 || strong < 1) : covered < Math.ceil(n * this.MIN_COVERAGE)) return 0;
    return (total + covered) * (0.5 + 0.5 * covered / n);
  },

  // -> up to MAX_RESULTS { kind, id, label, why, score }, best first.
  resolve(query, data, limit = this.MAX_RESULTS) {
    const terms = this.terms(query);
    if (!terms.length) return [];
    const targets = [];
    for (const s of data.settings || []) targets.push({ kind: 'setting', id: s.id, label: s.label, name: s.label, phrases: s.words, extra: '' });
    for (const f of data.features || []) targets.push({ kind: 'feature', id: f.id, label: f.label, name: f.label, phrases: f.phrases || '', extra: f.what || '' });
    for (const c of data.commands || []) targets.push({ kind: 'command', id: c.id, label: c.label, name: c.label, phrases: '', extra: c.hint || '' });
    const KIND_BONUS = { setting: 0.3, feature: 0.2, command: 0 };
    const out = [];
    for (const t of targets) {
      const s = this.score(t, terms);
      if (s > 0) out.push({ kind: t.kind, id: t.id, label: t.label, score: s + KIND_BONUS[t.kind] });
    }
    out.sort((a, b) => b.score - a.score || (a.label < b.label ? -1 : 1));
    return out.slice(0, limit);
  },

  // ---- the live data ----------------------------------------------------------------
  collect() {
    const settings = [];
    if (typeof SettingsUI !== 'undefined' && SettingsUI.KEYWORDS) {
      for (const [heading, words] of Object.entries(SettingsUI.KEYWORDS)) settings.push({ id: heading, label: heading.replace(/\b\w/g, c => c.toUpperCase()), words });
    }
    const features = [];
    if (typeof VexFeatures !== 'undefined') for (const f of VexFeatures.ITEMS) features.push({ id: f.id, label: VexFeatures.nameOf(f), phrases: f.phrases || '', what: f.what || '' });
    const commands = [];
    if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) for (const c of CommandBar.commands) if (c && c.id && c.label) commands.push({ id: c.id, label: c.label, hint: c.hint || '' });
    return { settings, features, commands };
  },

  // ---- opening what it found -------------------------------------------------------------
  open(hit) {
    if (hit.kind === 'setting') {
      const mgr = (typeof SidebarManager !== 'undefined') ? SidebarManager : null;
      if (!mgr || typeof mgr.openPanel !== 'function') throw new Error('Settings cannot be opened from here');
      mgr.openPanel('settings');
      // The Settings search box finds the section by the same words; typing it there is "going to the section".
      const box = document.querySelector('#panel-settings .set-search');
      if (box) { box.value = hit.id; box.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    if (hit.kind === 'feature') {
      if (typeof VexDiscover === 'undefined') throw new Error('Discover is not loaded');
      const f = VexFeatures.get(hit.id);
      if (f && (VexFeatures.command(f) || f.panel || f.setting)) VexDiscover.openFeature(hit.id); else VexDiscover.showMe(hit.id);
      return;
    }
    const cmd = (typeof CommandBar !== 'undefined' ? CommandBar.commands : []).find(c => c.id === hit.id);
    if (!cmd) throw new Error('That command is no longer there');
    if (typeof CommandBar._execute === 'function') CommandBar._execute(cmd); else cmd.action();
  },

  // Ctrl+K rows for a typed sentence. Only for something that reads like a request (two words or more).
  results(raw) {
    if (!this.enabled()) return [];
    const q = String(raw || '').trim();
    if (this._words(q).length < 2) return [];
    const hits = this.resolve(q, this.collect());
    if (typeof VexUsage !== 'undefined' && hits.length) VexUsage.touch('intent-search');
    return hits.map(h => ({
      id: 'intent:' + h.kind + ':' + h.id, icon: h.kind === 'setting' ? 'settings' : (h.kind === 'feature' ? 'compass' : 'search'),
      isPrimary: false, label: h.label,
      hint: (h.kind === 'setting' ? 'Settings section' : h.kind === 'feature' ? 'Feature' : 'Command') + ' · matches what you asked',
      action: () => this.open(h),
    }));
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Type what you want in Ctrl+K ("make text bigger", "stop notifications", "why is it slow") and Vex lists the settings section, feature or command that fits, below the commands that match. Fixed word lists and synonyms; no AI, nothing sent.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexIntent = VexIntent;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'intent-search', title: 'Search by what you want', keywords: 'intent search ask what you want sentence find setting synonyms ctrl k', before: 'about', build: (el) => VexIntent.group(el) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexIntent };
