// === More from the creator: the maker's other public projects ================================
//
// A window in the Library (and Ctrl+K, and Settings) that lists the public GitHub repositories of the person who makes
// Vex (0xmortuex), with a filter bar: search, languages, topics, a minimum number of stars, original / forks / archived,
// and a sort. Totals follow the filters.
//
// Where the list comes from, in order:
//   1. the SNAPSHOT that ships with Vex, js/maker-repos-data.js (written by scripts/update-maker-repos.js; plain data);
//   2. a refreshed copy kept in the profile folder (main/maker-repos.js), when its date is newer.
// Nothing is contacted until the person presses "Refresh from GitHub": that is the only network call here, it goes through
// the main process (a public-only fetch, no cookies, size cap, one line in the "what left this computer" ledger) and is
// refused in a private window. A failure is shown in the window, with when GitHub's limit resets; the list stays as it was.
//
// The data and the filtering are plain functions on VexMakerRepos (filter, facets, totals, ago), so tests read them
// without a DOM; open() only draws.
const VexMakerRepos = {
  LOGIN: '0xmortuex',
  SELF: 'Vex',           // the repository of the browser the person is using
  MIN_STARS: [0, 1, 5, 25, 100],
  SORTS: [
    { id: 'stars', label: 'Most stars' },
    { id: 'updated', label: 'Recently updated' },
    { id: 'pushed', label: 'Recently pushed' },
    { id: 'name', label: 'Name A to Z' },
    { id: 'forks', label: 'Most forks' },
  ],
  TOPIC_CHIPS: 10,

  // ---- the data ------------------------------------------------------------------------------------
  defaultFilters() {
    return { q: '', langs: [], topics: [], minStars: 0, types: { original: true, fork: false, archived: false }, sort: 'stars' };
  },

  _fold(s) { return String(s == null ? '' : s).toLocaleLowerCase('en').normalize('NFKD').replace(/[̀-ͯ]/g, ''); },

  // Which of the three type toggles a repository answers to. A fork that is also archived answers to both.
  kinds(r) {
    const k = [];
    if (r.fork) k.push('fork');
    if (r.archived) k.push('archived');
    if (!r.fork && !r.archived) k.push('original');
    return k;
  },

  // Does one repository pass the filters? `skip` leaves one facet out ('lang' or 'topic'), for the chip counts.
  matches(r, f, skip) {
    if (!this.kinds(r).some(k => f.types[k])) return false;
    if (f.minStars > 0 && r.stars < f.minStars) return false;
    if (skip !== 'lang' && f.langs.length && !f.langs.includes(r.language || '')) return false;
    if (skip !== 'topic' && f.topics.length && !f.topics.some(t => r.topics.includes(t))) return false;
    const q = this._fold(f.q).trim();
    if (q) {
      const hay = this._fold([r.name, r.description, r.language || '', r.topics.join(' ')].join(' '));
      if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  },

  sort(list, key) {
    const t = (v) => (v ? Date.parse(v) : 0);
    const by = {
      stars: (a, b) => b.stars - a.stars || a.name.localeCompare(b.name),
      forks: (a, b) => b.forks - a.forks || b.stars - a.stars || a.name.localeCompare(b.name),
      updated: (a, b) => t(b.updatedAt) - t(a.updatedAt) || a.name.localeCompare(b.name),
      pushed: (a, b) => t(b.pushedAt) - t(a.pushedAt) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    };
    if (!by[key]) throw new Error('Unknown sort: ' + key);
    return list.slice().sort(by[key]);
  },

  filter(repos, f) { return this.sort(repos.filter(r => this.matches(r, f)), f.sort); },

  // The language and topic chips with their counts. Each facet is counted over what passes every OTHER filter, so a chip
  // says how many you would get by choosing it. Languages: all of them, most used first. Topics: the first TOPIC_CHIPS.
  facets(repos, f) {
    const tally = (list, pick) => {
      const m = new Map();
      for (const r of list) for (const v of pick(r)) m.set(v, (m.get(v) || 0) + 1);
      return m;
    };
    const langs = tally(repos.filter(r => this.matches(r, f, 'lang')), r => [r.language || '']);
    const topicsAll = tally(repos.filter(r => this.matches(r, f, 'topic')), r => r.topics);
    const order = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
    // A chosen chip stays on the bar even when other filters have taken its count to zero.
    for (const l of f.langs) if (!langs.has(l)) langs.set(l, 0);
    for (const t of f.topics) if (!topicsAll.has(t)) topicsAll.set(t, 0);
    const wholeTopics = order(tally(repos, r => r.topics)).slice(0, this.TOPIC_CHIPS).map(t => t.name);
    const topics = order(topicsAll).filter(t => wholeTopics.includes(t.name) || f.topics.includes(t.name));
    return { languages: order(langs), topics };
  },

  totals(list) {
    return { projects: list.length, stars: list.reduce((n, r) => n + r.stars, 0), forks: list.reduce((n, r) => n + r.forks, 0) };
  },

  // "3 days ago" in the language Vex is in.
  ago(iso, now = Date.now(), locale) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const lang = locale || ((typeof VexI18nUI !== 'undefined' && VexI18nUI.locale) ? VexI18nUI.locale() : 'en');
    const rtf = new Intl.RelativeTimeFormat(lang === 'tr' ? 'tr' : 'en', { numeric: 'auto' });
    const s = Math.round((t - now) / 1000);
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [u, secs] of units) if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), u);
    return rtf.format(0, 'day');
  },

  // The list to show: the snapshot, or the refreshed copy when it is newer. -> { repos, date, kind }
  pick(snapshot, stored) {
    if (!snapshot || !Array.isArray(snapshot.repos)) throw new Error('The snapshot of the creator\'s projects is missing');
    if (stored && Array.isArray(stored.repos) && Date.parse(stored.fetchedAt) > Date.parse(snapshot.fetchedAt)) return { repos: stored.repos, date: stored.fetchedAt, kind: 'refreshed' };
    return { repos: snapshot.repos, date: snapshot.fetchedAt, kind: 'snapshot' };
  },

  // ---- the window ---------------------------------------------------------------------------------
  _esc(s) { return window.escapeHtml(String(s == null ? '' : s)); },
  _icon(name, size = 13) { return typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size }) : ''; },
  _private() { return !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },

  // Colours for the dot beside a language name. Decorative: the name is always written next to it.
  LANG_COLOURS: { JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572a5', Lua: '#000080', Rust: '#dea584', Go: '#00add8', HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051', 'C++': '#f34b7d', C: '#808080', Java: '#b07219', PowerShell: '#012456' },
  _dot(lang) {
    if (!lang) return '#8a8a8a';
    if (this.LANG_COLOURS[lang]) return this.LANG_COLOURS[lang];
    let h = 0;
    for (const c of lang) h = (h * 31 + c.charCodeAt(0)) % 360;
    return 'hsl(' + h + ' 55% 50%)';
  },

  async _data() {
    if (typeof VexMakerReposData === 'undefined') await VexLazy.ensure('js/maker-repos-data.js');
    if (typeof VexMakerReposData === 'undefined') throw new Error('The snapshot of the creator\'s projects did not load');
    let stored = null;
    let storedError = null;
    if (window.vex && typeof window.vex.makerReposStored === 'function') {
      try { stored = await window.vex.makerReposStored(); } catch (err) { storedError = this._plain(err); }
    }
    return { ...this.pick(VexMakerReposData, stored), storedError };
  },

  // An IPC error reads "Error invoking remote method 'x': Error: the message"; the person wants the message.
  _plain(err) { return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ''); },

  async open() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The platform dialog is not loaded (js/vex-settings-groups.js)');
    const opener = document.activeElement;
    const state = { ...(await this._data()), f: this.defaultFilters(), busy: false, error: '' };
    const { overlay, body, close } = VexSettingsGroups.dialog({ id: 'vex-maker-repos', title: 'More from the creator', sub: 'Other public projects by the maker of Vex.' });
    overlay.classList.add('mr-ov');
    // Focus goes back to what opened this when the window goes, whichever way it goes (Escape, X, a click outside, Open).
    const watcher = new MutationObserver(() => {
      if (overlay.isConnected) return;
      watcher.disconnect();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    });
    watcher.observe(document.body, { childList: true });
    const draw = () => this._draw(body, state, draw, close);
    body.innerHTML = this._shell();
    this._wire(body, state, draw, close);
    draw();
    return overlay;
  },

  _shell() {
    return `
      <div class="mr-top">
        <div class="mr-by"><span>By</span> <strong>${this._esc(this.LOGIN)}</strong></div>
        <div class="mr-stats" id="mr-stats"></div>
      </div>
      <div class="mr-source">
        <span class="mr-source-label" id="mr-source"></span>
        <button type="button" class="btn-secondary mr-refresh" id="mr-refresh">${this._icon('refresh')}<span>Refresh from GitHub</span></button>
        <span class="mr-privacy">Nothing is contacted until you press Refresh.</span>
      </div>
      <div class="mr-alert" id="mr-alert" role="alert"></div>
      <div class="mr-filters" role="group" aria-label="Filters">
        <input type="search" id="mr-q" class="mr-q" placeholder="Search name, description or topic" aria-label="Search name, description or topic" autocomplete="off">
        <div class="mr-row2">
          <label class="mr-field"><span>Minimum stars</span><select id="mr-min">${this.MIN_STARS.map(n => `<option value="${n}">${n === 0 ? 'Any number of stars' : n + ' or more'}</option>`).join('')}</select></label>
          <label class="mr-field"><span>Sort by</span><select id="mr-sort">${this.SORTS.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}</select></label>
          <div class="mr-field"><span id="mr-types-h">Show</span><div class="mr-types" role="group" aria-labelledby="mr-types-h">
            <button type="button" class="mr-chip" data-type="original" data-k="type:original" aria-pressed="true">Original</button>
            <button type="button" class="mr-chip" data-type="fork" data-k="type:fork" aria-pressed="false">Forks</button>
            <button type="button" class="mr-chip" data-type="archived" data-k="type:archived" aria-pressed="false">Archived</button>
          </div></div>
          <button type="button" class="btn-secondary mr-clear" id="mr-clear">Clear filters</button>
        </div>
        <div class="mr-chips" role="group" aria-labelledby="mr-langs-h"><span class="mr-chips-h" id="mr-langs-h">Languages</span><span class="mr-chips-in" id="mr-langs"></span></div>
        <div class="mr-chips" role="group" aria-labelledby="mr-topics-h"><span class="mr-chips-h" id="mr-topics-h">Topics</span><span class="mr-chips-in" id="mr-topics"></span></div>
      </div>
      <div class="mr-results"><span id="mr-count" aria-live="polite"></span><span id="mr-shown-stars"></span></div>
      <ul class="mr-list" id="mr-list" aria-label="Projects"></ul>`;
  },

  _wire(body, state, draw, close) {
    const f = state.f;
    const $ = (id) => body.querySelector('#' + id);
    $('mr-q').addEventListener('input', (e) => { f.q = e.target.value; draw(); });
    $('mr-min').addEventListener('change', (e) => { f.minStars = Number(e.target.value); draw(); });
    $('mr-sort').addEventListener('change', (e) => { f.sort = e.target.value; draw(); });
    $('mr-clear').addEventListener('click', () => { Object.assign(f, this.defaultFilters()); $('mr-q').value = ''; $('mr-min').value = '0'; $('mr-sort').value = 'stars'; draw(); });
    $('mr-refresh').addEventListener('click', () => this._refresh(state, draw));
    const toggle = (arr, v) => { const i = arr.indexOf(v); if (i < 0) arr.push(v); else arr.splice(i, 1); };
    body.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !body.contains(b)) return;
      if (b.dataset.type) { f.types[b.dataset.type] = !f.types[b.dataset.type]; draw(); }
      else if (b.dataset.lang != null) { toggle(f.langs, b.dataset.lang); draw(); }
      else if (b.dataset.topic) { toggle(f.topics, b.dataset.topic); draw(); }
      else if (b.dataset.open) { try { this._openRepo(b.dataset.open, close); } catch (err) { window.showToast?.(err.message, 'error'); } }
      else if (b.dataset.copy) this._copy(b.dataset.copy);
    });
  },

  _draw(body, state, redraw, close) {
    const f = state.f;
    const $ = (id) => body.querySelector('#' + id);
    const active = document.activeElement;
    const keepKey = active && body.contains(active) ? (active.dataset.k || active.id || '') : '';
    const all = state.repos;
    const list = this.filter(all, f);
    const whole = this.totals(all);
    const shown = this.totals(list);
    $('mr-stats').innerHTML = [
      [whole.projects, 'public projects'], [whole.stars, 'stars in total'], [whole.forks, 'forks in total'],
    ].map(([n, label]) => `<div class="mr-stat"><strong>${n}</strong><span>${label}</span></div>`).join('');
    const when = new Date(state.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    $('mr-source').textContent = (state.kind === 'refreshed' ? 'Refreshed ' : 'Snapshot of ') + when;
    const refresh = $('mr-refresh');
    const priv = this._private();
    refresh.disabled = state.busy || priv;
    refresh.querySelector('span').textContent = state.busy ? 'Refreshing…' : 'Refresh from GitHub';
    refresh.title = priv ? 'Refresh is not available in a private window.' : '';
    $('mr-alert').textContent = state.error || (priv ? 'Refresh is not available in a private window.' : '') || (state.storedError ? 'The refreshed copy could not be read, so the snapshot is shown: ' + state.storedError : '');
    body.querySelectorAll('[data-type]').forEach(b => b.setAttribute('aria-pressed', String(!!f.types[b.dataset.type])));
    const fac = this.facets(all, f);
    const chip = (kind, name, count, on, label) => `<button type="button" class="mr-chip" data-${kind}="${this._esc(name)}" data-k="${kind}:${this._esc(name)}" aria-pressed="${on}"${count === 0 ? ' data-empty="1"' : ''}>${this._esc(label)} <span class="mr-n">${count}</span></button>`;
    $('mr-langs').innerHTML = fac.languages.map(l => chip('lang', l.name, l.count, f.langs.includes(l.name), l.name || 'Other')).join('');
    $('mr-topics').innerHTML = fac.topics.length ? fac.topics.map(t => chip('topic', t.name, t.count, f.topics.includes(t.name), t.name)).join('') : '<span class="mr-none">No topics</span>';
    $('mr-count').textContent = 'Showing ' + shown.projects + ' of ' + whole.projects;
    $('mr-shown-stars').textContent = shown.stars + ' stars in these';
    const now = Date.now();
    const ul = $('mr-list');
    ul.innerHTML = list.length ? list.map(r => this._rowHtml(r, now)).join('') : `<li class="mr-empty">${all.length ? 'No projects match these filters.' : 'This copy of Vex has no list of projects. Press Refresh from GitHub to load it.'}</li>`;
    // A redraw replaces the chips; the one the person was on gets its focus back.
    if (keepKey) keepKeyFocus(body, keepKey);
  },

  _rowHtml(r, now) {
    const self = r.name === this.SELF;
    const badge = (t, cls) => `<span class="mr-badge ${cls || ''}">${t}</span>`;
    return `<li class="mr-item${self ? ' mr-self' : ''}">
      <div class="mr-main">
        <div class="mr-l1"><strong class="mr-name">${this._esc(r.name)}</strong>${self ? badge('You are using this', 'mr-using') : ''}${r.fork ? badge('Fork') : ''}${r.archived ? badge('Archived') : ''}</div>
        <div class="mr-desc">${this._esc(r.description)}</div>
        <div class="mr-meta">
          ${r.language ? `<span class="mr-lang"><i class="mr-dot" style="background:${this._dot(r.language)}"></i>${this._esc(r.language)}</span>` : ''}
          <span class="mr-s" title="Stars">${this._icon('star', 12)}<span class="mr-sr">Stars</span> <b>${r.stars}</b></span>
          <span class="mr-s" title="Forks">${this._icon('git', 12)}<span class="mr-sr">Forks</span> <b>${r.forks}</b></span>
          ${r.updatedAt ? `<span class="mr-s"><span>Updated</span> ${this._esc(this.ago(r.updatedAt, now))}</span>` : ''}
          ${r.license ? `<span class="mr-s">${this._esc(r.license)}</span>` : ''}
        </div>
      </div>
      <div class="mr-actions">
        <button type="button" class="btn-secondary" data-open="${this._esc(r.url)}" data-k="open:${this._esc(r.name)}" aria-label="Open ${this._esc(r.name)} on GitHub">${this._icon('external')}<span>Open on GitHub</span></button>
        <button type="button" class="btn-secondary" data-copy="${this._esc(r.url)}" data-k="copy:${this._esc(r.name)}" aria-label="Copy the link to ${this._esc(r.name)}">${this._icon('copy')}<span>Copy link</span></button>
      </div>
    </li>`;
  },

  // A new tab through the normal tab API; the tab that was open is never navigated.
  _openRepo(url, close) {
    if (!/^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(url)) throw new Error('Not a GitHub project address: ' + url);
    if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not available here');
    close();
    TabManager.createTab(url, true);
  },

  async _copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      window.showToast?.('Link copied', 'success');
    } catch (err) { window.showToast?.('Could not copy the link: ' + this._plain(err), 'error'); }
  },

  async _refresh(state, draw) {
    if (state.busy) return;
    if (this._private()) { state.error = 'Refresh is not available in a private window.'; draw(); return; }
    if (!window.vex || typeof window.vex.makerReposRefresh !== 'function') { state.error = 'Refreshing is not available here'; draw(); return; }
    state.busy = true; state.error = ''; draw();
    try {
      const got = await window.vex.makerReposRefresh();
      state.repos = got.repos; state.date = got.fetchedAt; state.kind = 'refreshed'; state.storedError = null;
    } catch (err) {
      state.error = 'Could not refresh: ' + this._plain(err);
    } finally {
      state.busy = false;
    }
    draw();
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('The public projects of the person who makes Vex, with their stars, and a filter. The list ships with Vex. Nothing is contacted until you press Refresh from GitHub inside it.'));
    el.appendChild(VexSettingsGroups.button('Open More from the creator', () => this.open().catch(err => window.showToast?.(err.message, 'error')), { primary: true }));
  },
};

// Gives focus back to the button/field with this data-k (or id) after a redraw replaced it.
function keepKeyFocus(root, key) {
  const el = [...root.querySelectorAll('[data-k],[id]')].find(n => (n.dataset.k || n.id) === key);
  if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
}

if (typeof window !== 'undefined') {
  window.VexMakerRepos = VexMakerRepos;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'maker-repos', title: 'More from the creator', keywords: 'creator maker author github repositories repos projects stars other works 0xmortuex', before: 'about', build: (el) => VexMakerRepos.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'maker-repos', label: 'More from the creator', hint: 'The public projects of the maker of Vex, with stars and filters', keywords: 'creator maker author github repositories repos projects stars other works', icon: 'code', action: () => VexMakerRepos.open().catch(err => window.showToast?.(err.message, 'error')) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMakerRepos };
