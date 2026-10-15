// === Brief extra: AI news to action ==========================================
//
// An AI news story (js/ai-news.js) that names a tool or model the person
// already uses gets up to three one-click actions: open the changelog, watch
// the repository (GitHubWatch) and remind me later.
//
// "Uses" means one of three things Vex already knows, matched on whole words
// only, against the story's title, companies and models:
//   extension  an installed extension's name
//   repo       a GitHub repository in GitHubWatch
//   site       a site visited at least MIN_VISITS times in the history
// Nothing is sent anywhere and no AI is involved.
//
// Section object for VexBrief.register: { id, title, build(), isEnabled() }.
// build() is async (the extension list comes from the main process) and
// returns null or { id, title, icon, lines: [{ text, detail, actions }] }.
//
// Watching: only a GitHub repository can be watched with certainty (its
// releases page). For an extension or a site there is no known changelog
// address, so "Open changelog" there is a web search for it and no Watch is
// offered, rather than watching a guessed page.
const VexBriefNewsActions = {
  id: 'news-actions',
  title: 'News about what you use',
  icon: 'newspaper',
  SETTINGS_KEY: 'vex.briefExtras',
  STATE_KEY: 'vex.brief.newsActions',
  MAX_LINES: 3,
  MAX_AGE_MS: 3 * 24 * 3600 * 1000,
  MIN_VISITS: 3,
  MIN_TOKEN: 4,
  // Sites whose name is also a common word in the news; matching them says nothing.
  NOISE: new Set(['google', 'github', 'youtube', 'reddit', 'twitter', 'amazon', 'facebook', 'microsoft', 'apple', 'wikipedia', 'linkedin', 'bing', 'yahoo', 'mozilla', 'localhost', 'discord', 'spotify', 'netflix']),

  _json(key, fb) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fb : v; }
    catch { return fb; }
  },

  isEnabled() {
    const s = this._json(this.SETTINGS_KEY, {});
    return !(s && s.newsActions === false);
  },

  _handled() { const h = this._json(this.STATE_KEY, {}); return (h && typeof h.done === 'object' && h.done) || {}; },
  markHandled(id, now = Date.now()) {
    const done = this._handled();
    done[id] = now;
    const keep = Object.entries(done).sort((a, b) => b[1] - a[1]).slice(0, 300);
    localStorage.setItem(this.STATE_KEY, JSON.stringify({ done: Object.fromEntries(keep) }));
  },

  _esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); },

  // Pure. The first of `known` that the story names, extensions first.
  matchItem(item, known) {
    if (!item) return null;
    const hay = [item.title, ...(item.companies || []), ...(item.models || [])].join(' \n ').toLowerCase();
    const order = { extension: 0, repo: 1, site: 2 };
    const list = known.slice().sort((a, b) => (order[a.kind] - order[b.kind]));
    for (const k of list) {
      for (const t of k.tokens) {
        if (t.length < this.MIN_TOKEN) continue;
        if (new RegExp('(^|[^a-z0-9])' + this._esc(t) + '([^a-z0-9]|$)').test(hay)) return { known: k, token: t };
      }
    }
    return null;
  },

  // Pure. A GitHub owner/repo for the story: the one it links to, else the matched watch.
  repoFor(item, match) {
    try {
      const u = new URL(item.url);
      if (u.hostname === 'github.com') {
        const [owner, repo] = u.pathname.split('/').filter(Boolean);
        if (owner && repo) return { owner, repo };
      }
    } catch { /* not a URL: fall through */ }
    const k = match && match.known;
    return k && k.kind === 'repo' ? { owner: k.owner, repo: k.repo } : null;
  },

  changelogUrl(item, match) {
    const r = this.repoFor(item, match);
    if (r) return 'https://github.com/' + r.owner + '/' + r.repo + '/releases';
    const name = match.known.name;
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(name + ' changelog release notes');
  },

  // What the person is known to use, from the three sources. Each source is
  // optional; one failing does not hide the others (its error is returned).
  async known(deps = {}) {
    const out = [];
    const errors = [];
    try {
      const list = deps.extensions ? await deps.extensions() : (window.vex && window.vex.extensionsList ? await window.vex.extensionsList() : []);
      for (const e of (list || [])) {
        if (!e || !e.name || e.enabled === false) continue;
        const name = String(e.name).toLowerCase().replace(/\s+/g, ' ').trim();
        const tokens = [name];
        const first = name.split(' ')[0];
        if (first && first !== name && first.length >= 5) tokens.push(first);
        out.push({ kind: 'extension', name: String(e.name), tokens });
      }
    } catch (err) { errors.push('extensions: ' + ((err && err.message) || 'unavailable')); }
    try {
      const gh = deps.watches ? deps.watches() : (typeof GitHubWatch !== 'undefined' ? GitHubWatch.list() : []);
      const seen = new Set();
      for (const w of gh) {
        if (!w || !w.owner || !w.repo || seen.has(w.owner + '/' + w.repo)) continue;
        seen.add(w.owner + '/' + w.repo);
        const tokens = [String(w.repo).toLowerCase()];
        if (String(w.owner).length >= 5) tokens.push(String(w.owner).toLowerCase());
        out.push({ kind: 'repo', name: w.owner + '/' + w.repo, owner: w.owner, repo: w.repo, tokens });
      }
    } catch (err) { errors.push('watched repositories: ' + ((err && err.message) || 'unavailable')); }
    try {
      const hist = deps.history ? deps.history() : (typeof HistoryPanel !== 'undefined' ? HistoryPanel.list() : []);
      const counts = new Map();
      for (const h of hist) {
        let host;
        try { host = new URL(h.url).hostname.replace(/^www\./, ''); } catch { continue; }
        counts.set(host, (counts.get(host) || 0) + 1);
      }
      for (const [host, n] of counts) {
        if (n < this.MIN_VISITS) continue;
        const parts = host.split('.');
        const label = (parts.length > 1 ? parts[parts.length - 2] : parts[0]).toLowerCase();
        if (this.NOISE.has(label)) continue;
        out.push({ kind: 'site', name: host, host, tokens: [label] });
      }
    } catch (err) { errors.push('history: ' + ((err && err.message) || 'unavailable')); }
    return { known: out, errors };
  },

  // Tomorrow 09:00 local.
  _tomorrowMorning(now) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  },

  actionsFor(item, match, deps = {}) {
    const now = () => (deps.now ? deps.now() : Date.now());
    const open = deps.openUrl || ((url) => {
      if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not available');
      TabManager.createTab(url, true);
    });
    const out = [];
    out.push({ label: 'Open changelog', icon: 'link', run: () => { open(this.changelogUrl(item, match)); this.markHandled(item.id, now()); } });
    const repo = this.repoFor(item, match);
    if (repo) {
      out.push({
        label: 'Watch ' + repo.owner + '/' + repo.repo, icon: 'eye',
        run: () => {
          const G = deps.github || (typeof GitHubWatch !== 'undefined' ? GitHubWatch : null);
          if (!G) throw new Error('Repository watching is not available');
          G.add('https://github.com/' + repo.owner + '/' + repo.repo + '/releases');
          this.markHandled(item.id, now());
        },
      });
    }
    out.push({
      label: 'Remind me tomorrow', icon: 'bell',
      run: async () => {
        const b = deps.reminders || (window.vex && window.vex.reminders);
        if (!b || typeof b.create !== 'function') throw new Error('Reminders are not available');
        await b.create('Read: ' + item.title, this._tomorrowMorning(now()), { url: item.url });
        this.markHandled(item.id, now());
      },
    });
    out.push({ label: 'Dismiss', icon: 'x', run: () => this.markHandled(item.id, now()) });
    return out;
  },

  async build(now = Date.now(), deps = {}) {
    const news = deps.news || (typeof AINews !== 'undefined' ? AINews : null);
    if (!news) return null;
    const handled = this._handled();
    const items = news.list()
      .filter(i => !i.read && !handled[i.id] && (now - (i.publishedAt || i.firstSeenAt || 0)) < this.MAX_AGE_MS)
      .slice(0, 60);
    if (!items.length) return null;
    const { known, errors } = await this.known(deps);
    if (!known.length) return null;
    const lines = [];
    for (const item of items) {
      const m = this.matchItem(item, known);
      if (!m) continue;
      const why = m.known.kind === 'extension' ? 'You have the ' + m.known.name + ' extension'
        : m.known.kind === 'repo' ? 'You watch ' + m.known.name : 'You visit ' + m.known.name + ' often';
      lines.push({ text: item.title, detail: why + '. ' + (item.source || ''), url: item.url, actions: this.actionsFor(item, m, { ...deps, now: () => now }) });
      if (lines.length >= this.MAX_LINES) break;
    }
    if (!lines.length) return null;
    return { id: this.id, title: this.title, icon: this.icon, lines, errors };
  },
};

if (typeof window !== 'undefined') window.VexBriefNewsActions = VexBriefNewsActions;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBriefNewsActions };
