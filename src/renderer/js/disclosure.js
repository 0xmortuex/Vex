// === Progressive disclosure: "New for you", a few at a time (T3-067) =============
//
// Vex has well over a hundred features and the catalogue (js/feature-catalog.js)
// knows which ones you have never used (VexFeatures.unused(), the list behind
// Discover > New to you). Showing all of them at once is a wall; showing none
// means you never meet them. This introduces them slowly:
//
//   - at most ONE a day and THREE a week (weeks start on Monday);
//   - picked by affinity: features in the categories you already use most come
//     first, and the choice rotates week to week so the same ones do not
//     lead for ever;
//   - never one it showed in the last 90 days, never one you have used since;
//   - it goes to the Attention Inbox (VexAttention.suggest), never a toast: it
//     waits there quietly, and "Never" / "Show less" on the row work as for any
//     feature. Its button opens the feature (its Ctrl+K command) or points at it.
//
// Local only: the record (vex.disclosure) is feature ids and times.
const VexDisclosure = {
  PREF: 'vex.disclosure.enabled',
  KEY: 'vex.disclosure',
  PER_DAY: 1,
  PER_WEEK: 3,
  COOLDOWN_MS: 90 * 24 * 3600 * 1000,
  EVERY_MS: 3 * 3600 * 1000,
  FIRST_MS: 45 * 1000,
  _now() { return Date.now(); },

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save the setting: ' + err.message); }
    return !!on;
  },

  // ---- the record: { v: 1, shown: { featureId: ms } } ---------------------------------
  _read() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { throw new Error('The "New for you" record could not be read: ' + err.message); }
    if (!raw) return { v: 1, shown: {} };
    let o;
    try { o = JSON.parse(raw); }
    catch (err) { throw new Error('The "New for you" record is not readable: ' + err.message); }
    return o && typeof o === 'object' && o.v === 1 && o.shown && typeof o.shown === 'object' ? o : { v: 1, shown: {} };
  },
  _write(o) { localStorage.setItem(this.KEY, JSON.stringify(o)); },
  reset() { localStorage.removeItem(this.KEY); },

  // ---- the calendar (local time; the week starts on Monday) ----------------------------
  dayStart(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); },
  weekStart(ms) {
    const d = new Date(this.dayStart(ms));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  },
  weekNumber(ms) { return Math.floor(this.weekStart(ms) / (7 * 24 * 3600 * 1000)); },

  // How many were shown today and this week.
  counts(now = this._now()) {
    const shown = Object.values(this._read().shown);
    return { today: shown.filter(t => t >= this.dayStart(now)).length, week: shown.filter(t => t >= this.weekStart(now)).length };
  },

  _hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; },

  // ---- the choice (pure over what it is given) -------------------------------------------
  // items: unused catalogue items [{ id, cat, ... }]; usedByCat: { cat: how many you use }.
  // -> the items best first, never one still cooling down.
  rank(items, usedByCat, shown, now) {
    const week = this.weekNumber(now);
    return items
      .filter(f => !(shown[f.id] && now - shown[f.id] < this.COOLDOWN_MS))
      .map(f => ({ f, score: (usedByCat[f.cat] || 0) * 1000 + (this._hash(f.id + ':' + week) % 1000) }))
      .sort((a, b) => b.score - a.score || (a.f.id < b.f.id ? -1 : 1))
      .map(x => x.f);
  },

  // The next one to show, or null (a cap is reached, or nothing is left).
  pick(now = this._now()) {
    if (typeof VexFeatures === 'undefined') throw new Error('The feature catalogue is not loaded (js/feature-catalog.js)');
    const c = this.counts(now);
    if (c.today >= this.PER_DAY || c.week >= this.PER_WEEK) return null;
    const unused = VexFeatures.unused().filter(f => this._reachable(f));
    if (!unused.length) return null;
    const usedByCat = {};
    for (const f of VexFeatures.ITEMS) if (VexFeatures.used(f)) usedByCat[f.cat] = (usedByCat[f.cat] || 0) + 1;
    return this.rank(unused, usedByCat, this._read().shown, now)[0] || null;
  },

  // Something the person can act on: a command, a panel or a settings section.
  _reachable(f) { return !!(VexFeatures.command(f) || f.panel || f.setting); },

  // ---- showing it ---------------------------------------------------------------------------
  surface(now = this._now()) {
    if (!this.enabled()) return null;
    const f = this.pick(now);
    if (!f) return null;
    if (typeof VexAttention === 'undefined') throw new Error('The attention budget is not loaded (js/vex-attention.js)');
    const name = VexFeatures.nameOf(f);
    const added = VexAttention.suggest({
      feature: 'disclosure', label: 'New for you', id: f.id, title: 'New for you: ' + name,
      body: f.what, action: { label: 'Show me', key: 'show:' + f.id },
    });
    if (!added) return null;                      // muted or shown less: counted nowhere, tried again later
    const rec = this._read();
    rec.shown[f.id] = now;
    this._write(rec);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('progressive-disclosure');
    return f;
  },

  // The row's button.
  open(id) {
    const f = VexFeatures.get(id);
    if (!f) throw new Error('No feature "' + id + '" in the catalogue');
    if (typeof VexDiscover === 'undefined') throw new Error('Discover is not loaded');
    if (VexFeatures.command(f) || f.panel || f.setting) return VexDiscover.openFeature(id);
    return VexDiscover.showMe(id);
  },

  tick() {
    if (!this.enabled()) return null;
    if (typeof GameMode !== 'undefined' && GameMode.gaming) return null;
    return this.surface();
  },

  start() {
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('disclosure', (key) => {
        const m = /^show:(.+)$/.exec(String(key));
        if (!m) throw new Error('Unknown "New for you" action ' + key);
        return this.open(m[1]);
      });
    }
    if (this._job) return;
    if (typeof VexJobs === 'undefined') throw new Error('Progressive disclosure needs VexJobs');
    this._job = VexJobs.every('Progressive disclosure', this.EVERY_MS, () => this.tick(), { when: 'ui', deferOnBattery: true, feature: 'progressive-disclosure' });
    this._first = setTimeout(() => { try { this.tick(); } catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('New for you', 'Could not pick a feature', err); else console.error(err); } }, this.FIRST_MS);
  },
  stop() { if (this._job) { this._job.stop(); this._job = null; } clearTimeout(this._first); },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Vex introduces the features you have not tried one at a time: at most one a day and three a week, starting with the kinds you already use. They wait in the Attention Inbox; nothing pops up.'));
    const c = this.counts();
    el.appendChild(VexSettingsGroups.note('Shown so far this week: ' + c.week + ' of ' + this.PER_WEEK + '.'));
    el.appendChild(VexSettingsGroups.button('Show me one now', () => {
      try {
        const f = this.surface();
        window.showToast?.(f ? 'Added "' + VexFeatures.nameOf(f) + '" to your Attention Inbox' : 'Nothing new to show right now (the limit for today or this week is reached)', 'info');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }, { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexDisclosure = VexDisclosure;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'progressive-disclosure', title: 'New for you', keywords: 'new for you discover introduce features weekly suggestions unused', before: 'about', build: (el) => VexDisclosure.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'new-for-you', label: 'New for you', hint: 'Add one feature you have not tried to your Attention Inbox (at most one a day, three a week)', icon: 'sparkles', action: () => VexDisclosure.group(VexSettingsGroups.dialog({ id: 'vex-new-for-you', title: 'New for you', sub: '' }).body) });
  }
  if (typeof VexJobs !== 'undefined' && typeof AttentionInbox !== 'undefined') VexDisclosure.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDisclosure };
