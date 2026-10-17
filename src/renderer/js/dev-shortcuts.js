// === Developer shortcuts: Cloudflare links, Roblox IDs, repo skim =============
//
// Three small tools for the owner's own work. None of them acts on its own and
// none writes anything anywhere: each runs when you ask (Ctrl+K), reads public
// pages, and shows you the answer.
//
//   CloudflareShortcuts  T3-009  deep links to your workers' and KV pages in the
//                        Cloudflare dashboard. Links only: Vex makes no request
//                        to Cloudflare, holds no Cloudflare token and cannot log
//                        in for you. A worker's logs page needs you signed in
//                        to the dashboard in a tab, as always.
//   RobloxResolver       T3-018  a pasted Roblox asset or place id (or a roblox.com
//                        address) -> the public page link and a short summary, read
//                        from Roblox's public JSON endpoints. No cookie, no login,
//                        one id at a time, only when you press the button.
//   RepoSkim             T3-070  a GitHub repository -> what it is, when it was
//                        last touched, its licence and a few red flags, read-only
//                        through the GitHub vault (public data when no token is
//                        saved). The README is summarised only on request, and
//                        only by the local model.

const DevToolsPrefs = {
  read(key, defaults) {
    let raw = null;
    try { raw = localStorage.getItem(key); }
    catch (err) { console.error('[DevTools] ' + key + ' could not be read:', err.message); return { ...defaults }; }
    if (raw == null) return { ...defaults };
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return { ...defaults, ...v };
      throw new Error('not an object');
    } catch (err) {
      console.error('[DevTools] ' + key + ' is not readable and is started again:', err.message);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Developer tools', key + ' was not readable and was started again', err);
      return { ...defaults };
    }
  },
  write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  open(url) {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    TabManager.createTab(String(url), true);
  },
  async copy(text, what) {
    await navigator.clipboard.writeText(String(text));
    window.showToast?.(what + ' copied');
  },
  ago(ms) {
    const d = Math.floor((Date.now() - ms) / 86400000);
    if (d < 1) return 'today';
    if (d < 31) return d + ' day' + VexPlural.s(d) + ' ago';
    if (d < 730) return Math.round(d / 30.4) + ' months ago';
    return Math.round(d / 365) + ' years ago';
  },
};

// ---------------------------------------------------------------------------------
// T3-009  Cloudflare dashboard shortcuts
const CloudflareShortcuts = {
  KEY: 'vex.cfShortcuts',
  FEATURE: 'cloudflare-shortcuts',
  DEFAULTS: { enabled: true, accountId: '', workers: [], kv: [] },
  MAX_WORKERS: 20,
  MAX_KV: 20,
  ACCOUNT_RE: /^[0-9a-f]{32}$/i,
  WORKER_RE: /^[a-z0-9][a-z0-9_-]{0,62}$/i,

  state() {
    const s = DevToolsPrefs.read(this.KEY, this.DEFAULTS);
    if (!Array.isArray(s.workers)) s.workers = [];
    if (!Array.isArray(s.kv)) s.kv = [];
    return s;
  },
  save(s) { DevToolsPrefs.write(this.KEY, s); this.registerCommands(); },
  enabled() { return this.state().enabled !== false; },
  setEnabled(on) { const s = this.state(); s.enabled = !!on; DevToolsPrefs.write(this.KEY, s); this.registerCommands(); },

  setAccount(id) {
    const v = String(id == null ? '' : id).trim();
    if (v && !this.ACCOUNT_RE.test(v)) throw new Error('A Cloudflare account id is 32 letters and digits (the dashboard shows it in the address after dash.cloudflare.com/)');
    const s = this.state(); s.accountId = v.toLowerCase(); this.save(s);
  },
  addWorker(name) {
    const n = String(name == null ? '' : name).trim();
    if (!this.WORKER_RE.test(n)) throw new Error('A worker name is letters, digits, dashes and underscores');
    const s = this.state();
    if (s.workers.includes(n)) throw new Error(n + ' is already in the list');
    if (s.workers.length >= this.MAX_WORKERS) throw new Error('At most ' + this.MAX_WORKERS + ' workers');
    s.workers.push(n); this.save(s);
    return n;
  },
  removeWorker(name) { const s = this.state(); s.workers = s.workers.filter(w => w !== name); this.save(s); },
  addKv(name, id) {
    const label = String(name == null ? '' : name).trim().slice(0, 40);
    const nsid = String(id == null ? '' : id).trim().toLowerCase();
    if (!label) throw new Error('Give the namespace a name');
    if (!this.ACCOUNT_RE.test(nsid)) throw new Error('A KV namespace id is 32 letters and digits');
    const s = this.state();
    if (s.kv.some(k => k.id === nsid)) throw new Error('That namespace is already in the list');
    if (s.kv.length >= this.MAX_KV) throw new Error('At most ' + this.MAX_KV + ' namespaces');
    s.kv.push({ name: label, id: nsid }); this.save(s);
  },
  removeKv(id) { const s = this.state(); s.kv = s.kv.filter(k => k.id !== id); this.save(s); },

  // The workers.dev workers on the endpoint board (js/dev-loop.js): name.account.workers.dev -> name.
  fromEndpointBoard() {
    if (typeof EndpointBoard === 'undefined' || typeof EndpointBoard.items !== 'function') return [];
    const out = [];
    for (const it of EndpointBoard.items()) {
      let host = '';
      try { host = new URL(it.url).hostname.toLowerCase(); } catch { continue; }
      const m = /^([a-z0-9][a-z0-9_-]{0,62})\.[a-z0-9-]+\.workers\.dev$/.exec(host);
      if (m && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
  },
  workers() { return Array.from(new Set([...this.state().workers, ...this.fromEndpointBoard()])); },

  // The pages. The paths are in one table so a change in the dashboard is one edit.
  PATHS: {
    home: (a) => '/' + a,
    workersHome: (a) => '/' + a + '/workers-and-pages',
    overview: (a, w) => '/' + a + '/workers/services/view/' + w + '/production',
    logs: (a, w) => '/' + a + '/workers/services/view/' + w + '/production/observability/logs',
    metrics: (a, w) => '/' + a + '/workers/services/view/' + w + '/production/metrics',
    settings: (a, w) => '/' + a + '/workers/services/view/' + w + '/production/settings',
    kvHome: (a) => '/' + a + '/workers/kv/namespaces',
    kv: (a, id) => '/' + a + '/workers/kv/namespaces/' + id,
  },
  url(page, arg) {
    const a = this.state().accountId;
    if (!a) throw new Error('Save your Cloudflare account id first (Ctrl+K, Cloudflare dashboard)');
    const fn = this.PATHS[page];
    if (!fn) throw new Error('Unknown dashboard page: ' + page);
    if (page === 'kv' && !this.ACCOUNT_RE.test(String(arg))) throw new Error('A KV namespace id is 32 letters and digits');
    if (['overview', 'logs', 'metrics', 'settings'].includes(page) && !this.WORKER_RE.test(String(arg))) throw new Error('A worker name is letters, digits, dashes and underscores');
    return 'https://dash.cloudflare.com' + fn(a, arg);
  },
  open(page, arg) {
    if (!this.enabled()) throw new Error('Cloudflare shortcuts are switched off (Settings > More developer tools)');
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    DevToolsPrefs.open(this.url(page, arg));
  },

  // Ctrl+K: "cf vex-sync logs" and friends, one entry per saved worker.
  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return;
    const fail = (err) => { console.error('[Cloudflare]', err); window.showToast?.(err.message, 'error'); };
    const act = (page, arg) => () => { try { this.open(page, arg); } catch (err) { fail(err); } };
    const list = [];
    if (this.enabled() && this.state().accountId) {
      for (const w of this.workers()) {
        list.push({ id: 'cf:' + w + ':logs', label: 'cf ' + w + ' logs', hint: 'Cloudflare dashboard: the logs of this worker', icon: 'cloud', action: act('logs', w) });
        list.push({ id: 'cf:' + w + ':overview', label: 'cf ' + w, hint: 'Cloudflare dashboard: this worker', icon: 'cloud', action: act('overview', w) });
      }
      list.push({ id: 'cf:kv', label: 'cf kv', hint: 'Cloudflare dashboard: KV namespaces', icon: 'database', action: act('kvHome') });
      for (const k of this.state().kv) list.push({ id: 'cf:kv:' + k.id, label: 'cf kv ' + k.name, hint: 'Cloudflare dashboard: this KV namespace', icon: 'database', action: act('kv', k.id) });
    }
    VexModuleCommands.set('cf:', list);
  },

  openUI() {
    const { body } = VexSettingsGroups.dialog({ id: 'vex-cf-shortcuts', title: 'Cloudflare shortcuts', sub: 'Links to your own workers and KV pages in the dashboard. Nothing is sent to Cloudflare from here; you open the page and sign in there as usual.' });
    const S = VexSettingsGroups;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const row = (...kids) => { const r = el('div', 'vexsr-rule'); r.append(...kids); return r; };
    const fail = (what, err) => { console.error('[Cloudflare] ' + what + ':', err); window.showToast?.(what + ': ' + err.message, 'error'); };
    const btn = (text, fn, opts) => S.button(text, () => { try { fn(); } catch (err) { fail(text, err); } }, opts);
    const draw = () => {
      body.textContent = '';
      const s = this.state();
      const acct = el('input', 'set-input'); acct.type = 'text'; acct.value = s.accountId; acct.placeholder = 'Account id (32 letters and digits)'; acct.spellcheck = false;
      acct.setAttribute('aria-label', 'Cloudflare account id');
      body.append(S.note('Your account id is in the dashboard address: dash.cloudflare.com/<account id>/...'), row(acct, btn('Save', () => { this.setAccount(acct.value); draw(); }, { primary: true })));
      if (!s.accountId) return;
      body.append(row(btn('Account home', () => this.open('home')), btn('Workers and Pages', () => this.open('workersHome')), btn('KV namespaces', () => this.open('kvHome'))));
      const saved = new Set(s.workers);
      const wlist = el('div', 'vexsr-list');
      for (const w of this.workers()) {
        const bar = el('div', ''); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        bar.append(btn('Logs', () => this.open('logs', w), { label: 'Logs of ' + w }), btn('Overview', () => this.open('overview', w), { label: 'Overview of ' + w }),
          btn('Metrics', () => this.open('metrics', w), { label: 'Metrics of ' + w }), btn('Settings', () => this.open('settings', w), { label: 'Settings of ' + w }));
        if (saved.has(w)) bar.append(btn('Remove', () => { this.removeWorker(w); draw(); }, { danger: true, label: 'Remove ' + w }));
        else bar.append(btn('Keep in my list', () => { this.addWorker(w); draw(); }, { label: 'Keep ' + w + ' in my list' }));
        const r = el('div', 'vexsr-rule'); r.style.flexWrap = 'wrap';
        r.append(el('span', 'vexsr-host', w + (saved.has(w) ? '' : ' (from your endpoint board)')), bar);
        wlist.appendChild(r);
      }
      if (!wlist.children.length) wlist.appendChild(S.note('No workers yet. Add one below, or add a workers.dev address to the endpoint board.'));
      const wname = el('input', 'set-input'); wname.type = 'text'; wname.placeholder = 'Worker name, e.g. vex-sync'; wname.spellcheck = false; wname.setAttribute('aria-label', 'Worker name to add');
      body.append(wlist, row(wname, btn('Add worker', () => { this.addWorker(wname.value); draw(); })));
      const klist = el('div', 'vexsr-list');
      for (const k of s.kv) klist.appendChild(row(el('span', 'vexsr-host', 'KV: ' + k.name), btn('Open', () => this.open('kv', k.id), { label: 'Open KV namespace ' + k.name }), btn('Remove', () => { this.removeKv(k.id); draw(); }, { danger: true, label: 'Remove ' + k.name })));
      const kname = el('input', 'set-input'); kname.type = 'text'; kname.placeholder = 'Namespace name'; kname.setAttribute('aria-label', 'KV namespace name');
      const kid = el('input', 'set-input'); kid.type = 'text'; kid.placeholder = 'Namespace id (32 characters)'; kid.spellcheck = false; kid.setAttribute('aria-label', 'KV namespace id');
      body.append(klist, row(kname, kid, btn('Add namespace', () => { this.addKv(kname.value, kid.value); draw(); })));
    };
    draw();
  },
};

// ---------------------------------------------------------------------------------
// T3-018  Roblox asset and place id resolver
const RobloxResolver = {
  KEY: 'vex.robloxResolver',
  FEATURE: 'roblox-resolver',
  DEFAULTS: { enabled: true },
  MIN_GAP_MS: 1200,
  CACHE_MS: 10 * 60000,
  ID_RE: /^\d{3,19}$/,
  ASSET_TYPES: { 1: 'Image', 2: 'T-Shirt', 3: 'Audio', 4: 'Mesh', 5: 'Lua script', 8: 'Hat', 9: 'Place', 10: 'Model', 11: 'Shirt', 12: 'Pants', 13: 'Decal', 17: 'Head', 18: 'Face', 19: 'Gear', 21: 'Badge', 24: 'Animation', 32: 'Package', 34: 'Game pass', 38: 'Plugin', 40: 'Mesh part', 41: 'Hair accessory', 42: 'Face accessory', 43: 'Neck accessory', 44: 'Shoulder accessory', 45: 'Front accessory', 46: 'Back accessory', 47: 'Waist accessory' },
  _last: 0,
  _cache: new Map(),

  enabled() { return DevToolsPrefs.read(this.KEY, this.DEFAULTS).enabled !== false; },
  setEnabled(on) { DevToolsPrefs.write(this.KEY, { ...DevToolsPrefs.read(this.KEY, this.DEFAULTS), enabled: !!on }); },

  // "1818", "https://www.roblox.com/games/920587237/Adopt-Me", ".../catalog/1234/Name" -> the id.
  parse(input) {
    const s = String(input == null ? '' : input).trim();
    if (this.ID_RE.test(s)) return s;
    let u;
    try { u = new URL(s); } catch { throw new Error('Paste a Roblox id (digits) or a roblox.com address'); }
    if (u.protocol !== 'https:' || !/(^|\.)roblox\.com$/i.test(u.hostname)) throw new Error('Only roblox.com addresses are read');
    const m = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:games|catalog|library|bundles|game-pass|badges)\/(\d{3,19})(?:\/|$)/i.exec(u.pathname);
    if (!m) throw new Error('That roblox.com address has no asset or place id in it');
    return m[1];
  },

  async _get(url) {
    const v = window.vex;
    if (!v || typeof v.apiRequest !== 'function') throw new Error('Web access is not available in this build');
    const wait = this._last + this.MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this._last = Date.now();
    // publicOnly: no cookie of yours goes with it, and nothing on this computer or your network is asked.
    const r = await v.apiRequest({ url, method: 'GET', publicOnly: true, headers: { Accept: 'application/json' } });
    if (!r || !r.ok) throw new Error((r && r.error) || 'Roblox could not be reached');
    if (r.status === 429) throw new Error('Roblox is limiting requests. Try again in a minute.');
    return r;
  },
  async _json(url) {
    const r = await this._get(url);
    if (r.status === 404 || r.status === 400) return null;
    if (r.status >= 400) throw new Error('Roblox answered ' + r.status);
    try { return JSON.parse(r.body); }
    catch (err) { throw new Error('Roblox gave an answer that is not JSON', { cause: err }); }
  },

  pageUrl(kind, id) { return kind === 'place' ? 'https://www.roblox.com/games/' + id : 'https://www.roblox.com/catalog/' + id; },

  summarizeAsset(id, a) {
    const type = this.ASSET_TYPES[a.AssetTypeId] || ('asset type ' + a.AssetTypeId);
    const kind = a.AssetTypeId === 9 ? 'place' : 'asset';
    const lines = [type + (a.Creator && a.Creator.Name ? ' by ' + a.Creator.Name : '')];
    if (a.IsForSale) lines.push(a.PriceInRobux ? 'For sale for ' + a.PriceInRobux + ' Robux' : 'Free to take');
    else lines.push('Not for sale');
    if (a.Created) lines.push('Created ' + String(a.Created).slice(0, 10) + (a.Updated ? ', updated ' + String(a.Updated).slice(0, 10) : ''));
    if (a.Description) lines.push(String(a.Description).replace(/\s+/g, ' ').slice(0, 160));
    return { id, kind, name: String(a.Name || 'Unnamed'), url: this.pageUrl(kind, id), lines };
  },
  summarizeGame(id, g) {
    const lines = ['Experience' + (g.creator && g.creator.name ? ' by ' + g.creator.name : '')];
    if (typeof g.playing === 'number') lines.push(g.playing.toLocaleString() + ' playing now, ' + (Number(g.visits) || 0).toLocaleString() + ' visits');
    if (g.created) lines.push('Created ' + String(g.created).slice(0, 10) + (g.updated ? ', updated ' + String(g.updated).slice(0, 10) : ''));
    if (g.description) lines.push(String(g.description).replace(/\s+/g, ' ').slice(0, 160));
    return { id, kind: 'place', name: String(g.name || 'Unnamed'), url: this.pageUrl('place', id), lines };
  },

  // -> { id, kind: 'asset'|'place', name, url, lines }. One id, only when asked.
  async resolve(input) {
    if (!this.enabled()) throw new Error('The Roblox resolver is switched off (Settings > More developer tools)');
    const id = this.parse(input);
    const hit = this._cache.get(id);
    if (hit && Date.now() - hit.at < this.CACHE_MS) return hit.value;
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    let out = null;
    const asset = await this._json('https://economy.roblox.com/v2/assets/' + id + '/details');
    if (asset && asset.AssetTypeId !== 9) out = this.summarizeAsset(id, asset);
    if (!out) {
      const uni = await this._json('https://apis.roblox.com/universes/v1/places/' + id + '/universe');
      if (uni && uni.universeId) {
        const games = await this._json('https://games.roblox.com/v1/games?universeIds=' + encodeURIComponent(uni.universeId));
        const g = games && Array.isArray(games.data) ? games.data[0] : null;
        if (g) out = this.summarizeGame(id, g);
      }
    }
    if (!out && asset) out = this.summarizeAsset(id, asset);
    if (!out) throw new Error('Roblox has no public asset or place with the id ' + id);
    this._cache.set(id, { at: Date.now(), value: out });
    return out;
  },

  async ask(initial) {
    const text = initial != null ? initial : await vexPrompt({ title: 'Resolve a Roblox id', message: 'An asset id, a place id, or a roblox.com address. Vex reads the public page data for that one id; no cookie or login is used.', label: 'Id or address', placeholder: '920587237', okLabel: 'Resolve' });
    if (text == null || !String(text).trim()) return null;
    const r = await this.resolve(text);
    this.show(r);
    return r;
  },

  show(r) {
    const { body } = VexSettingsGroups.dialog({ id: 'vex-roblox-resolved', title: r.name, sub: (r.kind === 'place' ? 'Roblox place ' : 'Roblox asset ') + r.id });
    const S = VexSettingsGroups;
    for (const l of r.lines) body.appendChild(S.note(l));
    body.appendChild(S.note(r.url));
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    const run = (text, fn, opts) => S.button(text, async () => { try { await fn(); } catch (err) { console.error('[Roblox]', err); window.showToast?.(err.message, 'error'); } }, opts);
    bar.append(run('Open page', () => DevToolsPrefs.open(r.url), { primary: true }), run('Copy link', () => DevToolsPrefs.copy(r.url, 'Link')), run('Copy summary', () => DevToolsPrefs.copy([r.name + ' (' + r.id + ')', ...r.lines, r.url].join('\n'), 'Summary')));
    body.appendChild(bar);
  },
};

// ---------------------------------------------------------------------------------
// T3-070  Repo skim
const RepoSkim = {
  KEY: 'vex.repoSkim',
  FEATURE: 'repo-skim',
  DEFAULTS: { enabled: true },
  README_CHARS: 6000,
  STALE_DAYS: 365,
  INSTALL_SCRIPTS: ['preinstall', 'install', 'postinstall', 'prepare'],

  enabled() { return DevToolsPrefs.read(this.KEY, this.DEFAULTS).enabled !== false; },
  setEnabled(on) { DevToolsPrefs.write(this.KEY, { ...DevToolsPrefs.read(this.KEY, this.DEFAULTS), enabled: !!on }); },

  parse(input) {
    const s = String(input == null ? '' : input).trim();
    const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/.exec(s);
    if (!m || m[1] === '.' || m[1] === '..' || m[2] === '.' || m[2] === '..') throw new Error('Use owner/repo, or a github.com repository address');
    return { owner: m[1], repo: m[2], full: m[1] + '/' + m[2] };
  },

  _vault() {
    if (typeof GitHubVault === 'undefined') throw new Error('The GitHub vault is not loaded');
    return GitHubVault;
  },
  _decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  },

  // Facts -> red flags. Pure: the same facts give the same flags.
  flags(f, now = Date.now()) {
    const out = [];
    if (!f.license) out.push('No licence file: you may not have the right to use or copy it');
    if (f.archived) out.push('Archived: read-only, no longer maintained');
    if (f.pushedAt && now - Date.parse(f.pushedAt) > this.STALE_DAYS * 86400000) out.push('No push for over a year');
    if (f.contributors === 1) out.push('One contributor in the recent list: a single maintainer');
    if (f.fork) out.push('A fork of another repository');
    if (!f.readme) out.push('No README');
    if (f.installScripts && f.installScripts.length) out.push('package.json runs scripts on install: ' + f.installScripts.join(', '));
    if (f.createdAt && now - Date.parse(f.createdAt) < 30 * 86400000) out.push('Created in the last 30 days');
    return out;
  },

  async skim(input) {
    if (!this.enabled()) throw new Error('Repo skim is switched off (Settings > More developer tools)');
    const { owner, repo, full } = this.parse(input);
    const V = this._vault();
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const base = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
    const meta = await V.json(base);
    const commits = await V.json(base + '/commits?per_page=5');
    let contributors = null;
    try { const c = await V.json(base + '/contributors?per_page=5'); contributors = Array.isArray(c) ? c.length : null; }
    catch (err) { console.error('[RepoSkim] contributors not read:', err.message); }
    let readme = '';
    try { const r = await V.json(base + '/readme'); if (r && r.encoding === 'base64') readme = this._decode(r.content).slice(0, this.README_CHARS); }
    catch (err) { if (!/cannot show that/.test(err.message)) throw err; }
    let tree = [];
    try { const t = await V.json(base + '/contents'); tree = Array.isArray(t) ? t.slice(0, 60).map(e => ({ name: String(e.name), dir: e.type === 'dir' })) : []; }
    catch (err) { console.error('[RepoSkim] top level not read:', err.message); }
    let installScripts = [];
    if (tree.some(e => e.name === 'package.json' && !e.dir)) {
      try {
        const p = await V.json(base + '/contents/package.json');
        const pkg = JSON.parse(this._decode(p.content));
        installScripts = this.INSTALL_SCRIPTS.filter(k => pkg.scripts && typeof pkg.scripts[k] === 'string');
      } catch (err) { console.error('[RepoSkim] package.json not read:', err.message); }
    }
    const last = Array.isArray(commits) && commits[0] ? commits[0] : null;
    const facts = {
      full, url: 'https://github.com/' + full, description: String(meta.description || ''), language: String(meta.language || ''),
      license: meta.license && meta.license.spdx_id && meta.license.spdx_id !== 'NOASSERTION' ? meta.license.spdx_id : (meta.license ? meta.license.name || 'a licence' : ''),
      stars: Number(meta.stargazers_count) || 0, forks: Number(meta.forks_count) || 0, openIssues: Number(meta.open_issues_count) || 0,
      archived: !!meta.archived, fork: !!meta.fork, pushedAt: meta.pushed_at || '', createdAt: meta.created_at || '',
      lastCommit: last ? { at: last.commit && last.commit.author && last.commit.author.date, message: String(last.commit && last.commit.message || '').split(/\r?\n/)[0].slice(0, 120) } : null,
      contributors, readme, tree, installScripts, topics: Array.isArray(meta.topics) ? meta.topics.slice(0, 8) : [],
    };
    facts.flags = this.flags(facts);
    return facts;
  },

  // Local model only. The README is redacted first; it never goes to a cloud model.
  async explain(facts) {
    if (typeof DevLoopLocalAI === 'undefined') throw new Error('The local model helper is not loaded');
    const clean = typeof devLoopRedact === 'function' ? devLoopRedact : (t) => t;
    const system = 'You read a GitHub README for a developer in a hurry. Answer in three short lines starting "Purpose:", "Run it:" and "Watch for:". Use only what the README and facts say; if the README does not say how to run it, write "not stated".';
    const prompt = ['Repository: ' + facts.full, facts.description ? 'Description: ' + facts.description : '', facts.language ? 'Language: ' + facts.language : '',
      'Top level: ' + facts.tree.map(e => e.name + (e.dir ? '/' : '')).join(', '), '', 'README:', clean(facts.readme || '(none)')].filter(x => x !== '').join('\n');
    return DevLoopLocalAI.generate(system, prompt, { maxTokens: 350 });
  },

  report(f) {
    const lines = [f.full + (f.description ? ' - ' + f.description : ''), [f.language, f.license ? 'licence ' + f.license : 'no licence', f.stars + ' stars', f.openIssues + ' open issues'].filter(Boolean).join(', ')];
    if (f.lastCommit && f.lastCommit.at) lines.push('Last commit ' + DevToolsPrefs.ago(Date.parse(f.lastCommit.at)) + ': ' + f.lastCommit.message);
    if (f.flags.length) lines.push('Red flags: ' + f.flags.join('; '));
    else lines.push('No red flags found by the checks Vex makes (licence, activity, maintainers, install scripts).');
    return lines.join('\n');
  },

  async ask(initial) {
    let input = initial;
    if (input == null) {
      const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
      const here = tab && /^https:\/\/(?:www\.)?github\.com\/[^/]+\/[^/?#]+/i.test(tab.url || '') ? tab.url : '';
      input = here || await vexPrompt({ title: 'Skim a repository', message: 'owner/repo or a github.com address. Read-only: Vex only asks GitHub for public information about it.', label: 'Repository', placeholder: 'owner/repo', okLabel: 'Skim' });
    }
    if (input == null || !String(input).trim()) return null;
    const facts = await this.skim(input);
    this.show(facts);
    return facts;
  },

  show(f) {
    const S = VexSettingsGroups;
    const { body } = S.dialog({ id: 'vex-repo-skim', title: f.full, sub: 'Read-only skim of a GitHub repository' });
    const el = (tag, text) => { const e = document.createElement(tag); if (text != null) e.textContent = text; return e; };
    if (f.description) body.appendChild(S.note(f.description));
    body.appendChild(S.note([f.language, f.license ? 'Licence ' + f.license : 'No licence', f.stars + ' stars', f.forks + ' forks', f.openIssues + ' open issues'].filter(Boolean).join(' | ')));
    if (f.lastCommit && f.lastCommit.at) body.appendChild(S.note('Last commit ' + DevToolsPrefs.ago(Date.parse(f.lastCommit.at)) + ': ' + f.lastCommit.message));
    body.appendChild(S.note(f.flags.length ? 'Red flags' : 'No red flags found by the checks Vex makes.'));
    for (const fl of f.flags) body.appendChild(S.note('- ' + fl));
    if (f.tree.length) body.appendChild(S.note('Top level: ' + f.tree.map(e => e.name + (e.dir ? '/' : '')).join(', ')));
    const out = el('pre'); out.style.cssText = 'white-space:pre-wrap;margin:8px 0'; out.setAttribute('role', 'status');
    body.appendChild(out);
    const bar = el('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    const run = (text, fn, opts) => S.button(text, async () => { try { await fn(); } catch (err) { console.error('[RepoSkim]', err); out.textContent = ''; window.showToast?.(err.message, 'error'); } }, opts);
    bar.append(
      run('Open repository', () => DevToolsPrefs.open(f.url), { primary: true }),
      run('Explain the README with the local model', async () => { out.textContent = 'Asking the local model...'; out.textContent = await this.explain(f); }),
      run('Copy report', () => DevToolsPrefs.copy(this.report(f) + (out.textContent && !/^Asking/.test(out.textContent) ? '\n\n' + out.textContent : ''), 'Report')),
    );
    body.appendChild(bar);
  },
};

// ---------------------------------------------------------------------------------
// Settings section and Ctrl+K commands
const DevShortcutsUI = {
  FEATURES: [
    ['cloudflare-shortcuts', 'Cloudflare dashboard shortcuts', CloudflareShortcuts],
    ['roblox-resolver', 'Roblox id resolver', RobloxResolver],
    ['repo-skim', 'Repo skim', RepoSkim],
  ],
  _fail(what, err) { console.error('[DevShortcuts] ' + what + ':', err); window.showToast?.(what + ': ' + ((err && err.message) || err), 'error'); },
  group(el) {
    const S = VexSettingsGroups;
    el.appendChild(S.note('Small tools that run only when you ask. Cloudflare shortcuts are links (no request is made to Cloudflare). The Roblox resolver and repo skim read public pages, read-only.'));
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0';
    bar.append(
      S.button('Cloudflare shortcuts', () => CloudflareShortcuts.openUI()),
      S.button('Resolve a Roblox id', () => RobloxResolver.ask().catch(err => this._fail('Roblox resolver', err))),
      S.button('Skim a repository', () => RepoSkim.ask().catch(err => this._fail('Repo skim', err))),
    );
    el.appendChild(bar);
    for (const [, label, mod] of this.FEATURES) {
      const l = document.createElement('label');
      l.className = 'vex-platform-note';
      const box = document.createElement('input');
      box.type = 'checkbox'; box.checked = mod.enabled();
      box.addEventListener('change', () => { try { mod.setEnabled(box.checked); } catch (err) { this._fail(label, err); } });
      l.append(box, document.createTextNode(' ' + label));
      el.appendChild(l);
    }
  },
};

if (typeof window !== 'undefined') {
  Object.assign(window, { DevToolsPrefs, CloudflareShortcuts, RobloxResolver, RepoSkim, DevShortcutsUI });
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'dev-tools-more', title: 'More developer tools',
      keywords: 'cloudflare dashboard worker kv logs roblox asset place id resolver github repo skim readme licence local service webhook inspector launcher',
      before: 'about',
      build: (el) => { DevShortcutsUI.group(el); if (typeof LocalToolsUI !== 'undefined') LocalToolsUI.group(el); },
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    const run = (what, fn) => () => { Promise.resolve().then(fn).catch(err => DevShortcutsUI._fail(what, err)); };
    VexExtras.registerCommand({ id: 'cloudflare-shortcuts', label: 'Cloudflare dashboard', hint: 'Deep links to your workers, logs and KV namespaces', icon: 'cloud', action: run('Cloudflare shortcuts', () => CloudflareShortcuts.openUI()) });
    VexExtras.registerCommand({ id: 'roblox-resolve', label: 'Resolve a Roblox id', hint: 'An asset or place id to its page link and a short summary', icon: 'gamepad', action: run('Roblox resolver', () => RobloxResolver.ask()) });
    VexExtras.registerCommand({ id: 'repo-skim', label: 'Skim a repository', hint: 'What a GitHub repository is, how active it is, and red flags', icon: 'git', action: run('Repo skim', () => RepoSkim.ask()) });
  }
  CloudflareShortcuts.registerCommands();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { DevToolsPrefs, CloudflareShortcuts, RobloxResolver, RepoSkim, DevShortcutsUI };
