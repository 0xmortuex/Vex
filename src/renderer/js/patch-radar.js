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
    const r = local ? await PageWatch._getLocal(url) : await AgentTools._get(url);
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
    window.showToast?.(text, 'info', 8000);
    try { window.vex?.notify?.('Vex — ' + this._t('patch notes'), text); } catch (err) { this._note('The desktop notification failed', err); }
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

if (typeof window !== 'undefined') window.PatchRadar = PatchRadar;
if (typeof module !== 'undefined' && module.exports) module.exports = { PatchRadar };
