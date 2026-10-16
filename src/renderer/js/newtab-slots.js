// === New Tab slot grid and render budget =======================================
//
// The New Tab page grew a card for every feature: the Morning Brief, today, the
// widget shelf, the pet, one new thing, a fortune, the weather, the tools and
// the recent pages. Together they are a wall (T0-024). This is the one place
// that decides what the page shows:
//
//   hero      the greeting, the search box and the shortcuts: always
//   cards     at most MAX_CARDS (3), chosen by priority, then by cost
//   footer    at most one (recent pages or the GitHub activity)
//
// Every feature that wants a place on the page registers a candidate:
//
//   NewTabSlots.register({ id, slot: 'card' | 'footer', priority: 0..100, cost: ms,
//                          bytes?, available?(), element? | briefSection? | part? })
//
//   element       the id of a block in start.html (hidden when it is not chosen)
//   briefSection  the id of a Morning Brief section (dropped from the brief)
//   part          'pet' | 'widgets': a part of the New Tab payload (removed from it)
//   cost          what it takes to draw, in ms. The chosen ones together must fit
//                 in BUDGET_MS (50) with the hero
//   bytes         how much of the payload it needs (the payload is bounded)
//
// Layout: 'calm' (the default for a new profile) applies the grid; 'all' (the
// profile that existed before this, marked once by VexMigrations) shows
// everything as before and the plan only reports the cost.
//
// The plan is made in the main window and handed to the start page with the
// rest of the payload (js/today.js -> window.__vexToday.newtab.slots). The start
// page can only hide blocks it already has, by id from a fixed list.
const NewTabSlots = {
  LAYOUT_KEY: 'newtab.layout',
  LAYOUTS: ['calm', 'all'],
  DEFAULT_LAYOUT: 'calm',
  MAX_CARDS: 3,
  MAX_FOOTER: 1,
  BUDGET_MS: 50,
  HERO_MS: 8,
  MAX_BYTES: 14 * 1024,
  // The blocks start.html can hide (anything else in a plan is ignored there).
  PAGE_ELEMENTS: ['brief-section', 'today-section', 'weather-section', 'tools-section', 'recent-section', 'gh-activity-section'],
  MIGRATION: 'newtab.layout-existing-profiles',

  _defs: new Map(),

  register(def) {
    if (!def || !/^[a-z][a-z0-9-]{1,48}$/.test(String(def.id || ''))) throw new Error('A New Tab card needs an id of lowercase letters, digits and dashes');
    if (def.slot !== 'card' && def.slot !== 'footer') throw new Error('Card "' + def.id + '" must be a card or a footer');
    if (!Number.isFinite(def.priority) || def.priority < 0 || def.priority > 100) throw new Error('Card "' + def.id + '" needs a priority from 0 to 100');
    if (!Number.isFinite(def.cost) || def.cost < 0 || def.cost > this.BUDGET_MS) throw new Error('Card "' + def.id + '" needs a cost in ms of at most ' + this.BUDGET_MS);
    const targets = ['element', 'briefSection', 'part'].filter(k => def[k]);
    if (targets.length !== 1) throw new Error('Card "' + def.id + '" must name exactly one of element, briefSection, part');
    if (def.element && !this.PAGE_ELEMENTS.includes(def.element)) throw new Error('Card "' + def.id + '" names a block the page cannot hide: ' + def.element);
    if (def.part && !['pet', 'widgets'].includes(def.part)) throw new Error('Card "' + def.id + '" names an unknown part: ' + def.part);
    if (def.available != null && typeof def.available !== 'function') throw new Error('Card "' + def.id + '": available must be a function');
    this._defs.set(def.id, { bytes: 0, ...def });
    return def.id;
  },
  unregister(id) { return this._defs.delete(id); },
  list() { return Array.from(this._defs.values()); },

  // ---- the layout ------------------------------------------------------------
  layout() {
    if (typeof VexDefaults === 'undefined') throw new Error('VexDefaults is not loaded: js/vex-defaults.js must come before js/newtab-slots.js');
    const v = VexDefaults.get(this.LAYOUT_KEY, this.DEFAULT_LAYOUT);
    return this.LAYOUTS.includes(v) ? v : this.DEFAULT_LAYOUT;
  },
  setLayout(layout) {
    if (!this.LAYOUTS.includes(layout)) throw new Error('The New Tab layout is calm or all');
    VexDefaults.set(this.LAYOUT_KEY, layout);
    try { document.dispatchEvent(new CustomEvent('vex:newtab-layout', { detail: { layout } })); } catch { /* vex-allow-empty-catch: no document: a test */ }
    if (typeof VexToday !== 'undefined' && typeof VexToday.refresh === 'function') VexToday.refresh().catch(err => console.error('[NewTab] could not refresh:', err));
    return layout;
  },
  enabled() { return this.layout() === 'calm'; },
  setEnabled(on) { this.setLayout(on ? 'calm' : 'all'); },

  // ---- the plan (pure given the registry) -------------------------------------------
  _available(def) {
    if (typeof def.available !== 'function') return true;
    try { return !!def.available(); }
    catch (err) { console.error('[NewTab] could not tell if "' + def.id + '" has anything to show:', err); return false; }
  },

  // -> { layout, hero: true, cards: [ids], footer: [ids], dropped: [{ id, reason }], spentMs, budgetMs, bytes }
  plan(opts = {}) {
    const layout = opts.layout || this.layout();
    const all = layout === 'all';
    const cands = this.list().filter(d => this._available(d));
    const order = (a, b) => (b.priority - a.priority) || (a.cost - b.cost) || (a.id < b.id ? -1 : 1);
    const out = { layout, hero: true, cards: [], footer: [], dropped: [], spentMs: this.HERO_MS, budgetMs: this.BUDGET_MS, bytes: 0 };
    const room = { card: this.MAX_CARDS, footer: this.MAX_FOOTER };
    for (const d of cands.slice().sort(order)) {
      const list = d.slot === 'card' ? out.cards : out.footer;
      if (!all) {
        if (list.length >= room[d.slot]) { out.dropped.push({ id: d.id, reason: 'no free ' + d.slot + ' slot' }); continue; }
        if (out.spentMs + d.cost > this.BUDGET_MS) { out.dropped.push({ id: d.id, reason: 'over the ' + this.BUDGET_MS + ' ms budget' }); continue; }
        if (out.bytes + d.bytes > this.MAX_BYTES) { out.dropped.push({ id: d.id, reason: 'over the payload bound' }); continue; }
      }
      list.push(d.id);
      out.spentMs += d.cost;
      out.bytes += d.bytes;
    }
    return out;
  },

  // Applies a plan to the Today snapshot that is about to be handed to the page.
  // Mutates snap.newtab (adds .slots, removes parts) and snap.morning.sections.
  applyTo(snap, plan = this.plan()) {
    if (!snap || typeof snap !== 'object') throw new Error('applyTo needs the Today snapshot');
    const chosen = new Set(plan.cards.concat(plan.footer));
    const nt = snap.newtab && typeof snap.newtab === 'object' ? snap.newtab : (snap.newtab = { v: 1 });
    const known = this.list();
    const show = [], hide = [];
    if (plan.layout !== 'all') {
      for (const d of known) {
        const picked = chosen.has(d.id);
        if (d.element) (picked ? show : hide).push(d.element);
        if (d.part && !picked) delete nt[d.part];
        if (d.briefSection && !picked && snap.morning && Array.isArray(snap.morning.sections)) {
          snap.morning.sections = snap.morning.sections.filter(s => s.id !== d.briefSection);
        }
      }
    }
    nt.slots = { layout: plan.layout, show: [...new Set(show)], hide: [...new Set(hide.filter(e => !show.includes(e)))] };
    return nt.slots;
  },

  // A profile that was in use before the grid keeps every card it had; a new one
  // gets the calm grid. Runs after VexSimpleMode.migrate() (js/app.js), which is
  // what tells a used profile from a new one. `used` is injectable for tests.
  _migrateLayout(used) {
    if (VexDefaults.isExplicit(this.LAYOUT_KEY)) return 'kept';
    if (used === undefined) {
      if (typeof Onboarding === 'undefined') throw new Error('Onboarding is not loaded, so a new profile cannot be told from an old one');
      used = Onboarding.done() || Onboarding._usedBefore();
    }
    if (used) { VexDefaults.set(this.LAYOUT_KEY, 'all'); return 'all'; }
    return 'calm';
  },

  // ---- Settings › New Tab layout -----------------------------------------------------------
  renderSettings(body) {
    body.textContent = '';
    const info = document.createElement('p');
    info.className = 'setting-info';
    info.textContent = 'Calm shows the search box, your shortcuts and at most three cards chosen by priority, plus one line of recent pages. Everything shows every card, as Vex did before.';
    body.appendChild(info);
    const row = document.createElement('div');
    row.className = 'setting-row';
    const label = document.createElement('label');
    label.textContent = 'New Tab layout';
    label.setAttribute('for', 'setting-newtab-layout');
    const sel = document.createElement('select');
    sel.id = 'setting-newtab-layout';
    for (const [v, t] of [['calm', 'Calm: search and up to three cards'], ['all', 'Everything']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o);
    }
    sel.value = this.layout();
    sel.addEventListener('change', () => {
      try { this.setLayout(sel.value); this.renderSettings(body); }
      catch (err) { sel.value = this.layout(); window.showToast?.((err && err.message) || String(err), 'error'); }
    });
    row.append(label, sel);
    body.appendChild(row);
    const p = this.plan();
    const names = (ids) => ids.map(id => (this._defs.get(id) || {}).label || id).join(', ') || 'none';
    const status = document.createElement('p');
    status.className = 'setting-info';
    status.textContent = 'Right now: ' + names(p.cards) + (p.footer.length ? ' and, below, ' + names(p.footer) : '') + '. ' + (p.dropped.length ? 'Not shown: ' + p.dropped.map(d => ((this._defs.get(d.id) || {}).label || d.id) + ' (' + d.reason + ')').join('; ') + '.' : '');
    body.appendChild(status);
  },

  // ---- the built-in candidates ----------------------------------------------------------------
  // Priorities: what the person needs today first, the day's context next, quiet
  // extras last. Costs are the ms a block takes to draw on the start page.
  registerBuiltins() {
    const briefOn = () => typeof VexBrief !== 'undefined' && VexBrief.prefs().enabled !== false;
    const briefHas = (id) => () => briefOn() && VexBrief.isEnabled(id);
    const play = (kind) => () => typeof VexPlayfulness === 'undefined' || VexPlayfulness.allowed(kind);
    const both = (...fns) => () => fns.every(f => f());
    const D = [
      { id: 'brief', label: 'Morning Brief', slot: 'card', priority: 90, cost: 14, bytes: 6000, element: 'brief-section', available: briefOn },
      { id: 'today', label: 'Today', slot: 'card', priority: 80, cost: 8, bytes: 3000, element: 'today-section' },
      { id: 'news-actions', label: 'News you can act on', slot: 'card', priority: 60, cost: 6, bytes: 1200, briefSection: 'news-actions', available: briefHas('news-actions') },
      { id: 'weather', label: 'Weather', slot: 'card', priority: 55, cost: 6, element: 'weather-section' },
      { id: 'widgets', label: 'Widget shelf', slot: 'card', priority: 50, cost: 10, bytes: 2500, part: 'widgets', available: both(() => typeof VexDelights !== 'undefined' && VexDelights.isOn('widgets'), play('delight')) },
      { id: 'one-new-thing', label: 'One new thing', slot: 'card', priority: 40, cost: 5, bytes: 600, briefSection: 'one-new-thing', available: briefHas('one-new-thing') },
      { id: 'tools', label: 'Tools', slot: 'card', priority: 30, cost: 4, element: 'tools-section' },
      { id: 'streaks', label: 'Streaks', slot: 'card', priority: 25, cost: 4, bytes: 500, briefSection: 'streaks-goals', available: both(briefHas('streaks-goals'), play('streak')) },
      { id: 'pet', label: 'Vex Pet', slot: 'card', priority: 22, cost: 5, bytes: 6000, part: 'pet', available: both(() => typeof VexProgress !== 'undefined' && VexProgress.enabled('pet'), play('pet')) },
      { id: 'fortune', label: 'Fortune', slot: 'card', priority: 20, cost: 3, bytes: 400, briefSection: 'fortune', available: both(briefHas('fortune'), play('delight')) },
      { id: 'recent', label: 'Recent pages', slot: 'footer', priority: 60, cost: 5, element: 'recent-section' },
      { id: 'github', label: 'GitHub activity', slot: 'footer', priority: 30, cost: 6, element: 'gh-activity-section' },
    ];
    for (const d of D) if (!this._defs.has(d.id)) this.register(d);
    // The daily word and "take me somewhere interesting" have no New Tab block
    // yet (they are commands and a game). When one gets a block it registers
    // here with its own priority and competes for a slot like the others.
  },
};

if (typeof window !== 'undefined') {
  window.NewTabSlots = NewTabSlots;
  NewTabSlots.registerBuiltins();
  if (typeof VexMigrations !== 'undefined') VexMigrations.register(NewTabSlots.MIGRATION, () => NewTabSlots._migrateLayout());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'newtab-layout', title: 'New Tab layout', keywords: 'start page cards calm grid brief widgets pet slots', render: (body) => NewTabSlots.renderSettings(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { NewTabSlots };
