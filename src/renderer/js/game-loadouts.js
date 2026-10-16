// === Loadout cards, and the stale-guide flag ==================================
//
// T2-069. A loadout card is what you would otherwise keep in a note you cannot
// find mid-match: the items or hero picks for a build, a line of notes, where
// you got it (a link) and the patch you last checked it against.
//
// The flag. Patch radar (js/patch-radar.js) already watches each game's patch
// notes page. When it saw a change AFTER you last checked a card, the card says
// so ("Stale: a patch came after you checked this"), and the same is said of
// the guide pages saved for the game. "Checked it" stamps the card with now and
// the current patch name. Nothing is fetched here: it only compares two dates
// Vex already has.
//
// Honest limits. Patch radar knows when a patch page CHANGED, not what the new
// patch changed, so the flag means "worth re-checking", not "wrong". A saved
// guide page has no date of its own, so its age counts from the first time this
// list saw it. A page diff for "what changed on that guide" is not built.
//
// The pure parts (isStale, cleanCard) take plain data and are tested alone.
const GameLoadouts = {
  KEY: 'vex.loadouts',
  ON_KEY: 'vex.loadouts.enabled',
  SEEN_KEY: 'vex.loadouts.seen',
  MAX_CARDS: 120,
  MAX_ITEMS: 30,

  enabled() { return VexLifeKit.flag(this.ON_KEY, true); },
  setEnabled(on) { VexLifeKit.setFlag(this.ON_KEY, !!on); },

  // ---- pure --------------------------------------------------------------------
  // patch: { label, at } | null (the newest patch Vex has seen for the game).
  isStale(card, patch) {
    if (!patch || !Number.isFinite(patch.at) || patch.at <= 0) return false;
    const checked = card.verifiedAt || card.createdAt || 0;
    return patch.at > checked;
  },
  // -> a card ready to store, or throws with the reason. `now` stamps new cards.
  cleanCard(input, now = Date.now()) {
    const title = String(input.title || '').trim();
    if (!title) throw new Error('The card needs a name');
    if (title.length > 80) throw new Error('The name is up to 80 characters');
    const gameId = String(input.gameId || '').trim();
    if (!gameId) throw new Error('Choose the game the card is for');
    const items = (Array.isArray(input.items) ? input.items : String(input.items || '').split(/\r?\n/))
      .map(s => String(s).trim()).filter(Boolean);
    if (items.length > this.MAX_ITEMS) throw new Error('A card holds up to ' + this.MAX_ITEMS + ' lines');
    if (items.some(s => s.length > 120)) throw new Error('A line is up to 120 characters');
    const notes = String(input.notes || '').trim();
    if (notes.length > 600) throw new Error('Notes are up to 600 characters');
    let source = String(input.source || '').trim();
    if (source) {
      let u;
      try { u = new URL(source); } catch (err) { throw new Error('The source is not an address', { cause: err }); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The source must be an http or https address');
      source = u.href;
    }
    const verifiedPatch = String(input.verifiedPatch || '').trim().slice(0, 80);
    return {
      id: input.id || VexLifeKit.uid('lo'),
      gameId, title, items, notes, source, verifiedPatch,
      createdAt: input.createdAt || now,
      verifiedAt: input.verifiedAt || now,
    };
  },

  // ---- storage -----------------------------------------------------------------
  all() {
    const d = VexLifeKit.read(this.KEY, null);
    return d && Array.isArray(d.cards) ? d.cards : [];
  },
  _save(cards) { VexLifeKit.write(this.KEY, { v: 1, cards }); },
  forGame(gameId) { return this.all().filter(c => c.gameId === gameId); },
  add(input) {
    if (!this.enabled()) throw new Error('Loadout cards are switched off');
    const cards = this.all();
    if (cards.length >= this.MAX_CARDS) throw new Error('You have ' + this.MAX_CARDS + ' cards; delete one first');
    const card = this.cleanCard(input);
    cards.push(card);
    this._save(cards);
    return card;
  },
  update(id, input) {
    const cards = this.all();
    const i = cards.findIndex(c => c.id === id);
    if (i < 0) throw new Error('That card is gone');
    cards[i] = this.cleanCard({ ...cards[i], ...input, id, createdAt: cards[i].createdAt, verifiedAt: input.verifiedAt || cards[i].verifiedAt });
    this._save(cards);
    return cards[i];
  },
  remove(id) { this._save(this.all().filter(c => c.id !== id)); },
  // "Checked it": stamp now and the current patch name.
  verify(id, now = Date.now()) {
    const cards = this.all();
    const c = cards.find(x => x.id === id);
    if (!c) throw new Error('That card is gone');
    const patch = this.patchInfo(c.gameId);
    c.verifiedAt = now;
    if (patch && patch.label) c.verifiedPatch = patch.label.slice(0, 80);
    this._save(cards);
    return c;
  },

  // ---- the patch Vex last saw ----------------------------------------------------
  patchInfo(gameId) {
    if (typeof PatchRadar === 'undefined' || typeof PatchRadar.pages !== 'function') return null;
    let best = null;
    for (const p of PatchRadar.pages(gameId)) {
      const at = p.changedAt || 0;
      if (at && (!best || at > best.at)) best = { at, label: p.latest || '' };
    }
    return best;
  },

  // Guide pages saved for the game, with their age (counted from first seen here).
  guidePages(gameId, now = Date.now()) {
    if (typeof GameSession === 'undefined') return [];
    const seen = VexLifeKit.read(this.SEEN_KEY, {}) || {};
    let changed = false;
    const patch = this.patchInfo(gameId);
    const out = GameSession.pages(gameId).map(p => {
      if (!seen[p.url]) { seen[p.url] = now; changed = true; }
      return { ...p, seenAt: seen[p.url], stale: this.isStale({ createdAt: seen[p.url] }, patch) };
    });
    if (changed) VexLifeKit.write(this.SEEN_KEY, seen);
    return out;
  },

  // Every page a second screen could show for a game: its guide, then its cards' sources.
  pagesFor(gameId) {
    const pages = typeof GameSession !== 'undefined' ? GameSession.pages(gameId).map(p => ({ title: p.title, url: p.url })) : [];
    for (const c of this.forGame(gameId)) if (c.source && !pages.some(p => p.url === c.source)) pages.push({ title: c.title, url: c.source });
    return pages;
  },

  // ---- the window ------------------------------------------------------------------
  _games() { return typeof GameSession !== 'undefined' ? GameSession.games() : []; },

  async edit(card) {
    const games = this._games();
    if (!games.length) throw new Error('Add a game first: Settings, Game mode');
    const v = await VexLifeKit.form({
      id: 'vex-loadout-form', title: card ? 'Edit card' : 'New loadout card', sub: 'Kept on this computer.',
      fields: [
        { name: 'title', label: 'Name', value: card ? card.title : '', required: true, placeholder: 'Season 3 tank build' },
        { name: 'gameId', label: 'Game', type: 'select', options: games.map(g => [g.id, g.name]), value: card ? card.gameId : (GameSession.defaultGame() || games[0]).id },
        { name: 'items', label: 'Items or picks (one per line)', type: 'textarea', value: card ? card.items.join('\n') : '' },
        { name: 'notes', label: 'Notes', type: 'textarea', value: card ? card.notes : '' },
        { name: 'source', label: 'Where it came from (link)', value: card ? card.source : '', placeholder: 'https://' },
        { name: 'verifiedPatch', label: 'Patch you checked it against', value: card ? card.verifiedPatch : '', placeholder: 'optional' },
      ],
      validate: (vals) => this.cleanCard(vals),
    });
    if (!v) return null;
    return card ? this.update(card.id, v) : this.add(v);
  },

  open(gameId) {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('game-loadouts');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-loadouts', title: 'Loadout cards', sub: 'Builds and picks per game. A card is flagged when a patch came after you last checked it.' });
    const games = this._games();
    const draw = () => {
      body.textContent = '';
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;margin-bottom:10px';
      bar.appendChild(VexSettingsGroups.button('New card', async () => {
        try { await this.edit(null); draw(); } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { primary: true }));
      body.appendChild(bar);
      const list = gameId ? this.forGame(gameId) : this.all();
      if (!list.length) body.appendChild(VexSettingsGroups.note('No cards yet.'));
      for (const c of list) {
        const game = games.find(g => g.id === c.gameId);
        const patch = this.patchInfo(c.gameId);
        const stale = this.isStale(c, patch);
        const lines = [
          c.title + ' (' + (game ? game.name : 'a game no longer in the list') + ')',
          (stale ? 'Stale: a patch' + (patch.label ? ' (' + patch.label + ')' : '') + ' came after you checked this on ' + VexLifeKit.dayString(c.verifiedAt) : 'Checked ' + VexLifeKit.dayString(c.verifiedAt) + (c.verifiedPatch ? ' against ' + c.verifiedPatch : '')),
        ];
        if (c.items.length) lines.push(c.items.join(' / '));
        if (c.notes) lines.push(c.notes);
        const buttons = [];
        if (c.source) buttons.push(VexSettingsGroups.button('Source', () => { try { TabManager.createTab(c.source, true); } catch (err) { window.showToast?.(err.message, 'error'); } }));
        buttons.push(VexSettingsGroups.button('Checked it', () => { try { this.verify(c.id); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
        buttons.push(VexSettingsGroups.button('Edit', async () => { try { await this.edit(c); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
        buttons.push(VexSettingsGroups.button('Delete', async () => {
          if (await window.vexConfirm({ title: 'Delete this card?', message: c.title, okLabel: 'Delete', danger: true })) { this.remove(c.id); draw(); }
        }, { danger: true }));
        body.appendChild(VexLifeKit.row(lines, buttons));
        if (stale) body.lastChild.dataset.stale = '1';
      }
      if (gameId) {
        const pages = this.guidePages(gameId);
        const staleCount = pages.filter(p => p.stale).length;
        if (pages.length) body.appendChild(VexSettingsGroups.note('Guide pages: ' + pages.length + (staleCount ? ', ' + staleCount + ' saved before the latest patch. Open them and check.' : ', none older than the latest patch.')));
      }
    };
    draw();
  },
};

if (typeof window !== 'undefined') {
  window.GameLoadouts = GameLoadouts;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'game-loadouts',
      title: 'Loadout cards',
      keywords: 'loadout build card game guide patch stale hero items',
      before: 'about',
      build: (el) => {
        el.appendChild(VexSettingsGroups.note('Builds and picks per game, flagged when a patch came after you last checked them.'));
        el.appendChild(VexSettingsGroups.button('Open the cards', () => GameLoadouts.open(), { primary: true }));
      },
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'game-loadouts', label: 'Loadout cards', hint: 'Builds and picks per game, flagged when a patch is newer', icon: 'gamepad', action: () => { if (GameLoadouts.enabled()) GameLoadouts.open(typeof GameSession !== 'undefined' && GameSession.defaultGame() ? GameSession.defaultGame().id : undefined); else window.showToast?.('Loadout cards are switched off'); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { GameLoadouts };
