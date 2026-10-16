// === Discord noise tools (T3-013) =================================================
//
// A busy server fills the kept list of panel notifications (js/panel-capture.js)
// with bot lines, joins and a channel nobody important writes in. These are the
// person's own rules for THAT LIST, applied on this computer:
//
//   hide   the notification is taken out of Vex's list the moment it is kept;
//   mute   the conversation is muted in Vex's list for a while, so it does not
//          count as waiting for you.
//
// What this is not: it does not touch Discord, its page, its settings or its
// toasts. Discord's own notification still shows (that is the page's; Vex does not
// change it), nothing is muted or left on Discord's side, and no page script or
// style is injected. A VIP match (js/vip-rules.js) is NEVER hidden or muted, so a
// rule cannot swallow what the person said matters.
//
// It also looks at the same list for the quiet-worthy: the conversations and servers
// that notified most while you never marked one as read, offered as "mute" or "hide"
// rules to accept. Vex cannot see which servers you never open; the counts say only
// what the kept notifications say. Leaving a server is yours to do on Discord.
//
// Every automatic hide or mute is noted in "Why did that happen?" (at most one line
// per rule per hour) with an Undo that puts the hidden notifications back.
const DiscordNoise = {
  KEY: 'vex.discordNoise',
  MAX_RULES: 40,
  MAX_HIDDEN: 60,
  MIN_MATCH: 3,
  LEDGER_EVERY_MS: 3600000,
  FIELDS: ['title', 'body', 'any'],
  KINDS: ['hide', 'mute'],
  MUTE_CHOICES: { '1 hour': 3600000, '8 hours': 8 * 3600000, '1 day': 24 * 3600000 },
  // Starting points offered in Settings; none is on until the person adds it.
  PRESETS: [
    { label: 'Joins and leaves', kind: 'hide', source: 'discord', field: 'body', match: 'joined the server' },
    { label: 'Welcome lines', kind: 'hide', source: 'discord', field: 'body', match: 'welcome to' },
    { label: 'Server boosts', kind: 'hide', source: 'discord', field: 'body', match: 'boosted' },
    { label: 'Anything from a bot named "bot"', kind: 'mute', source: 'discord', field: 'title', match: 'bot', ms: 24 * 3600000 },
  ],

  _now() { return Date.now(); },
  _restoring: false,

  // ---- state ---------------------------------------------------------------------------
  state() {
    const s = CommsStore.record(this.KEY, { on: true, rules: [], hidden: [], ledgered: {}, hits: {} }, 'Discord noise rules');
    return {
      on: s.on !== false,
      rules: Array.isArray(s.rules) ? s.rules.filter(r => r && typeof r.id === 'string' && typeof r.match === 'string') : [],
      hidden: Array.isArray(s.hidden) ? s.hidden : [],
      ledgered: s.ledgered && typeof s.ledgered === 'object' && !Array.isArray(s.ledgered) ? s.ledgered : {},
      hits: s.hits && typeof s.hits === 'object' && !Array.isArray(s.hits) ? s.hits : {},
    };
  },
  _save(s) { CommsStore.write(this.KEY, s); CommsStore.emit('vex:discord-noise'); },
  enabled() { return this.state().on; },
  setEnabled(on) { const s = this.state(); s.on = !!on; this._save(s); },
  rules() { return this.state().rules; },

  addRule({ kind, source = 'discord', field = 'any', match, ms = 0, label = '' } = {}) {
    if (!this.KINDS.includes(kind)) throw new Error('A rule hides or mutes');
    const src = String(source).toLowerCase();
    if (src !== '*' && !/^[a-z][a-z0-9_-]{0,40}$/.test(src)) throw new Error('A rule names a panel such as discord, or * for all');
    if (!this.FIELDS.includes(field)) throw new Error('A rule looks in the title, the text or any');
    const m = CommsStore.line(match, 80);
    if (m.length < this.MIN_MATCH) throw new Error('A rule needs at least ' + this.MIN_MATCH + ' characters to look for, or it would catch too much');
    let mute = 0;
    if (kind === 'mute') {
      mute = Number(ms);
      if (!(mute >= 60000 && mute <= 7 * 24 * 3600000)) throw new Error('A mute lasts from a minute to a week');
    }
    const s = this.state();
    if (s.rules.some(r => r.kind === kind && r.source === src && r.field === field && r.match.toLowerCase() === m.toLowerCase())) throw new Error('That rule already exists');
    if (s.rules.length >= this.MAX_RULES) throw new Error('At most ' + this.MAX_RULES + ' rules. Remove one first.');
    const rule = { id: CommsStore.id('nr'), kind, source: src, field, match: m, ms: mute, label: CommsStore.line(label, 60) || m, addedAt: this._now() };
    s.rules.push(rule);
    this._save(s);
    return rule;
  },
  removeRule(id) {
    const s = this.state();
    const next = s.rules.filter(r => r.id !== id);
    if (next.length === s.rules.length) return false;
    s.rules = next; delete s.hits[id]; this._save(s);
    return true;
  },

  // ---- matching (pure) ---------------------------------------------------------------------
  matches(rule, item) {
    if (rule.source !== '*' && rule.source !== item.source) return false;
    const needle = rule.match.toLowerCase();
    const title = String(item.title || '').toLowerCase(), body = String(item.body || '').toLowerCase();
    return rule.field === 'title' ? title.includes(needle) : rule.field === 'body' ? body.includes(needle) : (title.includes(needle) || body.includes(needle));
  },
  // The first rule that applies to a notification, or null. A VIP notification is never touched.
  ruleFor(item, rules = this.rules()) {
    if (!item || item.vip) return null;
    return rules.find(r => this.matches(r, item)) || null;
  },

  // ---- acting on a kept notification --------------------------------------------------------------
  apply(item) {
    if (!this.enabled() || this._restoring || CommsStore.privateWindow()) return null;
    if (typeof PanelCapture === 'undefined') return null;
    const rule = this.ruleFor(item);
    if (!rule) return null;
    const s = this.state();
    if (rule.kind === 'hide') {
      PanelCapture.remove(item.id);
      s.hidden.unshift({ rule: rule.id, source: item.source, title: item.title, body: item.body, ts: item.ts });
      while (s.hidden.length > this.MAX_HIDDEN) s.hidden.pop();
    } else {
      PanelCapture.mute(item.source, item.title, rule.ms);
    }
    s.hits[rule.id] = { n: ((s.hits[rule.id] || {}).n || 0) + 1, last: this._now() };
    const now = this._now();
    if (!(now - (s.ledgered[rule.id] || 0) < this.LEDGER_EVERY_MS)) {
      s.ledgered[rule.id] = now;
      if (typeof VexLedger !== 'undefined') {
        VexLedger.note({ feature: 'discord-noise', what: (rule.kind === 'hide' ? 'Hid' : 'Muted') + ' a ' + PanelCapture.label(item.source) + ' notification in Vex\'s list', why: 'It matched your rule "' + rule.label + '" (Settings, Community and chat tools). Discord itself was not touched.', undo: { kind: 'noise-restore', rule: rule.id } });
      }
    }
    this._save(s);
    return rule;
  },
  // The notifications this rule hid, put back into the list.
  restore(ruleId) {
    if (typeof PanelCapture === 'undefined') throw new Error('Kept notifications are not loaded');
    const s = this.state();
    const mine = s.hidden.filter(h => h.rule === ruleId);
    if (!mine.length) return 0;
    this._restoring = true;
    let n = 0;
    try { for (const h of mine.reverse()) if (PanelCapture.ingest(h.source, { title: h.title, body: h.body })) n++; }
    finally { this._restoring = false; }
    s.hidden = s.hidden.filter(h => h.rule !== ruleId);
    this._save(s);
    return n;
  },
  hiddenCount(ruleId) { return this.state().hidden.filter(h => !ruleId || h.rule === ruleId).length; },

  // ---- the quiet-worthy -----------------------------------------------------------------------------
  // "Alice (#general, My Server)" -> "My Server" ; "#general (My Server)" -> "My Server" ; otherwise ''.
  serverOf(title) {
    const m = /\(([^()]+)\)\s*$/.exec(String(title || ''));
    if (!m) return '';
    const parts = m[1].split(',').map(p => p.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  },
  // -> [{ key, label, kind: 'server' | 'conversation', source, count, unread, last }] noisiest first.
  noisiest({ minCount = 5, limit = 8 } = {}) {
    if (typeof PanelCapture === 'undefined') return [];
    const groups = new Map();
    for (const n of PanelCapture.list({ includeMuted: true })) {
      if (n.vip) continue;
      const server = this.serverOf(n.title);
      const kind = server ? 'server' : 'conversation';
      const label = server || String(n.title).slice(0, 80);
      const key = n.source + '::' + kind + '::' + label.toLowerCase();
      const g = groups.get(key) || { key, label, kind, source: n.source, count: 0, unread: 0, last: 0 };
      g.count++; if (!n.read) g.unread++; g.last = Math.max(g.last, n.ts);
      groups.set(key, g);
    }
    return Array.from(groups.values()).filter(g => g.count >= minCount && g.unread === g.count).sort((a, b) => b.count - a.count || b.last - a.last).slice(0, limit);
  },
  ruleCovers(group) { return this.rules().some(r => r.match.toLowerCase() === group.label.toLowerCase() && (r.source === '*' || r.source === group.source)); },
  suggestRule(group, kind = 'mute') {
    return this.addRule({ kind, source: group.source, field: 'title', match: group.label, ms: kind === 'mute' ? 24 * 3600000 : 0, label: group.label });
  },
};

if (typeof window !== 'undefined') {
  window.DiscordNoise = DiscordNoise;
  if (typeof document !== 'undefined') {
    // Every notification the list keeps is judged once, right then.
    document.addEventListener('vex:panel-notification', (e) => {
      const d = e && e.detail;
      if (!d || d.kind !== 'added' || !d.item) return;
      try { DiscordNoise.apply(d.item); }
      catch (err) { console.error('[DiscordNoise]', err); window.VexProblems?.note('Discord noise', 'A rule could not be applied to a notification', err); }
    });
  }
  if (typeof VexLedger !== 'undefined') VexLedger.registerUndo('noise-restore', async (token) => { DiscordNoise.restore(token.rule); });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { DiscordNoise };
