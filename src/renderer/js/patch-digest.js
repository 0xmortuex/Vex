// === Patch digest for my heroes and items (T3-007) ===========================
//
// Patch radar (js/patch-radar.js) says THAT a game's patch notes page changed. It
// cannot say whether the change touches the hero or the item you play. This reads
// the new patch notes and keeps only the sentences that name something on your
// watch list, quoted word for word, at most five at a time:
//
//   "Reaper: Shotgun spread reduced from 5.5 to 5.0 degrees."
//
// There is no AI in it, on purpose: a digest that paraphrases can say something the
// notes never said. Every bullet is a sentence copied out of the page, with the page
// it came from one click away. A change that names none of your heroes or items
// produces nothing ("your hero changed" is the only reason to be told).
//
// The watch list is per game, typed in Settings (heroes, items, maps, any word), and
// optionally also the lines on that game's loadout cards when loadouts exist (Wave 2).
// It reads only the patch notes pages the person already gave patch radar; nothing
// else is fetched, no game is touched, and the text read is not kept (only the five
// quoted sentences and the page's address are).
//
// While a game runs nothing is read or said: patch radar's event waits, and the digest
// is made and told when the game ends (the pending list survives a restart).
const VexPatchDigest = {
  KEYS: { on: 'vex.patchDigest.enabled', state: 'vex.patchDigest' },
  FEATURE: 'patch-digest',
  MAX_TERMS: 40,
  MAX_BULLETS: 5,
  MAX_DIGESTS: 20,
  MAX_PENDING: 10,
  MAX_TEXT: 300000,
  _now() { return Date.now(); },

  enabled() { return VexMediaKit.flag(this.KEYS.on, false); },
  setEnabled(on) { VexMediaKit.setFlag(this.KEYS.on, !!on); },

  // ---- pure ----------------------------------------------------------------------------
  // Words the person watches, cleaned: 2 to 40 characters, no duplicates (any case).
  cleanTerms(input) {
    const raw = Array.isArray(input) ? input : String(input == null ? '' : input).split(/[\n,;]+/);
    const out = [];
    const seen = new Set();
    for (const r of raw) {
      const t = String(r).replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (t.length < 2 || t.length > 40) throw new Error('"' + t.slice(0, 20) + '" must be 2 to 40 characters');
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    if (out.length > this.MAX_TERMS) throw new Error('Watch at most ' + this.MAX_TERMS + ' names per game');
    return out;
  },
  // The text of a page or feed as sentences and bullet lines, in order.
  sentences(text) {
    const out = [];
    for (const line of String(text == null ? '' : text).slice(0, this.MAX_TEXT).split(/\r?\n/)) {
      const l = line.replace(/\s+/g, ' ').trim();
      if (l.length < 8) continue;
      // A long paragraph is split after sentence ends; a short bullet stays whole.
      if (l.length <= 220) { out.push(l); continue; }
      for (const s of l.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)) if (s.trim().length >= 8) out.push(s.trim());
    }
    return out;
  },
  _pattern(term) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A word-ish name needs word edges (so "Ana" is not "Banana"); a name with symbols is matched as written.
    return /^[\p{L}\p{N}][\p{L}\p{N} '-]*[\p{L}\p{N}]$/u.test(term) ? new RegExp('(?<![\\p{L}\\p{N}])' + esc + '(?![\\p{L}\\p{N}])', 'iu') : new RegExp(esc, 'i');
  },
  // → [{ term, quote }] at most `max`, the most-mentioned names first, one quote per name
  // (a second quote only if there is room), always the sentence exactly as written.
  digest(text, terms, max = this.MAX_BULLETS) {
    const sents = this.sentences(text);
    const per = [];
    for (const term of terms) {
      const re = this._pattern(term);
      const hits = sents.filter(s => re.test(s));
      if (hits.length) per.push({ term, hits });
    }
    per.sort((a, b) => b.hits.length - a.hits.length);
    const out = [];
    for (const p of per) { if (out.length >= max) break; out.push({ term: p.term, quote: this._clip(p.hits[0]) }); }
    for (const p of per) for (const h of p.hits.slice(1)) { if (out.length >= max) break; out.push({ term: p.term, quote: this._clip(h) }); }
    return out;
  },
  _clip(s) { return s.length > 260 ? s.slice(0, 257) + '...' : s; },
  // The newest item's text out of an RSS or Atom body, or '' when it is not a feed.
  feedItemText(body, htmlToText) {
    const head = String(body || '').slice(0, 2000);
    const rss = /<rss[\s>]|<rdf:RDF[\s>]/i.test(head);
    const atom = !rss && /<feed[\s>]/i.test(head);
    if (!rss && !atom) return '';
    const m = new RegExp(rss ? '<item[ >]([\\s\\S]*?)</item>' : '<entry[ >]([\\s\\S]*?)</entry>', 'i').exec(String(body));
    if (!m) return '';
    const grab = (tag) => { const t = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i').exec(m[1]); return t ? t[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '') : ''; };
    const decoded = [grab('title'), grab('content:encoded'), grab('content'), grab('description'), grab('summary')].filter(Boolean)
      .map(x => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&amp;/g, '&')).join('\n');
    return htmlToText(decoded).text;
  },

  // ---- the saved state ------------------------------------------------------------------
  state() {
    const v = VexMediaKit.read(this.KEYS.state, null);
    if (v == null) return { terms: {}, loadouts: false, digests: [], pending: [] };
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error('The saved patch digest is not readable');
    return { terms: v.terms && typeof v.terms === 'object' ? v.terms : {}, loadouts: !!v.loadouts, digests: Array.isArray(v.digests) ? v.digests : [], pending: Array.isArray(v.pending) ? v.pending : [] };
  },
  _save(st) { VexMediaKit.write(this.KEYS.state, st); },
  termsFor(gameId) {
    const st = this.state();
    const own = Array.isArray(st.terms[gameId]) ? st.terms[gameId].slice() : [];
    if (st.loadouts && globalThis.GameLoadouts && typeof globalThis.GameLoadouts.forGame === 'function') {
      for (const card of globalThis.GameLoadouts.forGame(gameId)) {
        for (const line of Array.isArray(card.items) ? card.items : []) {
          const name = String(line).split(/\s+[-:]\s+|:/)[0].trim();
          if (name.length >= 2 && name.length <= 40 && !own.some(t => t.toLowerCase() === name.toLowerCase())) own.push(name);
        }
      }
    }
    return own.slice(0, this.MAX_TERMS * 2);
  },
  setTerms(gameId, input) {
    const st = this.state();
    const terms = this.cleanTerms(input);
    if (terms.length) st.terms[gameId] = terms; else delete st.terms[gameId];
    this._save(st);
    return terms;
  },
  setUseLoadouts(on) { const st = this.state(); st.loadouts = !!on; this._save(st); },
  digests() { return this.state().digests; },
  clear() { const st = this.state(); st.digests = []; st.pending = []; this._save(st); },

  // ---- reading the patch notes ------------------------------------------------------------
  _game(gameId) {
    const g = typeof GameSession !== 'undefined' ? GameSession.games().find(x => x.id === gameId) : null;
    return g || null;
  },
  async _textOf(url) {
    if (typeof AgentTools === 'undefined' || typeof PageWatch === 'undefined') throw new Error('Page reading is not available in this window');
    const refused = PageWatch.refusalFor({ url });
    if (refused) throw new Error(refused);
    const r = await AgentTools._get(url);
    const body = String(r.body || '');
    const fromFeed = this.feedItemText(body, (h) => AgentTools.htmlToText(h));
    return fromFeed || AgentTools.htmlToText(body).text;
  },
  // Read this game's patch notes pages and keep the sentences that name a watched thing.
  // → the saved digest, or null when nothing named anything on the list.
  async make(gameId, { watchId = '', title = '' } = {}) {
    const game = this._game(gameId);
    if (!game) throw new Error('That game is not in the list any more');
    const terms = this.termsFor(gameId);
    if (!terms.length) return null;
    if (typeof PatchRadar === 'undefined') throw new Error('Patch radar is not available in this window');
    const pages = PatchRadar.pages(gameId).filter(p => !watchId || p.watchId === watchId);
    if (!pages.length) throw new Error(game.name + ' has no patch notes page yet (Settings, Games)');
    const bullets = [];
    let from = '';
    for (const p of pages) {
      const found = this.digest(await this._textOf(p.url), terms, this.MAX_BULLETS - bullets.length);
      if (found.length && !from) from = p.url;
      bullets.push(...found.map(b => ({ ...b, url: p.url })));
      if (bullets.length >= this.MAX_BULLETS) break;
    }
    if (!bullets.length) return null;
    const d = { id: VexMediaKit.uid('pd'), gameId, game: game.name, at: this._now(), title: String(title || '').slice(0, 120), url: from, bullets };
    const st = this.state();
    st.digests.unshift(d);
    st.digests = st.digests.slice(0, this.MAX_DIGESTS);
    this._save(st);
    return d;
  },

  // ---- hearing about a patch ----------------------------------------------------------------
  // Patch radar found a change (event vex:patch-radar). While a game runs it only waits.
  onPatch(item) {
    if (!this.enabled() || !item || !item.gameId) return 'off';
    if (!this.termsFor(item.gameId).length) return 'nothing-watched';
    const st = this.state();
    st.pending = st.pending.filter(p => p.watchId !== item.watchId).concat([{ gameId: item.gameId, watchId: item.watchId, title: String(item.title || '').slice(0, 120) }]).slice(-this.MAX_PENDING);
    this._save(st);
    if (VexMediaKit.gaming()) return 'waiting';
    this.flush().catch((err) => VexMediaKit.problem('Patch digest', 'Could not make the digest', err));
    return 'working';
  },
  async flush() {
    if (!this.enabled() || VexMediaKit.gaming()) return [];
    const st = this.state();
    const todo = st.pending;
    if (!todo.length) return [];
    st.pending = [];
    this._save(st);
    const made = [];
    for (const p of todo) {
      try { const d = await this.make(p.gameId, p); if (d) made.push(d); }
      catch (err) { VexMediaKit.problem('Patch digest', 'The digest for ' + (this._game(p.gameId) || { name: p.gameId }).name + ' could not be made', err); }
    }
    if (made.length) this._tell(made);
    return made;
  },
  _tell(made) {
    const names = made.flatMap(d => d.bullets.map(b => b.term));
    const uniq = [...new Set(names)].slice(0, 4);
    const text = 'The new patch names ' + uniq.join(', ') + (names.length > uniq.length ? ' and more' : '');
    const show = () => VexMediaKit.toast(text, 'info', 12000, { action: { label: 'See the digest', run: () => this.open() } });
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: this.FEATURE, urgency: 'useful', id: made[0].id, title: text, action: { label: 'See the digest', key: 'open' } }, show);
    else show();
  },

  // ---- drawing --------------------------------------------------------------------------------
  open() {
    const K = VexMediaKit;
    const { body } = K.dialog({ id: 'patch-digest', title: 'Patch digest', sub: 'Sentences copied from the patch notes that name something you watch.' });
    const list = this.digests();
    if (!list.length) body.appendChild(K.info('Nothing yet. When a patch names a hero or item on your watch list, the sentences show up here.'));
    for (const d of list) {
      body.appendChild(K.el('div', 'setting-label-text', d.game + (d.title ? ' - ' + d.title : '') + ' (' + new Date(d.at).toLocaleDateString() + ')'));
      for (const b of d.bullets) {
        const r = K.el('div', 'setting-row');
        r.appendChild(K.el('strong', '', b.term));
        r.appendChild(K.el('span', '', '"' + b.quote + '"'));
        body.appendChild(r);
      }
      if (d.url) body.appendChild(K.button('Open the patch notes', () => TabManager.createTab(d.url, true)));
    }
  },
  render(body) {
    const K = VexMediaKit;
    body.textContent = '';
    body.appendChild(K.info('When a game\'s patch notes change, keep only the sentences that name a hero, item or word you watch, copied word for word. No AI, so nothing is invented. Told when the game ends.'));
    body.appendChild(K.switchRow('Patch digest for my heroes and items', this.enabled(), (on) => this.setEnabled(on)));
    let games = [];
    try { games = typeof GameSession !== 'undefined' ? GameSession.games() : []; } catch (err) { body.appendChild(K.info(err.message)); }
    if (!games.length) body.appendChild(K.info('Add a game in Game mode first, then name the heroes and items to watch.'));
    for (const g of games) {
      const input = K.input('Names to watch in ' + g.name, { value: this.state().terms[g.id] ? this.state().terms[g.id].join(', ') : '', placeholder: 'Reaper, Ana, Shotgun', max: 800 });
      input.addEventListener('change', () => { try { this.setTerms(g.id, input.value); } catch (err) { K.fail(err); } });
      body.appendChild(K.row(g.name, input));
    }
    body.appendChild(K.switchRow('Also watch the names on my loadout cards (when loadouts exist)', this.state().loadouts, (on) => this.setUseLoadouts(on)));
    body.appendChild(K.button('See the digests', () => this.open()));
    body.appendChild(K.button('Forget all digests', () => { this.clear(); K.toast('Forgotten'); }, { danger: true }));
  },
  init() {
    if (this._wired) return false;
    this._wired = true;
    document.addEventListener('vex:patch-radar', (e) => {
      try { this.onPatch(e.detail && e.detail.item); } catch (err) { VexMediaKit.problem('Patch digest', 'A patch could not be noted', err); }
    });
    document.addEventListener('vex:game-mode', (e) => {
      if (e.detail && e.detail.active === false) this.flush().catch((err) => VexMediaKit.problem('Patch digest', 'Could not make the digest after the game', err));
    });
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle(this.FEATURE, (key) => { if (key === 'open') this.open(); });
    VexMediaKit.register({
      id: 'patch-digest', title: 'Patch digest', keywords: 'patch notes heroes items watch list game changed',
      render: (b) => this.render(b),
      commands: [{ id: 'patch-digest', label: 'Patch digest', hint: 'Sentences from new patch notes that name your heroes and items', icon: 'list', action: () => { try { this.open(); } catch (err) { VexMediaKit.fail(err); } } }],
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexPatchDigest = VexPatchDigest;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPatchDigest };
