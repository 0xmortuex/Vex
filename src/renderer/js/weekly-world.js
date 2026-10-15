// === What changed in my world: one page for the week ========================
//
// The watched pages that changed, the releases (Patch Radar), the repositories
// (GitHub watches) and the prices (Price History) of the last seven days, on
// one page. Reads what Vex already keeps; nothing is fetched and nothing
// leaves this computer. Different from Weekly Review (weekly-review.js), which
// is about reminders, saved articles and tools; this one is about the world
// outside.
//
// GitHub watches keep only the latest tag, not when it changed, so this module
// logs each 'vex:github-watch' announcement itself (vex.weeklyWorld.log,
// 35 days, 300 entries, this computer only, not synced).
//
// Brief-ready section: { id, title, icon, build(), isEnabled() }.
// Switch: VexExtras 'weeklyWorld' (on unless false).
const VexWeeklyWorld = {
  id: 'weekly-world',
  title: 'What changed in my world',
  icon: 'globe',
  LOG_KEY: 'vex.weeklyWorld.log',
  SETTING: 'weeklyWorld',
  KEEP_MS: 35 * 24 * 3600000,
  MAX_LOG: 300,
  DAY_MS: 24 * 3600000,

  isEnabled() {
    return typeof VexExtras === 'undefined' ? true : VexExtras.get(this.SETTING, true) !== false;
  },

  _log() {
    let raw;
    try { raw = localStorage.getItem(this.LOG_KEY); } catch { return []; }
    if (!raw) return [];
    let a;
    try { a = JSON.parse(raw); }
    catch (err) { throw new Error('The weekly log could not be read', { cause: err }); }
    return Array.isArray(a) ? a.filter(e => e && typeof e.text === 'string' && typeof e.at === 'number') : [];
  },

  record({ kind, text, url = '' }, now = Date.now()) {
    if (!text) return false;
    const log = this._log().filter(e => e.at >= now - this.KEEP_MS);
    // The same sentence twice in a row is one event.
    const last = log[log.length - 1];
    if (last && last.text === text && last.kind === kind) return false;
    log.push({ at: now, kind, text: String(text).slice(0, 300), url: String(url || '') });
    localStorage.setItem(this.LOG_KEY, JSON.stringify(log.slice(-this.MAX_LOG)));
    return true;
  },

  _listening: false,
  // Start logging. Safe to call twice.
  init() {
    if (this._listening || typeof document === 'undefined') return false;
    this._listening = true;
    document.addEventListener('vex:github-watch', (e) => {
      const d = (e && e.detail) || {};
      try { this.record({ kind: 'repo', text: d.text, url: d.url }); }
      catch (err) { window.VexProblems?.note('Weekly page', 'Could not log a repository event', err); }
    });
    return true;
  },

  _dayKey(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  // deps (all optional, for tests): { watches, prices, log, format }
  collect(now = Date.now(), deps = {}) {
    const from = now - 7 * this.DAY_MS;
    const out = { from, to: now, pages: [], releases: [], repos: [], prices: [], errors: [] };
    const safe = (name, fn) => { try { fn(); } catch (err) { out.errors.push(name + ': ' + ((err && err.message) || 'unavailable')); } };

    safe('watched pages', () => {
      const watches = deps.watches || ((typeof PageWatch !== 'undefined' && PageWatch.list) ? PageWatch.list() : []);
      for (const w of watches) {
        if (!w || !w.lastChangedAt || w.lastChangedAt < from || w.lastChangedAt > now) continue;
        const isRadar = typeof w.source === 'string' && w.source.startsWith('radar:');
        const row = {
          text: w.title || w.url,
          sub: this._sub(w.lastChangedAt, w.lastSummary, w.kind !== 'text' && w.lastValue != null ? 'now ' + String(w.lastValue).slice(0, 60) : ''),
          url: w.url || '',
          at: w.lastChangedAt,
        };
        (isRadar ? out.releases : out.pages).push(row);
      }
    });

    safe('repositories', () => {
      const log = deps.log || this._log();
      for (const e of log) {
        if (e.kind !== 'repo' || e.at < from || e.at > now) continue;
        out.repos.push({ text: e.text, sub: this._sub(e.at), url: e.url || '', at: e.at });
      }
    });

    safe('prices', () => {
      const all = deps.prices || ((typeof PriceHistory !== 'undefined' && PriceHistory.all) ? PriceHistory.all() : {});
      const fromDay = this._dayKey(from);
      const fmt = deps.format || ((c, cur) => (typeof PriceHistory !== 'undefined' && PriceHistory.format) ? PriceHistory.format(c, cur) : (c / 100).toFixed(2) + (cur ? ' ' + cur : ''));
      for (const [key, e] of Object.entries(all)) {
        const pts = e && Array.isArray(e.points) ? e.points : [];
        if (!pts.length) continue;
        const inWeek = pts.filter(p => p.day >= fromDay);
        if (!inWeek.length) continue;
        const before = pts.filter(p => p.day < fromDay).pop();
        const start = before || inWeek[0];
        const end = inWeek[inWeek.length - 1];
        if (start.cents === end.cents) continue;
        const delta = end.cents - start.cents;
        out.prices.push({
          text: e.name || key,
          sub: fmt(start.cents, e.currency) + ' to ' + fmt(end.cents, e.currency) + ' (' + (delta < 0 ? 'down ' : 'up ') + fmt(Math.abs(delta), e.currency) + ')',
          url: /^https?:/i.test(key) ? key : '',
          at: Date.parse(end.day + 'T12:00:00') || now,
          delta,
        });
      }
    });

    for (const k of ['pages', 'releases', 'repos', 'prices']) out[k].sort((a, b) => b.at - a.at);
    return out;
  },

  _sub(at, sentence, now) {
    const parts = [VexExtras.fmtDay(at)];
    if (now) parts.push(now);
    if (sentence) parts.push(sentence);
    return parts.join(' - ');
  },

  total(c) { return c.pages.length + c.releases.length + c.repos.length + c.prices.length; },

  // The brief section.
  build(now = Date.now(), deps = {}) {
    const c = this.collect(now, deps);
    const lines = [];
    const add = (label, rows) => rows.slice(0, 4).forEach(r => lines.push({ text: label + ': ' + r.text, detail: r.sub, url: r.url }));
    add('Page', c.pages);
    add('Release', c.releases);
    add('Repository', c.repos);
    add('Price', c.prices);
    return {
      id: this.id, title: this.title, icon: this.icon,
      lines,
      counts: { pages: c.pages.length, releases: c.releases.length, repos: c.repos.length, prices: c.prices.length },
      empty: lines.length === 0,
      errors: c.errors,
    };
  },

  open(now = Date.now()) {
    const c = this.collect(now);
    const sec = (title, rows, empty) => ({ title, rows, empty });
    return VexExtras.openReport({
      id: 'vex-weekly-world',
      title: this.title,
      icon: this.icon,
      range: VexExtras.fmtDay(c.from) + ' - ' + VexExtras.fmtDay(c.to),
      stats: [
        { n: c.pages.length, label: 'pages changed' },
        { n: c.releases.length, label: 'releases' },
        { n: c.repos.length, label: 'repository news' },
        { n: c.prices.length, label: 'prices moved' },
      ],
      sections: [
        sec('Watched pages that changed', c.pages, 'No watched page changed this week.'),
        sec('Releases', c.releases, 'No release on your radar this week.'),
        sec('Repositories', c.repos, 'No news from watched repositories since this page started keeping count.'),
        sec('Prices', c.prices, 'No price you follow moved this week.'),
      ].concat(c.errors.map(e => sec('Could not read ' + e, [], ''))),
      footer: 'Built from what Vex already keeps on this computer. Nothing was fetched for this page.',
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexWeeklyWorld = VexWeeklyWorld;
  if (typeof VexExtras !== 'undefined') {
    VexExtras.registerToggle({ key: 'weeklyWorld', label: 'Weekly "what changed in my world" page', hint: 'Watched pages, releases, repositories and prices of the last seven days on one page, from data already on this computer.', def: true });
    VexExtras.registerCommand({ id: 'weekly-world', label: 'What Changed in My World This Week', hint: 'Watched pages, releases, repositories and prices', icon: 'globe', action: () => VexWeeklyWorld.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWeeklyWorld };
