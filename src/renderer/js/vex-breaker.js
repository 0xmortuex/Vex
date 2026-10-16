// === A feature that keeps failing turns itself off, alone ====================
//
// A circuit breaker per feature. N failures in a row (a timer that throws, a
// fetch that keeps failing, a panel that cannot draw) or a declared budget
// overrun (js/vex-cost.js) switches that ONE feature off for the rest of the
// session, writes one ledger line, and lets it try again after a cool-down:
//
//   closed   normal; every failure counts, every success resets the count.
//   open     tripped: the feature is switched off (its own disable()), its
//            jobs do not run. Lasts COOLDOWN_MS.
//   probing  the cool-down ended and the feature was switched back on; ONE
//            failure trips it again with a cool-down twice as long (up to
//            MAX_COOLDOWN_MS), a success closes it for good.
//
// It is session-only on purpose: nothing is written to the person's saved
// choices (VexUsage's "off" list), so a feature that failed on a bad day is
// back on the next start, and a feature the person had switched off is never
// switched ON by a cool-down.
//
// Also here:
//   guardPanel   a panel whose render throws becomes an inline "this panel
//                failed" card with Try again, instead of an empty pane.
//   bootStep     tells main which feature is starting (main/safe-mode.js), so a
//                feature that crashes start-up twice is left out alone.
//   bootOff      the features main left out of this launch.
const VexBreaker = {
  MAX_FAILS: 5,
  COOLDOWN_MS: 10 * 60 * 1000,
  MAX_COOLDOWN_MS: 60 * 60 * 1000,

  _s: new Map(),        // id -> { fails, state, until, cooldown, trips, reason, wasOn, last }
  _now() { return Date.now(); },

  _rec(id) {
    let r = this._s.get(id);
    if (!r) { r = { fails: 0, state: 'closed', until: 0, cooldown: this.COOLDOWN_MS, trips: 0, reason: '', wasOn: false, last: '' }; this._s.set(id, r); }
    return r;
  },

  // ---- counting -------------------------------------------------------------
  // → true when this failure tripped the breaker.
  fail(id, err) {
    if (typeof id !== 'string' || !id) throw new Error('A failure has to name the feature');
    const r = this._rec(id);
    r.last = (err && err.message) ? String(err.message) : String(err == null ? 'it failed' : err);
    if (r.state === 'open') return false;
    r.fails++;
    if (r.state === 'probing') { this._open(id, r, 'it failed again right after coming back (' + r.last + ')', Math.min(r.cooldown * 2, this.MAX_COOLDOWN_MS)); return true; }
    if (r.fails >= this.MAX_FAILS) { this._open(id, r, 'it failed ' + r.fails + ' times in a row (' + r.last + ')', r.cooldown); return true; }
    return false;
  },
  ok(id) {
    const r = this._s.get(id);
    if (!r) return;
    r.fails = 0;
    if (r.state === 'probing') { r.state = 'closed'; r.cooldown = this.COOLDOWN_MS; }
  },

  // A reason other than throwing (js/vex-cost.js: over its declared budget).
  trip(id, reason, cooldownMs) {
    if (typeof id !== 'string' || !id) throw new Error('A trip has to name the feature');
    if (typeof reason !== 'string' || !reason) throw new Error('A trip needs a reason');
    const r = this._rec(id);
    if (r.state === 'open') return false;
    this._open(id, r, reason, cooldownMs || r.cooldown);
    return true;
  },

  _usage() { return typeof VexUsage !== 'undefined' ? VexUsage : null; },

  _open(id, r, reason, cooldown) {
    r.state = 'open';
    r.until = this._now() + cooldown;
    r.cooldown = cooldown;
    r.trips++;
    r.reason = reason;
    r.fails = 0;
    // Switch it off with its own switch, and remember whether it was on, so the
    // cool-down never turns on something that was off before.
    const u = this._usage();
    const f = u ? u.get(id) : null;
    r.wasOn = false;
    if (f) {
      try { r.wasOn = !!u.isEnabled(id); }
      catch (err) { console.error('[Breaker] could not read the switch of "' + id + '":', err.message); }
      if (r.wasOn) {
        Promise.resolve().then(() => f.disable()).catch(err => {
          console.error('[Breaker] could not switch "' + id + '" off:', err);
          if (typeof VexProblems !== 'undefined') VexProblems.note('Feature', 'Could not switch off "' + id + '" after it failed', err);
        });
      }
    }
    const title = (typeof VexRegistry !== 'undefined' && VexRegistry.get(id) ? VexRegistry.get(id).title : id);
    console.warn('[Breaker] "' + id + '" is off for ' + Math.round(cooldown / 60000) + ' min: ' + reason);
    if (typeof VexProblems !== 'undefined') VexProblems.note('Feature', '"' + title + '" was switched off for a while: ' + reason, r.last || reason);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({
        feature: id, what: 'Switched off "' + title + '" for ' + Math.round(cooldown / 60000) + ' minutes',
        why: reason.charAt(0).toUpperCase() + reason.slice(1) + '. It tries again after the wait.',
        undo: { kind: 'breaker-revive', id },
      });
    }
    this._emit();
  },

  // ---- asking ---------------------------------------------------------------
  // True while the feature (or job) is switched off by a trip. When the
  // cool-down has passed it is switched back on here and goes on probation.
  isTripped(id) {
    const r = this._s.get(id);
    if (!r || r.state !== 'open') return false;
    if (this._now() >= r.until) { this._probe(id, r); return false; }
    return true;
  },

  _probe(id, r) {
    r.state = 'probing';
    r.fails = 0;
    this._revive(id, r);
    this._emit();
  },

  _revive(id, r) {
    const u = this._usage();
    const f = u ? u.get(id) : null;
    if (f && r.wasOn) {
      Promise.resolve().then(() => f.enable()).catch(err => {
        console.error('[Breaker] could not switch "' + id + '" back on:', err);
        if (typeof VexProblems !== 'undefined') VexProblems.note('Feature', 'Could not switch "' + id + '" back on', err);
      });
    }
  },

  // The person (or an undo) brings it back before the cool-down is over.
  revive(id) {
    const r = this._s.get(id);
    if (!r || r.state !== 'open') return false;
    r.state = 'closed';
    r.fails = 0;
    r.cooldown = this.COOLDOWN_MS;
    this._revive(id, r);
    this._emit();
    return true;
  },

  // When the current cool-down of `id` ends (ms since the epoch), or 0 when it is not tripped.
  untilOf(id) {
    const r = this._s.get(id);
    return r && r.state === 'open' ? r.until : 0;
  },

  // Called by the shared timer: any cool-down that has ended is lifted.
  sweep() {
    const now = this._now();
    for (const [id, r] of this._s) if (r.state === 'open' && now >= r.until) this._probe(id, r);
  },

  status() {
    this.sweep();
    return Array.from(this._s, ([id, r]) => ({ id, state: r.state, fails: r.fails, trips: r.trips, reason: r.reason, until: r.until }))
      .filter(x => x.state !== 'closed' || x.trips > 0 || x.fails > 0);
  },

  _listeners: [],
  onChange(fn) { this._listeners.push(fn); },
  _emit() { for (const fn of this._listeners.slice()) { try { fn(); } catch (err) { console.error('[Breaker] a listener failed:', err); } } },

  // ---- a panel that cannot draw ----------------------------------------------
  // render() draws into `host`. If it throws (or its promise rejects), the host
  // shows "this panel failed" with the reason and Try again, and the failure
  // counts against the feature. Returns what render returned.
  async guardPanel(host, id, label, render) {
    if (!host || typeof host.appendChild !== 'function') throw new Error('guardPanel needs the element to draw into');
    if (typeof render !== 'function') throw new Error('guardPanel needs a render function');
    try {
      const out = await render();
      this.ok(id);
      return out;
    } catch (err) {
      console.error('[Breaker] the "' + label + '" panel failed to draw:', err);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Panel', 'The "' + label + '" panel failed to draw', err);
      this.fail(id, err);
      this.failedCard(host, label, err, () => this.guardPanel(host, id, label, render));
      return undefined;
    }
  },

  failedCard(host, label, err, retry) {
    host.textContent = '';
    const card = document.createElement('div');
    card.className = 'vex-panel-failed';
    card.setAttribute('role', 'alert');
    const h = document.createElement('strong');
    h.textContent = 'The ' + label + ' panel failed to load';
    const p = document.createElement('p');
    p.textContent = (err && err.message) ? err.message : String(err);
    card.append(h, p);
    if (typeof retry === 'function') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vex-panel-failed-retry';
      b.textContent = 'Try again';
      b.addEventListener('click', () => { retry(); });
      card.append(b);
    }
    host.appendChild(card);
    return card;
  },

  // ---- start-up: the feature that crashes the launch ------------------------------
  // Runs a feature's start-up step, telling main first and afterwards, so a
  // launch that dies in between is blamed on this feature (main/safe-mode.js).
  // A feature main left out of this launch is skipped. A step that throws is
  // reported and counted, and the launch goes on without that feature.
  bootOff() {
    if (this._bootOff) return this._bootOff;
    let list = [];
    try {
      const f = typeof window !== 'undefined' && window.vex && window.vex.bootDisabled;
      if (typeof f === 'function') list = f();
    } catch (err) { console.error('[Breaker] could not read the features left out of this launch:', err.message); }
    this._bootOff = new Set(Array.isArray(list) ? list.filter(x => typeof x === 'string') : []);
    return this._bootOff;
  },

  bootStep(id, fn) {
    if (typeof fn !== 'function') throw new Error('bootStep needs a function');
    if (this.bootOff().has(id)) {
      console.warn('[Breaker] "' + id + '" is left out of this launch: it was starting when the last launches crashed');
      this._noteBootOff(id);
      this._keepOff(id);
      return undefined;
    }
    const tell = (phase) => { try { if (window.vex && typeof window.vex.bootFeature === 'function') window.vex.bootFeature(id, phase); } catch (err) { console.error('[Breaker] could not tell main about "' + id + '":', err.message); } };
    tell('start');
    let out;
    try { out = fn(); }
    catch (err) {
      tell('done');
      console.error('[Breaker] "' + id + '" failed to start:', err);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Feature', '"' + id + '" failed to start', err);
      this.fail(id, err);
      return undefined;
    }
    if (out && typeof out.then === 'function') {
      return out.then(v => { tell('done'); return v; }, err => {
        tell('done');
        console.error('[Breaker] "' + id + '" failed to start:', err);
        if (typeof VexProblems !== 'undefined') VexProblems.note('Feature', '"' + id + '" failed to start', err);
        this.fail(id, err);
      });
    }
    tell('done');
    return out;
  },

  // Left out of this launch: keep it off afterwards too (VexUsage's saved off list),
  // so it does not crash the next normal start. The person turns it back on in
  // the usage dashboard once whatever broke is fixed.
  _keepOff(id) {
    const u = this._usage();
    if (!u) return;
    const off = () => u.disable(id).catch(err => console.error('[Breaker] could not keep "' + id + '" switched off:', err));
    if (u.get(id)) off();
    else u.onRegister(f => { if (f.id === id) off(); });
  },

  _noteBootOff(id) {
    if (this._told && this._told.has(id)) return;
    (this._told || (this._told = new Set())).add(id);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: id, what: 'Left "' + id + '" out of this start', why: 'Vex did not finish starting twice in a row while it was starting this feature, so it was left out instead of putting the whole app in safe mode.', undo: null });
    }
  },

  _reset() { this._s.clear(); this._listeners = []; this._bootOff = null; this._told = null; },
};

// A ledger line for a trip can be undone: the feature comes back before the cool-down ends.
if (typeof VexLedger !== 'undefined') {
  VexLedger.registerUndo('breaker-revive', async (token) => {
    if (!VexBreaker.revive(token.id)) throw new Error('"' + token.id + '" is already back');
  });
}

if (typeof window !== 'undefined') window.VexBreaker = VexBreaker;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBreaker };
