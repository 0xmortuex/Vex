// === Drops, giveaways and codes that end (T3-089) =============================
//
// One list of things that expire: a free game, a stream drop, a giveaway, a code. Each
// has an end time and a countdown, a "claimed" tick you press yourself, and an optional
// reminder before it ends.
//
//   Manual        add one by hand, or "Remind me before this ends" from any page: the
//                 page's address and title, and when it ends (you type it)
//   Free games    "Add the free games" copies what Epic and Steam give away now into the
//                 list, with their end times (the stores' own public lists, js/free-games.js)
//   Sources       feeds you list (RSS or Atom, public): a new item becomes a line, with no
//                 end time until you give it one, and you are told once. Checked hourly,
//                 and held while a game runs like every Vex job
//   Reminder      a real Vex reminder (delivered even during a game) a set time before it
//                 ends; removed when you tick "claimed" or delete the line
//
// It TELLS. It never claims, redeems, signs in, clicks or submits anything for you, and
// it does not read a store or a game. Claiming stays a thing you do on the real page.
//
// Going-live notices already exist (js/live-channels.js: Twitch and YouTube channels, one
// notification when one goes live, held while a game runs), so none is duplicated here.
// Deferred: gathering Roblox codes automatically from code-list pages (it would mean
// scraping third-party pages for a game with anti-cheat); a code is a line you type.
const VexDropsDesk = {
  KEYS: { on: 'vex.drops.enabled', data: 'vex.drops', poll: 'vex.drops.poll' },
  FEATURE: 'drops-desk',
  KINDS: ['drop', 'giveaway', 'code', 'free game'],
  MAX_ITEMS: 120,
  MAX_SOURCES: 10,
  MAX_PER_POLL: 15,
  LEAD_MIN: 120,
  EVERY_MS: 60 * 60 * 1000,
  _now() { return Date.now(); },

  enabled() { return VexMediaKit.flag(this.KEYS.on, true); },
  setEnabled(on) { VexMediaKit.setFlag(this.KEYS.on, !!on); },
  polling() { return VexMediaKit.flag(this.KEYS.poll, false); },
  setPolling(on) { VexMediaKit.setFlag(this.KEYS.poll, !!on); },

  // ---- the data ---------------------------------------------------------------------
  data() {
    const v = VexMediaKit.read(this.KEYS.data, null);
    if (v == null) return { items: [], sources: [] };
    if (typeof v !== 'object' || !Array.isArray(v.items) || !Array.isArray(v.sources)) throw new Error('The saved drops list is not readable');
    return v;
  },
  _save(d) { VexMediaKit.write(this.KEYS.data, d); },
  items() { return this.data().items; },

  // → a clean item, or throws.
  clean(input) {
    const title = String(input && input.title != null ? input.title : '').replace(/\s+/g, ' ').trim();
    if (!title) throw new Error('Give it a title');
    if (title.length > 140) throw new Error('The title is up to 140 characters');
    const kind = this.KINDS.includes(input.kind) ? input.kind : 'drop';
    let url = '';
    if (input.url) url = VexMediaKit.webUrl(input.url);
    const endsAt = Number(input.endsAt) || 0;
    if (endsAt < 0) throw new Error('That is not a real end time');
    return { id: input.id || VexMediaKit.uid('dr'), title, kind, url, endsAt, claimed: !!input.claimed, source: String(input.source || '').slice(0, 40), note: String(input.note || '').slice(0, 200), reminderId: String(input.reminderId || ''), at: Number(input.at) || this._now() };
  },
  async add(input, { remind = 0 } = {}) {
    const d = this.data();
    if (d.items.length >= this.MAX_ITEMS) throw new Error('The list holds ' + this.MAX_ITEMS + ' lines. Delete finished ones first.');
    const item = this.clean(input);
    if (item.url && d.items.some(i => i.url === item.url && i.title === item.title)) throw new Error('That one is already on the list');
    if (remind > 0 && item.endsAt && item.endsAt - remind * 60000 - this._now() < 90000) throw new Error('That is too close to the end for a reminder');
    d.items.push(item);
    this._save(d);
    if (remind > 0 && item.endsAt) await this.setReminder(item.id, remind);
    return item;
  },
  async remove(id) {
    const d = this.data();
    const it = d.items.find(i => i.id === id);
    if (!it) throw new Error('That line is not on the list any more');
    if (it.reminderId) await this._dropReminder(it.reminderId);
    d.items = d.items.filter(i => i.id !== id);
    this._save(d);
  },
  async setClaimed(id, claimed) {
    const d = this.data();
    const it = d.items.find(i => i.id === id);
    if (!it) throw new Error('That line is not on the list any more');
    it.claimed = !!claimed;
    if (claimed && it.reminderId) { await this._dropReminder(it.reminderId); it.reminderId = ''; }
    this._save(d);
  },

  // ---- reminders (real ones) -----------------------------------------------------------------
  _api() {
    const r = window.vex && window.vex.reminders;
    if (!r || typeof r.create !== 'function' || typeof r.delete !== 'function' || typeof r.list !== 'function') throw new Error('Reminders are not available in this window');
    return r;
  },
  async _dropReminder(id) {
    const items = await this._api().list();
    if (Array.isArray(items) && items.some(r => r && r.id === id)) await this._api().delete(id);
  },
  async setReminder(id, leadMin = this.LEAD_MIN) {
    const d = this.data();
    const it = d.items.find(i => i.id === id);
    if (!it) throw new Error('That line is not on the list any more');
    if (!it.endsAt) throw new Error('Give it an end time first');
    const at = it.endsAt - leadMin * 60000;
    if (at - this._now() < 90000) throw new Error('That is too close to the end for a reminder');
    if (it.reminderId) await this._dropReminder(it.reminderId);
    const made = await this._api().create(it.title + ' ends in ' + VexMediaKit.span(leadMin * 60000), at, it.url ? { url: it.url } : undefined);
    if (!made || !made.id) throw new Error('The reminder was not created');
    it.reminderId = made.id;
    this._save(d);
    return at;
  },

  // ---- ends soon (pure) --------------------------------------------------------------------------
  // Unclaimed lines that end, soonest first; lines already over are returned last-ended-first by `over`.
  upcoming(items, now = this._now()) {
    return items.filter(i => !i.claimed && i.endsAt > now).sort((a, b) => a.endsAt - b.endsAt);
  },
  line(i, now = this._now()) { return i.title + ' ends in ' + VexMediaKit.span(i.endsAt - now); },
  widgetLines(now = this._now()) {
    if (!this.enabled()) return [];
    return this.upcoming(this.items(), now).filter(i => i.endsAt - now <= 24 * 3600000).slice(0, 2).map(i => this.line(i, now));
  },
  calendarEvents(from, to) {
    if (!this.enabled()) return [];
    return this.items().filter(i => !i.claimed && i.endsAt >= from && i.endsAt < to)
      .map(i => ({ start: i.endsAt - 1800000, end: i.endsAt, summary: i.title + ' ends', allDay: false, location: i.url, calendar: 'Drops' }));
  },

  // ---- from a page, from the stores ----------------------------------------------------------------
  async fromPage() {
    const K = VexMediaKit;
    const page = K.activePage();
    const when = await window.vexPrompt({ title: 'Remind me before this ends', message: page.title || page.url, label: 'When does it end? (YYYY-MM-DD HH:MM, your clock)', okLabel: 'Add' });
    if (!when) return null;
    const endsAt = K.parseLocal(when);
    const item = await this.add({ title: page.title || page.url, url: page.url, endsAt, kind: 'drop' }, { remind: this.LEAD_MIN });
    K.toast('Added. You will be reminded ' + K.span(this.LEAD_MIN * 60000) + ' before it ends.');
    return item;
  },
  async addFreeGames() {
    if (!window.vex || typeof window.vex.freeGames !== 'function') throw new Error('The free games list is not available in this window');
    const res = await window.vex.freeGames();
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not read the stores');
    let n = 0;
    for (const g of res.games.filter(x => x.live && x.until)) {
      try { await this.add({ title: g.store + ': ' + g.title, url: g.url, endsAt: g.until, kind: 'free game' }); n++; }
      catch (err) { if (!/already on the list/.test(err.message)) throw err; }
    }
    return n;
  },

  // ---- sources (public feeds) ------------------------------------------------------------------------
  addSource(url, name) {
    const u = VexMediaKit.webUrl(url);
    const d = this.data();
    if (d.sources.some(s => s.url === u)) throw new Error('That source is already listed');
    if (d.sources.length >= this.MAX_SOURCES) throw new Error('At most ' + this.MAX_SOURCES + ' sources');
    d.sources.push({ id: VexMediaKit.uid('ds'), url: u, name: String(name || new URL(u).hostname).slice(0, 40), seen: [], primed: false });
    this._save(d);
  },
  removeSource(id) { const d = this.data(); d.sources = d.sources.filter(s => s.id !== id); this._save(d); },
  // One pass over the listed feeds. The first look at a source only learns what is there (no flood).
  async poll() {
    if (!this.enabled() || !this.polling()) return 0;
    if (typeof VexFeeds === 'undefined') throw new Error('The feed reader is not available in this window');
    if (!window.vex || typeof window.vex.rssFetch !== 'function') throw new Error('Feeds cannot be read in this window');
    let added = 0;
    const names = [];
    for (const s of this.data().sources) {
      const xml = await window.vex.rssFetch(s.url);
      if (!xml) throw new Error('"' + s.name + '" did not answer');
      const parsed = VexFeeds.parse(xml, s.name, s.url).slice(0, this.MAX_PER_POLL);
      const d = this.data();
      const src = d.sources.find(x => x.id === s.id);
      if (!src) continue;
      const fresh = parsed.filter(p => !src.seen.includes(p.link));
      src.seen = parsed.map(p => p.link).concat(src.seen).slice(0, 60);
      const first = !src.primed;
      src.primed = true;
      if (!first) {
        for (const p of fresh) {
          if (d.items.length >= this.MAX_ITEMS) break;
          d.items.push(this.clean({ title: p.title.slice(0, 140), url: p.link, kind: 'drop', source: s.name }));
          added++;
        }
        if (fresh.length) names.push(s.name);
      }
      this._save(d);
    }
    if (added && typeof VexAttention !== 'undefined') {
      const text = added + ' new on your drops list from ' + [...new Set(names)].join(', ');
      VexAttention.notify({ feature: this.FEATURE, urgency: 'useful', id: 'poll' + this._now(), title: text, action: { label: 'Open', key: 'open' } }, () => VexMediaKit.toast(text, 'info', 8000, { action: { label: 'Open', run: () => this.open() } }));
    }
    return added;
  },

  // ---- drawing ---------------------------------------------------------------------------------------------
  open() {
    const K = VexMediaKit;
    const { body } = K.dialog({ id: 'drops-desk', title: 'Drops and giveaways', sub: 'Things that end, with a countdown. Claim them yourself on the real page.' });
    const draw = () => {
      body.textContent = '';
      if (!this.enabled()) { body.appendChild(K.info('The drops list is switched off in Settings.')); return; }
      const now = this._now();
      const items = this.items();
      const soon = this.upcoming(items, now);
      const rest = items.filter(i => !soon.includes(i)).sort((a, b) => (a.claimed - b.claimed) || b.at - a.at);
      if (!items.length) body.appendChild(K.info('Nothing listed. Add one below, or use "Remind me before this ends" on any page from Ctrl+K.'));
      for (const i of soon.concat(rest)) {
        const r = K.el('div', 'setting-row');
        r.appendChild(K.el('span', '', i.title + ' (' + i.kind + ') ' + (i.endsAt > now ? 'ends in ' + K.span(i.endsAt - now) : (i.endsAt ? 'ended' : 'no end time')) + (i.claimed ? ', claimed' : '')));
        r.appendChild(K.switchRow('Claimed', i.claimed, async (on) => { await this.setClaimed(i.id, on); draw(); }));
        if (i.url) r.appendChild(K.button('Open', () => TabManager.createTab(i.url, true), { label: 'Open ' + i.title }));
        r.appendChild(K.button('Delete', async () => { await this.remove(i.id); draw(); }, { danger: true, label: 'Delete ' + i.title }));
        body.appendChild(r);
      }
      const title = K.input('Title', { placeholder: 'Free skin pack', max: 140 });
      const url = K.input('Page address (optional)', { placeholder: 'https://...', max: 300 });
      const ends = K.input('Ends (YYYY-MM-DD HH:MM, your clock)', { placeholder: '2026-11-02 18:00', max: 16 });
      const kind = document.createElement('select'); kind.setAttribute('aria-label', 'What kind');
      for (const k of this.KINDS) kind.appendChild(new Option(k, k));
      body.appendChild(K.row('Add one', title, url, ends, kind, K.button('Add', async () => {
        await this.add({ title: title.value, url: url.value, kind: kind.value, endsAt: ends.value.trim() ? K.parseLocal(ends.value) : 0 }, { remind: ends.value.trim() ? this.LEAD_MIN : 0 });
        draw();
      })));
      body.appendChild(K.button('Add the free games', async () => { const n = await this.addFreeGames(); K.toast(n ? 'Added ' + n : 'Nothing new to add'); draw(); }));
    };
    draw();
  },
  render(body) {
    const K = VexMediaKit;
    body.textContent = '';
    body.appendChild(K.info('One list of drops, giveaways, free games and codes that end, with a countdown, a Claimed tick and a reminder before the end. It only tells you; it never claims or redeems anything.'));
    body.appendChild(K.switchRow('Drops and giveaways list', this.enabled(), (on) => this.setEnabled(on)));
    body.appendChild(K.switchRow('Check my listed feeds every hour (held while a game runs)', this.polling(), (on) => this.setPolling(on)));
    const list = K.el('div');
    const draw = () => {
      list.textContent = '';
      let sources = [];
      try { sources = this.data().sources; } catch (err) { list.appendChild(K.info(err.message)); return; }
      for (const s of sources) list.appendChild(K.row(s.name + ' (' + s.url + ')', K.button('Remove', () => { this.removeSource(s.id); draw(); }, { danger: true, label: 'Remove ' + s.name })));
    };
    draw();
    const input = K.input('Feed address to add', { placeholder: 'https://example.com/giveaways.rss', max: 300 });
    body.append(list, K.row('Add a feed', input, K.button('Add', () => { this.addSource(input.value); input.value = ''; draw(); })), K.button('Open the list', () => this.open()));
  },
  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof VexJobs === 'undefined') throw new Error('VexJobs is not loaded: js/jobs.js must come before js/drops-desk.js');
    VexJobs.every('Drops sources', this.EVERY_MS, () => this.poll(), { when: 'background', deferOnBattery: true, feature: this.FEATURE });
    if (typeof VexNewTab !== 'undefined' && typeof VexNewTab.addTextWidget === 'function') VexNewTab.addTextWidget(this.FEATURE, () => this.widgetLines());
    if (typeof Calendar !== 'undefined' && typeof Calendar.addProvider === 'function') Calendar.addProvider(this.FEATURE, (from, to) => this.calendarEvents(from, to));
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle(this.FEATURE, (key) => { if (key === 'open') this.open(); });
    const run = (p) => p.catch((err) => VexMediaKit.fail(err));
    VexMediaKit.register({
      id: 'drops-desk', title: 'Drops and giveaways', keywords: 'drop giveaway free game code ends countdown claim remind',
      render: (b) => this.render(b),
      commands: [
        { id: 'drops-open', label: 'Drops and giveaways', hint: 'What ends soon, with a countdown', icon: 'list', action: () => { try { this.open(); } catch (err) { VexMediaKit.fail(err); } } },
        { id: 'drops-from-page', label: 'Remind me before this ends', hint: 'Add this page to the drops list with an end time', icon: 'bell', action: () => run(this.fromPage()) },
      ],
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexDropsDesk = VexDropsDesk;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDropsDesk };
