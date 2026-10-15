// === Brief actions: settings, section registration and wiring ================
//
// The other modules of this group (snooze-anything, mail-triage-actions,
// github-desk, interests-profile, day-layout, next-action, lost-tab-finder)
// each export a brief section { id, title, build(ctx), isEnabled() }. This one
// owns their Settings block and puts the sections into the Morning Brief's
// registry (js/brief.js, VexBrief.register) when that registry exists.
//
// Nothing here edits today.js or the start page. Everything is attached from
// outside, once, after all scripts have loaded:
//   * sections       -> VexBrief.register(...)
//   * section order  -> VexBrief.orderedIds is wrapped so that, while the
//                       person has not ordered sections by hand and "Order by
//                       time of day" is on, the order follows their habits
//   * AI news        -> AINews.openItem records what is opened, and
//                       AINewsUI.sortItems puts topics you open first when
//                       sorting by importance
//
// The three features that watch what you do (interests, time-of-day layout,
// next-action) start OFF: they record only on this PC and only once chosen.
const BriefActions = {
  PREFS_KEY: 'vex.briefActions.prefs',
  FEATURES: [
    { key: 'mail', label: 'One-tap mail triage and draft replies', info: 'Done, snooze, mark and a drafted reply on each message in the inbox sorter. Vex never sends or changes your mailbox.', def: true },
    { key: 'github', label: 'Pull request and issue desk', info: 'Your open pull requests, review requests and their CI status from GitHub, using the username set in Settings. Public data only.', def: true },
    { key: 'snooze', label: 'Snooze anything', info: 'Snoozed tabs, stories, mail and reminders come back in the next brief.', def: true },
    { key: 'finder', label: 'Find a lost page', info: 'Search history and saved page text by words and by "last week". Private and Tor tabs are never searched.', def: true },
    { key: 'interests', label: 'Learn my interests', info: 'Remembers which topics and sites you open, on this PC only, to put them first in AI news and the brief.', def: false },
    { key: 'dayLayout', label: 'Order the brief by time of day', info: 'Moves the sections you usually use at this hour to the top, unless you ordered them yourself.', def: false },
    { key: 'nextAction', label: 'Suggest what I usually do next', info: 'Remembers the order of what you do here (commands and panels, not pages) and suggests the next step.', def: false },
  ],

  prefs() {
    const out = {};
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREFS_KEY) || 'null'); } catch { raw = null; }
    for (const f of this.FEATURES) out[f.key] = raw && typeof raw[f.key] === 'boolean' ? raw[f.key] : f.def;
    return out;
  },
  isOn(key) { return !!this.prefs()[key]; },
  set(key, on) {
    if (!this.FEATURES.some(f => f.key === key)) throw new Error('No such feature: ' + key);
    const next = { ...this.prefs(), [key]: !!on };
    localStorage.setItem(this.PREFS_KEY, JSON.stringify(next));
    try { document.dispatchEvent(new CustomEvent('vex:brief-changed')); } catch { /* no document */ }
    return next;
  },

  // Every section this group offers, as the registry wants them.
  sections() {
    const out = [];
    const take = (obj, def) => { if (obj) out.push({ defaultOn: true, order: 100, icon: 'sparkles', ...def, ...obj }); };
    if (typeof VexSnooze !== 'undefined') take(VexSnooze.section, {});
    if (typeof MailTriage !== 'undefined') take(MailTriage.section, {});
    if (typeof GitHubDesk !== 'undefined') take(GitHubDesk.section, {});
    if (typeof VexInterests !== 'undefined') take(VexInterests.section, {});
    if (typeof VexDayLayout !== 'undefined') take(VexDayLayout.section, {});
    if (typeof VexNextAction !== 'undefined') take(VexNextAction.section, {});
    if (typeof LostTabFinder !== 'undefined') take(LostTabFinder.section, {});
    return out;
  },

  // Register with the brief registry. A section's own isEnabled() gates build,
  // so the Settings switch here really turns it off.
  registerAll(brief) {
    if (!brief || typeof brief.register !== 'function') return 0;
    let n = 0;
    for (const s of this.sections()) {
      const gated = {
        ...s,
        build: async (ctx) => {
          if (typeof s.isEnabled === 'function' && !s.isEnabled()) return null;
          return s.build(ctx);
        },
      };
      brief.register(gated);
      n++;
    }
    return n;
  },

  // Wrap VexBrief.orderedIds once. Only when the person has not saved an order.
  _wrapOrder(brief) {
    if (!brief || brief._dayLayoutWrapped || typeof brief.orderedIds !== 'function') return false;
    const original = brief.orderedIds.bind(brief);
    brief.orderedIds = function (prefs) {
      const ids = original(prefs);
      const p = prefs || (typeof brief.prefs === 'function' ? brief.prefs() : {});
      const manual = p && Array.isArray(p.order) && p.order.length > 0;
      if (manual || typeof VexDayLayout === 'undefined' || !BriefActions.isOn('dayLayout')) return ids;
      return VexDayLayout.order(ids);
    };
    brief._dayLayoutWrapped = true;
    return true;
  },

  // Record a section being used: the brief page cannot tell us (it is another
  // document), so a command the page sends to the browser counts as use.
  noteSectionUse(id) {
    if (typeof VexDayLayout !== 'undefined' && this.isOn('dayLayout')) VexDayLayout.record(id);
  },

  // A button pressed in the brief counts as using the section it sits in.
  _wrapUse(brief) {
    if (!brief || brief._useWrapped || typeof brief.onStartCommand !== 'function') return false;
    const original = brief.onStartCommand.bind(brief);
    brief.onStartCommand = function (cmd, webview) {
      try {
        const secs = (brief._last && brief._last.sections) || [];
        const same = (c) => c && cmd && c.type === cmd.type && (c.id === cmd.id) && (c.path === cmd.path) && (c.panel === cmd.panel);
        const hit = secs.find(s => (s.items || []).some(i => same(i.cmd)) || (s.action && same(s.action.cmd)));
        if (hit) BriefActions.noteSectionUse(hit.id);
      } catch (err) { window.VexProblems?.note('Brief actions', 'Could not note a brief section use', err); }
      return original(cmd, webview);
    };
    brief._useWrapped = true;
    return true;
  },

  _wrapNews() {
    if (typeof AINews !== 'undefined' && !AINews._interestWrapped && typeof AINews.openItem === 'function') {
      const open = AINews.openItem.bind(AINews);
      AINews.openItem = function (id, opts) {
        try {
          if (typeof VexInterests !== 'undefined' && BriefActions.isOn('interests')) {
            const item = typeof AINews.get === 'function' ? AINews.get(id) : null;
            if (item) VexInterests.record(VexInterests.featuresOf(item));
          }
        } catch (err) { window.VexProblems?.note('Interests', 'Could not record a story you opened', err); }
        return open(id, opts);
      };
      AINews._interestWrapped = true;
    }
    if (typeof AINewsUI !== 'undefined' && !AINewsUI._interestWrapped && typeof AINewsUI.sortItems === 'function') {
      const sort = AINewsUI.sortItems.bind(AINewsUI);
      AINewsUI.sortItems = function (items, how) {
        const out = sort(items, how);
        if (how !== 'important' || typeof VexInterests === 'undefined' || !BriefActions.isOn('interests')) return out;
        return VexInterests.rank(out, (i) => VexInterests.featuresOf(i), (i) => i.importance || 0);
      };
      AINewsUI._interestWrapped = true;
    }
  },

  // ---- Settings -----------------------------------------------------------
  // Its own group, added to the Settings panel from here: the markup of
  // index.html is not touched. It redraws whenever it scrolls into view.
  renderSettings(container) {
    if (!container) return;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    container.textContent = '';
    container.appendChild(el('p', 'setting-info', 'Quick actions for the brief. Everything here works on this PC with your local AI. Vex never sends mail and never changes your mailbox.'));
    const p = this.prefs();
    for (const f of this.FEATURES) {
      const row = el('div', 'setting-toggle-row');
      const name = el('span', '', f.label);
      name.style.flex = '1';
      name.title = f.info;
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!p[f.key]; input.setAttribute('aria-label', f.label);
      input.addEventListener('change', () => {
        try { this.set(f.key, input.checked); } catch (err) { input.checked = !input.checked; window.showToast?.(err.message, 'error'); }
      });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(name, lab);
      container.appendChild(row);
      container.appendChild(el('div', 'setting-info', f.info));
    }
    if (typeof VexInterests !== 'undefined') VexInterests.renderSettings(container);
    if (typeof VexNextAction !== 'undefined') VexNextAction.renderSettings(container);
    if (typeof VexDayLayout !== 'undefined') VexDayLayout.renderSettings(container);
  },

  mountSettings() {
    const panel = document.getElementById('panel-settings');
    if (!panel || document.getElementById('settings-brief-actions')) return false;
    const group = document.createElement('div');
    group.className = 'setting-group';
    group.id = 'settings-brief-actions';
    const label = document.createElement('label');
    label.className = 'setting-label';
    label.textContent = 'Brief actions';
    const body = document.createElement('div');
    body.id = 'brief-actions-content';
    group.append(label, body);
    // Straight after the Morning Brief group when it exists, else at the end.
    const anchor = document.getElementById('settings-brief');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(group, anchor.nextSibling);
    else (panel.querySelector('.settings-content') || panel).appendChild(group);
    this.renderSettings(body);
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver((entries) => { if (entries.some(e => e.isIntersecting)) this.renderSettings(body); }).observe(group);
    }
    return true;
  },

  init() {
    if (this._inited) return;
    this._inited = true;
    if (typeof VexBrief !== 'undefined') { this.registerAll(VexBrief); this._wrapOrder(VexBrief); this._wrapUse(VexBrief); }
    this._wrapNews();
    try { this.mountSettings(); } catch (err) { window.VexProblems?.note('Brief actions', 'Settings block could not be added', err); }
    if (typeof VexSnooze !== 'undefined') VexSnooze.start();
    if (typeof VexNextAction !== 'undefined') VexNextAction.start();
  },
};

if (typeof window !== 'undefined') {
  window.BriefActions = BriefActions;
  if (typeof document !== 'undefined') {
    const go = () => { try { BriefActions.init(); } catch (err) { console.error('[BriefActions]', err); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else setTimeout(go, 0);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { BriefActions };
