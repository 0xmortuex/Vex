// === Vencord bridge: mentions, replies and channel catch-up (T3-005) ================
//
// THE HOST SIDE ONLY. Vex does not read Discord and does not change Vencord. The
// owner's OWN Vencord plugin (source in tools/vencord-bridge, built in the owner's Vencord repo; the contract is docs/vencord-bridge.md)
// may write one small JSON file, "vex-bridge.json", into a folder he chooses. This reads
// that file, and only when asked:
//
//   - the folder is picked in a system dialog; Vex remembers that one path and reads
//     exactly one file name from it. It never lists the folder, never follows a link,
//     never writes there, and refuses a file over 1 MB or in the wrong shape (main/comms-tools.js);
//   - nothing is polled. The file is read when you open the bridge screen, press
//     Refresh, or build the Morning Brief with the (opt-in) section on;
//   - what the file holds (mentions of you, replies to your messages, the last messages of
//     a few channels) stays in memory for the session. What is kept on disk is only the ids of
//     the items you have already seen, so "new" means new;
//   - nothing leaves this computer, except: the optional "Summarize with the local AI"
//     sends the channel text to the LOCAL model only (never the cloud one).
//
// Without the plugin there is no file, and this says so in plain words.
const VencordBridge = {
  KEY: 'vex.vencordBridge',
  MAX_SEEN: 800,
  QUESTION: /\?\s*$|\?\s/,
  DECISION: /\b(decid(?:ed|e)|agreed?|approved?|let'?s go with|we(?:'ll| will) (?:go|do|use|ship)|final(?:ly)?|settled|confirmed)\b/i,

  _now() { return Date.now(); },
  _data: null,        // the cleaned file of this session
  _mtime: 0,

  // ---- state ------------------------------------------------------------------------------------
  state() {
    const s = CommsStore.record(this.KEY, { on: true, seen: [], lastRead: 0 }, 'Vencord bridge settings');
    return { on: s.on !== false, seen: Array.isArray(s.seen) ? s.seen.filter(x => typeof x === 'string') : [], lastRead: Number(s.lastRead) || 0 };
  },
  _save(s) { CommsStore.write(this.KEY, s); CommsStore.emit('vex:vencord-bridge'); },
  enabled() { return this.state().on; },
  setEnabled(on) { const s = this.state(); s.on = !!on; this._save(s); if (!on) { this._data = null; } },

  _api() {
    const v = typeof window !== 'undefined' && window.vex;
    if (!v || typeof v.commsBridgeRead !== 'function') throw new Error('The bridge is not available in this build');
    return v;
  },
  status() { return this._api().commsBridgeStatus(); },
  async pick() { return this._api().commsBridgePick(); },
  async forget() {
    const r = await this._api().commsBridgeForget();
    this._data = null; this._mtime = 0;
    const s = this.state(); s.seen = []; s.lastRead = 0; this._save(s);
    return r;
  },

  // Read the file now. Throws what is wrong with it. -> the cleaned data
  async read() {
    if (!this.enabled()) throw new Error('The Vencord bridge is switched off in Settings');
    CommsStore.needKept('The Vencord bridge');
    const r = await this._api().commsBridgeRead();
    this._data = r.data; this._mtime = r.mtime;
    const s = this.state(); s.lastRead = this._now(); this._save(s);
    return r.data;
  },
  data() { return this._data; },
  age(now = this._now()) { return this._data && this._data.generatedAt ? now - this._data.generatedAt : null; },

  // ---- mentions and replies -----------------------------------------------------------------------
  _isNew(id) { return !this.state().seen.includes(id); },
  mentions({ onlyNew = false } = {}) {
    const m = (this._data ? this._data.mentions : []).slice().sort((a, b) => b.ts - a.ts);
    return onlyNew ? m.filter(x => this._isNew(x.id)) : m;
  },
  replies({ onlyNew = false } = {}) {
    const m = (this._data ? this._data.replies : []).slice().sort((a, b) => b.ts - a.ts);
    return onlyNew ? m.filter(x => this._isNew(x.id)) : m;
  },
  markSeen(ids) {
    const s = this.state();
    const set = new Set(s.seen);
    for (const id of ids) set.add(String(id));
    s.seen = Array.from(set).slice(-this.MAX_SEEN);
    this._save(s);
    return ids.length;
  },
  markAllSeen() { return this.markSeen([...this.mentions(), ...this.replies()].map(x => x.id)); },

  // The counts for a glance: -> { mentions, replies, channels: [{ name, n }], lines }
  digest() {
    const nm = this.mentions({ onlyNew: true }), nr = this.replies({ onlyNew: true });
    const by = new Map();
    for (const x of [...nm, ...nr]) { const k = (x.channelName ? '#' + x.channelName.replace(/^#/, '') : 'a channel') + (x.guildName ? ' (' + x.guildName + ')' : ''); by.set(k, (by.get(k) || 0) + 1); }
    const channels = Array.from(by, ([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
    const lines = [];
    lines.push(nm.length + ' new mention' + (nm.length === 1 ? '' : 's') + ', ' + nr.length + ' new repl' + (nr.length === 1 ? 'y' : 'ies'));
    for (const c of channels.slice(0, 5)) lines.push(c.n + ' in ' + c.name);
    return { mentions: nm.length, replies: nr.length, channels, lines };
  },

  // ---- channel catch-up -----------------------------------------------------------------------------------
  channels() { return this._data ? this._data.channels : []; },
  // Plain counting, no AI: who spoke, the questions asked, the lines that read like decisions, the links.
  // -> { channel, count, from, to, authors: [{ name, n }], questions: [], decisions: [], links: [], mentionedYou: [] }
  catchUp(channelId) {
    const ch = this.channels().find(c => c.channelId === channelId);
    if (!ch) throw new Error('That channel is not in the file');
    const msgs = ch.messages.slice().sort((a, b) => a.ts - b.ts);
    const authors = new Map();
    for (const m of msgs) authors.set(m.author || 'someone', (authors.get(m.author || 'someone') || 0) + 1);
    const me = this._data && this._data.account ? this._data.account.toLowerCase() : '';
    const pick = (re) => msgs.filter(m => re.test(m.text)).slice(-6).map(m => ({ author: m.author, text: m.text.slice(0, 200), ts: m.ts }));
    return {
      channel: ch.name || ch.channelId, guild: ch.guildName, count: msgs.length, from: msgs.length ? msgs[0].ts : 0, to: msgs.length ? msgs[msgs.length - 1].ts : 0,
      authors: Array.from(authors, ([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 8),
      questions: pick(this.QUESTION), decisions: pick(this.DECISION),
      links: CommsStore.links(msgs.map(m => m.text).join('\n'), 10),
      mentionedYou: me ? msgs.filter(m => m.text.toLowerCase().includes('@' + me) || m.text.toLowerCase().includes(me)).slice(-5).map(m => ({ author: m.author, text: m.text.slice(0, 200), ts: m.ts })) : [],
    };
  },
  catchUpText(channelId) {
    const c = this.catchUp(channelId);
    const t = (ms) => ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const out = [c.count + ' messages in #' + c.channel + (c.guild ? ' (' + c.guild + ')' : '') + (c.count ? ', ' + t(c.from) + ' to ' + t(c.to) : '')];
    out.push('Who spoke: ' + (c.authors.map(a => a.name + ' ' + a.n).join(', ') || 'nobody'));
    out.push('', 'Questions that look open:');
    for (const q of c.questions) out.push('- ' + q.author + ': ' + q.text);
    if (!c.questions.length) out.push('- none found');
    out.push('', 'Lines that read like decisions:');
    for (const d of c.decisions) out.push('- ' + d.author + ': ' + d.text);
    if (!c.decisions.length) out.push('- none found');
    if (c.mentionedYou.length) { out.push('', 'Mention you:'); for (const m of c.mentionedYou) out.push('- ' + m.author + ': ' + m.text); }
    if (c.links.length) { out.push('', 'Links:'); for (const l of c.links) out.push('- ' + l); }
    return out.join('\n');
  },
  // With the LOCAL model only: the cloud model is never asked about a chat.
  async summarizeLocal(channelId) {
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') throw new Error('The AI is not loaded');
    const ch = this.channels().find(c => c.channelId === channelId);
    if (!ch) throw new Error('That channel is not in the file');
    const lines = ch.messages.slice().sort((a, b) => a.ts - b.ts).slice(-80).map(m => (m.author || 'someone') + ': ' + m.text).join('\n');
    const message = 'Catch me up on this chat. Give: what was decided, what questions are still open, and anything that needs me. Be brief and use only what is written below.\n\n' + lines;
    const res = await AIRouter.callOn('local', 'chat', { message, persona: { systemPrompt: 'You summarize a chat for its reader. Never invent anything that is not in the text.', temperature: 0.2 } });
    const text = String(res && (res.result || res.text || res.message) || '').trim();
    if (!text) throw new Error('The local AI returned nothing');
    return text;
  },

  // ---- the Morning Brief section (opt-in) ---------------------------------------------------------------------
  async briefPayload() {
    if (!this.enabled()) return null;
    const st = await this.status();
    if (!st.granted || !st.found) return null;
    await this.read();
    const d = this.digest();
    if (!d.mentions && !d.replies) return null;
    return { summary: d.lines[0], items: d.channels.slice(0, 5).map(c => ({ text: c.n + ' in ' + c.name })) };
  },
};

if (typeof window !== 'undefined') {
  window.VencordBridge = VencordBridge;
  if (typeof VexBrief !== 'undefined') {
    VexBrief.register({ id: 'vencord-bridge', title: 'Discord mentions', icon: 'message', order: 57, optIn: true, defaultOn: false, maxItems: 5, ttlMs: 60000, build: () => VencordBridge.briefPayload() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VencordBridge };
