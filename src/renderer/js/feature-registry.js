// === One manifest per feature ================================================
//
// Settings, Discover, Ctrl+K, the cost meter, the kill switch, the diagnostics
// and the "what does this feature touch" summary all used to find out what a
// feature IS by reading different places: the VexUsage registration (how to
// switch it), the catalogue (what it is for), the module itself (its storage
// keys, jobs and commands). This file is the one description they read.
//
//   VexRegistry.define({
//     id: 'tab-cleanup',            // the same id the feature registers with VexUsage
//     title: 'Evening tab cleanup', group: 'Tab cleanup',   // as VexUsage.register
//     maturity: 'stable',           // 'new' | 'beta' | 'experimental' | 'stable'  (see stage())
//     storageKeys: ['vex.tabCleanup.mode', ...],  // localStorage keys this feature OWNS: one owner per key
//     usesKeys: ['vex.notes'],      // keys it reads/writes but another feature owns
//     settingsKeys: [...], events: [...], jobs: ['Tab cleanup'], commands: ['tab-cleanup'], panels: [...],
//     permissions: { reads: [...], writes: [...], sends: [...] },   // plain words; shown to the person
//     budget: { jobMsPerMin: 150, fetchesPerHour: 60, gameFetches: 0, domNodes: 1500, storageKB: 512 },
//     tiers: { minimal: false, standard: true },   // the default in each tier
//     killSwitch: 'usage',          // 'usage' = VexUsage's disable()/enable(); 'none' = cannot be switched
//   });
//
// The switch itself (isEnabled/disable/enable) stays where it is: VexUsage keeps
// the runtime, this keeps the description. A feature registered with VexUsage
// that has no manifest is a test failure (tests/renderer/featureRegistry.test.js),
// and so is a vex.* storage key that nobody owns or two features both own.
const VexRegistry = {
  // 'experimental' is a tier of its own: off on EVERY profile (a brand-new one too), never offered, never
  // counted against the nudge budget, never carried by Vex Sync; only the person switching it on in Settings
  // starts it. 'new' and 'beta' are off on a profile that already existed and offered once the safety window passes.
  MATURITY: ['new', 'beta', 'experimental', 'stable'],
  // How long a staged feature waits, crash-free, before Vex offers to switch it on.
  SAFETY_WINDOW_MS: 7 * 24 * 3600 * 1000,
  TIERS: ['minimal', 'standard'],
  KINDS: ['storage', 'settings', 'events', 'jobs', 'commands', 'panels'],
  STATE_KEY: 'vex.registry',
  // What a feature may cost unless its manifest says otherwise. gameFetches 0:
  // no background request while a game has the screen.
  DEFAULT_BUDGET: { jobMsPerMin: 150, fetchesPerHour: 60, gameFetches: 0, domNodes: 1500, storageKB: 512 },

  _m: new Map(),
  _owner: new Map(),     // storage key (or 'prefix.') -> feature id
  _jobOwner: new Map(),
  _cmdOwner: new Map(),
  _state: null,

  // ---- defining ------------------------------------------------------------
  define(spec) {
    if (!spec || typeof spec !== 'object') throw new Error('A feature manifest has to be an object');
    const id = String(spec.id || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(id)) throw new Error('A feature id is 1-64 letters, digits, . _ : or -');
    if (this._m.has(id)) throw new Error('Feature "' + id + '" already has a manifest');
    const maturity = spec.maturity == null ? 'stable' : spec.maturity;
    if (!this.MATURITY.includes(maturity)) throw new Error('Feature "' + id + '": maturity is new, beta, experimental or stable, not ' + maturity);
    const killSwitch = spec.killSwitch == null ? 'usage' : spec.killSwitch;
    if (killSwitch !== 'usage' && killSwitch !== 'none') throw new Error('Feature "' + id + '": killSwitch is usage or none');
    const list = (name) => {
      const v = spec[name] == null ? [] : spec[name];
      if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !x)) throw new Error('Feature "' + id + '": ' + name + ' has to be a list of non-empty strings');
      return v.slice();
    };
    const storageKeys = list('storageKeys');
    for (const k of storageKeys) if (!/^vex\.[A-Za-z0-9_.:-]+$/.test(k)) throw new Error('Feature "' + id + '": "' + k + '" is not a vex.* storage key');
    const usesKeys = list('usesKeys');
    for (const k of usesKeys) if (!/^vex\.[A-Za-z0-9_.:-]+$/.test(k)) throw new Error('Feature "' + id + '": "' + k + '" is not a vex.* storage key');
    const perm = spec.permissions == null ? {} : spec.permissions;
    if (typeof perm !== 'object' || Array.isArray(perm)) throw new Error('Feature "' + id + '": permissions has to be { reads, writes, sends }');
    const permissions = {};
    for (const p of ['reads', 'writes', 'sends']) {
      const v = perm[p] == null ? [] : perm[p];
      if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !x)) throw new Error('Feature "' + id + '": permissions.' + p + ' has to be a list of strings');
      permissions[p] = v.slice();
    }
    const budget = { ...this.DEFAULT_BUDGET };
    for (const [k, v] of Object.entries(spec.budget || {})) {
      if (!(k in this.DEFAULT_BUDGET)) throw new Error('Feature "' + id + '": unknown budget item ' + k);
      if (!(typeof v === 'number' && v >= 0 && Number.isFinite(v))) throw new Error('Feature "' + id + '": budget ' + k + ' has to be a number of zero or more');
      budget[k] = v;
    }
    // What a profile that already existed gets for a new or beta feature: 'off' (held back, then offered) unless
    // the manifest says 'on' (a passive feature, named on purpose; there are none by default).
    const existingProfileDefault = spec.existingProfileDefault == null ? 'off' : spec.existingProfileDefault;
    if (existingProfileDefault !== 'off' && existingProfileDefault !== 'on') throw new Error('Feature "' + id + '": existingProfileDefault is off or on');
    const tiers = { minimal: false, standard: true, ...(spec.tiers || {}) };
    for (const t of Object.keys(tiers)) if (!this.TIERS.includes(t) || typeof tiers[t] !== 'boolean') throw new Error('Feature "' + id + '": tiers are minimal and standard, each true or false');
    const m = Object.freeze({
      id,
      title: String(spec.title || id),
      group: spec.group ? String(spec.group) : '',
      maturity, killSwitch, existingProfileDefault,
      storageKeys, usesKeys,
      settingsKeys: list('settingsKeys'), events: list('events'), jobs: list('jobs'), commands: list('commands'), panels: list('panels'),
      permissions: Object.freeze(permissions), budget: Object.freeze(budget), tiers: Object.freeze(tiers),
      catalog: spec.catalog ? String(spec.catalog) : '',     // the id in VexFeatures (feature-catalog.js), when different
    });
    // All claims are checked before any is recorded: a refused manifest leaves no half of itself behind.
    for (const k of storageKeys) {
      const other = this._ownerOf(k);
      if (other) throw new Error('Storage key "' + k + '" is claimed by "' + other + '" and by "' + id + '": one owner per key');
    }
    for (const j of m.jobs) if (this._jobOwner.has(j)) throw new Error('Job "' + j + '" belongs to "' + this._jobOwner.get(j) + '" and to "' + id + '"');
    for (const c of m.commands) if (this._cmdOwner.has(c)) throw new Error('Command "' + c + '" belongs to "' + this._cmdOwner.get(c) + '" and to "' + id + '"');
    this._m.set(id, m);
    for (const k of storageKeys) this._owner.set(k, id);
    for (const j of m.jobs) this._jobOwner.set(j, id);
    for (const c of m.commands) this._cmdOwner.set(c, id);
    return m;
  },

  defineAll(list) { return list.map(spec => this.define(spec)); },

  // ---- reading --------------------------------------------------------------
  get(id) { return this._m.get(id) || null; },
  has(id) { return this._m.has(id); },
  all() { return Array.from(this._m.values()); },
  ids() { return Array.from(this._m.keys()); },

  // Who owns this storage key: the exact key, else the prefix claim ("vex.x." owns "vex.x.anything").
  _ownerOf(key) {
    if (this._owner.has(key)) return this._owner.get(key);
    for (const [claim, id] of this._owner) {
      if (claim.endsWith('.') && key.startsWith(claim)) return id;
      if (key.endsWith('.') && claim.startsWith(key)) return id;
    }
    return '';
  },
  ownerOfKey(key) { return this._ownerOf(String(key)) || null; },
  claimedKeys() { return Array.from(this._owner.keys()).sort(); },
  forJob(name) { return this._jobOwner.get(name) || null; },
  forCommand(cmdId) { return this._cmdOwner.get(cmdId) || null; },

  // What each tier turns on by default.
  tierDefault(id, tier) {
    const m = this._need(id);
    if (!this.TIERS.includes(tier)) throw new Error('Unknown tier: ' + tier);
    return m.tiers[tier];
  },
  budget(id) { return this._need(id).budget; },
  _need(id) {
    const m = this._m.get(id);
    if (!m) throw new Error('No manifest for feature: ' + id);
    return m;
  },

  // "New" / "Beta" beside a feature's name; nothing for a stable one.
  maturityLabel(id) {
    const m = this._need(id);
    return m.maturity === 'stable' ? '' : (m.maturity === 'new' ? 'New' : (m.maturity === 'experimental' ? 'Experimental' : 'Beta'));
  },
  // Beta, new and experimental features are not carried to other devices until they are stable.
  syncEligible(id) { return this._need(id).maturity === 'stable'; },
  // Keys Vex Sync must neither push nor pull right now (js/sync-engine.js preferenceKeys): the data of an
  // experimental feature, and of a staged feature that is still switched off. A pull that carried another
  // device's "on" would otherwise switch on a feature this profile never chose, past the staging.
  syncHeld(key) {
    const id = this._ownerOf(String(key));
    const m = id ? this._m.get(id) : null;
    if (!m) return false;
    if (m.maturity === 'experimental') return true;
    if (m.maturity === 'stable') return false;
    const rec = this._load().staged[m.id];
    if (!rec || rec.off !== true) return false;
    const u = this._usage();
    return !(u && u.get(m.id) && u.isEnabled(m.id));
  },

  // One sentence per kind of access, for the permission sheet (feature-details.js).
  permissionLines(id) {
    const p = this._need(id).permissions;
    const out = [];
    if (p.reads.length) out.push('Reads: ' + p.reads.join(', '));
    if (p.writes.length) out.push('Writes: ' + p.writes.join(', '));
    out.push(p.sends.length ? 'Sends off this computer: ' + p.sends.join(', ') : 'Sends nothing off this computer');
    return out;
  },

  // ---- the runtime side (joined with VexUsage and VexBreaker) -----------------
  _usage() { return typeof VexUsage !== 'undefined' ? VexUsage : null; },
  _breaker() { return typeof VexBreaker !== 'undefined' ? VexBreaker : null; },

  // The switch-off that Ctrl+K "Stop doing this", the breaker and the
  // diagnostics all go through, so there is one way a feature is turned off.
  async switchOff(id) {
    const m = this._need(id);
    if (m.killSwitch === 'none') throw new Error('"' + m.title + '" cannot be switched off');
    const u = this._usage();
    if (!u || !u.get(id)) throw new Error('"' + m.title + '" is not running in this build, so there is nothing to switch off');
    await u.disable(id);
  },
  async switchOn(id) {
    const m = this._need(id);
    if (m.killSwitch === 'none') throw new Error('"' + m.title + '" has no switch');
    const u = this._usage();
    if (!u || !u.get(id)) throw new Error('"' + m.title + '" is not running in this build');
    await u.enable(id);
  },

  // Everything the diagnostics bundle and the problem report want to know about
  // each feature, as plain data.
  diagnostics() {
    const u = this._usage();
    const b = this._breaker();
    return this.all().map(m => {
      const live = u ? u.get(m.id) : null;
      let on = null;
      if (live) { try { on = u.isEnabled(m.id); } catch (err) { on = null; console.error('[Registry] could not read the switch of "' + m.id + '":', err.message); } }
      return {
        id: m.id, title: m.title, maturity: m.maturity, running: !!live, on,
        tripped: b ? b.isTripped(m.id) : false,
        keys: m.storageKeys.length, jobs: m.jobs.length, commands: m.commands.length,
      };
    });
  },

  // ---- maturity and staged enablement (T0-029) ---------------------------------
  // A feature whose manifest says 'new' or 'beta' arrives OFF on a profile that
  // already existed, and the person is offered it ("try it") instead of finding
  // it on. A brand-new profile keeps the feature's own default. Decided once per
  // feature: the record (vex.registry) remembers it, so a feature the person
  // later switches on is never switched off again.
  _load() {
    if (this._state) return this._state;
    let raw = null;
    try { raw = localStorage.getItem(this.STATE_KEY); }
    catch (err) { console.error('[Registry] the staging record could not be read:', err.message); }
    let st = null;
    if (raw) { try { st = JSON.parse(raw); } catch (err) { console.error('[Registry] the staging record is not readable and is started again:', err.message); } }
    const ok = st && typeof st === 'object' && !Array.isArray(st) && st.v === 1;
    this._state = {
      v: 1,
      staged: ok && st.staged && typeof st.staged === 'object' ? st.staged : {},
      offered: ok && st.offered && typeof st.offered === 'object' ? st.offered : {},
      safeOffered: ok && st.safeOffered && typeof st.safeOffered === 'object' ? st.safeOffered : {},
      // Decided ONCE, by the first stage() this profile ever runs: { at, kind: 'new' | 'existing' }.
      profile: ok && st.profile && typeof st.profile === 'object' && (st.profile.kind === 'new' || st.profile.kind === 'existing') ? st.profile : null,
      // When "try it" offers were made (the last week only), for the weekly limit.
      offerLog: ok && Array.isArray(st.offerLog) ? st.offerLog.filter(Number.isFinite) : [],
    };
    return this._state;
  },
  _save() {
    try { localStorage.setItem(this.STATE_KEY, JSON.stringify(this._state)); }
    catch (err) { console.error('[Registry] the staging record could not be saved:', err.message); }
  },

  // Data a profile has before the usage record could possibly say so. The usage record (js/vex-usage.js)
  // did not exist in older releases, so on an upgrade its "since" is today and says nothing about the
  // profile's age: evidence comes from what the person has saved. Any one of these is enough. A storage
  // that cannot be read is an error, not "a new profile".
  PROFILE_EVIDENCE: ['vex.hasRunBefore', 'vex.onboardingDone', 'vex.legalAcceptedVersion', 'vex.tabs', 'vex.sessions', 'vex.bookmarks', 'vex.history', 'vex.notes', 'vex.theme', 'vex.userName', 'vex.aiWorkerUrl', 'vex.githubUsername', 'vex.weatherLoc', 'vex.personas'],
  hasProfileEvidence() {
    if (typeof localStorage === 'undefined') throw new Error('Saved settings are not available, so a new profile cannot be told from an old one');
    return this.PROFILE_EVIDENCE.some(k => localStorage.getItem(k) != null);
  },

  // Returns the ids switched off for this profile this time.
  // Who is "existing" (decided once and kept in vex.registry):
  //   - the FIRST stage() a profile runs: it is existing when it already holds saved data (hasProfileEvidence);
  //     `existing` may be passed to force it (tests);
  //   - every later stage(): a feature not seen before arrived after the profile did, so the profile
  //     is existing for it.
  // A new or beta feature is switched off on an existing profile unless its manifest says
  // existingProfileDefault: 'on'. A brand-new profile keeps each module's own default.
  async stage({ existing, now = Date.now() } = {}) {
    const u = this._usage();
    const st = this._load();
    const first = !st.profile;
    let isExisting = existing;
    if (isExisting == null) isExisting = first ? this.hasProfileEvidence() : true;
    if (first) st.profile = { at: now, kind: isExisting ? 'existing' : 'new' };
    const heldOff = [];
    for (const m of this.all()) {
      if (m.maturity === 'stable' || st.staged[m.id]) continue;
      const live = u ? u.get(m.id) : null;
      st.staged[m.id] = { at: now, off: false };
      // Experimental: off on every profile; new or beta: off on an existing one. Either waits for the person.
      const hold = m.maturity === 'experimental' || (isExisting && m.existingProfileDefault !== 'on');
      if (hold && live && m.killSwitch === 'usage' && u.isEnabled(m.id)) {
        await u.disable(m.id);
        st.staged[m.id].off = true;
        // A new or beta feature is offered for switching on once it has waited out the safety window without a crash.
        if (m.maturity !== 'experimental') st.staged[m.id].enabledAfter = now + this.SAFETY_WINDOW_MS;
        heldOff.push(m.id);
      }
    }
    this._save();
    return heldOff;
  },

  // Staged-off features not yet offered ("try it"): to whatever subscribed with
  // onOffer() (the attention inbox), otherwise one gated toast.
  pendingOffers() {
    const st = this._load();
    return Object.keys(st.staged).filter(id => st.staged[id].off && !st.offered[id] && this._m.has(id) && this._m.get(id).maturity !== 'experimental');
  },
  // Staged-off features that have now waited out the safety window with no crash since they were staged, and
  // were not already offered this way. `crashes` is the crash log (each { at }), at least the last window long.
  // Pure: nothing is switched on, nothing is shown.
  safeWindowOffers(crashes, now = Date.now()) {
    if (!Array.isArray(crashes)) throw new Error('safeWindowOffers needs the crash list');
    const st = this._load();
    const u = this._usage();
    const out = [];
    for (const id of Object.keys(st.staged)) {
      const rec = st.staged[id], m = this._m.get(id);
      if (!m || !rec.off || m.maturity === 'experimental' || st.safeOffered[id]) continue;
      const after = Number.isFinite(rec.enabledAfter) ? rec.enabledAfter : rec.at + this.SAFETY_WINDOW_MS;
      if (now < after) continue;
      if (u && u.get(id) && u.isEnabled(id)) continue;                   // the person already turned it on
      if (crashes.some(c => c && Number.isFinite(c.at) && c.at >= rec.at)) continue;   // a crash since it was staged: keep waiting
      out.push(id);
    }
    return out;
  },
  // The second, calmer offer: "waited N days, no crash since". It is an offer, never a switch-on: the person
  // presses the button. Counts against the same three-a-week nudge budget as every other offer.
  offerSafe(crashes, now = Date.now()) {
    const st = this._load();
    st.offerLog = st.offerLog.filter(t => now - t < 7 * 24 * 3600 * 1000);
    let n = 0;
    for (const id of this.safeWindowOffers(crashes, now)) {
      if (this.nudgeRoom(now) <= 0) break;
      const m = this._m.get(id);
      const text = m.title + ' has waited ' + Math.round(this.SAFETY_WINDOW_MS / 86400000) + ' days with no crash since Vex added it. Turn it on?';
      const turnOn = () => this.switchOn(id).catch(err => { console.error('[Registry] could not turn on "' + id + '":', err); window.showToast?.('Could not turn on ' + m.title + ': ' + err.message, 'error'); });
      if (this._offerSinks.length) {
        for (const sink of this._offerSinks.slice()) sink({ id, title: m.title, text, turnOn });
      } else {
        if (typeof VexAttention !== 'undefined' && !VexAttention.gate('try-feature', id)) continue;
        if (typeof window === 'undefined' || typeof window.showToast !== 'function') continue;
        window.showToast(text, 'info', 12000, { action: { label: 'Turn on', run: turnOn } });
      }
      st.safeOffered[id] = now;
      st.offerLog.push(now);
      n++;
    }
    this._save();
    return n;
  },
  _offerSinks: [],
  onOffer(fn) {
    if (typeof fn !== 'function') throw new Error('onOffer needs a function');
    this._offerSinks.push(fn);
  },
  // At most OFFERS_PER_WEEK offers in any seven days: the rest stay pending and are offered on a later start.
  // ONE budget for every way Vex nudges you about a feature: a "try it" offer here, a "New for you" row
  // (js/disclosure.js) and a "hidden until needed" offer (js/quiet-defaults.js) all count against the same
  // three in seven days, so they never add up to a stream. Each of those exposes nudgeTimes(now).
  OFFERS_PER_WEEK: 3,
  NUDGE_SOURCES: ['VexDisclosure', 'VexQuietDefaults'],
  nudgesInWeek(now = Date.now()) {
    const week = 7 * 24 * 3600 * 1000;
    let n = this._load().offerLog.filter(t => now - t < week).length;
    for (const name of this.NUDGE_SOURCES) {
      const src = typeof window !== 'undefined' ? window[name] : undefined;
      if (src && typeof src.nudgeTimes === 'function') n += src.nudgeTimes(now).length;
    }
    return n;
  },
  nudgeRoom(now = Date.now()) { return Math.max(0, this.OFFERS_PER_WEEK - this.nudgesInWeek(now)); },
  offerTry(ids = this.pendingOffers(), now = Date.now()) {
    const st = this._load();
    st.offerLog = st.offerLog.filter(t => now - t < 7 * 24 * 3600 * 1000);
    let n = 0;
    for (const id of ids) {
      const m = this._m.get(id);
      if (!m || st.offered[id]) continue;
      if (this.nudgeRoom(now) <= 0) break;
      const text = (m.maturity === 'new' ? 'New in Vex: ' : 'Beta: ') + m.title + '. It is off until you try it.';
      const turnOn = () => this.switchOn(id).then(() => { st.offered[id] = Date.now(); this._save(); }).catch(err => { console.error('[Registry] could not turn on "' + id + '":', err); window.showToast?.('Could not turn on ' + m.title + ': ' + err.message, 'error'); });
      if (this._offerSinks.length) {
        // The attention inbox (when there is one) subscribes with onOffer() and shows it its own way.
        for (const sink of this._offerSinks.slice()) sink({ id, title: m.title, text, turnOn });
      } else {
        if (typeof VexAttention !== 'undefined' && !VexAttention.gate('try-feature', id)) continue;   // not now; offered next start
        if (typeof window === 'undefined' || typeof window.showToast !== 'function') continue;
        window.showToast(text, 'info', 12000, { action: { label: 'Try it', run: turnOn } });
      }
      st.offered[id] = now;
      st.offerLog.push(now);
      n++;
    }
    this._save();
    return n;
  },

  // For tests.
  _reset() { this._offerSinks.length = 0; this._m.clear(); this._owner.clear(); this._jobOwner.clear(); this._cmdOwner.clear(); this._state = null; },
};

if (typeof window !== 'undefined') window.VexRegistry = VexRegistry;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRegistry };
