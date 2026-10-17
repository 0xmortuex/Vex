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
// What the rules are not: they do not touch Discord, its page, its settings or its
// toasts. Discord's own notification still shows (that is the page's; Vex does not
// change it) and nothing is muted or left on Discord's side. A VIP match
// (js/vip-rules.js) is NEVER hidden or muted, so a rule cannot swallow what the
// person said matters.
//
// It also looks at the same list for the quiet-worthy: the conversations and servers
// that notified most while you never marked one as read, offered as "mute" or "hide"
// rules to accept. Leaving a server is yours to do on Discord.
//
// Two more things, each with its own switch, both OFF:
//
//   Collapse in the Discord page   one stylesheet (bot messages; join, leave, boost and
//       pin lines) put into the Discord pages through the same path the Discord theme
//       uses (DiscordTheme.onPageReady, webview.insertCSS). It only shrinks those lines
//       to a single faded row that opens when the pointer is on it. No page script runs,
//       nothing is read from a message, no setting of Discord is changed, and turning
//       the switch off removes the stylesheet at once. The selectors use the stable part
//       of Discord's class names; if Discord renames them the lines simply stay as they
//       were.
//   Servers never opened   while the second switch is on, Vex remembers only the number
//       of each server whose page you open (from the address of the Discord page, never a
//       message, a channel name or a person). "Look at my servers" then reads the names
//       of the servers in Discord's server bar, once, when you press it, and lists the
//       ones whose number it has never seen you open since it started watching. Vex
//       cannot know about days before that switch was on, and says so.
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

  CHANNEL_URL: /^https:\/\/([a-z0-9-]+\.)?discord\.com\/channels\/(\d{15,25})(?:\/|$)/i,
  MAX_OPENED: 400,
  // The stable part of Discord's class names (the rest is a changing hash). A match never
  // changes what a line says: it only limits its height until the pointer is on it.
  BOT_SELECTOR: 'li[class*="messageListItem"]:has([class*="botTag"])',
  SYSTEM_SELECTOR: 'li[class*="messageListItem"]:has([class*="systemMessage"])',
  RAIL_SCRIPT: "(() => { const out = []; for (const el of document.querySelectorAll('[data-list-item-id^=\"guildsnav___\"]')) { const id = String(el.getAttribute('data-list-item-id') || '').slice(12); if (!/^[0-9]{15,25}$/.test(id)) continue; const holder = el.closest('[data-dnd-name]'); out.push({ id, name: String((holder && holder.getAttribute('data-dnd-name')) || el.getAttribute('aria-label') || '').slice(0, 100) }); } return out; })()",

  _now() { return Date.now(); },
  _restoring: false,

  // ---- state ---------------------------------------------------------------------------
  state() {
    const s = CommsStore.record(this.KEY, { on: true, rules: [], hidden: [], ledgered: {}, hits: {}, collapse: {}, track: false, opened: {}, since: 0 }, 'Discord noise rules');
    return {
      collapse: { bots: !!(s.collapse && s.collapse.bots === true), system: !!(s.collapse && s.collapse.system === true) },
      track: s.track === true,
      since: Number(s.since) || 0,
      opened: s.opened && typeof s.opened === 'object' && !Array.isArray(s.opened) ? s.opened : {},
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
  // ---- collapse bot and system lines in the Discord page ----------------------------------------------------
  collapse() { return this.state().collapse; },
  // The stylesheet for these choices, or '' when nothing is chosen. Pure.
  collapseCss(c = this.collapse()) {
    const sel = [];
    if (c && c.bots) sel.push(this.BOT_SELECTOR);
    if (c && c.system) sel.push(this.SYSTEM_SELECTOR);
    if (!sel.length) return '';
    const shut = sel.map(s => s + ':not(:hover):not(:focus-within)').join(',\n');
    const open = sel.join(',\n');
    return '/* Vex: Discord noise tools */\n' + shut + ' { max-height: 2.6em !important; overflow: hidden !important; opacity: .55 !important; }\n' + open + ' { transition: opacity .15s; }\n';
  },
  setCollapse(patch) {
    const s = this.state();
    for (const k of ['bots', 'system']) if (patch && patch[k] !== undefined) s.collapse[k] = !!patch[k];
    this._save(s);
    return this.applyAll();
  },
  _pages() {
    if (typeof DiscordTheme === 'undefined' || typeof DiscordTheme.pages !== 'function') throw new Error('The Discord pages are not available in this window');
    return DiscordTheme.pages();
  },
  // One Discord page gets the stylesheet that matches the choices (or loses it). Serialized per page.
  applyTo(wv) {
    if (typeof wv.insertCSS !== 'function') throw new Error('This page cannot take a stylesheet');
    const css = this.enabled() ? this.collapseCss() : '';
    const run = async () => {
      const old = wv._vexNoiseCssKey;
      wv._vexNoiseCssKey = null;
      if (old && typeof wv.removeInsertedCSS === 'function') {
        try { await wv.removeInsertedCSS(old); } catch (err) { console.warn('[DiscordNoise] the old stylesheet was already gone:', err && err.message); }
      }
      if (css) wv._vexNoiseCssKey = await wv.insertCSS(css);
    };
    wv._vexNoiseChain = (wv._vexNoiseChain || Promise.resolve()).then(run);
    return wv._vexNoiseChain;
  },
  async applyAll() {
    const out = [];
    for (const wv of this._pages()) out.push(await this.applyTo(wv));
    return out.length;
  },
  // A Discord page finished loading (DiscordTheme.onPageReady calls this): the stylesheet goes in,
  // and the page's address is followed for "servers never opened".
  onPageReady(wv) {
    const c = this.collapseCss();
    if (c || wv._vexNoiseCssKey) {
      this.applyTo(wv).catch(err => { console.error('[DiscordNoise] could not update the Discord page:', err); window.VexProblems?.note('Discord noise', 'The Discord page could not take the collapse stylesheet', err); });
    }
    if (!wv._vexNoiseNav) {
      wv._vexNoiseNav = true;
      const seen = (e) => { try { this.recordUrl(e && e.url); } catch (err) { window.VexProblems?.note('Discord noise', 'Could not note which server you opened', err); } };
      wv.addEventListener('did-navigate-in-page', seen);
      wv.addEventListener('did-navigate', seen);
    }
    this.recordUrl(typeof vexGuestUrl === 'function' ? vexGuestUrl(wv) : '');
    return true;
  },

  // ---- servers never opened ------------------------------------------------------------------------------
  tracking() { return this.state().track; },
  setTracking(on) {
    const s = this.state();
    s.track = !!on;
    if (on && !s.since) s.since = this._now();
    this._save(s);
  },
  forgetOpened() { const s = this.state(); s.opened = {}; s.since = s.track ? this._now() : 0; this._save(s); },
  // The server number in a Discord address, or ''.
  guildOf(url) { const m = this.CHANNEL_URL.exec(String(url || '')); return m ? m[2] : ''; },
  // A server's page was opened: its number and when, nothing else. Only while the switch is on.
  recordUrl(url) {
    const id = this.guildOf(url);
    if (!id || CommsStore.privateWindow()) return false;
    const s = this.state();
    if (!s.on || !s.track) return false;
    const now = this._now();
    const row = s.opened[id];
    if (row && now - row.last < 60000) return false;
    s.opened[id] = { last: now, n: (row ? row.n : 0) + 1 };
    const ids = Object.keys(s.opened);
    if (ids.length > this.MAX_OPENED) for (const k of ids.sort((a, b) => s.opened[a].last - s.opened[b].last).slice(0, ids.length - this.MAX_OPENED)) delete s.opened[k];
    this._save(s);
    return true;
  },
  // Pure: the servers (from the server bar) whose number was never seen opened.
  neverOpened(servers, opened = this.state().opened) {
    const seen = new Set();
    const out = [];
    for (const sv of servers || []) {
      if (!sv || !/^[0-9]{15,25}$/.test(String(sv.id)) || seen.has(sv.id)) continue;
      seen.add(sv.id);
      if (!opened[sv.id]) out.push({ id: sv.id, name: String(sv.name || '').slice(0, 100) || 'A server' });
    }
    return out;
  },
  // Read the server bar of the Discord page in front (names and numbers only), once, on a click.
  async serversFromPage(wv) {
    if (typeof window.vexGuestEval !== 'function') throw new Error('Pages cannot be read in this window');
    const list = await window.vexGuestEval(wv, this.RAIL_SCRIPT, false, 5000);
    if (!Array.isArray(list)) throw new Error('Discord did not show its server bar');
    if (!list.length) throw new Error('No servers were found in the server bar. Open Discord (not a call or a settings page) and try again.');
    return list;
  },
  async findNeverOpened() {
    if (!this.tracking()) throw new Error('Switch on "Remember which servers I open" first; Vex can only tell from then on');
    const pages = this._pages();
    if (!pages.length) throw new Error('Open Discord first (a tab or the panel)');
    const servers = await this.serversFromPage(pages[0]);
    return { servers: servers.length, never: this.neverOpened(servers), since: this.state().since };
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
