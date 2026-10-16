// === Year in Vex: what you read, built and watched this year ================
//
// A year-end page made only from what Vex already stores on this computer:
// browsing history, saved articles, notes, tool results, research projects,
// watched pages, repositories, prices, habits and offline pages. Nothing is
// uploaded, nothing is fetched, and no "share" button exists.
//
// Honest limits, said on the page: browsing history keeps at most 5000
// visits, so a busy year shows its later part; a watched page remembers only
// its latest change.
//
// Brief-ready section: { id, title, icon, build(), isEnabled() }. It is
// enabled in December and the first half of January only.
const VexYearInVex = {
  id: 'year-in-vex',
  title: 'Your year in Vex',
  icon: 'calendar',
  SETTING: 'yearInVex',

  _json(key, fb) {
    let raw;
    try { raw = localStorage.getItem(key); } catch { return fb; }
    if (!raw) return fb;
    try { const v = JSON.parse(raw); return v == null ? fb : v; }
    catch (err) { throw new Error(key + ' could not be read', { cause: err }); }
  },

  // January still shows the year that just ended.
  yearFor(now = new Date()) { return now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(); },

  isEnabled(now = new Date()) {
    if (typeof VexExtras !== 'undefined' && VexExtras.get(this.SETTING, true) === false) return false;
    // The master level (js/vex-playfulness.js): a year-end page is a treat, not a duty, so it stays out of Simple mode, Focus and Game mode.
    if (typeof VexPlayfulness !== 'undefined' && !VexPlayfulness.allowed('delight')) return false;
    return now.getMonth() === 11 || (now.getMonth() === 0 && now.getDate() <= 15);
  },

  _inYear(ms, year) { return Number.isFinite(ms) && new Date(ms).getFullYear() === year; },
  _iso(s) { const t = Date.parse(s); return Number.isFinite(t) ? t : NaN; },

  // deps (optional, for tests): { history, readLater, notes, toolHistory,
  // projects, watches, github, prices, habits, offline }
  collect(year, deps = {}) {
    const out = {
      year,
      read: { saved: 0, finished: 0, visits: 0, sites: 0, topSites: [] },
      built: { notes: 0, toolResults: 0, projects: 0, topTools: [] },
      watched: { pages: 0, changed: 0, repos: 0, products: 0, offline: 0 },
      habits: { days: 0, best: null },
      errors: [],
    };
    const safe = (name, fn) => { try { fn(); } catch (err) { out.errors.push(name + ': ' + ((err && err.message) || 'unavailable')); } };
    const inY = (ms) => this._inYear(ms, year);

    safe('history', () => {
      let h = deps.history !== undefined ? deps.history : this._json('vex.history', []);
      if (h && !Array.isArray(h) && Array.isArray(h.entries)) h = h.entries;
      const counts = new Map();
      for (const e of (Array.isArray(h) ? h : [])) {
        const t = e && (e.visitedAt ? this._iso(e.visitedAt) : e.time);
        if (!inY(t) || !e.url || e.ownSession) continue;
        out.read.visits++;
        let host = '';
        try { host = new URL(e.url).hostname.replace(/^www\./, ''); } catch { continue; }
        if (host) counts.set(host, (counts.get(host) || 0) + 1);
      }
      out.read.sites = counts.size;
      out.read.topSites = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([host, n]) => ({ host, n }));
    });

    safe('read later', () => {
      const items = deps.readLater || this._json('vex.readLater', []);
      for (const i of (Array.isArray(items) ? items : [])) {
        if (!i || !inY(i.at)) continue;
        out.read.saved++;
        if (i.read) out.read.finished++;
      }
    });

    safe('notes', () => {
      const notes = deps.notes || this._json('vex.notes', []);
      for (const n of (Array.isArray(notes) ? notes : [])) if (n && inY(this._iso(n.createdAt))) out.built.notes++;
    });

    safe('tools', () => {
      let tools = deps.toolHistory;
      if (!tools) {
        tools = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith('vex.tool.history.')) continue;
          const v = JSON.parse(localStorage.getItem(k) || '[]');
          tools[k.slice('vex.tool.history.'.length)] = v;
        }
      }
      const per = [];
      for (const [id, items] of Object.entries(tools)) {
        const n = (Array.isArray(items) ? items : []).filter(h => h && inY(h.at)).length;
        if (n) per.push({ id, n });
        out.built.toolResults += n;
      }
      out.built.topTools = per.sort((a, b) => b.n - a.n).slice(0, 5);
    });

    safe('projects', () => {
      const p = deps.projects || this._json('vex.projects', []);
      const list = Array.isArray(p) ? p : (p && Array.isArray(p.list) ? p.list : []);
      out.built.projects = list.filter(x => x && inY(x.at)).length;
    });

    safe('watched pages', () => {
      const w = deps.watches || this._json('vex.pageWatches', []);
      for (const x of (Array.isArray(w) ? w : [])) {
        if (!x) continue;
        if (inY(x.addedAt)) out.watched.pages++;
        if (inY(x.lastChangedAt)) out.watched.changed++;
      }
    });
    safe('repositories', () => {
      const g = deps.github || this._json('vex.githubWatches', []);
      out.watched.repos = (Array.isArray(g) ? g : []).filter(x => x && inY(x.addedAt)).length;
    });
    safe('prices', () => {
      const p = deps.prices || this._json('vex.priceHistory', {});
      for (const e of Object.values(p && typeof p === 'object' ? p : {})) {
        if (e && Array.isArray(e.points) && e.points.some(pt => String(pt.day).startsWith(year + '-'))) out.watched.products++;
      }
    });
    safe('offline pages', () => {
      const o = deps.offline || this._json('vex.offline.pages', []);
      out.watched.offline = (Array.isArray(o) ? o : []).filter(x => x && inY(x.at)).length;
    });

    safe('habits', () => {
      const hs = deps.habits || this._json('vex.habits', []);
      let best = null;
      for (const h of (Array.isArray(hs) ? hs : [])) {
        if (!h || !Array.isArray(h.done)) continue;
        const days = h.done.filter(d => typeof d === 'string' && d.startsWith(year + '-'));
        out.habits.days += days.length;
        if (!best || days.length > best.days) best = { name: String(h.name || '').slice(0, 80), days: days.length };
      }
      out.habits.best = best && best.days ? best : null;
    });

    return out;
  },

  _toolName(id) {
    try {
      if (typeof Toolbox !== 'undefined' && Toolbox.all) return (Toolbox.all().find(t => t.id === id) || {}).name || id;
    } catch { /* fall through */ }
    return id;
  },

  build(now = new Date(), deps = {}) {
    const c = this.collect(this.yearFor(now), deps);
    const lines = [];
    if (c.read.visits) lines.push({ text: c.read.visits + ' pages across ' + c.read.sites + ' sites', detail: c.read.topSites[0] ? 'Most visited: ' + c.read.topSites[0].host : '' });
    if (c.read.saved) lines.push({ text: c.read.saved + ' articles saved for later', detail: c.read.finished + ' read' });
    if (c.built.notes || c.built.toolResults || c.built.projects) lines.push({ text: 'Built: ' + c.built.notes + ' notes, ' + c.built.toolResults + ' tool results, ' + c.built.projects + ' projects', detail: '' });
    if (c.watched.pages || c.watched.repos || c.watched.products) lines.push({ text: 'Watched: ' + c.watched.pages + ' pages, ' + c.watched.repos + ' repositories, ' + c.watched.products + ' prices', detail: '' });
    return { id: this.id, title: this.title + ' ' + c.year, icon: this.icon, lines, empty: lines.length === 0, year: c.year, errors: c.errors };
  },

  open(now = new Date(), deps = {}) {
    const c = this.collect(this.yearFor(now), deps);
    const sec = (title, rows, empty) => ({ title, rows, empty });
    return VexExtras.openReport({
      id: 'vex-year-in-vex',
      title: 'Your ' + c.year + ' in Vex',
      icon: this.icon,
      range: 'Kept on this computer only',
      stats: [
        { n: c.read.visits, label: 'pages visited' },
        { n: c.read.sites, label: 'sites' },
        { n: c.read.finished, label: 'saved articles read' },
        { n: c.built.notes + c.built.toolResults + c.built.projects, label: 'things built' },
      ],
      sections: [
        sec('Read', c.read.topSites.map(s => ({ text: s.host, sub: s.n + ' visits' })).concat(c.read.saved ? [{ text: c.read.saved + ' articles saved, ' + c.read.finished + ' read', sub: '' }] : []), 'No browsing history for ' + c.year + '.'),
        sec('Built', [
          ...(c.built.notes ? [{ text: c.built.notes + ' notes written', sub: '' }] : []),
          ...(c.built.projects ? [{ text: c.built.projects + ' research projects started', sub: '' }] : []),
          ...c.built.topTools.map(t => ({ text: this._toolName(t.id), sub: t.n + ' results' })),
        ], 'No notes, projects or tool results from ' + c.year + '.'),
        sec('Watched', [
          ...(c.watched.pages ? [{ text: c.watched.pages + ' pages watched', sub: c.watched.changed + ' changed lately' }] : []),
          ...(c.watched.repos ? [{ text: c.watched.repos + ' repositories followed', sub: '' }] : []),
          ...(c.watched.products ? [{ text: c.watched.products + ' product prices tracked', sub: '' }] : []),
          ...(c.watched.offline ? [{ text: c.watched.offline + ' pages kept for offline', sub: '' }] : []),
        ], 'Nothing watched in ' + c.year + '.'),
        sec('Habits', c.habits.best ? [{ text: c.habits.days + ' habit days ticked', sub: 'Most: ' + c.habits.best.name + ' (' + c.habits.best.days + ')' }] : [], 'No habit days ticked.'),
      ].concat(c.errors.map(e => sec('Could not read ' + e, [], ''))),
      footer: 'Made from data on this computer only; nothing was uploaded and there is nothing to share. History keeps at most 5000 visits, so a busy year shows its later part.',
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexYearInVex = VexYearInVex;
  if (typeof VexExtras !== 'undefined') {
    VexExtras.registerToggle({ key: 'yearInVex', label: 'Year in Vex in the brief (December)', hint: 'A year-end summary of what you read, built and watched. Made from data on this computer; nothing is uploaded.', def: true });
    VexExtras.registerCommand({ id: 'year-in-vex', label: 'Your Year in Vex', hint: 'What you read, built and watched this year', icon: 'calendar', action: () => VexYearInVex.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexYearInVex };
