// === Discovery log ============================================================
//
// A collectible list of the Vex features you have found. Nothing new is
// tracked: a feature counts as discovered when VexFeatures.used() already says
// it was used (a command run, or a panel opened). This only remembers the day
// each one was first seen, so the log can show what was found lately.
//
//   VexDiscovery.snapshot() -> { enabled, found, total, text, recent[], missing[] }
//   VexDiscovery.scan()     -> records newly found features, signals medals
//   VexDiscovery.render(el) -> draws the card (used by Settings and the Profile)
//
// Off until turned on. The count is "N of M discovered": there is no deadline
// and no "you are missing" language.
const VexDiscovery = {
  KEY: 'vex.fun.discovery',
  MILESTONES: [10, 25, 50],

  _items() {
    const F = globalThis.VexFeatures;
    if (!F || !Array.isArray(F.ITEMS)) throw new Error('The feature list is not loaded');
    return F;
  },

  // Records features that have been used since the last scan. Returns the ids
  // found this time. A no-op while the log is off.
  scan() {
    if (!VexFun.enabled('discovery')) return [];
    const F = this._items();
    const seen = VexFun.load(this.KEY, {});
    const day = VexFun.today();
    const fresh = [];
    for (const item of F.ITEMS) {
      if (!seen[item.id] && F.used(item)) { seen[item.id] = day; fresh.push(item.id); }
    }
    if (fresh.length) {
      VexFun.save(this.KEY, seen);
      const found = Object.keys(seen).length;
      for (const m of this.MILESTONES) if (found >= m) VexFun.medal('discovery-' + m);
      if (found >= F.ITEMS.length) VexFun.medal('discovery-all');
      try { document.dispatchEvent(new CustomEvent('vex:discovery-changed', { detail: { ids: fresh } })); } catch { /* no document */ }
    }
    return fresh;
  },

  snapshot() {
    const F = this._items();
    const enabled = VexFun.enabled('discovery');
    const seen = VexFun.load(this.KEY, {});
    const total = F.ITEMS.length;
    const known = F.ITEMS.filter(i => seen[i.id]);
    const nameOf = (i) => (typeof F.nameOf === 'function' ? F.nameOf(i) : i.name || i.id);
    const recent = known
      .map(i => ({ id: i.id, name: nameOf(i), day: seen[i.id] }))
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
      .slice(0, 5);
    return {
      enabled,
      found: known.length,
      total,
      text: known.length + ' of ' + total + ' discovered',
      recent,
      // The undiscovered ones, by name only: a place to look, not a to-do list.
      missing: F.ITEMS.filter(i => !seen[i.id]).map(i => ({ id: i.id, name: nameOf(i) })),
    };
  },

  render(el) {
    if (!el) throw new Error('No place to draw the discovery log');
    const s = this.snapshot();
    const icon = (n) => (globalThis.VexIcons ? globalThis.VexIcons.svg(n, { size: 15 }) : '');
    if (!s.enabled) {
      el.innerHTML = '<p class="setting-info muted">The discovery log is off. Turn it on above to keep a list of the features you find.</p>';
      return;
    }
    const pct = s.total ? Math.round((s.found / s.total) * 100) : 0;
    el.innerHTML =
      '<div class="fun-card" role="group" aria-label="Discovery log">' +
        '<div class="fun-card-head">' + icon('star') + '<strong>' + VexFun.esc(s.text) + '</strong></div>' +
        '<div class="fun-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + s.total + '" aria-valuenow="' + s.found + '" aria-label="' + VexFun.esc(s.text) + '"><span style="width:' + pct + '%"></span></div>' +
        (s.recent.length
          ? '<ul class="fun-list">' + s.recent.map(r => '<li>' + VexFun.esc(r.name) + ' <span class="muted">' + VexFun.esc(r.day) + '</span></li>').join('') + '</ul>'
          : '<p class="setting-info muted">Nothing logged yet. Features you use show up here.</p>') +
      '</div>';
  },

  init() {
    if (this._wired || typeof document === 'undefined') return;
    this._wired = true;
    let last = 0;
    // A scan reads two small stores; once a minute while the person switches
    // tabs is plenty, and it never runs over a game.
    document.addEventListener('vex:tab-activated', () => {
      const t = VexFun.now();
      if (t - last < 60000 || VexFun.gameActive()) return;
      last = t;
      try { this.scan(); } catch (err) { VexFun.report('The discovery log could not update', err); }
    });
  },
};

if (typeof document !== 'undefined') VexDiscovery.init();
globalThis.VexDiscovery = VexDiscovery;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDiscovery };
