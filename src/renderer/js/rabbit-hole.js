// === Rabbit hole: "take me somewhere interesting" ===========================
//
// One button that opens a page chosen from what the person already has:
// history, bookmarks and Read Later. There is no recommender and no network
// request to choose: the pick is made here, on this PC, from local lists.
//
// What makes a page a good pick:
//   * Read Later (unread) and bookmarks count for more than a visit;
//   * the longer since it was seen, the better ("I forgot about that");
//   * hosts the interests profile knows (js/interests-profile.js, when it is
//     on) get a small lift;
//   * hosts the person marked "good" get a lift, hosts they skipped repeatedly
//     are left alone;
//   * something shown in the last two weeks, visited in the last day, or
//     skipped is not offered again, and login/checkout-like pages never are.
//
// Feedback ("Good find" / "Skip") is stored under 'vex.rabbitHole' on this PC
// only, as small per-host counters and per-address verdicts. It is optional:
// ignoring the bar costs nothing and nothing is asked twice.
//
// Off until switched on in Settings > Little surprises (js/delights.js).
const VexRabbitHole = {
  KEY: 'vex.rabbitHole',
  DAY: 24 * 3600 * 1000,
  SEEN_DAYS: 14,
  SKIP_DAYS: 60,
  RECENT_DAYS: 1,
  MAX_URLS: 400,
  MAX_HOSTS: 200,
  HOST_SKIP_LIMIT: 3,
  SOURCE_WEIGHT: { readlater: 3, bookmark: 2, history: 1 },
  _bar: null,
  _lastTabId: null,

  // ---- storage -------------------------------------------------------------
  // Unreadable data is an error: an empty model would be saved over it.
  _read() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return { v: 1, hosts: {}, urls: {}, seen: {} };
    let m;
    try { m = JSON.parse(raw); } catch (err) { throw new Error('The rabbit-hole feedback could not be read', { cause: err }); }
    if (!m || typeof m !== 'object') return { v: 1, hosts: {}, urls: {}, seen: {} };
    return { v: 1, hosts: m.hosts && typeof m.hosts === 'object' ? m.hosts : {}, urls: m.urls && typeof m.urls === 'object' ? m.urls : {}, seen: m.seen && typeof m.seen === 'object' ? m.seen : {} };
  },
  _write(m) {
    const trim = (obj, max, byAt) => {
      const keys = Object.keys(obj);
      if (keys.length <= max) return;
      keys.sort((a, b) => byAt(obj[a]) - byAt(obj[b])).slice(0, keys.length - max).forEach(k => { delete obj[k]; });
    };
    trim(m.urls, this.MAX_URLS, v => (v && v.at) || 0);
    trim(m.seen, this.MAX_URLS, v => Number(v) || 0);
    trim(m.hosts, this.MAX_HOSTS, v => (v && v.at) || 0);
    localStorage.setItem(this.KEY, JSON.stringify(m));
  },
  reset() { localStorage.removeItem(this.KEY); },
  summary() {
    const m = this._read();
    let good = 0, skip = 0;
    for (const h of Object.values(m.hosts)) { good += Number(h.good) || 0; skip += Number(h.skip) || 0; }
    return { good, skip, hosts: Object.keys(m.hosts).length };
  },

  // ---- candidates (pure given the lists) ------------------------------------
  hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
  },
  _key(url) { return String(url).replace(/#.*$/, '').replace(/\/$/, ''); },
  _boring(url) {
    if (!/^https?:\/\//i.test(url)) return true;
    return /\/(log-?in|sign-?in|sign-?up|log-?out|checkout|cart|account|password|oauth|auth)(\/|\?|$)/i.test(url);
  },

  // lists: { history: [{url,title,visitedAt}], bookmarks: [{url,title,at}], readLater: [{url,title,at,read}] }
  gather(lists) {
    const out = new Map();
    const take = (url, title, at, source, extra) => {
      if (typeof url !== 'string' || this._boring(url)) return;
      const key = this._key(url);
      const cur = out.get(key);
      const w = this.SOURCE_WEIGHT[source];
      const entry = { url, title: title || url, source, at: Number(at) || 0, lastSeen: Number(at) || 0, visits: 1, ...(extra || {}) };
      if (!cur) { out.set(key, entry); return; }
      cur.visits += 1;
      cur.lastSeen = Math.max(cur.lastSeen, entry.lastSeen);
      if (w > this.SOURCE_WEIGHT[cur.source]) { cur.source = source; cur.title = entry.title; cur.url = entry.url; }
    };
    for (const b of (lists.readLater || [])) if (b && !b.read && !b.ownSession) take(b.url, b.title, b.at, 'readlater');
    for (const b of (lists.bookmarks || [])) if (b && !b.ownSession && !b.archived) take(b.url, b.title, b.at, 'bookmark');
    for (const h of (lists.history || [])) {
      if (!h || h.ownSession) continue;
      const t = Date.parse(h.visitedAt || '') || Number(h.time) || 0;
      take(h.url, h.title, t, 'history');
    }
    return [...out.values()];
  },

  // Score and filter. ctx: { now, model, interest(host) -> number }
  rank(cands, ctx) {
    const now = ctx.now, m = ctx.model;
    const out = [];
    for (const c of cands) {
      const key = this._key(c.url);
      const seen = Number(m.seen[key]) || 0;
      if (seen && now - seen < this.SEEN_DAYS * this.DAY) continue;
      const v = m.urls[key];
      if (v && v.v === 'skip' && now - v.at < this.SKIP_DAYS * this.DAY) continue;
      if (c.lastSeen && now - c.lastSeen < this.RECENT_DAYS * this.DAY) continue;
      const host = this.hostOf(c.url);
      const hf = m.hosts[host] || { good: 0, skip: 0 };
      if ((Number(hf.skip) || 0) - (Number(hf.good) || 0) >= this.HOST_SKIP_LIMIT) continue;
      const ageDays = c.lastSeen ? (now - c.lastSeen) / this.DAY : 60;
      let score = this.SOURCE_WEIGHT[c.source] + Math.min(2, ageDays / 30);
      score += Math.min(3, Math.max(0, ctx.interest ? ctx.interest(host) : 0));
      score += Math.max(-3, Math.min(2, 0.7 * (Number(hf.good) || 0) - 1.0 * (Number(hf.skip) || 0)));
      out.push({ ...c, host, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  },

  // One page, chosen among the best few with a little chance so the button
  // does not give the same answer twice. rng defaults to Math.random.
  pick(lists, { now = Date.now(), rng = Math.random, model = null, interest = null } = {}) {
    const ranked = this.rank(this.gather(lists), { now, model: model || this._read(), interest });
    if (!ranked.length) return null;
    const top = ranked.slice(0, 8);
    const jittered = top.map(c => ({ c, v: c.score + rng() * 1.5 })).sort((a, b) => b.v - a.v);
    return jittered[0].c;
  },

  // ---- live wiring ----------------------------------------------------------
  _lists() {
    return {
      history: (typeof HistoryPanel !== 'undefined' && typeof HistoryPanel.list === 'function') ? HistoryPanel.list() : [],
      bookmarks: (typeof Bookmarks !== 'undefined' && Array.isArray(Bookmarks.items)) ? Bookmarks.items : [],
      readLater: (typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items)) ? ReadLater.items : [],
    };
  },
  _interestFn() {
    if (typeof VexInterests === 'undefined' || typeof VexInterests.bonus !== 'function') return null;
    return (host) => VexInterests.bonus(['host:' + host]);
  },

  isEnabled() { return typeof VexDelights !== 'undefined' && VexDelights.isOn('rabbit'); },

  // Choose and open. `replace` closes the tab the last pick opened (a skip
  // swaps the page instead of piling tabs up).
  async surprise({ replace = false } = {}) {
    const pick = this.pick(this._lists(), { interest: this._interestFn() });
    if (!pick) throw new Error('Nothing to pick from yet. Browse a little, or save a few bookmarks or Read Later pages, and try again.');
    const m = this._read();
    m.seen[this._key(pick.url)] = Date.now();
    this._write(m);
    if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not available in this window');
    const prev = this._lastTabId;
    const id = TabManager.createTab(pick.url, true);
    this._lastTabId = id;
    if (replace && prev != null && typeof TabManager.closeTab === 'function') {
      try { TabManager.closeTab(prev); } catch (err) { console.error('[RabbitHole] could not close the skipped tab:', err.message); }
    }
    this._signal('rabbit-hole-first');
    this.showBar(pick);
    return pick;
  },

  feedback(url, verdict) {
    if (verdict !== 'good' && verdict !== 'skip') throw new Error('Feedback is "good" or "skip"');
    const m = this._read();
    const now = Date.now();
    m.urls[this._key(url)] = { v: verdict, at: now };
    const host = this.hostOf(url);
    if (host) {
      const h = m.hosts[host] || { good: 0, skip: 0, at: now };
      h[verdict] = (Number(h[verdict]) || 0) + 1;
      h.at = now;
      m.hosts[host] = h;
    }
    this._write(m);
    if (verdict === 'good') {
      this._signal('rabbit-hole-good');
      if (typeof VexInterests !== 'undefined' && typeof VexInterests.record === 'function' && typeof BriefActions !== 'undefined' && BriefActions.isOn('interests')) {
        VexInterests.record(['host:' + host]);
      }
    }
  },

  _signal(id) {
    try { document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id } })); } catch (err) { console.error('[RabbitHole] medal signal failed:', err.message); }
  },

  // A small, quiet bar: two buttons, dismissable, gone by itself.
  showBar(pick) {
    this.hideBar();
    if (typeof document === 'undefined' || !document.body) return null;
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const bar = mk('div', 'vex-delight-bar');
    bar.setAttribute('role', 'status');
    const label = mk('span', 'vex-delight-bar-text', pick.title.length > 70 ? pick.title.slice(0, 69) + '…' : pick.title);
    label.title = pick.url;
    const btn = (text, icon, onClick) => {
      const b = mk('button', 'btn-secondary vex-delight-btn');
      b.type = 'button';
      if (typeof VexIcons !== 'undefined') b.innerHTML = VexIcons.svg(icon, { size: 14 });
      b.appendChild(mk('span', '', text));
      b.addEventListener('click', onClick);
      return b;
    };
    const run = (fn) => { try { fn(); } catch (err) { window.showToast?.(err.message, 'error'); } };
    bar.append(
      label,
      btn('Good find', 'check', () => { run(() => this.feedback(pick.url, 'good')); this.hideBar(); window.showToast?.('Noted, you will see more like it', 'info', 2000); }),
      btn('Skip', 'shuffle', () => {
        run(() => this.feedback(pick.url, 'skip'));
        this.hideBar();
        this.surprise({ replace: true }).catch(err => window.showToast?.(err.message, 'error'));
      }),
    );
    const close = mk('button', 'vex-delight-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    if (typeof VexIcons !== 'undefined') close.innerHTML = VexIcons.svg('x', { size: 13 });
    close.addEventListener('click', () => this.hideBar());
    bar.appendChild(close);
    document.body.appendChild(bar);
    this._bar = bar;
    this._barTimer = setTimeout(() => this.hideBar(), 25000);
    return bar;
  },
  hideBar() {
    clearTimeout(this._barTimer);
    if (this._bar) { this._bar.remove(); this._bar = null; }
  },

  command: {
    id: 'rabbit-hole',
    label: 'Take Me Somewhere Interesting',
    hint: 'Opens a page from your own history, bookmarks or Read Later, chosen on this PC',
    icon: 'compass',
    action: async () => {
      try {
        if (!VexRabbitHole.isEnabled()) throw new Error('Turn on "Take me somewhere interesting" in Settings > Little surprises first');
        await VexRabbitHole.surprise();
      } catch (err) { window.showToast?.(err.message, 'error'); }
    },
  },
};

if (typeof window !== 'undefined') window.VexRabbitHole = VexRabbitHole;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRabbitHole };
