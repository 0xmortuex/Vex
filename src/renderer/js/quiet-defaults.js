// === Quiet by default: rarely used parts stay out of sight until they are needed ====
//
// Measured on the owner's profile over seven weeks: two timers and no stopwatch run, an empty
// Bookmarks list, Annotations and Feeds last opened in September, no boosts, no site forced to
// dark mode. They are not deleted. A NEW profile starts with them out of sight, and each comes
// back when it is needed:
//
//   - the person opens it on purpose (Ctrl+K "Stopwatch", the timer pill on the title bar);
//   - Settings › Hidden until needed has a Show button for each, and "Show everything";
//   - Vex offers one now and then through the Attention Inbox ("Try it", never a pop-up, at
//     most one a week), and the "New for you" scheduler (js/disclosure.js, where it exists)
//     calls VexQuietDefaults.reveal(id) when it picks one of them.
//
// WHO GETS WHAT. The default is Vex's, not a choice (VexDefaults): a profile that already
// existed when this shipped is given 'all' and sees exactly what it saw before; only a profile
// with nothing in it yet is given 'quiet'. A profile that has chosen (Show everything, or one
// Show button) keeps that choice for good. Nothing here ever hides something that is in use:
// a site that already has dark mode or a boost still shows its row.
//
// The panels Bookmarks, Annotations and Feeds are hidden from the sidebar by the older lean
// default (js/sidebar.js DEFAULT_HIDDEN_PANELS) on every profile; this module only knows how to
// bring them back, it does not change who has them hidden. The reminders list stays in the
// Clock panel: the reminder path in the main process is load-bearing for other features.
const VexQuietDefaults = {
  KEY: 'quietDefaults',                     // VexDefaults: { mode: 'quiet' | 'all', revealed: [ids] }
  STATE_KEY: 'vex.quietDefaults.state',     // { v: 1, last: ms of the last offer, offered: { id: ms } }
  MIGRATION: 'quiet-defaults.initial',
  OFFER_EVERY_MS: 7 * 24 * 3600 * 1000,
  JOB_EVERY_MS: 6 * 3600 * 1000,
  JOB_FIRST_MS: 2 * 60 * 1000,
  _now() { return Date.now(); },

  // Most useful to meet first. 'panel' items are hidden by the sidebar's lean default (see above).
  ITEMS: [
    { id: 'clock-timer', kind: 'clock-tab', tab: 'timers', label: 'Timer', what: 'Count down from a time you set, from the Clock panel. Reminders stay where they are.' },
    { id: 'clock-stopwatch', kind: 'clock-tab', tab: 'stopwatch', label: 'Stopwatch', what: 'A stopwatch with laps, in the Clock panel.' },
    { id: 'site-dark', kind: 'site-row', label: 'Force dark mode for a site', what: 'In the site panel (the lock at the address): turn a bright site dark.' },
    { id: 'site-boosts', kind: 'site-row', label: 'Custom CSS and JavaScript for a site', what: 'In the site panel: make a site look or behave the way you want, only on that site.' },
    { id: 'panel-bookmarks', kind: 'panel', panel: 'bookmarks', label: 'Bookmarks panel', what: 'Your saved sites in a side panel (they are always in the address bar menu).' },
    { id: 'panel-annotations', kind: 'panel', panel: 'annotations', label: 'Highlights panel', what: 'Everything you highlighted on pages, in one list.' },
    { id: 'panel-feeds', kind: 'panel', panel: 'feeds', label: 'Feeds panel', what: 'RSS and news feeds you follow, in a side panel.' },
  ],

  item(id) {
    const it = this.ITEMS.find(i => i.id === id);
    if (!it) throw new Error('"' + id + '" is not something Vex keeps quiet by default');
    return it;
  },
  ids() { return this.ITEMS.map(i => i.id); },

  _def() {
    if (typeof VexDefaults === 'undefined') throw new Error('VexDefaults is not loaded: js/vex-defaults.js must come before js/quiet-defaults.js');
    return VexDefaults;
  },
  // { mode, revealed } as saved, or the 'all' of a profile that has never been asked.
  state() {
    const v = this._def().get(this.KEY, null);
    if (!v || typeof v !== 'object' || !['quiet', 'all'].includes(v.mode)) return { mode: 'all', revealed: [] };
    return { mode: v.mode, revealed: Array.isArray(v.revealed) ? v.revealed.filter(x => typeof x === 'string') : [] };
  },
  isExplicit() { return this._def().isExplicit(this.KEY); },

  // true while this item should stay out of sight.
  hidden(id) {
    const it = this.item(id);
    if (it.kind === 'panel') return this._panelHidden(it);
    const s = this.state();
    return s.mode === 'quiet' && !s.revealed.includes(id);
  },
  hiddenItems() { return this.ITEMS.filter(i => this.hidden(i.id)); },

  _overrides() {
    const raw = localStorage.getItem('vex.panelOverrides');
    if (raw === null) return {};
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The saved sidebar settings are not readable', { cause: err }); }
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  },
  _panelHidden(it) { const o = this._overrides()[it.panel]; return !!(o && o.hidden === true); },

  // ---- bringing one back ---------------------------------------------------------------------
  // by: who asked, for the ledger ('you', 'the Settings button', 'New for you', 'an offer you accepted').
  reveal(id, { by = 'you' } = {}) {
    const it = this.item(id);
    if (!this.hidden(id)) return false;
    if (it.kind === 'panel') {
      const ov = this._overrides();
      ov[it.panel] = { ...ov[it.panel], hidden: false, chosen: true };
      localStorage.setItem('vex.panelOverrides', JSON.stringify(ov));
      if (typeof SidebarManager !== 'undefined' && typeof SidebarManager.applyPanelOverrides === 'function') SidebarManager.applyPanelOverrides();
    } else {
      const s = this.state();
      this._def().set(this.KEY, { mode: s.mode, revealed: [...new Set([...s.revealed, id])] });
    }
    this._changed(id);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: 'quiet-defaults', what: 'Showed "' + it.label + '"', why: 'It was out of sight on this profile and ' + by + ' asked for it',
        undo: { kind: 'quiet-defaults-hide', id } });
    }
    return true;
  },
  // Undo of reveal(): put it out of sight again.
  hideAgain(id) {
    const it = this.item(id);
    if (it.kind === 'panel') {
      const ov = this._overrides();
      ov[it.panel] = { ...ov[it.panel], hidden: true };
      delete ov[it.panel].chosen;
      localStorage.setItem('vex.panelOverrides', JSON.stringify(ov));
      if (typeof SidebarManager !== 'undefined' && typeof SidebarManager.applyPanelOverrides === 'function') SidebarManager.applyPanelOverrides();
    } else {
      const s = this.state();
      this._def().set(this.KEY, { mode: s.mode, revealed: s.revealed.filter(x => x !== id) });
    }
    this._changed(id);
    return true;
  },
  // Show everything this module keeps quiet (or go back to quiet).
  showAll() {
    const s = this.state();
    this._def().set(this.KEY, { mode: 'all', revealed: s.revealed });
    for (const it of this.ITEMS.filter(i => i.kind === 'panel')) this.reveal(it.id, { by: 'Show everything' });
    this._changed('*');
    return true;
  },
  quietAgain() {
    this._def().set(this.KEY, { mode: 'quiet', revealed: [] });
    this._changed('*');
    return true;
  },
  _changed(id) {
    try { document.dispatchEvent(new CustomEvent('vex:quiet-defaults-changed', { detail: { id } })); } catch { /* vex-allow-empty-catch: no document: a test */ }
  },

  // ---- who starts quiet ------------------------------------------------------------------------
  // Once per profile. A profile that already has things in it keeps seeing everything; a profile with
  // nothing yet starts quiet. Only a default is written, never a choice, and never over a choice.
  migrate() { return VexMigrations.migrateOnce(this.MIGRATION, () => this._migrateBody()); },
  _migrateBody(used) {
    if (this._def().isExplicit(this.KEY)) return 'kept';
    if (used === undefined) {
      if (typeof Onboarding === 'undefined') throw new Error('Onboarding is not loaded, so a new profile cannot be told from an old one');
      used = Onboarding.done() || Onboarding._usedBefore();
    }
    const mode = used ? 'all' : 'quiet';
    this._def().setDefault(this.KEY, { mode, revealed: [] });
    return mode;
  },

  // ---- offering one (the "try it" flow) -----------------------------------------------------------
  _rec() {
    const raw = localStorage.getItem(this.STATE_KEY);
    if (raw === null) return { v: 1, last: 0, offered: {} };
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The "hidden until needed" record is not readable', { cause: err }); }
    return o && o.v === 1 && o.offered && typeof o.offered === 'object' ? o : { v: 1, last: 0, offered: {} };
  },
  // The next one worth offering: still hidden, never offered, in the order of ITEMS (non-panel first:
  // a hidden panel on an old profile is the owner's own earlier choice and is not nagged about).
  nextToOffer() {
    const s = this.state();
    if (s.mode !== 'quiet') return null;
    const rec = this._rec();
    return this.ITEMS.find(i => i.kind !== 'panel' && this.hidden(i.id) && !rec.offered[i.id]) || null;
  },
  // At most one a week, only on a profile that is in quiet mode, only through the Attention Inbox.
  offer(now = this._now()) {
    const it = this.nextToOffer();
    if (!it) return null;
    const rec = this._rec();
    if (now - rec.last < this.OFFER_EVERY_MS) return null;
    if (typeof VexAttention === 'undefined') throw new Error('The attention budget is not loaded (js/vex-attention.js)');
    const added = VexAttention.suggest({
      feature: 'quiet-defaults', label: 'Hidden until needed', id: it.id, title: 'Try: ' + it.label,
      body: it.what + ' It is out of sight until you ask for it.', action: { label: 'Show it', key: 'reveal:' + it.id },
    });
    if (!added) return null;
    rec.last = now; rec.offered[it.id] = now;
    localStorage.setItem(this.STATE_KEY, JSON.stringify(rec));
    return it;
  },
  tick() {
    if (typeof GameMode !== 'undefined' && GameMode.gaming) return null;
    return this.offer();
  },
  start() {
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('quiet-defaults', (key) => {
        const m = /^reveal:(.+)$/.exec(String(key));
        if (!m) throw new Error('Unknown "hidden until needed" action ' + key);
        return this.reveal(m[1], { by: 'an offer you accepted' });
      });
    }
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('quiet-defaults-hide', (token) => { this.hideAgain(token.id); return 'Put it out of sight again'; });
    }
    if (this.state().mode !== 'quiet') return false;       // nothing to offer on a profile that sees everything
    if (this._job) return true;
    if (typeof VexJobs === 'undefined') throw new Error('Hidden-until-needed needs VexJobs');
    this._job = VexJobs.every('Hidden until needed', this.JOB_EVERY_MS, () => this.tick(), { when: 'ui', deferOnBattery: true, feature: 'quiet-defaults' });
    this._first = setTimeout(() => {
      try { this.tick(); } catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Hidden until needed', 'Could not pick one to offer', err); else console.error(err); }
    }, this.JOB_FIRST_MS);
    return true;
  },
  stop() { if (this._job) { this._job.stop(); this._job = null; } clearTimeout(this._first); },

  // The switch Minimal Vex and the usage table would use: it has none on purpose (killSwitch 'none'):
  // a calm layout must not be turned into "show everything" by Minimal mode.

  // ---- Settings › Hidden until needed ------------------------------------------------------------
  group(body) {
    body.textContent = '';
    const redraw = () => this.group(body);
    const s = this.state();
    body.appendChild(VexSettingsGroups.note(s.mode === 'quiet'
      ? 'A new profile starts with a few rarely used parts out of sight. Nothing is deleted; each has a Show button here, comes back when you open it on purpose, and Vex may offer one now and then in the Attention Inbox (at most one a week).'
      : 'This profile shows everything, as it always did. Quiet again hides the rarely used parts that are not in use.'));
    for (const it of this.ITEMS) {
      const hid = this.hidden(it.id);
      const row = document.createElement('div');
      row.className = 'setting-row';
      const text = document.createElement('span');
      text.textContent = it.label + (hid ? ' (out of sight)' : '');
      row.appendChild(text);
      if (hid) {
        row.appendChild(VexSettingsGroups.button('Show', () => {
          try { this.reveal(it.id, { by: 'the Settings button' }); window.showToast?.('Showing: ' + it.label, 'info'); redraw(); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        }, { label: 'Show ' + it.label }));
      }
      body.appendChild(row);
    }
    body.appendChild(VexSettingsGroups.button(s.mode === 'quiet' ? 'Show everything' : 'Quiet again', () => {
      try {
        if (s.mode === 'quiet') this.showAll(); else this.quietAgain();
        this.start();
        window.showToast?.('Saved', 'info');
        redraw();
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }, { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexQuietDefaults = VexQuietDefaults;
  if (typeof VexMigrations !== 'undefined') VexMigrations.register(VexQuietDefaults.MIGRATION, () => VexQuietDefaults._migrateBody());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'quiet-defaults', title: 'Hidden until needed', keywords: 'quiet hidden timer stopwatch bookmarks annotations feeds boosts dark mode show everything calm', before: 'about', render: (body) => VexQuietDefaults.group(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexQuietDefaults };
