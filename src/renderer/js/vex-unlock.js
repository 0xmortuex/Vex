// === Unlock rules for the profile expression items =========================
//
// Frames, banners, backgrounds (js/vex-cosmetics.js) and titles
// (js/vex-titles.js) are unlocked by what the person really did, which the
// medal system (js/vex-medals.js, VexMedals) records. This file is the one
// place that reads it, so the two catalogs stay a list of facts and nothing
// else.
//
// A rule is one of
//   { free: true }                  always owned
//   { medal: 'medal-id' }           that medal was earned
//   { level: 5 }                    the profile reached that level
//   { any: [rule, rule, ...] }      any of them
//
// What it does NOT do: take anything away. An item once unlocked stays owned
// (the id is remembered in vex.expression.owned), so a medal catalog that
// changes later never empties a profile. Nothing here nags, counts down or
// toasts; an unlock is simply there the next time the profile page is opened.
//
// Programmed against the medal event contract, not the medal catalog: the
// medal ids a catalog uses are listed in `referenced()` so they can be checked
// against VexMedals.get(id) (`unknownMedals()`).
const VexUnlock = {
  OWNED_KEY: 'vex.expression.owned',

  _medals() {
    return (typeof VexMedals !== 'undefined' && VexMedals) ? VexMedals : null;
  },

  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (err) {
      throw new Error('Could not read ' + key + ': ' + err.message, { cause: err });
    }
  },

  // Ids of medals seen awarded through the event, kept in case VexMedals is
  // not loaded in a window that still wants to show the profile.
  _seen() {
    const v = this._read('vex.expression.medals', []);
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  },

  hasMedal(id) {
    const M = this._medals();
    if (M && typeof M.has === 'function') {
      try { if (M.has(id)) return true; } catch { /* fall through to the ledger */ }
    }
    return this._seen().includes(id);
  },

  level() {
    const M = this._medals();
    if (M && typeof M.levelInfo === 'function') {
      const l = Number(M.levelInfo().level);
      if (Number.isFinite(l) && l >= 1) return l;
    }
    return 1;
  },

  check(rule) {
    if (!rule || typeof rule !== 'object') throw new Error('An unlock rule must be an object');
    if (rule.free === true) return true;
    if (typeof rule.medal === 'string') return this.hasMedal(rule.medal);
    if (Number.isInteger(rule.level)) return this.level() >= rule.level;
    if (Array.isArray(rule.any)) return rule.any.some(r => this.check(r));
    throw new Error('Unknown unlock rule: ' + JSON.stringify(rule));
  },

  // Plain words for the rule: what earns it. No pressure wording.
  describe(rule) {
    if (!rule || typeof rule !== 'object') return '';
    if (rule.free === true) return 'Yours from the start';
    if (typeof rule.medal === 'string') {
      const M = this._medals();
      let def = null;
      try { def = M && M.get ? M.get(rule.medal) : null; } catch { def = null; }
      return 'Comes with the medal ' + (def && def.title ? def.title : rule.medal);
    }
    if (Number.isInteger(rule.level)) return 'Comes with level ' + rule.level;
    if (Array.isArray(rule.any)) return rule.any.map(r => this.describe(r)).join(', or ');
    return '';
  },

  // Every medal id a list of rules names.
  referenced(rules) {
    const out = new Set();
    const walk = (r) => {
      if (!r || typeof r !== 'object') return;
      if (typeof r.medal === 'string') out.add(r.medal);
      if (Array.isArray(r.any)) r.any.forEach(walk);
    };
    (rules || []).forEach(walk);
    return [...out];
  },

  // Names a rule uses that the medal catalog does not define (empty when the
  // catalog is not loaded: nothing can be said then).
  unknownMedals(rules) {
    const M = this._medals();
    if (!M || typeof M.get !== 'function' || typeof M.list !== 'function' || !M.list().length) return [];
    return this.referenced(rules).filter(id => !M.get(id));
  },

  // The remembered set of owned ids for one kind ('frame', 'title', ...).
  ownedIds(kind) {
    const all = this._read(this.OWNED_KEY, {});
    const v = all && typeof all === 'object' ? all[kind] : null;
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  },

  // Fold the items that are unlocked right now into the remembered set and
  // answer the full owned list. `items` is [{ id, unlock }].
  settle(kind, items) {
    const all = this._read(this.OWNED_KEY, {});
    const book = all && typeof all === 'object' ? all : {};
    const had = new Set(Array.isArray(book[kind]) ? book[kind] : []);
    const known = new Set(items.map(i => i.id));
    let changed = false;
    for (const it of items) {
      if (!had.has(it.id) && this.check(it.unlock)) { had.add(it.id); changed = true; }
    }
    // An id the catalog no longer has is kept (nothing is taken away) but is
    // not reported as owned.
    if (changed) {
      book[kind] = [...had];
      try { localStorage.setItem(this.OWNED_KEY, JSON.stringify(book)); }
      catch (err) { throw new Error('Could not save what you unlocked: ' + err.message, { cause: err }); }
    }
    return [...had].filter(id => known.has(id));
  },

  _listen() {
    if (typeof document === 'undefined' || this._listening) return;
    this._listening = true;
    document.addEventListener('vex:medal-awarded', (e) => {
      const id = e && e.detail && e.detail.id;
      if (typeof id !== 'string') return;
      try {
        const seen = this._seen();
        if (!seen.includes(id)) {
          seen.push(id);
          localStorage.setItem('vex.expression.medals', JSON.stringify(seen.slice(-400)));
        }
      } catch (err) {
        console.warn('[VexUnlock] could not record the medal', id, err && err.message);
      }
    });
  },
};
VexUnlock._listen();

if (typeof window !== 'undefined') window.VexUnlock = VexUnlock;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUnlock };
