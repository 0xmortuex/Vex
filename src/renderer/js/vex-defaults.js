// === Versioned consent, defaults that know who chose them, run-once migrations ===
//
// Three small rules that every setting in Vex should follow, kept in one place so
// that no feature has to invent them again (T0-017):
//
//   VexMigrations.migrateOnce(id, fn)
//       A change to what is already saved on a profile runs ONCE. The ids that
//       have run are kept in a list (vex.migrations.ran). A migration that throws
//       is not marked as run, and the error is raised, not swallowed.
//
//   VexDefaults  { value, explicit }
//       A new default must never override a saved choice. A value is either a
//       default (explicit:false: Vex picked it, a later release may change it) or
//       a choice (explicit:true: the person made it, it is never touched again).
//       setDefault() writes nothing over a choice; set() always records a choice.
//
//   VexConsent  { version, state }
//       A consent is tied to the version of the feature's data use it was given
//       for. When a feature changes what it reads or sends it bumps its version
//       and the old answer is 'stale': the person is asked ONCE more, and the new
//       answer is stored with the new version. A "no" is remembered for the
//       version it was said for, so a declined feature is not asked again.
//
// Storage is localStorage on this device and nothing here leaves it.

function _vxStore() {
  if (typeof localStorage === 'undefined') throw new Error('Saved settings are not available here');
  return localStorage;
}

function _vxReadJson(key, fallback) {
  const raw = _vxStore().getItem(key);
  if (raw === null) return fallback;
  let v;
  try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved value "' + key + '" is not readable', { cause: err }); }
  return v == null ? fallback : v;
}

const VexMigrations = {
  KEY: 'vex.migrations.ran',
  MAX: 500,
  _defs: new Map(),

  ran() {
    const v = _vxReadJson(this.KEY, []);
    if (!Array.isArray(v)) throw new Error('The migration list is not a list');
    return v.filter(x => typeof x === 'string');
  },
  hasRun(id) { return this.ran().includes(id); },

  // A migration registered here is run by runAll() at start-up.
  register(id, fn) {
    if (!/^[a-z][a-z0-9.-]{2,80}$/.test(String(id || ''))) throw new Error('A migration needs an id of lowercase letters, digits, dots and dashes');
    if (typeof fn !== 'function') throw new Error('Migration "' + id + '" needs a function');
    this._defs.set(id, fn);
    return id;
  },

  // Runs fn (or the registered one) unless id is in the ran-list.
  // -> { ran: boolean, result }
  migrateOnce(id, fn) {
    const run = fn || this._defs.get(id);
    if (typeof run !== 'function') throw new Error('No migration is registered as "' + id + '"');
    const ran = this.ran();
    if (ran.includes(id)) return { ran: false, result: undefined };
    const result = run();
    ran.push(id);
    while (ran.length > this.MAX) ran.shift();
    _vxStore().setItem(this.KEY, JSON.stringify(ran));
    return { ran: true, result };
  },

  // Every registered migration, in registration order. All are tried; if any
  // threw, ONE error that lists them is raised after the rest have run.
  runAll() {
    const done = [];
    const failed = [];
    for (const id of this._defs.keys()) {
      try { if (this.migrateOnce(id).ran) done.push(id); } catch (err) { failed.push(id + ': ' + ((err && err.message) || err)); }
    }
    if (failed.length) throw new Error('Settings migration failed: ' + failed.join('; '));
    return done;
  },
};

const VexDefaults = {
  KEY: 'vex.defaults',

  _all() {
    const v = _vxReadJson(this.KEY, {});
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('The saved defaults are not in a form Vex knows');
    return v;
  },
  _save(all) { _vxStore().setItem(this.KEY, JSON.stringify(all)); },
  _check(key) { if (!/^[a-z][A-Za-z0-9.-]{0,63}$/.test(String(key || ''))) throw new Error('A setting needs a short name made of letters, digits, dots and dashes'); },

  entry(key) {
    this._check(key);
    const e = this._all()[key];
    return e && typeof e === 'object' && 'value' in e ? { value: e.value, explicit: e.explicit === true } : null;
  },
  get(key, fallback) { const e = this.entry(key); return e ? e.value : fallback; },
  isExplicit(key) { const e = this.entry(key); return !!(e && e.explicit); },

  // Vex's own pick. A choice the person made is left exactly as it is.
  setDefault(key, value) {
    this._check(key);
    const all = this._all();
    const e = all[key];
    if (e && e.explicit === true) return false;
    if (e && JSON.stringify(e.value) === JSON.stringify(value)) return false;
    all[key] = { value, explicit: false };
    this._save(all);
    return true;
  },
  // The person's choice.
  set(key, value) {
    this._check(key);
    const all = this._all();
    all[key] = { value, explicit: true };
    this._save(all);
    return value;
  },
  // Back to Vex's default: the choice is forgotten.
  reset(key) {
    this._check(key);
    const all = this._all();
    if (!(key in all)) return false;
    delete all[key];
    this._save(all);
    return true;
  },
};

