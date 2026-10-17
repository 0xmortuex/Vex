// === Patch radar: tell me when one of my games gets a patch ====================
//
// For each game in Game mode's list the user can name a "Patch notes page": a
// news feed (RSS/Atom) or an ordinary page. Vex then watches it in the
// background and says "New patch notes for <game>" without anyone visiting the
// site.
//
// This is NOT a second poller. A radar watch is a page watch (js/page-watch.js)
// made with source 'radar:patch-notes': the engine there does the timing,
// history, backoff, ETag, "what changed" and the Watched pages panel. This file
// only (1) knows which game a watch belongs to, (2) shows the result in the
// game's Settings row and dossier, and (3) holds the announcement back while the
// game runs.
//
// Rules:
//  - Nothing is watched, and nothing is requested, until the user types an
//    address (or an app number) and confirms what Vex found there.
//  - No account, no key. The bundled templates only fill in a public address
//    the user then confirms; they are labelled "suggested, unverified".
//  - A page that is built by JavaScript is said to be so, and the hidden-tab
//    read the watcher already has is offered; it is never switched on silently.
//  - While the game runs nothing is shown. What was found waits and is told
//    when the game ends (it survives a restart).
const PatchRadar = {
  KEY: 'vex.patchRadar',
  QUEUE_KEY: 'vex.patchRadar.queue',
  SOURCE: 'radar:patch-notes',
  EVERY: 6 * 3600000,
  MAX_PER_GAME: 3,
  MAX_QUEUE: 20,

  // Public address patterns the user can start from. Each is only a suggestion:
  // it is filled in and shown, and nothing is requested until it is confirmed.
  TEMPLATES: [
    { id: 'steam-news', label: 'Steam news feed for an app number', input: /^\d{1,10}$/, build: (v) => 'https://store.steampowered.com/feeds/news/app/' + v + '/' },
    { id: 'github-releases', label: 'GitHub releases feed for owner/repo', input: /^(?!localhost\/)[A-Za-z0-9-]{1,39}\/[\w.-]{1,100}$/, build: (v) => 'https://github.com/' + v + '/releases.atom' },
  ],
  // The newest item's title, out of the feed's own markup.
  FEED_PATTERNS: {
    rss: '<item[ >][\\s\\S]*?<title[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</title>',
    atom: '<entry[ >][\\s\\S]*?<title[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</title>',
  },

  _t(s) { try { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(s)) || s; } catch { return s; } },
  _note(what, err) { window.VexProblems?.note('Patch radar', what, err); },

  // ---- what is saved: { [gameId]: [{ watchId, url, mode, template }] } ----------
  _all() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch { return {}; }
    if (!raw) return {};
    try { const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch (err) { this._note('The saved patch pages could not be read and were ignored', err); return {}; }
  },
  _saveAll(o) {
    try { localStorage.setItem(this.KEY, JSON.stringify(o)); }
    catch (err) { this._note('Could not save the patch pages', err); throw new Error('Could not save the patch notes page: ' + err.message); }
  },

  // What the user typed → the address to look at. A number is a Steam app, and
  // owner/repo a GitHub project; anything else must be a web address.
  resolveInput(input) {
    const v = String(input == null ? '' : input).trim();
    if (!v) throw new Error('Type the address of the patch notes page or feed');
    for (const t of this.TEMPLATES) {
      if (t.input.test(v) && !/^https?:/i.test(v)) return { url: t.build(v), template: t.id };
    }
    let u;
    try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v); } catch { throw new Error('That is not a web address'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only a web page (https://…) can be watched');
    return { url: u.href, template: null };
  },

  // Is this body a feed? (Detected from what came back, not from the address.)
  detect(body) {
    const head = String(body || '').slice(0, 2000);
    if (/<rss[\s>]|<rdf:RDF[\s>]/i.test(head)) return 'rss';
    if (/<feed[\s>]/i.test(head)) return 'atom';
    return null;
  },
  _entities(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&amp;/g, '&');
  },
  // The newest item of a feed, or null.
  latestOf(body, flavour) {
    const D = PageWatch._diff();
    const v = D.extract(String(body || ''), this.FEED_PATTERNS[flavour]);
    return v == null ? null : this._entities(v);
  },

  // One look, before anything is watched: what is at this address? The person
  // confirms on this. → { mode: 'feed'|'page', flavour, latest, jsNeeded }
  async preview(url) {
    if (typeof PageWatch === 'undefined' || typeof AgentTools === 'undefined') throw new Error('Page watching is not available');
    const refused = PageWatch.refusalFor({ url });
    if (refused) throw new Error(refused);
    const local = PageWatch.isLocal(url);
    const r = local ? await PageWatch._getLocal(url) : await AgentTools._get(url, null, PageWatch.POLITE);
    const body = String(r.body || '');
    const flavour = this.detect(body);
    if (flavour) {
      const latest = this.latestOf(body, flavour);
      if (latest == null) throw new Error('That is a feed, but it has no items in it');
      return { mode: 'feed', flavour, latest, jsNeeded: false };
    }
    const text = AgentTools.htmlToText(body).text;
    return { mode: 'page', flavour: null, latest: null, jsNeeded: text.length < 200 };
  },

  // ---- adding and removing ---------------------------------------------------------
  // `mode` and `jsNeeded` come from preview(). render: the user said yes to the
  // hidden tab for a page that builds itself with JavaScript.
  add(gameId, { url, mode = 'page', flavour = null, template = null, render = false }) {
    const game = typeof GameSession !== 'undefined' ? GameSession.games().find(g => g.id === gameId) : null;
    if (!game) throw new Error('That game is not in the list');
    const all = this._all();
    const mine = (Array.isArray(all[gameId]) ? all[gameId] : []).filter(e => PageWatch.list().some(w => w.id === e.watchId));
    if (mine.some(e => e.url === url)) throw new Error('That page is already watched for ' + game.name);
    if (mine.length >= this.MAX_PER_GAME) throw new Error(game.name + ' already has ' + this.MAX_PER_GAME + ' patch notes pages. Stop one first.');
    const feed = mode === 'feed';
    if (feed && !this.FEED_PATTERNS[flavour]) throw new Error('Say whether the feed is RSS or Atom');
    const watch = PageWatch.add({
      url, title: game.name + ' — patch notes', source: this.SOURCE, byUser: true, every: this.EVERY,
      kind: feed ? 'regex' : 'text', pattern: feed ? this.FEED_PATTERNS[flavour] : '', raw: feed, render: !!render && !feed,
    });
    try {
      mine.push({ watchId: watch.id, url, mode: feed ? 'feed' : 'page', template: template || null });
      all[gameId] = mine;
      this._saveAll(all);
    } catch (err) {
      PageWatch.remove(watch.id);
      throw err;
    }
    return watch;
  },
  // The first look at once, so the baseline is set while the person is there.
  async confirmAndAdd(gameId, input, { ask } = {}) {
    const { url, template } = this.resolveInput(input);
    const p = await this.preview(url);
    let render = false;
    if (p.mode === 'page' && p.jsNeeded) {
      const ok = ask ? await ask({ kind: 'js', url, preview: p }) : false;
      if (!ok) throw new Error('That page builds itself with JavaScript, so a plain check would see almost nothing. Add it again and choose the hidden-tab read, or use the page’s news feed instead.');
      render = true;
    } else if (ask) {
      const ok = await ask({ kind: p.mode, url, template, preview: p });
      if (!ok) return null;
    }
    const watch = this.add(gameId, { url, mode: p.mode, flavour: p.flavour, template, render });
    await PageWatch.firstLook(watch);
    return watch;
  },
  remove(gameId, watchId) {
    const all = this._all();
    const list = Array.isArray(all[gameId]) ? all[gameId] : [];
    if (!list.some(e => e.watchId === watchId)) throw new Error('That patch notes page is not on this game');
    PageWatch.remove(watchId);
    all[gameId] = list.filter(e => e.watchId !== watchId);
    if (!all[gameId].length) delete all[gameId];
    this._saveAll(all);
  },
  // The game left the list: its radar watches go with it.
  forgetGame(gameId) {
    const all = this._all();
    for (const e of (Array.isArray(all[gameId]) ? all[gameId] : [])) {
      try { PageWatch.remove(e.watchId); } catch (err) { this._note('Could not stop a patch notes watch', err); }
    }
    if (all[gameId]) { delete all[gameId]; this._saveAll(all); }
    const q = this.queue().filter(x => x.gameId !== gameId);
    this._saveQueue(q);
  },

  // ---- reading it back ---------------------------------------------------------------
  // [{ watchId, url, mode, title, latest, at, unseen, error, paused }]. A watch
  // stopped in the Watched pages panel simply is not listed.
  pages(gameId) {
    const list = Array.isArray(this._all()[gameId]) ? this._all()[gameId] : [];
    const watches = PageWatch.list();
    const out = [];
    for (const e of list) {
      const w = watches.find(x => x.id === e.watchId);
      if (!w) continue;
      out.push({
        watchId: w.id, url: e.url, mode: e.mode, template: e.template,
        latest: e.mode === 'feed' && w.lastValue != null ? this._entities(w.lastValue) : null,
        at: w.lastChangedAt || (w.lastValue != null ? w.addedAt : 0),
        changedAt: w.lastChangedAt || 0,
        unseen: PageWatch.isUnseen(w), error: w.lastError || '', paused: !!w.paused,
        render: !!w.render,
      });
    }
    return out;
  },
  unseenCount(gameId) { return this.pages(gameId).filter(p => p.unseen).length; },
  markSeen(gameId) { for (const p of this.pages(gameId)) PageWatch.markSeen(p.watchId); },
  gameOf(watchId) {
    const all = this._all();
    for (const [gameId, list] of Object.entries(all)) {
      if (Array.isArray(list) && list.some(e => e.watchId === watchId)) return gameId;
    }
    return null;
  },

  // ---- telling the user, and not while the game runs ----------------------------------
  gaming() { return typeof GameSession !== 'undefined' && !!GameSession.active; },
  queue() {
    try { const a = JSON.parse(localStorage.getItem(this.QUEUE_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
  },
  _saveQueue(q) {
    try { localStorage.setItem(this.QUEUE_KEY, JSON.stringify(q.slice(-this.MAX_QUEUE))); }
    catch (err) { this._note('Could not keep the patch news for after the game', err); }
  },
  _gameName(gameId) {
    const g = typeof GameSession !== 'undefined' ? GameSession.games().find(x => x.id === gameId) : null;
    return g ? g.name : '';
  },
  _line(item) {
    return this._t('New patch notes for') + ' ' + item.name + (item.title ? ' — ' + item.title : '');
  },

  // Called by PageWatch.announce for a radar watch, in place of its own words.
  // → 'shown' | 'queued' | 'ignored'
  announce(watch, verdict) {
    const gameId = this.gameOf(watch.id);
    const name = gameId ? this._gameName(gameId) : '';
    // The game was removed from the list but the watch lingered: say nothing
    // about a game that is not there.
    if (!name) return 'ignored';
    const entry = this.pages(gameId).find(p => p.watchId === watch.id);
    const item = { gameId, name, watchId: watch.id, title: entry && entry.latest ? entry.latest : '', at: Date.now() };
    document.dispatchEvent(new CustomEvent('vex:patch-radar', { detail: { item } }));
    if (this.gaming()) {
      const q = this.queue().filter(x => !(x.watchId === item.watchId && x.title === item.title));
      q.push(item);
      this._saveQueue(q);
      return 'queued';
    }
    this._show([item]);
    return 'shown';
  },
  _show(items) {
    if (!items.length) return;
    const text = items.length === 1
      ? this._line(items[0])
      : this._t('New patch notes for') + ' ' + [...new Set(items.map(i => i.name))].join(', ');
    const show = () => {
      window.showToast?.(text, 'info', 8000);
      try { window.vex?.notify?.('Vex — ' + this._t('patch notes'), text); } catch (err) { this._note('The desktop notification failed', err); }
    };
    // One alert per change, digest first (js/watch-alerts.js; off = shown at once, as before).
    if (typeof WatchAlerts === 'undefined' || !WatchAlerts.route({ source: 'patch-radar', entity: 'patch:' + [...new Set(items.map(i => i.name))].join(','), title: text, show })) show();
  },
  // The game ended: what was found meanwhile is told now, once.
  flush() {
    if (this.gaming()) return 0;
    const q = this.queue();
    if (!q.length) return 0;
    this._saveQueue([]);
    // A game removed while it was queued says nothing.
    const live = q.filter(i => this._gameName(i.gameId));
    this._show(live);
    return live.length;
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    document.addEventListener('vex:game-mode', (e) => { if (e && e.detail && e.detail.active === false) this.flush(); });
    // Vex started with news waiting from before it closed.
    setTimeout(() => this.flush(), 5000);
    return true;
  },

  // ---- Settings: one block inside each game's row -----------------------------------
  renderGame(wrap, game, repaint) {
    const t = (s) => this._t(s);
    const failed = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const pages = this.pages(game.id);
    const unseen = pages.filter(p => p.unseen).length;
    const row = document.createElement('div');
    row.className = 'setting-toggle-row pr-row';
    const label = document.createElement('span');
    label.textContent = t('Patch notes page') + (pages.length ? ' (' + pages.length + ')' : '') + (unseen ? ' — ' + unseen + ' ' + t('new') : '');
    if (unseen) label.className = 'pr-unseen';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-secondary';
    add.textContent = t('Add a patch notes page…');
    add.addEventListener('click', async () => {
      try {
        const v = await window.vexPrompt({
          title: t('Patch notes page for') + ' ' + game.name,
          label: t('Address, Steam app number, or GitHub owner/repo'),
          message: t('Nothing is requested until you confirm. A number is suggested as https://store.steampowered.com/feeds/news/app/<number>/ and owner/repo as https://github.com/<owner>/<repo>/releases.atom — suggested, unverified.'),
          okLabel: t('Look'),
        });
        if (v == null) return;
        const w = await this.confirmAndAdd(game.id, v, { ask: (c) => this._confirm(game, c) });
        if (w) window.showToast?.(t('Watching for patch notes for') + ' ' + game.name);
      } catch (err) { failed(err); }
      repaint();
    });
    row.append(label, add);
    wrap.appendChild(row);
    for (const p of pages) {
      const r = document.createElement('div');
      r.className = 'setting-toggle-row pr-page';
      const info = document.createElement('span');
      let host = p.url; try { host = new URL(p.url).hostname; } catch { /* shown as given */ }
      const when = p.at ? new Date(p.at).toLocaleDateString() : t('not yet');
      info.textContent = (p.latest ? p.latest : host) + ' · ' + (p.changedAt ? t('new') + ' ' : t('seen') + ' ') + when
        + (p.template ? ' · ' + t('suggested, unverified') : '') + (p.render ? ' · ' + t('hidden tab') : '') + (p.error ? ' · ' + p.error : '') + (p.paused ? ' · ' + t('paused') : '');
      const btns = document.createElement('span');
      btns.className = 'gs-btns';
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'btn-secondary'; open.textContent = t('Open');
      open.addEventListener('click', () => {
        try { PageWatch.markSeen(p.watchId); if (typeof TabManager === 'undefined') throw new Error('Tabs are not available'); TabManager.createTab(p.url, true); } catch (err) { failed(err); }
        repaint();
      });
      const stop = document.createElement('button');
      stop.type = 'button'; stop.className = 'btn-secondary'; stop.textContent = t('Stop');
      stop.addEventListener('click', () => { try { this.remove(game.id, p.watchId); } catch (err) { failed(err); } repaint(); });
      btns.append(open, stop);
      r.append(info, btns);
      wrap.appendChild(r);
    }
  },
  async _confirm(game, c) {
    const t = (s) => this._t(s);
    let host = c.url; try { host = new URL(c.url).host; } catch { /* as given */ }
    if (c.kind === 'js') {
      return window.vexConfirm({
        title: t('This page needs JavaScript'),
        message: host + ' — ' + t('a plain check sees almost nothing here. Vex can read it through a hidden tab instead (one load, no clicks, every 6 hours). Use the hidden tab?'),
        okLabel: t('Use the hidden tab'), cancelLabel: t('Cancel'),
      });
    }
    const what = c.kind === 'feed'
      ? t('A feed. Newest item:') + ' “' + c.preview.latest + '”'
      : t('An ordinary page. Vex will say when its text changes.');
    return window.vexConfirm({
      title: t('Watch for patch notes for') + ' ' + game.name + '?',
      message: c.url + '\n' + what + '\n' + t('Checked every 6 hours from this computer. Stop it any time here.') + (c.template ? '\n' + t('The address was suggested from a template and is unverified: check it is the one you want.') : ''),
      okLabel: t('Watch'), cancelLabel: t('Cancel'),
    });
  },

  // A short list for the game's dossier: the newest item of each patch page.
  latestBlock(gameId) {
    const t = (s) => this._t(s);
    const pages = this.pages(gameId);
    if (!pages.length) return null;
    const box = document.createElement('div');
    box.className = 'pr-latest';
    const h = document.createElement('h4');
    h.className = 'gd-h';
    h.textContent = t('Patch notes');
    box.appendChild(h);
    for (const p of pages) {
      const a = document.createElement('a');
      a.className = 'gd-link';
      a.href = p.url;
      a.textContent = (p.latest || p.url) + (p.at ? ' — ' + new Date(p.at).toLocaleDateString() : '') + (p.unseen ? ' (' + t('new') + ')' : '');
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        try { PageWatch.markSeen(p.watchId); if (typeof TabManager === 'undefined') throw new Error('Tabs are not available'); TabManager.createTab(p.url, true); }
        catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); }
      });
      box.appendChild(a);
    }
    return box;
  },
};

// === Release radar: what is new in the tools I actually use =====================
//
// The patch radar above is per game and per address the user typed. This is the
// same idea for software: the latest release of the products the person really
// uses, and only those. "Uses" is decided on this computer, from three places:
//
//   history      a product's site visited at least MIN_VISITS times in 60 days
//   extensions   an installed extension that is the product (or its companion)
//   watched      a GitHub repository already in Vex's GitHub watches
//
// A product that none of the three shows is never looked up, so nothing about
// products you do not use is asked or listed. The one request is GitHub's
// public "latest release" for each matched repository (no key, no account, 60 an
// hour unsigned; answers are kept six hours). What was asked is shown first, and
// asked of the person once, because the repository names tell GitHub which of
// these tools you use.
const ReleaseRadar = {
  KEY: 'vex.releaseRadar',
  CACHE_MS: 6 * 3600000,
  RECENT_MS: 45 * 24 * 3600000,
  HISTORY_MS: 60 * 24 * 3600000,
  MIN_VISITS: 3,
  MAX_LOOKUPS: 15,

  // A starting list of well-known tools. `hosts` are the sites that show use,
  // `ext` a pattern for an extension's name, `repo` the GitHub project whose
  // releases are the product's.
  PRODUCTS: [
    { id: 'vscode', name: 'Visual Studio Code', repo: 'microsoft/vscode', hosts: ['code.visualstudio.com'] },
    { id: 'node', name: 'Node.js', repo: 'nodejs/node', hosts: ['nodejs.org'] },
    { id: 'deno', name: 'Deno', repo: 'denoland/deno', hosts: ['deno.com', 'deno.land'] },
    { id: 'bun', name: 'Bun', repo: 'oven-sh/bun', hosts: ['bun.sh'] },
    { id: 'vite', name: 'Vite', repo: 'vitejs/vite', hosts: ['vitejs.dev', 'vite.dev'] },
    { id: 'electron', name: 'Electron', repo: 'electron/electron', hosts: ['electronjs.org'] },
    { id: 'rust', name: 'Rust', repo: 'rust-lang/rust', hosts: ['rust-lang.org', 'doc.rust-lang.org'] },
    { id: 'git', name: 'Git for Windows', repo: 'git-for-windows/git', hosts: ['git-scm.com', 'gitforwindows.org'] },
    { id: 'ollama', name: 'Ollama', repo: 'ollama/ollama', hosts: ['ollama.com'] },
    { id: 'obsidian', name: 'Obsidian', repo: 'obsidianmd/obsidian-releases', hosts: ['obsidian.md'] },
    { id: 'obs', name: 'OBS Studio', repo: 'obsproject/obs-studio', hosts: ['obsproject.com'] },
    { id: 'godot', name: 'Godot', repo: 'godotengine/godot', hosts: ['godotengine.org'] },
    { id: 'ha', name: 'Home Assistant', repo: 'home-assistant/core', hosts: ['home-assistant.io'] },
    { id: 'ublock', name: 'uBlock Origin', repo: 'gorhill/uBlock', hosts: [], ext: /ublock/i },
    { id: 'bitwarden', name: 'Bitwarden', repo: 'bitwarden/clients', hosts: ['bitwarden.com'], ext: /bitwarden/i },
    { id: 'darkreader', name: 'Dark Reader', repo: 'darkreader/darkreader', hosts: ['darkreader.org'], ext: /dark reader/i },
  ],

  enabled() { return !window.VexWorkflow ? true : window.VexWorkflow.pref('releaseRadar', true) !== false; },
  backgroundOn() { return !!window.VexWorkflow && window.VexWorkflow.pref('releaseRadarBackground', false) === true; },
  agreed() { return !!window.VexWorkflow && window.VexWorkflow.pref('releaseRadarAgreed', false) === true; },

  _state() {
    try { const o = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? { fetched: o.fetched || {}, seen: o.seen || {} } : { fetched: {}, seen: {} }; }
    catch { return { fetched: {}, seen: {} }; }
  },
  _saveState(s) { try { localStorage.setItem(this.KEY, JSON.stringify(s)); return true; } catch { return false; } },

  // ---- what the person uses ----------------------------------------------------------
  _historyHosts(now = Date.now()) {
    const counts = new Map();
    let entries = [];
    try {
      entries = (typeof HistoryPanel !== 'undefined' && typeof HistoryPanel.list === 'function') ? HistoryPanel.list()
        : (() => { const a = JSON.parse(localStorage.getItem('vex.history') || '[]'); return Array.isArray(a) ? a : (a && Array.isArray(a.entries) ? a.entries : []); })();
    } catch { entries = []; }
    for (const h of entries) {
      if (!h || !h.url) continue;
      const t = typeof h.time === 'number' ? h.time : Date.parse(h.time || '') || 0;
      if (t && now - t > this.HISTORY_MS) continue;
      let host = '';
      try { host = new URL(h.url).hostname.replace(/^www\./, '').toLowerCase(); } catch { continue; }
      counts.set(host, (counts.get(host) || 0) + 1);
    }
    return counts;
  },

  // → [{ product, why: [string], repo }] — products with at least one reason.
  usedProducts(extensions = [], watched = [], now = Date.now()) {
    const hosts = this._historyHosts(now);
    const out = [];
    const seenRepo = new Set();
    for (const p of this.PRODUCTS) {
      const why = [];
      let visits = 0;
      for (const [h, n] of hosts) if (p.hosts.some(x => h === x || h.endsWith('.' + x))) visits += n;
      if (visits >= this.MIN_VISITS) why.push('visited ' + visits + ' times in 60 days');
      const ext = p.ext ? extensions.find(e => p.ext.test(String(e.name || ''))) : null;
      if (ext) why.push('extension “' + ext.name + '” is installed');
      if (watched.some(w => String(w).toLowerCase() === p.repo.toLowerCase())) why.push('you watch ' + p.repo);
      if (why.length) { out.push({ product: p, repo: p.repo, why }); seenRepo.add(p.repo.toLowerCase()); }
    }
    // A repository watched in Vex that is not in the table is a product the
    // person named themselves.
    for (const r of watched) {
      if (seenRepo.has(String(r).toLowerCase())) continue;
      out.push({ product: { id: 'repo:' + r, name: r, repo: r, hosts: [] }, repo: r, why: ['you watch ' + r] });
      seenRepo.add(String(r).toLowerCase());
    }
    return out;
  },

  _watchedRepos() {
    try { return (typeof GitHubWatch !== 'undefined' ? GitHubWatch.list() : []).filter(w => w.kind === 'release').map(w => w.owner + '/' + w.repo); }
    catch { return []; }
  },
  async _extensions() {
    try { if (window.vex && typeof window.vex.extensionsList === 'function') { const l = await window.vex.extensionsList(); return Array.isArray(l) ? l : []; } }
    catch (err) { this._note('Could not read the installed extensions', err); }
    return [];
  },

  // ---- looking up ----------------------------------------------------------------------
  async _latest(repo) {
    if (typeof GitHubWatch === 'undefined' || typeof GitHubWatch._get !== 'function') throw new Error('GitHub lookups are not available');
    const r = await GitHubWatch._get('/repos/' + repo + '/releases/latest');
    return { tag: r.tag_name || '', name: r.name || r.tag_name || '', published: Date.parse(r.published_at || r.created_at || '') || 0, url: r.html_url || ('https://github.com/' + repo + '/releases'), notes: String(r.body || '').replace(/\r/g, '').slice(0, 400) };
  },

  // Look up the matched products whose answer is older than CACHE_MS. → { items, errors }
  async refresh({ force = false, now = Date.now() } = {}) {
    if (!this.enabled()) throw new Error('The release radar is off in Settings › Workflow');
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) throw new Error('The release radar is not used in a private window');
    const used = this.usedProducts(await this._extensions(), this._watchedRepos(), now).slice(0, this.MAX_LOOKUPS);
    const st = this._state();
    const errors = [];
    for (const u of used) {
      const have = st.fetched[u.repo];
      if (!force && have && now - have.at < this.CACHE_MS) continue;
      try { st.fetched[u.repo] = { ...(await this._latest(u.repo)), at: now }; }
      catch (err) { errors.push(u.product.name + ': ' + ((err && err.message) || String(err))); if (/slow down/i.test(String(err && err.message))) break; }
    }
    this._saveState(st);
    return { items: this.items(used, st, now), errors };
  },

  // The matched products with what is known, newest release first. No request.
  items(used, st = this._state(), now = Date.now()) {
    const list = used || this.usedProducts([], this._watchedRepos(), now);
    return list.map((u) => {
      const f = st.fetched[u.repo];
      return f ? { id: u.product.id, name: u.product.name, repo: u.repo, why: u.why, tag: f.tag, title: f.name, published: f.published, url: f.url, notes: f.notes, unseen: st.seen[u.repo] !== f.tag, recent: !!f.published && now - f.published < this.RECENT_MS } : null;
    }).filter(Boolean).sort((a, b) => b.published - a.published);
  },

  markSeen(repo) {
    const st = this._state();
    const f = st.fetched[repo];
    if (f) { st.seen[repo] = f.tag; this._saveState(st); }
  },

  // ---- the list ---------------------------------------------------------------------------
  async _agree(used) {
    if (this.agreed()) return true;
    const ok = await window.vexConfirm({
      title: 'Look up releases of the tools you use?',
      message: 'Vex found these in your history, extensions and GitHub watches:\n\n' + used.map(u => u.product.name + ' (' + u.repo + ')').join('\n')
        + '\n\nIt asks GitHub for each one’s latest release — no account, no key. GitHub can see which of them you asked for. Nothing else is sent.',
      okLabel: 'Look them up',
    });
    if (ok) window.VexWorkflow.setPref('releaseRadarAgreed', true);
    return ok;
  },

  async open() {
    if (!this.enabled()) { window.showToast?.('The release radar is off in Settings › Workflow', 'info'); return; }
    document.getElementById('vex-relradar')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const m = document.createElement('div');
    m.id = 'vex-relradar';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:flex-start;justify-content:center;padding-top:8vh';
    m.innerHTML = `<div role="dialog" aria-modal="true" aria-label="What is new for you" style="width:620px;max-width:94vw;max-height:80vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,.5));color:var(--text);font-size:12.5px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--border)">
        <span style="display:inline-flex;align-items:center;gap:7px;font-size:15px;font-weight:700;flex:1">${VexIcons.svg('rocket', { size: 16 })}What is new for you</span>
        <button type="button" id="rr-refresh" class="btn-secondary">Check now</button>
        <button type="button" id="rr-close" class="btn-secondary" aria-label="Close">${VexIcons.svg('x', { size: 13 })}</button>
      </div>
      <div id="rr-body" style="padding:10px 16px 16px;overflow-y:auto"></div></div>`;
    document.body.appendChild(m);
    if (typeof VexLayer !== 'undefined') VexLayer.track(m, { tier: 'dialog', id: 'patch-radar' });
    const body = m.querySelector('#rr-body');
    const close = () => m.remove();
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    m.querySelector('#rr-close').addEventListener('click', close);

    const paint = (items, errors, note) => {
      body.textContent = '';
      if (note) { const n = document.createElement('div'); n.style.cssText = 'color:var(--text-muted);margin-bottom:8px'; n.textContent = note; body.appendChild(n); }
      if (!items.length && !errors.length) {
        const e = document.createElement('div');
        e.style.color = 'var(--text-muted)';
        e.textContent = 'Nothing yet. A product shows here once your history, an extension or a GitHub watch shows you use it.';
        body.appendChild(e);
      }
      for (const it of items) {
        const row = document.createElement('div');
        row.style.cssText = 'border:1px solid var(--border);border-radius:9px;padding:9px 11px;margin-bottom:7px;background:var(--bg)';
        row.innerHTML = `<div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${esc(it.name)} · ${esc(it.tag)}</b><span style="color:var(--text-muted)">${it.published ? esc(new Date(it.published).toLocaleDateString()) : ''}${it.unseen ? ' · new' : ''}</span></div>
          <div style="color:var(--text-muted);font-size:11.5px;margin:3px 0">Shown because: ${esc(it.why.join('; '))}</div>
          ${it.notes ? `<div style="white-space:pre-wrap;font-size:11.5px;max-height:5.5em;overflow:hidden">${esc(it.notes)}</div>` : ''}
          <div style="margin-top:6px;display:flex;gap:6px"><button type="button" class="btn-secondary" data-open>Open release</button><button type="button" class="btn-secondary" data-seen>Mark seen</button></div>`;
        row.querySelector('[data-open]').addEventListener('click', () => { this.markSeen(it.repo); try { TabManager.createTab(it.url, true); close(); } catch (err) { window.showToast?.(err.message, 'error'); } });
        row.querySelector('[data-seen]').addEventListener('click', () => { this.markSeen(it.repo); row.remove(); });
        body.appendChild(row);
      }
      for (const e of errors) { const d = document.createElement('div'); d.style.cssText = 'color:var(--danger,#e5484d);font-size:11.5px'; d.textContent = e; body.appendChild(d); }
    };

    const run = async (force) => {
      body.textContent = 'Looking at what you use…';
      try {
        const used = this.usedProducts(await this._extensions(), this._watchedRepos()).slice(0, this.MAX_LOOKUPS);
        if (!used.length) { paint([], [], ''); return; }
        const st = this._state();
        const anyFetch = used.some(u => !st.fetched[u.repo] || force);
        if (anyFetch && !(await this._agree(used))) { paint(this.items(used, st), [], 'Showing what was already known. Nothing was looked up.'); return; }
        const r = await this.refresh({ force });
        paint(r.items, r.errors, 'Only products your history, extensions or GitHub watches show you use.');
      } catch (err) { paint([], [(err && err.message) || String(err)], ''); }
    };
    m.querySelector('#rr-refresh').addEventListener('click', () => run(true));
    await run(false);
  },

  // The background check: once every six hours, only when asked for and only
  // after the person has agreed to the lookups. What is new is told once.
  async _tick() {
    if (!this.enabled() || !this.backgroundOn() || !this.agreed()) return 0;
    const before = new Set(this.items().filter(i => !i.unseen).map(i => i.repo));
    const r = await this.refresh();
    const fresh = r.items.filter(i => i.unseen && i.recent && !before.has(i.repo));
    if (fresh.length) {
      const text = 'New for you: ' + fresh.slice(0, 3).map(i => i.name + ' ' + i.tag).join(', ') + (fresh.length > 3 ? ' and ' + (fresh.length - 3) + ' more' : '');
      window.showToast?.(text, 'info', 8000);
    }
    return fresh.length;
  },

  snapshot() {
    return { enabled: this.enabled(), background: this.backgroundOn(), items: this.items().map(i => ({ name: i.name, tag: i.tag, published: i.published, url: i.url, unseen: i.unseen, recent: i.recent })) };
  },

  render(box) {
    box.appendChild(window.VexWorkflow.toggleRow('Release radar: what is new in the tools I use', 'only tools your history, extensions or GitHub watches show', this.enabled(), (on) => {
      if (!window.VexWorkflow.setPref('releaseRadar', on)) window.showToast?.('The choice could not be saved', 'error');
      this.init();
    }));
    box.appendChild(window.VexWorkflow.toggleRow('Check by itself every six hours', 'off by default; asks GitHub only after you have agreed once', this.backgroundOn(), (on) => {
      if (!window.VexWorkflow.setPref('releaseRadarBackground', on)) window.showToast?.('The choice could not be saved', 'error');
    }));
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-secondary'; b.style.marginTop = '6px'; b.textContent = 'Show what is new for me';
    b.addEventListener('click', () => this.open());
    box.appendChild(b);
  },

  init() {
    if (!window.VexWorkflow) return false;
    if (!this.enabled()) {
      if (this._job) { this._job.stop(); this._job = null; }
      if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) CommandBar.commands = CommandBar.commands.filter(c => c.id !== 'release-radar');
      return false;
    }
    window.VexWorkflow.addCommand({ id: 'release-radar', label: 'What is new for me', hint: 'Latest releases of the tools you actually use, from your history, extensions and GitHub watches', icon: 'rocket', action: () => this.open() });
    if (!this._job && typeof VexJobs !== 'undefined') this._job = VexJobs.every('Release radar', 6 * 3600000, () => this._tick().catch(err => this._note('The release check failed', err)), { when: 'background', deferOnBattery: true });
    return true;
  },
  _note(what, err) { window.VexProblems?.note('Release radar', what, err); },
};

if (!!window.VexWorkflow) {
  window.VexWorkflow.register({
    id: 'releaseRadar', title: 'Release radar', icon: 'rocket',
    render: (box) => ReleaseRadar.render(box),
    snapshot: () => ReleaseRadar.snapshot(),
  });
}

if (typeof window !== 'undefined') { window.PatchRadar = PatchRadar; window.ReleaseRadar = ReleaseRadar; }
if (typeof module !== 'undefined' && module.exports) module.exports = { PatchRadar, ReleaseRadar };
