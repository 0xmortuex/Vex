// === AI news: what is new, told the way you chose ===========================
//
// Vex polls ONE address, a JSON file that the AI News Tracker publishes
// (github.com/0xmortuex/ai-news-tracker), and tells you about the stories that
// match what you asked to hear about, on the channels you picked for them.
//
//   * Off until you turn it on (Settings › AI news).
//   * The address is a setting. Only that address is asked for; nothing about
//     you is sent (no identifier, no list of what you follow), and the request
//     carries no cookies (api:request publicOnly).
//   * No AI anywhere in this path: matching is plain rules over the fields the
//     file already carries (topics, companies, models, sources, keywords,
//     importance, breaking).
//   * The first look is the baseline: what is already there is not news.
//   * A game or battery saving holds the poll (VexJobs, deferOnBattery); the
//     one run it owes happens when it ends. Quiet hours hold the toasts.
//
// The contract, "ai-news/1" (additive changes only; unknown fields are
// ignored; another schema is refused, in words):
//   { schema: 'ai-news/1', generatedAt: ISO,
//     items: [{ id, cluster?, title, url (https), source, sourceId?, sourceKind?,
//               country?, lang?, publishedAt?, firstSeenAt?, kind?, importance?
//               (0-100), companies?[], models?[], topics?[], summary?,
//               alsoIn?[], breaking? }] }
//
// The pure parts (validate, evaluate, quiet hours, plan) take their inputs as
// arguments and are tested without a window (tests/renderer/aiNews*.test.js).
const AINews = {
  SCHEMA: 'ai-news/1',
  PREFS_KEY: 'vex.aiNews.prefs',
  STATE_KEY: 'vex.aiNews.state',
  DEFAULT_FEED: 'https://raw.githubusercontent.com/0xmortuex/ai-news-tracker/data/news.json',
  JOB: 'AI News',
  TICK_MS: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  MAX_BACKOFF_MS: 6 * 60 * 60 * 1000,
  LIMITS: { items: 300, seen: 2000, clusters: 500, queue: 60, digest: 100, feedBytes: 2 * 1024 * 1024, title: 200, summary: 400, source: 80, list: 12, word: 60, url: 2048 },

  // What a person can follow or mute. A topic is matched against the item's own
  // topics, its kind and its country/language, so "china" and "turkey" work
  // even when the file does not tag them.
  TOPICS: [
    { id: 'model-release', label: 'Model releases' },
    { id: 'research', label: 'Research and papers' },
    { id: 'open-source', label: 'Open source and open weights' },
    { id: 'policy', label: 'Policy and regulation' },
    { id: 'hardware', label: 'Chips and hardware' },
    { id: 'funding', label: 'Funding and business' },
    { id: 'safety', label: 'Safety and security' },
    { id: 'tools', label: 'Tools and products' },
    { id: 'china', label: 'China' },
    { id: 'turkey', label: 'Turkey' },
  ],
  TOPIC_ALIASES: {
    'open-weights': 'open-source', 'open source': 'open-source', opensource: 'open-source',
    chips: 'hardware', gpu: 'hardware', gpus: 'hardware', regulation: 'policy', law: 'policy',
    paper: 'research', papers: 'research', security: 'safety', alignment: 'safety',
    product: 'tools', tool: 'tools', release: 'model-release', 'model release': 'model-release',
  },
  KIND_TOPIC: { 'model-release': 'model-release', paper: 'research', policy: 'policy', funding: 'funding', security: 'safety', tool: 'tools', product: 'tools' },
  KINDS: ['model-release', 'paper', 'policy', 'funding', 'product', 'tool', 'opinion', 'security', 'other'],
  COMPANIES: ['OpenAI', 'Anthropic', 'Google', 'Meta', 'Microsoft', 'NVIDIA', 'Mistral', 'xAI', 'DeepSeek', 'Alibaba', 'Apple', 'Amazon'],
  CHANNELS: ['windows', 'toast', 'badge', 'digest'],
  CHANNEL_LABELS: { windows: 'Windows notification', toast: 'In-Vex pop-up', badge: 'Toolbar badge', digest: 'Daily digest' },

  // ---- preferences ------------------------------------------------------------------
  defaults() {
    return {
      v: 1,
      enabled: false,
      feedUrl: this.DEFAULT_FEED,
      pollMinutes: 15,
      channels: { windows: true, toast: true, badge: true },
      // Stories that match a follow below, with no rule of their own.
      followChannels: ['windows', 'toast', 'badge'],
      // A story no rule or follow matched: 'panel' lists it only; 'badge' also
      // counts it on the toolbar; 'drop' does not keep it.
      defaultAction: 'panel',
      minImportance: 40,
      breakingOnly: false,
      sound: true,
      quietHours: { enabled: false, from: '23:00', to: '08:00', allowBreaking: false },
      caps: { windowsPerHour: 4, toastPerHour: 8, catchUpMax: 5 },
      digest: { enabled: false, at: '08:30' },
      follow: { topics: [], companies: [], models: [], sources: [], keywords: [] },
      mute: { topics: [], companies: [], models: [], sources: [], keywords: [] },
      rules: [{
        id: 'rule-model-releases', name: 'Model releases from the big labs', enabled: true,
        match: { kinds: ['model-release'], companies: ['OpenAI', 'Anthropic', 'Google', 'Meta'], minImportance: 40 },
        channels: ['windows', 'toast', 'badge'], sound: true,
      }],
    };
  },

  _note(area, message, err) { const v = typeof globalThis !== 'undefined' ? globalThis.VexProblems : null; if (v && typeof v.note === 'function') v.note(area, message, err); },

  _readJson(key) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } },
  _writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (err) { this._note('AI news', 'Could not save ' + key, err); return false; }
  },

  _list(v, max = this.LIMITS.list * 8) {
    return Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).map(x => x.slice(0, this.LIMITS.word)))].slice(0, max) : [];
  },
  _hhmm(v, fallback) { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback; },
  _num(v, lo, hi, fallback) { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback; },

  // Whatever is saved, made into a complete, valid object: a hand-edited or
  // restored value cannot put a missing or wrong field in front of the engine.
  sanitizePrefs(raw) {
    const d = this.defaults();
    const s = raw && typeof raw === 'object' ? raw : {};
    const sub = (k) => (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) ? s[k] : {});
    const lists = (o, base) => Object.fromEntries(Object.keys(base).map(k => [k, this._list(o[k])]));
    const channelsOf = (arr, fallback) => {
      const out = Array.isArray(arr) ? arr.filter(c => this.CHANNELS.includes(c)) : fallback;
      return [...new Set(out)];
    };
    const rules = Array.isArray(s.rules) ? s.rules : d.rules;
    return {
      v: 1,
      enabled: s.enabled === true,
      feedUrl: typeof s.feedUrl === 'string' && s.feedUrl.trim() ? s.feedUrl.trim().slice(0, this.LIMITS.url) : d.feedUrl,
      pollMinutes: this._num(s.pollMinutes, 10, 360, d.pollMinutes),
      channels: {
        windows: sub('channels').windows !== false,
        toast: sub('channels').toast !== false,
        badge: sub('channels').badge !== false,
      },
      followChannels: channelsOf(s.followChannels, d.followChannels),
      defaultAction: ['panel', 'badge', 'drop'].includes(s.defaultAction) ? s.defaultAction : d.defaultAction,
      minImportance: this._num(s.minImportance, 0, 100, d.minImportance),
      breakingOnly: s.breakingOnly === true,
      sound: s.sound !== false,
      quietHours: {
        enabled: sub('quietHours').enabled === true,
        from: this._hhmm(sub('quietHours').from, d.quietHours.from),
        to: this._hhmm(sub('quietHours').to, d.quietHours.to),
        allowBreaking: sub('quietHours').allowBreaking === true,
      },
      caps: {
        windowsPerHour: this._num(sub('caps').windowsPerHour, 0, 60, d.caps.windowsPerHour),
        toastPerHour: this._num(sub('caps').toastPerHour, 0, 120, d.caps.toastPerHour),
        catchUpMax: this._num(sub('caps').catchUpMax, 0, 30, d.caps.catchUpMax),
      },
      digest: { enabled: sub('digest').enabled === true, at: this._hhmm(sub('digest').at, d.digest.at) },
      follow: lists(sub('follow'), d.follow),
      mute: lists(sub('mute'), d.mute),
      rules: rules.slice(0, 40).filter(r => r && typeof r === 'object').map((r, i) => this.sanitizeRule(r, i)),
    };
  },

  sanitizeRule(r, i = 0) {
    const m = r.match && typeof r.match === 'object' ? r.match : {};
    const id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : 'rule-' + (i + 1);
    const out = {
      id,
      name: (typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Rule ' + (i + 1)).slice(0, 80),
      enabled: r.enabled !== false,
      match: {
        kinds: this._list(m.kinds).filter(k => this.KINDS.includes(k)),
        topics: this._list(m.topics),
        companies: this._list(m.companies),
        models: this._list(m.models),
        sources: this._list(m.sources),
        keywords: this._list(m.keywords),
        minImportance: this._num(m.minImportance, 0, 100, 0),
        breakingOnly: m.breakingOnly === true,
      },
      channels: [...new Set((Array.isArray(r.channels) ? r.channels : []).filter(c => this.CHANNELS.includes(c)))],
      sound: r.sound !== false,
    };
    return out;
  },

  prefs() { return this.sanitizePrefs(this._readJson(this.PREFS_KEY)); },

  // Merge a patch (objects merge one level down; lists and scalars replace).
  // Throws, in words, for an address that cannot be used.
  setPrefs(patch) {
    if (this._privateWindow()) throw new Error(this.PRIVATE_REFUSED);
    const cur = this.prefs();
    const next = { ...cur };
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in cur) || k === 'v') continue;
      next[k] = v && typeof v === 'object' && !Array.isArray(v) && cur[k] && typeof cur[k] === 'object' && !Array.isArray(cur[k]) ? { ...cur[k], ...v } : v;
    }
    if ('feedUrl' in patch) this.checkFeedUrl(String(patch.feedUrl || '').trim());
    const clean = this.sanitizePrefs(next);
    this._writeJson(this.PREFS_KEY, clean);
    this._changed('prefs');
    return clean;
  },

  PRIVATE_REFUSED: 'A private window does not keep AI news: what it fetched would be remembered after it closes',
  _privateWindow() { return typeof window !== 'undefined' && !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },

  _isLoopback(host) { return /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(host); },
  // https always; plain http only to this computer (a local test feed).
  checkFeedUrl(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { throw new Error('The AI news address is not a valid web address'); }
    if (u.username || u.password) throw new Error('The AI news address may not carry a login');
    if (u.protocol === 'https:') return u.toString();
    if (u.protocol === 'http:' && this._isLoopback(u.hostname)) return u.toString();
    throw new Error('The AI news address must start with https://');
  },

  // ---- the contract -----------------------------------------------------------------
  _str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; },
  _strs(v) { return Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => x.trim().slice(0, this.LIMITS.word)).filter(Boolean).slice(0, this.LIMITS.list) : []; },

  // One feed entry, as the engine holds it, or null when it cannot be used.
  sanitizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = this._str(raw.id, 64);
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) return null;
    const title = this._str(raw.title, this.LIMITS.title);
    if (!title) return null;
    let url = '';
    try {
      const u = new URL(this._str(raw.url, this.LIMITS.url));
      if (u.protocol !== 'https:' || u.username || u.password) return null;
      url = u.toString();
    } catch { return null; }
    const t = Date.parse(raw.publishedAt || raw.firstSeenAt || '');
    const imp = Number(raw.importance);
    return {
      id, title, url,
      cluster: this._str(raw.cluster, 64) || id,
      source: this._str(raw.source, this.LIMITS.source) || (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; } })(),
      sourceId: this._str(raw.sourceId, 64),
      sourceKind: this._str(raw.sourceKind, 24),
      country: this._str(raw.country, 8).toUpperCase(),
      lang: this._str(raw.lang, 8).toLowerCase(),
      kind: this.KINDS.includes(raw.kind) ? raw.kind : 'other',
      importance: Number.isFinite(imp) ? Math.min(100, Math.max(0, Math.round(imp))) : 0,
      companies: this._strs(raw.companies),
      models: this._strs(raw.models),
      topics: this._strs(raw.topics),
      summary: this._str(raw.summary, this.LIMITS.summary),
      alsoIn: Array.isArray(raw.alsoIn) ? raw.alsoIn.filter(a => a && typeof a === 'object').slice(0, 10).map(a => ({ source: this._str(a.source, this.LIMITS.source) })) : [],
      breaking: raw.breaking === true,
      publishedAt: Number.isFinite(t) ? t : 0,
    };
  },

  // The whole file. Throws for what must not be trusted: not JSON-shaped,
  // another schema, no list. Returns { items, dropped, generatedAt }.
  validateFeed(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('The AI news file is not a JSON object');
    if (json.schema !== this.SCHEMA) {
      throw new Error('The AI news file uses schema "' + this._str(String(json.schema), 40) + '", and this Vex understands ' + this.SCHEMA + ' — not used');
    }
    if (!Array.isArray(json.items)) throw new Error('The AI news file has no list of items');
    const items = [];
    let dropped = 0;
    const seen = new Set();
    for (const raw of json.items.slice(0, 2000)) {
      const it = this.sanitizeItem(raw);
      if (!it || seen.has(it.id)) { dropped++; continue; }
      seen.add(it.id);
      items.push(it);
    }
    if (json.items.length && !items.length) throw new Error('None of the ' + json.items.length + ' items in the AI news file could be used');
    return { items, dropped, generatedAt: Date.parse(json.generatedAt || '') || 0 };
  },

  // ---- the rule engine (pure) -------------------------------------------------------
  _norm(s) { return String(s || '').toLowerCase().trim(); },
  _has(list, value) { const v = this._norm(value); return list.some(x => this._norm(x) === v); },
  _word(text, term) {
    const t = this._norm(term);
    if (!t) return false;
    if (t.length < 3) return false;
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)').test(this._norm(text));
  },

  // The topics an item counts as: its own, its kind's, and where it is from.
  topicsOf(item) {
    const out = new Set();
    for (const t of item.topics || []) {
      const n = this._norm(t);
      out.add(this.TOPIC_ALIASES[n] || n);
    }
    if (this.KIND_TOPIC[item.kind]) out.add(this.KIND_TOPIC[item.kind]);
    if (item.country === 'CN') out.add('china');
    if (item.lang === 'tr' || item.country === 'TR') out.add('turkey');
    return [...out];
  },

  // Which of `lists` (topics/companies/models/sources/keywords) the item
  // matches, as readable reasons. Empty when none.
  matches(item, lists) {
    const why = [];
    const title = item.title + ' ' + item.summary;
    const topics = this.topicsOf(item);
    for (const t of lists.topics || []) {
      const n = this.TOPIC_ALIASES[this._norm(t)] || this._norm(t);
      if (topics.includes(n)) why.push('topic ' + n);
    }
    for (const c of lists.companies || []) {
      if (this._has(item.companies, c) || this._word(item.title, c)) why.push('company ' + c);
    }
    for (const m of lists.models || []) {
      if (this._has(item.models, m) || this._word(item.title, m)) why.push('model ' + m);
    }
    for (const s of lists.sources || []) {
      if (this._norm(item.source) === this._norm(s) || (item.sourceId && this._norm(item.sourceId) === this._norm(s))) why.push('source ' + item.source);
    }
    for (const k of lists.keywords || []) {
      if (this._norm(k) && this._norm(title).includes(this._norm(k))) why.push('keyword "' + k + '"');
    }
    return why;
  },

  // A rule matches when every dimension it names matches (several values in
  // one dimension: any of them). A rule that names nothing matches nothing.
  ruleMatches(item, rule) {
    const m = rule.match || {};
    const dims = [];
    const why = [];
    const check = (name, got) => { dims.push(name); if (got.length) why.push(...got); return got.length > 0; };
    let ok = true;
    if (m.kinds && m.kinds.length) { ok = check('kinds', m.kinds.includes(item.kind) ? ['kind ' + item.kind] : []) && ok; }
    if (m.topics && m.topics.length) ok = check('topics', this.matches(item, { topics: m.topics })) && ok;
    if (m.companies && m.companies.length) ok = check('companies', this.matches(item, { companies: m.companies })) && ok;
    if (m.models && m.models.length) ok = check('models', this.matches(item, { models: m.models })) && ok;
    if (m.sources && m.sources.length) ok = check('sources', this.matches(item, { sources: m.sources })) && ok;
    if (m.keywords && m.keywords.length) ok = check('keywords', this.matches(item, { keywords: m.keywords })) && ok;
    if (m.minImportance > 0) ok = check('importance', item.importance >= m.minImportance ? ['importance ' + item.importance + ' (at least ' + m.minImportance + ')'] : []) && ok;
    if (m.breakingOnly) ok = check('breaking', item.breaking ? ['breaking'] : []) && ok;
    if (!dims.length) return { ok: false, why: [] };
    return { ok, why: ok ? why : [] };
  },

  // One item against the preferences. Order: mute, then the first enabled rule
  // that matches, then the follow lists, then what to do with the rest.
  // → { action: 'mute'|'drop'|'keep', channels[], sound, rule: {id,name,kind}|null, why, interrupt }
  evaluate(item, prefs) {
    const muted = this.matches(item, prefs.mute);
    if (muted.length) return { action: 'mute', channels: [], sound: false, rule: null, why: 'Muted: ' + muted.join(', '), interrupt: false };

    let channels = [];
    let rule = null, reasons = [], sound = prefs.sound;
    for (const r of prefs.rules) {
      if (!r.enabled) continue;
      const m = this.ruleMatches(item, r);
      if (m.ok) { channels = r.channels.slice(); rule = { id: r.id, name: r.name, kind: 'rule' }; reasons = m.why; sound = r.sound && prefs.sound; break; }
    }
    if (!rule) {
      const f = this.matches(item, prefs.follow);
      if (f.length) { channels = prefs.followChannels.slice(); rule = { id: 'follow', name: 'Something you follow', kind: 'follow' }; reasons = f; }
    }
    if (!rule) {
      if (prefs.defaultAction === 'drop') return { action: 'drop', channels: [], sound: false, rule: null, why: 'No rule or follow matched, and other stories are hidden', interrupt: false };
      const badge = prefs.defaultAction === 'badge';
      return { action: 'keep', channels: badge ? ['badge'] : [], sound: false, rule: { id: 'default', name: 'Everything else', kind: 'default' }, why: 'No rule or follow matched; listed in the panel' + (badge ? ' and counted on the badge' : ''), interrupt: false };
    }

    // The global switches, then the importance floor and "breaking only".
    channels = channels.filter(c => c === 'digest' || prefs.channels[c] !== false);
    const notes = [];
    if (channels.some(c => c === 'windows' || c === 'toast')) {
      if (item.importance < prefs.minImportance) { channels = channels.filter(c => c !== 'windows' && c !== 'toast'); notes.push('importance ' + item.importance + ' is under your minimum of ' + prefs.minImportance); }
      else if (prefs.breakingOnly && !item.breaking) { channels = channels.filter(c => c !== 'windows' && c !== 'toast'); notes.push('you chose breaking stories only'); }
    }
    const why = 'Matched ' + (rule.kind === 'rule' ? 'the rule "' + rule.name + '"' : rule.name.toLowerCase()) + ' (' + reasons.join(', ') + ')'
      + (notes.length ? '; no pop-up because ' + notes.join(' and ') : '');
    return { action: 'keep', channels, sound, rule, why, interrupt: channels.includes('windows') || channels.includes('toast') };
  },

  // ---- quiet hours (pure) -----------------------------------------------------------
  _minutes(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; },
  // `from` to `to`, local time; a range that crosses midnight (23:00-08:00) is
  // the evening from and the morning to. from === to is no time at all.
  inQuietHours(now, qh) {
    if (!qh || !qh.enabled) return false;
    const a = this._minutes(qh.from), b = this._minutes(qh.to);
    if (a === b) return false;
    const d = new Date(now);
    const m = d.getHours() * 60 + d.getMinutes();
    return a < b ? (m >= a && m < b) : (m >= a || m < b);
  },
  // The next time quiet hours end after `now`, as epoch ms (for the status line).
  quietEndsAt(now, qh) {
    const b = this._minutes(qh.to);
    const d = new Date(now);
    d.setHours(Math.floor(b / 60), b % 60, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  },

  // ---- delivery plan (pure) ---------------------------------------------------------
  // verdicts: [{ item, verdict }], ctx: { now, prefs, held: ''|reason,
  // sentWindows, sentToast } (counts in the last hour). Returns what to do:
  //   windows[], toast[]   items to show one by one
  //   summary              { count, items[] } the ones over a cap, as ONE line
  //   queued[]             items held for quiet hours or a game
  //   digest[], badge[]    ids
  plan(verdicts, ctx) {
    const { now, prefs } = ctx;
    const out = { windows: [], toast: [], summary: { count: 0, items: [] }, queued: [], digest: [], badge: [], quiet: false };
    const quiet = this.inQuietHours(now, prefs.quietHours);
    out.quiet = quiet;
    const order = verdicts.slice().sort((a, b) => (Number(b.item.breaking) - Number(a.item.breaking)) || (b.item.importance - a.item.importance) || (b.item.publishedAt - a.item.publishedAt));
    let winLeft = Math.max(0, prefs.caps.windowsPerHour - (ctx.sentWindows || 0));
    let toastLeft = Math.max(0, prefs.caps.toastPerHour - (ctx.sentToast || 0));
    let catchUp = prefs.caps.catchUpMax;
    for (const { item, verdict } of order) {
      if (verdict.action !== 'keep') continue;
      const ch = verdict.channels;
      if (ch.includes('badge')) out.badge.push(item.id);
      if (ch.includes('digest')) out.digest.push(item.id);
      const wantsWin = ch.includes('windows'), wantsToast = ch.includes('toast');
      if (!wantsWin && !wantsToast) continue;
      const bypass = item.breaking && prefs.quietHours.allowBreaking;
      if ((quiet && !bypass) || ctx.held) { out.queued.push(item); continue; }
      // Over the per-poll catch-up cap or an hourly cap: counted into the
      // one summary line, never dropped silently.
      let delivered = false, overflow = false;
      if (catchUp <= 0) overflow = true;
      else {
        if (wantsWin) { if (winLeft > 0) { out.windows.push({ item, silent: !verdict.sound }); winLeft--; delivered = true; } else overflow = true; }
        if (wantsToast) { if (toastLeft > 0) { out.toast.push({ item }); toastLeft--; delivered = true; } else if (!delivered) overflow = true; }
      }
      if (delivered) catchUp--;
      else if (overflow) { out.summary.count++; if (out.summary.items.length < 3) out.summary.items.push(item); }
    }
    return out;
  },

  _summaryText(items, count) {
    const n = count != null ? count : items.length;
    const lines = items.slice(0, 3).map(i => i.title);
    return {
      title: n === 1 ? 'AI news: 1 new story' : 'AI news: ' + n + ' new stories',
      body: (lines.join(' · ') + (n > lines.length ? ' · and ' + (n - lines.length) + ' more' : '')).slice(0, 400),
    };
  },

  // ---- backoff (pure) ---------------------------------------------------------------
  backoffMs(pollMinutes, failures) {
    const base = Math.max(10, pollMinutes) * 60 * 1000;
    return Math.min(this.MAX_BACKOFF_MS, base * Math.pow(2, Math.max(0, failures)));
  },

  // ---- state ------------------------------------------------------------------------
  _blank() {
    return { v: 1, baselined: false, etag: '', lastModified: '', lastPollAt: 0, lastOkAt: 0, nextPollAt: 0, generatedAt: 0, failures: 0, error: '',
      notModified: 0, items: {}, seen: [], clusters: {}, queue: [], digest: [], digestDay: '', sent: { windows: [], toast: [] }, lastDelivery: null };
  },
  state() {
    if (this._state) return this._state;
    const s = this._readJson(this.STATE_KEY);
    const b = this._blank();
    this._state = s && typeof s === 'object' && s.v === 1 ? { ...b, ...s, sent: { ...b.sent, ...(s.sent || {}) } } : b;
    return this._state;
  },
  _save() { this._writeJson(this.STATE_KEY, this._state || this._blank()); },
  _changed(what) { try { document.dispatchEvent(new CustomEvent('vex:ai-news', { detail: { what } })); } catch { /* no document: a test */ } },
  // For tests and "forget what Vex holds".
  resetState() { this._state = this._blank(); this._save(); this._changed('reset'); },

  list() {
    return Object.values(this.state().items).sort((a, b) => (b.publishedAt || b.firstSeenAt) - (a.publishedAt || a.firstSeenAt));
  },
  get(id) { return this.state().items[id] || null; },
  unseenCount() { return this.list().filter(i => i.badge && !i.read && !i.seenAt).length; },
  unreadCount() { return this.list().filter(i => !i.read).length; },

  tagOf(item) { return 'news-' + String(item.id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 50); },
  byTag(tag) { return this.list().find(i => this.tagOf(i) === tag) || null; },

  _trim(st) {
    const L = this.LIMITS;
    const all = Object.values(st.items);
    if (all.length > L.items) {
      // Read ones go first, oldest first; an unread one is kept longest.
      all.sort((a, b) => (Number(a.read) - Number(b.read) === 0 ? a.firstSeenAt - b.firstSeenAt : (a.read ? -1 : 1)));
      for (const it of all.slice(0, all.length - L.items)) delete st.items[it.id];
    }
    if (st.seen.length > L.seen) st.seen = st.seen.slice(-L.seen);
    const cl = Object.entries(st.clusters);
    if (cl.length > L.clusters) st.clusters = Object.fromEntries(cl.sort((a, b) => a[1] - b[1]).slice(-L.clusters));
    st.queue = st.queue.slice(-L.queue);
    st.digest = st.digest.slice(-L.digest);
  },

  // ---- the poller -------------------------------------------------------------------
  // Injected in tests. request({ url, headers, publicOnly }) → api:request's answer.
  _io: null,
  io() {
    if (this._io) return this._io;
    return {
      request: (o) => { if (!window.vex || typeof window.vex.apiRequest !== 'function') throw new Error('Web access is not available in this build'); return window.vex.apiRequest(o); },
      notify: (p) => { if (!window.vex || !window.vex.news || typeof window.vex.news.notify !== 'function') throw new Error('Windows notifications are not available in this build'); return window.vex.news.notify(p); },
      toast: (text, kind, ms, opts) => (typeof window.showToast === 'function' ? window.showToast(text, kind, ms, opts) : null),
      gaming: () => (typeof GameMode !== 'undefined' && !!GameMode.gaming) || (typeof GameSession !== 'undefined' && !!GameSession.active),
    };
  },

  _fail(st, now, message) {
    st.lastPollAt = now;
    st.failures = Math.min(20, (st.failures || 0) + 1);
    st.error = message;
    st.nextPollAt = now + this.backoffMs(this.prefs().pollMinutes, st.failures);
    this._save();
    this._changed('error');
    this._note('AI news', message);
    return { status: 'error', error: message, retryAt: st.nextPollAt };
  },

  // One look at the feed. Never throws for what the network or the file does:
  // the answer says what happened, the status line shows it, VexProblems keeps it.
  async poll({ now = Date.now(), force = false } = {}) {
    if (this._privateWindow()) return { status: 'off', reason: this.PRIVATE_REFUSED };
    const prefs = this.prefs();
    if (!prefs.enabled) return { status: 'off' };
    const st = this.state();
    if (!force && now < st.nextPollAt) return { status: 'waiting', retryAt: st.nextPollAt };
    if (this._polling) return { status: 'busy' };
    this._polling = true;
    try {
      let url;
      try { url = this.checkFeedUrl(prefs.feedUrl); } catch (err) { return this._fail(st, now, err.message); }
      const headers = { Accept: 'application/json', 'User-Agent': 'Vex Browser AI News' };
      if (st.baselined && st.etag) headers['If-None-Match'] = st.etag;
      if (st.baselined && st.lastModified) headers['If-Modified-Since'] = st.lastModified;
      let r;
      try { r = await this.io().request({ url, headers, publicOnly: !this._isLoopback(new URL(url).hostname) }); }
      catch (err) { return this._fail(st, now, 'Could not ask for the AI news: ' + (err && err.message)); }
      if (!r || r.ok === false) return this._fail(st, now, 'Could not reach the AI news address: ' + ((r && r.error) || 'no answer'));
      st.lastPollAt = now;
      if (r.status === 304) {
        st.failures = 0; st.error = ''; st.notModified++; st.lastOkAt = now;
        st.nextPollAt = now + prefs.pollMinutes * 60000;
        this._save(); this._changed('poll');
        return { status: 'not-modified' };
      }
      if (r.status === 429 || r.status === 503) return this._fail(st, now, 'The AI news address asked Vex to slow down (' + r.status + ')');
      if (r.status < 200 || r.status >= 300) return this._fail(st, now, 'The AI news address answered ' + r.status + (r.status === 404 ? ' (not found: is the address right?)' : ''));
      if (r.capped) return this._fail(st, now, 'The AI news file is larger than Vex reads (5 MB)');
      let json;
      try { json = JSON.parse(String(r.body || '')); }
      catch { return this._fail(st, now, 'The AI news file is not valid JSON'); }
      let feed;
      try { feed = this.validateFeed(json); } catch (err) { return this._fail(st, now, err.message); }
      const h = r.headers || {};
      st.etag = String(h.etag || h.ETag || '').slice(0, 200);
      st.lastModified = String(h['last-modified'] || h['Last-Modified'] || '').slice(0, 100);
      st.failures = 0; st.error = ''; st.lastOkAt = now; st.generatedAt = feed.generatedAt;
      st.nextPollAt = now + prefs.pollMinutes * 60000;
      const summary = await this._ingest(feed.items, now, prefs);
      this._save();
      this._changed('poll');
      return { status: 'ok', dropped: feed.dropped, ...summary };
    } finally { this._polling = false; }
  },

  // New items into the store, then through the rules, then out.
  async _ingest(items, now, prefs) {
    const st = this.state();
    const seen = new Set(st.seen);
    const fresh = items.filter(i => !seen.has(i.id));
    const baseline = !st.baselined;
    const verdicts = [];
    let muted = 0, duplicates = 0;
    // The strongest of a story first, so it is the one that is told.
    fresh.sort((a, b) => (Number(b.breaking) - Number(a.breaking)) || (b.importance - a.importance));
    const known = new Set(Object.keys(st.clusters));
    for (const it of fresh) {
      st.seen.push(it.id);
      if (baseline) {
        st.items[it.id] = { ...it, firstSeenAt: now, read: true, seenAt: now, badge: false, baseline: true, why: 'Already there when you turned AI news on', rule: null, channels: [] };
        if (it.cluster) st.clusters[it.cluster] = now;
        continue;
      }
      const verdict = this.evaluate(it, prefs);
      if (verdict.action === 'mute') { muted++; continue; }
      if (verdict.action === 'drop') continue;
      // The same story from another source: kept (and listed), not told again.
      const dup = !!(it.cluster && known.has(it.cluster));
      if (it.cluster) { known.add(it.cluster); st.clusters[it.cluster] = st.clusters[it.cluster] || now; }
      if (dup) { duplicates++; verdict.channels = []; verdict.interrupt = false; }
      st.items[it.id] = { ...it, firstSeenAt: now, read: false, seenAt: 0, badge: verdict.channels.includes('badge'), why: verdict.why, rule: verdict.rule, channels: verdict.channels.slice(), duplicate: dup };
      verdicts.push({ item: st.items[it.id], verdict });
    }
    st.baselined = true;
    this._trim(st);
    if (baseline) return { baseline: true, added: fresh.length, delivered: 0 };

    const sent = this._pruneSent(st, now);
    const plan = this.plan(verdicts, { now, prefs, held: this.io().gaming() ? 'a game is running' : '', sentWindows: sent.windows.length, sentToast: sent.toast.length });
    for (const id of plan.digest) if (!st.digest.includes(id)) st.digest.push(id);
    for (const it of plan.queued) if (!st.queue.includes(it.id)) st.queue.push(it.id);
    const delivered = await this._deliver(plan, now);
    return { added: fresh.length, muted, duplicates, delivered, queued: plan.queued.length, summarised: plan.summary.count, quiet: plan.quiet };
  },

  _pruneSent(st, now) {
    st.sent.windows = st.sent.windows.filter(t => now - t < this.HOUR);
    st.sent.toast = st.sent.toast.filter(t => now - t < this.HOUR);
    return st.sent;
  },

  // ---- delivery ---------------------------------------------------------------------
  _bodyOf(item) { return ((item.source ? item.source + ' · ' : '') + (item.summary || '')).slice(0, 400); },

  async _windows(payload) {
    try { await this.io().notify(payload); return { ok: true }; }
    catch (err) {
      const message = (err && err.message) || String(err);
      // Locked: nothing was shown on purpose; the item stays queued.
      if (/Vex is locked/.test(message)) return { ok: false, locked: true, error: message };
      this.state().lastDelivery = { at: Date.now(), error: message };
      this._note('AI news', 'The Windows notification did not show', err);
      // Never silent: the same story as a pop-up inside Vex, with the reason.
      this.io().toast('Windows did not show an AI news notification: ' + message, 'error', 9000);
      return { ok: false, error: message };
    }
  },

  _popup(item) {
    const text = item.title + (item.source ? ' — ' + item.source : '');
    return this.io().toast(text, 'info', 12000, {
      actions: [
        { label: 'Open', run: () => { try { this.openItem(item.id); } catch (err) { this.io().toast(err.message, 'error'); } } },
        { label: 'Mute source', run: () => { try { this.muteSource(item.source); } catch (err) { this.io().toast(err.message, 'error'); } } },
      ],
    });
  },

  async _deliver(plan, now = Date.now()) {
    const st = this.state();
    let n = 0;
    const popped = new Set();
    for (const { item, silent } of plan.windows) {
      const r = await this._windows({ title: item.title.slice(0, 120), body: this._bodyOf(item), tag: this.tagOf(item), url: item.url, silent });
      if (r.ok) { st.sent.windows.push(now); n++; }
      else if (r.locked) { if (!st.queue.includes(item.id)) st.queue.push(item.id); }
      else { this._popup(item); popped.add(item.id); n++; }   // refused: the story still appears, inside Vex
    }
    for (const { item } of plan.toast) {
      if (popped.has(item.id)) continue;
      this._popup(item);
      st.sent.toast.push(now); n++;
    }
    if (plan.summary.count > 0) { await this._announceSummary(plan.summary.items, plan.summary.count, now); n++; }
    return n;
  },

  async _announceSummary(items, count, now = Date.now()) {
    const text = this._summaryText(items, count);
    const prefs = this.prefs();
    const st = this.state();
    if (prefs.channels.windows) {
      const r = await this._windows({ title: text.title, body: text.body, tag: 'news-summary-' + now.toString(36), silent: !prefs.sound });
      if (r.ok) st.sent.windows.push(now);
      else if (r.locked) return false;
    }
    if (prefs.channels.toast) {
      this.io().toast(text.title + ' — ' + text.body, 'info', 12000, { actions: [{ label: 'Open', run: () => this._openPanel() }] });
    }
    return true;
  },

  _openPanel() {
    if (typeof AINewsUI !== 'undefined') AINewsUI.openPanel();
    else if (globalThis.AINewsUI) globalThis.AINewsUI.openPanel();
  },

  // What waited for quiet hours or a game, told once, as one line (or the one
  // story, when there is only one).
  async flushQueue(now = Date.now()) {
    const st = this.state();
    const prefs = this.prefs();
    if (!st.queue.length) return 0;
    if (this.inQuietHours(now, prefs.quietHours) || this.io().gaming()) return 0;
    const items = st.queue.map(id => st.items[id]).filter(i => i && !i.read);
    st.queue = [];
    this._save();
    if (!items.length) return 0;
    items.sort((a, b) => (Number(b.breaking) - Number(a.breaking)) || (b.importance - a.importance));
    if (items.length === 1) {
      const it = items[0];
      const r = prefs.channels.windows ? await this._windows({ title: it.title.slice(0, 120), body: this._bodyOf(it), tag: this.tagOf(it), url: it.url, silent: !prefs.sound }) : { ok: false };
      if (r.locked) { st.queue.push(it.id); this._save(); return 0; }
      if (prefs.channels.toast || !r.ok) this._popup(it);
    } else {
      const ok = await this._announceSummary(items, items.length, now);
      if (!ok) { st.queue = items.map(i => i.id); this._save(); return 0; }
    }
    this._changed('flush');
    return items.length;
  },

  _dayKey(now) { const d = new Date(now); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); },
  digestDue(now, prefs = this.prefs()) {
    if (!prefs.digest.enabled) return false;
    const st = this.state();
    if (st.digestDay === this._dayKey(now)) return false;
    const m = this._minutes(prefs.digest.at);
    const d = new Date(now);
    return d.getHours() * 60 + d.getMinutes() >= m;
  },
  // Once a day, at the chosen time (or at once after it if Vex was away):
  // everything that matched a rule's "digest" channel, as one line.
  async sendDigest(now = Date.now()) {
    const prefs = this.prefs();
    const st = this.state();
    if (this.inQuietHours(now, prefs.quietHours) || this.io().gaming()) return 0;
    const items = st.digest.map(id => st.items[id]).filter(i => i && !i.read);
    st.digestDay = this._dayKey(now);
    st.digest = [];
    this._save();
    if (!items.length) return 0;
    items.sort((a, b) => b.importance - a.importance);
    await this._announceSummary(items, items.length, now);
    this._changed('digest');
    return items.length;
  },

  // One shared tick: holds, then the digest, then the poll.
  async tick({ now = Date.now() } = {}) {
    if (this._privateWindow()) return { status: 'off' };
    const prefs = this.prefs();
    if (!prefs.enabled) return { status: 'off' };
    await this.flushQueue(now);
    if (this.digestDue(now, prefs)) await this.sendDigest(now);
    return this.poll({ now });
  },

  start() {
    if (this._job || this._privateWindow()) return false;
    if (typeof VexJobs === 'undefined') throw new Error('AI news needs the background job runner');
    this._job = VexJobs.every(this.JOB, this.TICK_MS, () => this.tick(), { when: 'background', deferOnBattery: true });
    return true;
  },

  // The master switch. Turning it on starts over from a baseline: what is
  // there now is not news, however long it has been off.
  async enable() {
    if (this._privateWindow()) throw new Error(this.PRIVATE_REFUSED);
    this.checkFeedUrl(this.prefs().feedUrl);
    this.setPrefs({ enabled: true });
    const st = this.state();
    st.baselined = false; st.etag = ''; st.lastModified = ''; st.nextPollAt = 0; st.failures = 0; st.error = '';
    this._save();
    this.start();
    return this.poll({ force: true });
  },
  disable() {
    this.setPrefs({ enabled: false });
    this._changed('disabled');
  },

  // ---- what you do with a story -----------------------------------------------------
  markRead(id, read = true) {
    const it = this.get(id);
    if (!it) return false;
    it.read = read; if (read) it.seenAt = it.seenAt || Date.now();
    this._save(); this._changed('read');
    return true;
  },
  markAllRead() {
    const st = this.state();
    const now = Date.now();
    for (const it of Object.values(st.items)) { it.read = true; it.seenAt = it.seenAt || now; }
    this._save(); this._changed('read');
  },
  // The badge counted what you have not looked at; opening the panel is looking.
  markSeen() {
    const st = this.state();
    const now = Date.now();
    let n = 0;
    for (const it of Object.values(st.items)) if (!it.seenAt) { it.seenAt = now; n++; }
    if (n) { this._save(); this._changed('seen'); }
    return n;
  },

  // A recently handled tag: Windows can deliver the click twice (the toast's
  // own and the protocol launch), and a story opens once.
  _recent: {},
  openItem(id, { tag } = {}) {
    const it = this.get(id);
    if (!it) throw new Error('That story is no longer held by Vex');
    const t = Date.now();
    const key = tag || this.tagOf(it);
    if (this._recent[key] && t - this._recent[key] < 4000) return false;
    this._recent[key] = t;
    this.markRead(id);
    if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not available');
    TabManager.createTab(it.url, true);
    return true;
  },

  muteSource(source) {
    const name = this._str(source, this.LIMITS.source);
    if (!name) throw new Error('That story has no source to mute');
    const cur = this.prefs();
    if (!this._has(cur.mute.sources, name)) this.setPrefs({ mute: { sources: cur.mute.sources.concat(name) } });
    this.io().toast('Muted ' + name + ' — no more AI news from it', 'info', 9000, {
      actions: [{ label: 'Undo', run: () => { try { this.unmute('sources', name); } catch (err) { this.io().toast(err.message, 'error'); } } }],
    });
    return name;
  },
  muteTopic(topic) {
    const cur = this.prefs();
    if (!this._has(cur.mute.topics, topic)) this.setPrefs({ mute: { topics: cur.mute.topics.concat(topic) } });
    return topic;
  },
  unmute(dim, value) {
    const cur = this.prefs();
    if (!cur.mute[dim]) throw new Error('Unknown mute list ' + dim);
    this.setPrefs({ mute: { [dim]: cur.mute[dim].filter(x => this._norm(x) !== this._norm(value)) } });
  },

  // "Why was I notified?"
  whyText(id) {
    const it = this.get(id);
    if (!it) return 'Vex no longer holds that story.';
    if (it.baseline) return it.why;
    return (it.why || 'No reason was recorded.') + (it.channels && it.channels.length ? ' Channels: ' + it.channels.map(c => this.CHANNEL_LABELS[c] || c).join(', ') + '.' : ' No channel was set for it.')
      + (it.duplicate ? ' Another source had already reported it.' : '');
  },

  // A real Windows notification and a pop-up, to check the path works.
  async sendTest() {
    if (this._privateWindow()) throw new Error(this.PRIVATE_REFUSED);
    const prefs = this.prefs();
    const title = 'AI News test';
    const body = 'If you can read this, AI news can reach you. Nothing was fetched.';
    this.io().toast(title + ' — ' + body, 'info', 8000);
    if (!prefs.channels.windows) return { windows: false, note: 'The Windows notification channel is off, so only the pop-up was shown.' };
    await this.io().notify({ title, body, tag: 'news-test', silent: !prefs.sound });
    return { windows: true };
  },

  // Clicks and buttons that reached main while this window was not listening.
  async drainClicks() {
    if (!window.vex || !window.vex.news || typeof window.vex.news.pending !== 'function') return 0;
    const list = await window.vex.news.pending();
    let n = 0;
    for (const c of Array.isArray(list) ? list : []) {
      if (!c || typeof c.tag !== 'string') continue;
      const it = this.byTag(c.tag);
      try {
        if (c.action === 'mute') {
          if (!it) throw new Error('That story is no longer held by Vex');
          this.muteSource(it.source);
        } else if (it) {
          this.openItem(it.id, { tag: c.tag });
        } else if (/^news-(summary|test)/.test(c.tag)) {
          this._openPanel();
        } else if (c.url) {
          // Not held any more (cleared, or trimmed): the address came with the toast.
          if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
          TabManager.createTab(c.url, true);
        } else throw new Error('That story is no longer held by Vex');
        n++;
      } catch (err) { this.io().toast((err && err.message) || 'Could not use the notification', 'error'); }
    }
    this._changed('clicks');
    return n;
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (this._privateWindow()) return false;
    if (window.vex && window.vex.news && typeof window.vex.news.onWaiting === 'function') {
      window.vex.news.onWaiting(() => this.drainClicks().catch(err => this._note('AI news', 'Could not take a notification click', err)));
    }
    document.addEventListener('vex:game-mode', (e) => { if (e && e.detail && e.detail.active === false) this.tick().catch(err => this._note('AI news', 'Could not catch up after the game', err)); });
    this.start();
    setTimeout(() => this.drainClicks().catch(err => this._note('AI news', 'Could not take a notification click', err)), 3000);
    return true;
  },

  // For Settings' status line.
  status(now = Date.now()) {
    const p = this.prefs();
    const st = this.state();
    if (!p.enabled) return { text: 'Off', level: 'off' };
    const parts = [];
    if (st.error) parts.push('Last check failed: ' + st.error + (st.nextPollAt > now ? ' (trying again in ' + Math.max(1, Math.round((st.nextPollAt - now) / 60000)) + ' min)' : ''));
    else if (st.lastOkAt) parts.push('Last checked ' + new Date(st.lastOkAt).toLocaleTimeString() + ' — ' + Object.keys(st.items).length + ' stories held');
    else parts.push('Not checked yet');
    if (this.inQuietHours(now, p.quietHours)) parts.push('quiet hours until ' + new Date(this.quietEndsAt(now, p.quietHours)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    if (st.queue.length) parts.push(st.queue.length + ' waiting for the end of quiet hours or the game');
    if (st.lastDelivery && st.lastDelivery.error) parts.push('Windows did not show the last notification: ' + st.lastDelivery.error);
    return { text: parts.join(' · '), level: st.error ? 'error' : 'ok' };
  },
};

if (typeof window !== 'undefined') window.AINews = AINews;
if (typeof module !== 'undefined' && module.exports) module.exports = { AINews };