const VexConsent = {
  KEY: 'vex.consents',
  _defs: new Map(),

  // A feature says which version of its data use is current.
  register(id, { version, label } = {}) {
    if (!/^[a-z][a-z0-9.-]{1,63}$/.test(String(id || ''))) throw new Error('A consent needs an id of lowercase letters, digits, dots and dashes');
    if (!Number.isInteger(version) || version < 1) throw new Error('Consent "' + id + '" needs a version number of 1 or more');
    this._defs.set(id, { version, label: String(label || id) });
    return id;
  },
  version(id) {
    const d = this._defs.get(id);
    if (!d) throw new Error('Consent "' + id + '" is not registered');
    return d.version;
  },
  _all() {
    const v = _vxReadJson(this.KEY, {});
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('The saved consents are not in a form Vex knows');
    return v;
  },

  // 'unasked' | 'granted' | 'declined' | 'stale'
  // stale: it was answered for an older version of what the feature does.
  status(id) {
    const current = this.version(id);
    const e = this._all()[id];
    if (!e || (e.state !== 'granted' && e.state !== 'declined')) return 'unasked';
    if (!(e.version >= current)) return 'stale';
    return e.state;
  },
  granted(id) { return this.status(id) === 'granted'; },
  // Should the person be asked now? Never, for a version they already answered.
  needsAsk(id) { const s = this.status(id); return s === 'unasked' || s === 'stale'; },

  record(id, state) {
    if (state !== 'granted' && state !== 'declined') throw new Error('A consent is granted or declined');
    const version = this.version(id);
    const all = this._all();
    all[id] = { version, state, at: Date.now() };
    _vxStore().setItem(this.KEY, JSON.stringify(all));
    try { document.dispatchEvent(new CustomEvent('vex:consent', { detail: { id, state, version } })); } catch { /* vex-allow-empty-catch: no document: a test */ }
    return state;
  },
  revoke(id) {
    const all = this._all();
    if (!(id in all)) return false;
    delete all[id];
    _vxStore().setItem(this.KEY, JSON.stringify(all));
    return true;
  },

  // Seeds a consent from a choice the person made BEFORE consents were versioned,
  // as version 1. Never overwrites an answer.
  adopt(id, state) {
    if (this._all()[id]) return false;
    const version = this.version(id);
    const all = this._all();
    all[id] = { version: Math.min(1, version), state, at: Date.now(), adopted: true };
    _vxStore().setItem(this.KEY, JSON.stringify(all));
    return true;
  },

  // Asks with a confirm dialog when (and only when) an answer is needed.
  // -> true when the feature may use the data after this call.
  async ask(id, { title, message, yes = 'Allow', no = 'Not now' } = {}) {
    if (!this.needsAsk(id)) return this.granted(id);
    if (typeof window === 'undefined' || typeof window.vexConfirm !== 'function') throw new Error('Cannot ask for consent: the dialog is not available');
    const ok = await window.vexConfirm({ title: title || this._defs.get(id).label, message, okLabel: yes, cancelLabel: no });
    this.record(id, ok ? 'granted' : 'declined');
    return !!ok;
  },
};

if (typeof window !== 'undefined') {
  window.VexMigrations = VexMigrations;
  window.VexDefaults = VexDefaults;
  window.VexConsent = VexConsent;
  // "Settings.migrateOnce(id)": the Settings module carries the entry point.
  if (typeof SettingsUI !== 'undefined' && !SettingsUI.migrateOnce) SettingsUI.migrateOnce = (id, fn) => VexMigrations.migrateOnce(id, fn);
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMigrations, VexDefaults, VexConsent };
