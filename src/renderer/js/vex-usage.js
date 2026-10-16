// === Feature usage: what you actually use, and a one-click way to hide the rest ==
//
// Vex has a lot of features and every one of them shows up in Settings, the
// sidebar and the command bar. This is the registry behind the usage
// dashboard (js/vex-usage-ui.js), Minimal Vex mode (js/vex-minimal-mode.js)
// and nothing else: a feature says once that it exists, says when it is used,
// and says how it can be switched off and on again.
//
//   VexUsage.register({
//     id: 'brief',                  // stable id, one per feature
//     title: 'Morning brief',       // what the person sees
//     group: 'Morning brief',       // the start of its Settings section heading
//                                   //   (hidden with it when it is switched off)
//     keys: ['brief'],              // ids in VexFeatures (feature-catalog.js):
//                                   //   what the command bar / sidebar already
//                                   //   know about its use counts too
//     isEnabled() { ... },          // optional but strongly advised: the truth
//     disable() { ... },            // idempotent; may return a promise
//     enable()  { ... },            // idempotent; may return a promise
//   });
//   VexUsage.touch('brief');        // call where the feature is really used
//
// Registration is by the feature itself, never by a list kept here: a module
// that is not in this build simply never registers. A module that loads before
// this file may push its registration on window.__vexUsageQueue; it is drained
// when this file loads.
//
// Local only. Nothing here is sent anywhere, synced or put in a report; the
// record is one preference (vex.featureUsage) holding ids and dates.
const VexUsage = {
  KEY: 'vex.featureUsage',
  WINDOW_DAYS: 30,
  DAY_MS: 24 * 60 * 60 * 1000,
  SAVE_DELAY_MS: 2000,

  _features: new Map(),
  _state: null,
  _saveTimer: null,
  _listeners: [],
  _registerHooks: [],
  _forcedHidden: new Set(),
  _now() { return Date.now(); },

  // ---- the record ----------------------------------------------------------
  // { v: 1, since, features: { id: { first, last, n } }, seen: { id: ms }, off: { id: ms } }
  //   since   - when this device began keeping the record (the 30 days start here)
  //   features- real uses reported with touch()
  //   seen    - when a feature first registered here (a new feature is not "unused")
  //   off     - features the person switched off from the dashboard
  _load() {
    if (this._state) return this._state;
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { console.error('[Usage] the usage record could not be read:', err.message); }
    let state = null;
    if (raw) {
      try { state = JSON.parse(raw); }
      catch (err) { console.error('[Usage] the usage record is not readable and is started again:', err.message); }
    }
    const ok = state && typeof state === 'object' && !Array.isArray(state) && state.v === 1;
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    this._state = {
      v: 1,
      since: ok && Number.isFinite(state.since) ? state.since : this._now(),
      features: ok ? obj(state.features) : {},
      seen: ok ? obj(state.seen) : {},
      off: ok ? obj(state.off) : {},
    };
    if (!ok) this._save();
    return this._state;
  },

  _save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    if (!this._state) return;
    try { localStorage.setItem(this.KEY, JSON.stringify(this._state)); }
    catch (err) { console.error('[Usage] the usage record could not be saved:', err.message); }
  },
  _saveSoon() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => this._save(), this.SAVE_DELAY_MS);
  },
  flush() { if (this._saveTimer) this._save(); },

  // Forget everything and start counting the 30 days again.
  reset() {
    this._state = null;
    try { localStorage.removeItem(this.KEY); }
    catch (err) { console.error('[Usage] the usage record could not be cleared:', err.message); }
    this._load();
    this._emit();
  },

  // ---- registration ----------------------------------------------------------
  register(spec) {
    if (!spec || typeof spec !== 'object') throw new Error('A feature has to be described by an object');
    const id = String(spec.id || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(id)) throw new Error('A feature id is 1-64 letters, digits, . _ : or -');
    if (typeof spec.disable !== 'function' || typeof spec.enable !== 'function') throw new Error('Feature "' + id + '" has to give disable() and enable()');
    if (spec.isEnabled != null && typeof spec.isEnabled !== 'function') throw new Error('isEnabled of feature "' + id + '" has to be a function');
    const feature = {
      id,
      title: String(spec.title || id),
      group: spec.group ? String(spec.group) : '',
      keys: Array.isArray(spec.keys) ? spec.keys.map(String) : [],
      disable: spec.disable,
      enable: spec.enable,
      isEnabled: spec.isEnabled || null,
    };
    const state = this._load();
    this._features.set(id, feature);
    if (!state.seen[id]) { state.seen[id] = this._now(); this._saveSoon(); }
    for (const hook of this._registerHooks.slice()) {
      try { hook(feature); }
      catch (err) { console.error('[Usage] a registration hook failed for "' + id + '":', err); }
    }
    // A feature the person switched off from the dashboard stays off across
    // restarts: the module's own start-up may have turned it on again.
    // Without isEnabled() the module's own state cannot be read, so disable() is
    // asked again (it is idempotent by contract).
    if (state.off[id] && !this._forcedHidden.has(id) && (!feature.isEnabled || this._isOn(feature))) {
      Promise.resolve().then(() => feature.disable()).catch(err => console.error('[Usage] could not keep "' + id + '" switched off:', err));
    }
    this.applyGroups();
    this._emit();
    return feature;
  },

  unregister(id) {
    const had = this._features.delete(id);
    if (had) { this.applyGroups(); this._emit(); }
    return had;
  },

  // Called with each feature as it registers (Minimal mode uses this to take a
  // feature that arrives late out of play too).
  onRegister(fn) { this._registerHooks.push(fn); },
  onChange(fn) { this._listeners.push(fn); },
  _emit() {
    for (const fn of this._listeners.slice()) {
      try { fn(); } catch (err) { console.error('[Usage] a listener failed:', err); }
    }
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('vex-usage-changed'));
  },

  get(id) { return this._features.get(id) || null; },
  features() { return Array.from(this._features.values()); },

  // ---- use ----------------------------------------------------------------
  // Cheap enough to call on every use; written out a moment later.
  touch(id) {
    if (!this._features.has(id)) return false;
    const state = this._load();
    const t = this._now();
    const rec = state.features[id] || (state.features[id] = { first: t, last: t, n: 0 });
    rec.last = t;
    rec.n += 1;
    this._saveSoon();
    if (typeof VexUsageCounters !== 'undefined') VexUsageCounters.note(id, 'opened');   // js/usage-counters.js: local counts
    if (rec.n === 1 && typeof VexFeatureSheet !== 'undefined') VexFeatureSheet.firstUse(id);   // js/feature-sheet.js: what a new feature touches
    return true;
  },

  // ---- state ------------------------------------------------------------------
  // Is the feature on? Its own answer when it gives one; otherwise "on unless
  // the person switched it off here".
  _isOn(feature) {
    // Held off by Minimal mode (js/vex-minimal-mode.js).
    if (this._forcedHidden.has(feature.id)) return false;
    if (feature.isEnabled) {
      try { return !!feature.isEnabled(); }
      catch (err) { console.error('[Usage] isEnabled of "' + feature.id + '" failed:', err); }
    }
    return !this._load().off[feature.id];
  },
  isEnabled(id) {
    const f = this._features.get(id);
    if (!f) throw new Error('Unknown feature: ' + id);
    return this._isOn(f);
  },

  // The catalogue's own record (command bar counts, panel timestamps).
  _catalogUsed(feature) {
    if (typeof VexFeatures === 'undefined' || typeof VexFeatures.get !== 'function' || typeof VexFeatures.used !== 'function') return false;
    return feature.keys.some(k => { const item = VexFeatures.get(k); return !!item && VexFeatures.used(item); });
  },

  // One row per registered feature.
  //   status: 'used'    touched in the last 30 days, or the catalogue has a record of use
  //           'unused'  registered here for 30+ days with no use
  //           'new'     registered less than 30 days ago: too early to say
  //           'off'     switched off (by the person, or by Minimal mode)
  list() {
    const state = this._load();
    const now = this._now();
    const win = this.WINDOW_DAYS * this.DAY_MS;
    return this.features().map(f => {
      const rec = state.features[f.id] || null;
      const on = this._isOn(f);
      const touchedRecently = !!rec && now - rec.last <= win;
      const catalog = this._catalogUsed(f);
      const age = now - (state.seen[f.id] || now);
      let status;
      if (!on) status = 'off';
      else if (touchedRecently || catalog) status = 'used';
      else if (age >= win) status = 'unused';
      else status = 'new';
      return {
        id: f.id, title: f.title, group: f.group, status, on,
        uses: rec ? rec.n : 0,
        lastUsed: rec ? rec.last : 0,
        catalogUsed: catalog,
        daysSeen: Math.floor(age / this.DAY_MS),
        hidden: this._hiddenIds().has(f.id),
      };
    });
  },

  // The report the dashboard shows. `ready` is false for the first 30 days
  // this device has kept the record: it says so rather than guess.
  report() {
    const state = this._load();
    const now = this._now();
    const elapsed = now - state.since;
    const rows = this.list();
    return {
      since: state.since,
      days: Math.floor(elapsed / this.DAY_MS),
      daysLeft: Math.max(0, Math.ceil((this.WINDOW_DAYS * this.DAY_MS - elapsed) / this.DAY_MS)),
      ready: elapsed >= this.WINDOW_DAYS * this.DAY_MS,
      used: rows.filter(r => r.status === 'used'),
      unused: rows.filter(r => r.status === 'unused'),
      fresh: rows.filter(r => r.status === 'new'),
      off: rows.filter(r => r.status === 'off'),
    };
  },

  // ---- one-click off / on ---------------------------------------------------------
  async disable(id) {
    const f = this._features.get(id);
    if (!f) throw new Error('Unknown feature: ' + id);
    await f.disable();
    const state = this._load();
    state.off[id] = this._now();
    this._save();
    this.applyGroups();
    this._emit();
  },
  async enable(id) {
    const f = this._features.get(id);
    if (!f) throw new Error('Unknown feature: ' + id);
    await f.enable();
    const state = this._load();
    delete state.off[id];
    this._save();
    this.applyGroups();
    this._emit();
  },

  // ---- the Settings sections a switched-off feature takes away -----------------
  // Ids hidden for another reason (Minimal mode) are added here by that module.
  setForcedHidden(ids) {
    this._forcedHidden = new Set(ids);
    this.applyGroups();
  },
  _hiddenIds() {
    const out = new Set(this._forcedHidden);
    const off = this._load().off;
    for (const f of this._features.values()) if (off[f.id] && !(f.isEnabled && this._isOn(f))) out.add(f.id);
    return out;
  },
  _heading(group) {
    const label = group.querySelector(':scope > .setting-label') || group.querySelector('.setting-label, h3, h2');
    return label ? String(label.textContent || '').trim().toLowerCase() : '';
  },
  // Hides every Settings section whose heading starts with the `group` of a
  // hidden feature, and shows the ones that are no longer hidden. A section
  // that is shown again is exactly as it was: only a class comes and goes.
  applyGroups(root) {
    if (typeof document === 'undefined') return;
    const scope = root || document.querySelector('#panel-settings .settings-content');
    if (!scope) return;
    const hidden = this._hiddenIds();
    const wanted = [];
    for (const id of hidden) {
      const f = this._features.get(id);
      if (f && f.group) wanted.push(f.group.toLowerCase());
    }
    scope.querySelectorAll('.setting-group').forEach(g => {
      const heading = this._heading(g);
      const hide = !!heading && wanted.some(w => heading.startsWith(w));
      g.classList.toggle('vex-usage-hidden', hide);
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexUsage = VexUsage;
  const queued = Array.isArray(window.__vexUsageQueue) ? window.__vexUsageQueue : [];
  window.__vexUsageQueue = { push(spec) { VexUsage.register(spec); return 0; } };
  for (const spec of queued) {
    try { VexUsage.register(spec); }
    catch (err) { console.error('[Usage] a queued feature could not be registered:', err.message); }
  }
  window.addEventListener('pagehide', () => VexUsage.flush());
  window.addEventListener('beforeunload', () => VexUsage.flush());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUsage };
