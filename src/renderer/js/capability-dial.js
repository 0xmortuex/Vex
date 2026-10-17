// === Simple / Standard / Power: a capability dial built on the usage counts (T3-083) =========
//
// The usage counters (js/usage-counters.js) already know, on this computer only, which features you open.
// This turns them into one dial with three settings:
//
//   Simple    switches off the features you have NEVER used, so there is less to look at. It waits until
//             the counts are two weeks old, shows you the exact list first, and records one line in
//             "Why did Vex do that?" with an Undo that puts every one of them back.
//   Standard  the way Vex is without the dial. Choosing it puts back exactly the features Simple switched
//             off (and only those); nothing else changes.
//   Power     like Standard, and the usage suggestions (hide what you never use, pin what you use daily)
//             come once a week instead of once a month. It turns nothing on by itself: a feature that
//             arrives off stays off until you switch it on.
//
// What it will never do:
//   - hide a feature you have used: any recorded use at all (the usage record, the counts, the command bar's
//     own record, a command you pinned) keeps a feature on, however long ago it was;
//   - touch a feature that cannot be switched off (security, the attention budget), one that Minimal Vex keeps,
//     or the counters and this dial themselves;
//   - run while Minimal Vex is on (both keep a note of what they switched off; they must not share it);
//   - do anything at all until you switch the dial on. It is off by default, and an existing profile stays off.
//
//   VexCapabilityDial.plan(rows, now)    pure: { hide: [{ id, title }], kept: [{ id, why }] } for Simple
//   VexCapabilityDial.setLevel(level)    'simple' | 'standard' | 'power'
//   VexCapabilityDial.level()            the level in force ('standard' when the dial is off)
const VexCapabilityDial = {
  KEY: 'vex.capabilityDial',               // { v: 1, level, at, hidden: [feature ids Simple switched off] }
  PREF: 'vex.capabilityDial.enabled',      // 'on' | absent (off)
  LEVELS: ['simple', 'standard', 'power'],
  LABEL: { simple: 'Simple', standard: 'Standard', power: 'Power' },
  SUGGEST_EVERY_MS: { simple: 30 * 24 * 3600 * 1000, standard: 30 * 24 * 3600 * 1000, power: 7 * 24 * 3600 * 1000 },
  PROTECTED: ['capability-dial', 'usage-counters', 'first-use-sheet', 'minimal-mode'],
  MAX_HIDE: 40,

  enabled() { try { return localStorage.getItem(this.PREF) === 'on'; } catch (err) { throw new Error('The capability dial setting could not be read: ' + err.message); } },
  // The bare switch (what Minimal Vex and the feature table use): it does not touch the features Simple switched off.
  // They stay off and listed until the dial is on again and Standard is chosen, or "Put them back" is pressed.
  setPref(on) {
    try { if (on) localStorage.setItem(this.PREF, 'on'); else localStorage.removeItem(this.PREF); }
    catch (err) { throw new Error('The capability dial setting could not be saved: ' + err.message); }
    return !!on;
  },
  // Switching the dial off from its own Settings button puts back what it switched off first.
  async setEnabled(on) {
    if (on) { localStorage.setItem(this.PREF, 'on'); return true; }
    await this.restore();
    this._write({ v: 1, level: 'standard', at: Date.now(), hidden: [] });
    localStorage.removeItem(this.PREF);
    return false;
  },

  _read() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { throw new Error('The capability dial note could not be read: ' + err.message, { cause: err }); }
    if (!raw) return { v: 1, level: 'standard', at: 0, hidden: [] };
    let s;
    try { s = JSON.parse(raw); }
    catch (err) { throw new Error('The capability dial note is not readable: ' + err.message, { cause: err }); }
    if (!s || s.v !== 1 || !this.LEVELS.includes(s.level) || !Array.isArray(s.hidden)) throw new Error('The capability dial note is not in a form Vex knows');
    return s;
  },
  _write(s) {
    try { localStorage.setItem(this.KEY, JSON.stringify(s)); }
    catch (err) { throw new Error('The capability dial could not save its note: ' + err.message, { cause: err }); }
  },

  // The level in force: Standard whenever the dial is off.
  level() { return this.enabled() ? this._read().level : 'standard'; },
  hidden() { return this._read().hidden.slice(); },

  // How often the usage suggestions may come (js/usage-counters.js asks).
  suggestEveryMs() { return this.SUGGEST_EVERY_MS[this.level()]; },

  // ---- Simple: what could be switched off. Pure over the rows it is given. --------------------------
  // rows: VexUsage.list(). counters: VexUsageCounters. Anything with a trace of use is kept, and says why.
  plan(rows, { now = Date.now(), counters = null, pinned = [], isCore = null } = {}) {
    const hide = [], kept = [];
    const reg = typeof VexRegistry !== 'undefined' ? VexRegistry : null;
    for (const r of rows) {
      const keep = (why) => kept.push({ id: r.id, title: r.title, why });
      if (!r.on) continue;
      if (this.PROTECTED.includes(r.id)) { keep('the dial and its counters stay'); continue; }
      const m = reg && reg.has(r.id) ? reg.get(r.id) : null;
      if (m && m.killSwitch === 'none') { keep('it cannot be switched off'); continue; }
      if (m && m.tiers && m.tiers.minimal === true) { keep('Vex keeps it in every mode'); continue; }
      if (isCore && isCore(r)) { keep('it is part of the browser'); continue; }
      if (r.uses > 0 || r.lastUsed > 0) { keep('you have used it'); continue; }
      if (r.catalogUsed) { keep('you have used it'); continue; }
      if (counters && (counters.total(r.id, 'opened', counters.KEEP_DAYS, now) > 0 || counters.daysUsed(r.id, counters.KEEP_DAYS, now) > 0)) { keep('you have used it'); continue; }
      if (m && m.commands && m.commands.some(c => pinned.includes(c))) { keep('you pinned it'); continue; }
      if (r.daysSeen < 14) { keep('too new to judge'); continue; }
      hide.push({ id: r.id, title: r.title });
    }
    return { hide: hide.slice(0, this.MAX_HIDE), kept, more: Math.max(0, hide.length - this.MAX_HIDE) };
  },

  _needs() {
    if (typeof VexUsage === 'undefined') throw new Error('The feature record is not loaded');
    if (typeof VexUsageCounters === 'undefined') throw new Error('The usage counts are not loaded');
    if (typeof VexMinimalMode !== 'undefined' && VexMinimalMode.isOn()) throw new Error('Minimal Vex is on. Switch it off before you change the capability level, so the two do not share one list of what was switched off.');
  },

  // What Simple would switch off right now, or why it cannot say yet. → { ready, wait, plan }
  preview(now = Date.now()) {
    this._needs();
    const c = VexUsageCounters;
    const age = c.age(now);
    if (!c.enabled()) return { ready: false, wait: 0, reason: 'The usage counts are switched off, so Vex cannot tell what you never use. Switch them on first.', plan: null };
    if (age < c.MIN_DAYS) return { ready: false, wait: c.MIN_DAYS - age, reason: 'Vex has counted for ' + age + ' days. It needs ' + c.MIN_DAYS + ' to tell what you never use.', plan: null };
    return { ready: true, wait: 0, reason: '', plan: this.plan(VexUsage.list(), { now, counters: c, pinned: c.pinnedCommands() }) };
  },

  // ---- changing the dial --------------------------------------------------------------------------
  async setLevel(level, { confirmed = false } = {}) {
    if (!this.LEVELS.includes(level)) throw new Error('The level is Simple, Standard or Power');
    if (!this.enabled()) throw new Error('The capability dial is off. Switch it on first.');
    this._needs();
    const cur = this._read();
    if (level === 'simple') {
      if (cur.level === 'simple') return { level, hidden: cur.hidden };
      const p = this.preview();
      if (!p.ready) throw new Error(p.reason);
      if (!confirmed) throw new Error('Simple switches features off. Show the list first and pass confirmed when it was accepted.');
      const done = [];
      const failed = [];
      for (const f of p.plan.hide) {
        try { await VexUsage.disable(f.id); done.push(f.id); }
        catch (err) { failed.push(f.id + ': ' + ((err && err.message) || err)); }
      }
      this._write({ v: 1, level: 'simple', at: Date.now(), hidden: done });
      if (done.length && typeof VexLedger !== 'undefined') {
        VexLedger.record({ feature: 'capability-dial', what: 'Simple: switched off ' + done.length + ' feature' + VexPlural.s(done.length) + ' you never used',
          why: 'You chose Simple and these had no recorded use.', undo: { kind: 'capability-dial:restore' } });
      }
      if (failed.length) throw new Error('Simple is on, but ' + failed.length + ' feature' + VexPlural.s(failed.length) + ' could not be switched off: ' + failed.join('; '));
      return { level, hidden: done };
    }
    // Standard and Power both put back what Simple took away.
    await this.restore();
    this._write({ v: 1, level, at: Date.now(), hidden: [] });
    return { level, hidden: [] };
  },

  // Puts back exactly what the dial switched off (a feature the person already turned on again is left as it is).
  async restore() {
    const s = this._read();
    const problems = [];
    for (const id of s.hidden) {
      try {
        if (typeof VexUsage === 'undefined') throw new Error('The feature record is not loaded');
        if (!VexUsage.get(id)) continue;
        if (!VexUsage.isEnabled(id)) await VexUsage.enable(id);
      } catch (err) { problems.push(id + ': ' + ((err && err.message) || err)); }
    }
    this._write({ v: 1, level: s.level === 'simple' ? 'standard' : s.level, at: Date.now(), hidden: [] });
    if (problems.length) throw new Error('Some features could not be put back: ' + problems.join('; '));
    return s.hidden.length;
  },

  // ---- the screen ---------------------------------------------------------------------------------
  group(el) {
    el.appendChild(VexSettingsGroups.note('One dial for how much Vex shows. Simple switches off the features you have never used (after two weeks of counting, with the list shown first, and an Undo). Standard is Vex as it is. Power brings the "pin what you use daily" and "hide what you never use" suggestions weekly instead of monthly. A feature you have used is never switched off by the dial. It is off until you switch it on.'));
    const draw = () => {
      el.querySelectorAll('[data-dial]').forEach(n => n.remove());
      const box = document.createElement('div');
      box.dataset.dial = '1';
      const on = this.enabled();
      const left = this._read().hidden.length;
      if (!on && left) {
        box.appendChild(VexSettingsGroups.note(left + ' feature' + (left === 1 ? ' is' : 's are') + ' still switched off from when the dial was on Simple.'));
        box.appendChild(VexSettingsGroups.button('Put them back', async () => {
          try { const n = await this.restore(); window.showToast?.(n + ' feature' + VexPlural.s(n) + ' put back', 'info'); }
          catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }));
      }
      box.appendChild(VexSettingsGroups.button(on ? 'Turn the capability dial off' : 'Turn the capability dial on', async () => {
        try { await this.setEnabled(!on); window.showToast?.(on ? 'Capability dial off: everything is back as it was' : 'Capability dial on', 'info'); }
        catch (err) { window.showToast?.(err.message, 'error'); }
        draw();
      }, { primary: !on }));
      if (on) {
        const cur = this.level();
        box.appendChild(VexSettingsGroups.note('In force: ' + this.LABEL[cur] + (cur === 'simple' ? ' (' + this._read().hidden.length + ' features switched off)' : '')));
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0';
        for (const lv of this.LEVELS) row.appendChild(VexSettingsGroups.button(this.LABEL[lv], () => this.choose(lv).then(draw, (err) => { window.showToast?.(err.message, 'error'); draw(); }), { primary: cur === lv }));
        box.appendChild(row);
      }
      el.appendChild(box);
    };
    draw();
  },

  // The Settings button: Simple shows the list and asks; the other two just apply.
  async choose(level) {
    if (level !== 'simple') { const r = await this.setLevel(level); window.showToast?.(this.LABEL[level] + ': everything Simple switched off is back', 'info'); return r; }
    const p = this.preview();
    if (!p.ready) throw new Error(p.reason);
    if (!p.plan.hide.length) { window.showToast?.('Nothing to switch off: every feature that is on has been used or is needed.', 'info'); return this.setLevel('simple', { confirmed: true }); }
    if (typeof VexPlan === 'undefined') throw new Error('The preview list is not loaded (js/plan-preview.js)');
    const go = await VexPlan.confirmSteps({
      title: 'Switch off ' + p.plan.hide.length + ' features you have never used?', intro: 'They are switched off, not removed. Anything you have used is kept. Standard, or Undo in "Why did Vex do that?", puts them all back.',
      steps: p.plan.hide.map(f => ({ label: f.title, detail: 'never used' })), okLabel: 'Switch them off', noun: 'feature',
    });
    if (!go) return null;
    return this.setLevel('simple', { confirmed: true });
  },

  start() {
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('capability-dial:restore', async () => { await this.restore(); });
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexCapabilityDial = VexCapabilityDial;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'capability-dial', title: 'Simple, Standard or Power', keywords: 'simple standard power level dial capability fewer features hide unused tier', before: 'about', build: (el) => VexCapabilityDial.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'capability-dial', label: 'Simple, Standard or Power', hint: 'One dial for how much Vex shows, built on what you actually use', icon: 'sliders',
      action: () => { try { if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('vex-sg-capability-dial'); else throw new Error('Settings is not available'); } catch (err) { window.showToast?.(err.message, 'error'); } } });
  }
  if (typeof VexLedger !== 'undefined') VexCapabilityDial.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCapabilityDial };
