// === VIP people and keywords: who and what gets through ========================
//
// Quiet hours, Focus mode and the Attention Budget hold back everything that is
// not urgent. Some things are urgent to YOU and to nobody else: your partner's
// message, the word "ban" in a moderation channel, your own name. These rules
// are how the person says so:
//
//   people     a name and its other names ("Sam", "samir", "sammy")
//   keywords   words that matter wherever they show up ("ban", "deploy", "invoice")
//   sites      a whole panel (a family WhatsApp) that always gets through
//
// A hit is a whole word, any case, in the TITLE or BODY of something Vex already
// has: a notification a panel raised (js/panel-capture.js), a row in the
// Attention Inbox, a mail subject. The rules never read a page and never reach
// out: they only look at text Vex was already holding. A hit
//   - makes that item rank first in "Needs me" (js/needs-me.js);
//   - lets it through the Attention Budget while Vex is quiet (VexAttention.request
//     takes opts.vipText and asks hit() below; reason "vip", not counted in the caps);
//   - is never held back for the digest (js/attention-digest.js).
//
// The Windows quiet hours (src/main/quiet-hours.js) already have a list of VIP
// SITES for the toasts Vex itself sends; this is the same idea for people and
// words inside Vex's own lists, and it leaves that list alone.
const VipRules = {
  KEY: 'vex.vip',
  MAX_PEOPLE: 50,
  MAX_ALIASES: 10,
  MAX_KEYWORDS: 50,
  MAX_SITES: 20,

  _blank() { return { on: true, people: [], keywords: [], sites: [] }; },
  _load() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return this._blank();
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved VIP rules are not readable', { cause: err }); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('The saved VIP rules are not in a form Vex knows');
    return {
      on: v.on !== false,
      people: Array.isArray(v.people) ? v.people.filter(p => p && typeof p.name === 'string') : [],
      keywords: Array.isArray(v.keywords) ? v.keywords.filter(k => typeof k === 'string') : [],
      sites: Array.isArray(v.sites) ? v.sites.filter(s => typeof s === 'string') : [],
    };
  },
  _save(s) { localStorage.setItem(this.KEY, JSON.stringify(s)); document.dispatchEvent(new CustomEvent('vex:vip-changed')); },

  enabled() { return this._load().on; },
  setEnabled(on) { const s = this._load(); s.on = !!on; this._save(s); },
  rules() { const s = this._load(); return { people: s.people.map(p => ({ name: p.name, aliases: (p.aliases || []).slice() })), keywords: s.keywords.slice(), sites: s.sites.slice() }; },
  count() { const s = this._load(); return s.people.length + s.keywords.length + s.sites.length; },

  _word(v, what) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (s.length < 2 || s.length > 60) throw new Error('A ' + what + ' is 2 to 60 characters');
    return s;
  },

  addPerson(name, aliases = []) {
    const n = this._word(name, 'name');
    const list = (Array.isArray(aliases) ? aliases : String(aliases).split(',')).map(a => String(a).trim()).filter(Boolean).map(a => this._word(a, 'nickname'));
    if (list.length > this.MAX_ALIASES) throw new Error('At most ' + this.MAX_ALIASES + ' other names for one person');
    const s = this._load();
    const same = s.people.find(p => p.name.toLowerCase() === n.toLowerCase());
    if (same) same.aliases = [...new Set(list)];
    else {
      if (s.people.length >= this.MAX_PEOPLE) throw new Error('At most ' + this.MAX_PEOPLE + ' people');
      s.people.push({ name: n, aliases: [...new Set(list)] });
    }
    this._save(s);
  },
  removePerson(name) {
    const s = this._load();
    const next = s.people.filter(p => p.name.toLowerCase() !== String(name).toLowerCase());
    if (next.length === s.people.length) return false;
    s.people = next; this._save(s); return true;
  },
  addKeyword(word) {
    const w = this._word(word, 'keyword');
    const s = this._load();
    if (s.keywords.some(k => k.toLowerCase() === w.toLowerCase())) return false;
    if (s.keywords.length >= this.MAX_KEYWORDS) throw new Error('At most ' + this.MAX_KEYWORDS + ' keywords');
    s.keywords.push(w); this._save(s); return true;
  },
  removeKeyword(word) {
    const s = this._load();
    const next = s.keywords.filter(k => k.toLowerCase() !== String(word).toLowerCase());
    if (next.length === s.keywords.length) return false;
    s.keywords = next; this._save(s); return true;
  },
  addSite(source) {
    const w = String(source == null ? '' : source).trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,40}$/.test(w)) throw new Error('A VIP site is a panel name such as whatsapp');
    const s = this._load();
    if (s.sites.includes(w)) return false;
    if (s.sites.length >= this.MAX_SITES) throw new Error('At most ' + this.MAX_SITES + ' VIP sites');
    s.sites.push(w); this._save(s); return true;
  },
  removeSite(source) {
    const s = this._load();
    const w = String(source).toLowerCase();
    if (!s.sites.includes(w)) return false;
    s.sites = s.sites.filter(x => x !== w); this._save(s); return true;
  },

  _esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); },
  _has(text, term) {
    return new RegExp('(^|[^\\p{L}\\p{N}_])' + this._esc(term) + '($|[^\\p{L}\\p{N}_])', 'iu').test(text);
  },

  // -> null, or { kind: 'person' | 'keyword' | 'site', label } for the first rule that matches.
  hit(text, source) {
    const s = this._load();
    if (!s.on) return null;
    if (source && s.sites.includes(String(source).toLowerCase())) return { kind: 'site', label: String(source) };
    const t = String(text == null ? '' : text);
    if (!t) return null;
    for (const p of s.people) {
      for (const term of [p.name, ...(p.aliases || [])]) if (this._has(t, term)) return { kind: 'person', label: p.name };
    }
    for (const k of s.keywords) if (this._has(t, k)) return { kind: 'keyword', label: k };
    return null;
  },
};

if (typeof window !== 'undefined') window.VipRules = VipRules;
if (typeof module !== 'undefined' && module.exports) module.exports = { VipRules };
