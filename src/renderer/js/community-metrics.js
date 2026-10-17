// === Community metrics and name watch (T3-059) ===================================
//
// How big is the community this week, and did it grow? Server members, repo stars,
// group members and channel counts are kept as small series with a sparkline and the
// change since a week ago, in the Morning Brief on the New Tab page and here.
//
// Where a number comes from, in order of how Vex gets it:
//   1. YOU type it (a member count read off your own server's page). Nothing else is needed.
//   2. A public page you point at: a page watch (js/page-watch.js, polite polling, no
//      sign-in, no cookies) with a pattern that pulls the number out of the page. A page
//      that needs a login (Discord, WhatsApp, Slack and the like) is refused: Vex does not
//      sign in to read anything and does not scrape what a login protects.
//
// Name watch: a saved public search address for your own name or product (a search
// results page, a forum tag page). It is an ordinary page watch every hour; Vex tells
// you when what is new on it appears, not the whole page again. Same rule: public pages
// only. The watches are listed here and removed here.
const CommunityMetrics = {
  KEY: 'vex.communityMetrics',
  SOURCE_METRIC: 'community-metrics',
  SOURCE_NAME: 'name-watch',
  MAX_METRICS: 12,
  MAX_POINTS: 120,
  MAX_NAMES: 10,
  METRIC_EVERY: 6 * 3600000,
  NAME_EVERY: 3600000,
  BARS: '▁▂▃▄▅▆▇█',
  // Sites whose pages are behind a login: not watched, not read.
  LOGIN_HOSTS: /(^|\.)(discord\.com|discordapp\.com|web\.whatsapp\.com|whatsapp\.com|slack\.com|app\.slack\.com|teams\.microsoft\.com|mail\.google\.com|facebook\.com|instagram\.com)$/i,

  _now() { return Date.now(); },

  // ---- state -----------------------------------------------------------------------------------
  state() {
    const s = CommsStore.record(this.KEY, { on: true, metrics: [], names: [] }, 'community metrics');
    return {
      on: s.on !== false,
      metrics: Array.isArray(s.metrics) ? s.metrics.filter(m => m && typeof m.id === 'string' && Array.isArray(m.points)) : [],
      names: Array.isArray(s.names) ? s.names.filter(n => n && typeof n.id === 'string') : [],
    };
  },
  _save(s) { CommsStore.write(this.KEY, s); CommsStore.emit('vex:community-metrics'); },
  enabled() { return this.state().on; },
  setEnabled(on) { const s = this.state(); s.on = !!on; this._save(s); },
  metrics() { return this.state().metrics; },
  names() { return this.state().names; },

  _day(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },

  // ---- public-page address check -------------------------------------------------------------------
  checkUrl(text) {
    let u;
    try { u = new URL(String(text == null ? '' : text).trim()); } catch { throw new Error('Paste the full address of a public page, starting with https://'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only a web page (http or https) can be watched');
    if (u.username || u.password) throw new Error('Leave the user name and password out of the address: only public pages are read');
    if (this.LOGIN_HOSTS.test(u.hostname)) throw new Error(u.hostname + ' needs a sign-in to show its numbers. Vex does not sign in to read pages: type the number in yourself instead.');
    return u.href;
  },

  // ---- the numbers -------------------------------------------------------------------------------------
  addMetric({ label, unit = '' } = {}) {
    if (!this.enabled()) throw new Error('Community metrics are switched off in Settings');
    CommsStore.needKept('A metric');
    const name = CommsStore.line(label, 60);
    if (!name) throw new Error('Name the number, for example "Discord members"');
    const s = this.state();
    if (s.metrics.some(m => m.label.toLowerCase() === name.toLowerCase())) throw new Error('There is already a number called "' + name + '"');
    if (s.metrics.length >= this.MAX_METRICS) throw new Error('At most ' + this.MAX_METRICS + ' numbers. Remove one first.');
    const m = { id: CommsStore.id('cm'), label: name, unit: CommsStore.line(unit, 12), points: [], watchId: '' };
    s.metrics.push(m); this._save(s);
    return m;
  },
  removeMetric(id) {
    const s = this.state();
    const m = s.metrics.find(x => x.id === id);
    if (!m) return false;
    if (m.watchId && typeof PageWatch !== 'undefined') PageWatch.remove(m.watchId);
    s.metrics = s.metrics.filter(x => x.id !== id); this._save(s);
    return true;
  },
  // One reading per day: a second one on the same day replaces the first.
  record(id, value, ts = this._now()) {
    const v = Number(value);
    if (!Number.isFinite(v)) throw new Error('A reading is a number');
    const s = this.state();
    const m = s.metrics.find(x => x.id === id);
    if (!m) throw new Error('That number is gone');
    const day = this._day(ts);
    const same = m.points.findIndex(p => this._day(p.t) === day);
    if (same >= 0) m.points[same] = { t: ts, v }; else m.points.push({ t: ts, v });
    m.points.sort((a, b) => a.t - b.t);
    while (m.points.length > this.MAX_POINTS) m.points.shift();
    this._save(s);
    return m;
  },

  // ---- reading a series (pure) -----------------------------------------------------------------------------
  latest(m) { return m.points.length ? m.points[m.points.length - 1] : null; },
  // The change against the reading nearest to `days` ago (or the oldest one if the series is shorter).
  // -> { now, then, diff, pct, days } or null with fewer than two readings.
  change(m, days = 7, now = this._now()) {
    if (m.points.length < 2) return null;
    const last = m.points[m.points.length - 1];
    const cutoff = last.t - days * 86400000;
    let base = m.points[0];
    for (const p of m.points) { if (p.t <= cutoff) base = p; else break; }
    if (base === last) base = m.points[m.points.length - 2];
    const span = Math.max(1, Math.round((last.t - base.t) / 86400000));
    const diff = last.v - base.v;
    return { now: last.v, then: base.v, diff, pct: base.v ? Math.round((diff / base.v) * 1000) / 10 : null, days: span };
  },
  spark(values) {
    const v = values.filter(Number.isFinite);
    if (!v.length) return '';
    const lo = Math.min(...v), hi = Math.max(...v);
    return v.map(x => this.BARS[hi === lo ? 3 : Math.min(this.BARS.length - 1, Math.round(((x - lo) / (hi - lo)) * (this.BARS.length - 1)))]).join('');
  },
  sparkOf(m, n = 14) { return this.spark(m.points.slice(-n).map(p => p.v)); },
  fmt(n) { return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; },
  // "1,204 members, +12 (+1%) in 7 days"
  describe(m) {
    const last = this.latest(m);
    if (!last) return m.label + ': no reading yet';
    const c = this.change(m);
    const unit = m.unit ? ' ' + m.unit : '';
    if (!c) return m.label + ': ' + this.fmt(last.v) + unit;
    const sign = c.diff > 0 ? '+' : '';
    return m.label + ': ' + this.fmt(last.v) + unit + ', ' + sign + this.fmt(c.diff) + (c.pct == null ? '' : ' (' + sign + c.pct + '%)') + ' in ' + c.days + ' day' + VexPlural.s(c.days);
  },

  // ---- a number from a public page ---------------------------------------------------------------------------------
  // pattern: a regular expression whose first group is the number ("([\\d,]+) members").
  watchMetric(id, { url, pattern }) {
    if (typeof PageWatch === 'undefined') throw new Error('Page watching is not loaded');
    const href = this.checkUrl(url);
    const pat = String(pattern == null ? '' : pattern).trim();
    if (!pat) throw new Error('Say how to find the number on the page: a pattern such as ([0-9,]+) members');
    const s = this.state();
    const m = s.metrics.find(x => x.id === id);
    if (!m) throw new Error('That number is gone');
    if (m.watchId) throw new Error('This number already follows a page. Stop that first.');
    const w = PageWatch.add({ url: href, title: m.label, kind: 'regex', pattern: pat, every: this.METRIC_EVERY, source: this.SOURCE_METRIC, byUser: false });
    m.watchId = w.id; this._save(s);
    return w;
  },
  unwatchMetric(id) {
    const s = this.state();
    const m = s.metrics.find(x => x.id === id);
    if (!m || !m.watchId) return false;
    if (typeof PageWatch !== 'undefined') PageWatch.remove(m.watchId);
    m.watchId = ''; this._save(s);
    return true;
  },
  // Take the newest value each followed page's watch holds into the series. -> how many readings were added.
  sync() {
    if (typeof PageWatch === 'undefined') return 0;
    const watches = new Map(PageWatch.list().filter(w => w.source === this.SOURCE_METRIC).map(w => [w.id, w]));
    const s = this.state();
    let added = 0;
    for (const m of s.metrics) {
      const w = m.watchId && watches.get(m.watchId);
      if (!w || w.lastValue == null || !w.lastCheckedAt) continue;
      const n = PageWatch.firstNumber(String(w.lastValue));
      if (n == null) continue;
      const last = this.latest(m);
      if (last && last.v === n && this._day(last.t) === this._day(w.lastCheckedAt)) continue;
      const day = this._day(w.lastCheckedAt);
      const same = m.points.findIndex(p => this._day(p.t) === day);
      if (same >= 0) m.points[same] = { t: w.lastCheckedAt, v: n }; else m.points.push({ t: w.lastCheckedAt, v: n });
      m.points.sort((a, b) => a.t - b.t);
      while (m.points.length > this.MAX_POINTS) m.points.shift();
      added++;
    }
    if (added) this._save(s);
    return added;
  },

  // ---- name watch ---------------------------------------------------------------------------------------------------
  addName({ label, url } = {}) {
    if (!this.enabled()) throw new Error('Community metrics are switched off in Settings');
    CommsStore.needKept('A name watch');
    if (typeof PageWatch === 'undefined') throw new Error('Page watching is not loaded');
    const name = CommsStore.line(label, 60);
    if (!name) throw new Error('Name what you are looking for, for example "my game name on the forum"');
    const href = this.checkUrl(url);
    const s = this.state();
    if (s.names.length >= this.MAX_NAMES) throw new Error('At most ' + this.MAX_NAMES + ' name watches. Remove one first.');
    const w = PageWatch.add({ url: href, title: name, kind: 'text', every: this.NAME_EVERY, source: this.SOURCE_NAME, byUser: false });
    const rec = { id: CommsStore.id('nw'), label: name, url: href, watchId: w.id };
    s.names.push(rec); this._save(s);
    return rec;
  },
  removeName(id) {
    const s = this.state();
    const n = s.names.find(x => x.id === id);
    if (!n) return false;
    if (typeof PageWatch !== 'undefined') PageWatch.remove(n.watchId);
    s.names = s.names.filter(x => x.id !== id); this._save(s);
    return true;
  },
  // Name watches whose page changed since you last looked. -> [{ rec, watch }]
  newHits() {
    if (typeof PageWatch === 'undefined') return [];
    const byId = new Map(PageWatch.list().map(w => [w.id, w]));
    return this.names().map(rec => ({ rec, watch: byId.get(rec.watchId) })).filter(x => x.watch && PageWatch.isUnseen(x.watch));
  },

  // ---- the Morning Brief section -------------------------------------------------------------------------------------
  briefPayload() {
    if (!this.enabled()) return null;
    this.sync();
    const items = this.metrics().filter(m => m.points.length).slice(0, 5).map(m => ({ text: this.describe(m), sub: this.sparkOf(m) }));
    for (const h of this.newHits().slice(0, 3)) items.push({ text: 'New on "' + h.rec.label + '"', sub: h.rec.url, url: h.rec.url });
    return items.length ? { summary: items.length + (items.length === 1 ? ' community number' : ' community numbers'), items } : null;
  },
};

if (typeof window !== 'undefined') {
  window.CommunityMetrics = CommunityMetrics;
  // Opt-in: the section is off until the person turns it on in the brief's settings, like Mail.
  if (typeof VexBrief !== 'undefined') {
    VexBrief.register({ id: 'community-metrics', title: 'Community', icon: 'users', order: 58, optIn: true, defaultOn: false, maxItems: 8, build: () => CommunityMetrics.briefPayload() });
  }
  if (typeof VexJobs !== 'undefined' && typeof document !== 'undefined') {
    // Takes the values the followed pages' watches already hold into the series: local reading only, no network.
    VexJobs.every('Community metrics', 3600000, () => { try { if (CommunityMetrics.enabled()) CommunityMetrics.sync(); } catch (err) { window.VexProblems?.note('Community metrics', 'Could not take the page readings into the series', err); } }, { when: 'background', feature: 'community-metrics' });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { CommunityMetrics };
