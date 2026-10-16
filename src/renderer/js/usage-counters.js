// === Local usage counters and adaptive defaults (T3-083) ==========================
//
// Counts, per feature and per day, on this computer only: how often it was
// OPENED, how often it wanted to speak and was SUPPRESSED by the attention
// budget, how often it ERRORED, and how often it was BACKED OFF (switched off for
// a while by the breaker). The counts are kept for 35 days, never sent, never
// synced (they are not in SYNC_KEYS) and are reset with one button.
//
// What they are used for, and only this: after two weeks of counting, at most
// ONE suggestion a month, through the Attention Inbox:
//   "You have not used X in two weeks. Hide it?"  -> Accept switches it off (VexUsage), with an Undo
//   "You use Y almost every day. Pin it?"         -> Accept pins its Ctrl+K command to the top, with an Undo
// It only ever SUGGESTS. Nothing is changed unless you press the button. "Never"
// on the row stops all such suggestions; a feature offered once is not offered again
// for 180 days whatever the answer.
//
//   VexUsageCounters.note(id, 'opened')      called by VexUsage.touch, VexBreaker, VexAttention
//   VexUsageCounters.snapshot()              rows for a dashboard
//   VexUsageCounters.candidates(now)         pure over the record and the registry: what could be suggested
const VexUsageCounters = {
  KEY: 'vex.usageCounters',
  PREF: 'vex.usageCounters.enabled',
  STATE_KEY: 'vex.usageCounters.state',
  KINDS: ['opened', 'suppressed', 'errored', 'backedOff'],
  KEEP_DAYS: 35,
  MIN_DAYS: 14,
  EVERY_MS: 30 * 24 * 3600 * 1000,
  REOFFER_MS: 180 * 24 * 3600 * 1000,
  DAILY_USE_DAYS: 10,
  DAY_MS: 24 * 3600 * 1000,
  EVAL_EVERY_MS: 6 * 3600 * 1000,
  _now() { return Date.now(); },
  _rec: null,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save the setting: ' + err.message); }
    return !!on;
  },

  // ---- the record: { v: 1, since, days: { 'YYYY-MM-DD': { featureId: { opened, suppressed, errored, backedOff } } } } ----
  _day(ms) { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); },
  _load() {
    if (this._rec) return this._rec;
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { throw new Error('The usage counters could not be read: ' + err.message); }
    let o = null;
    if (raw) {
      try { o = JSON.parse(raw); }
      catch (err) { throw new Error('The usage counters are not readable (Settings > New for you can reset them): ' + err.message); }
    }
    const ok = o && typeof o === 'object' && o.v === 1 && o.days && typeof o.days === 'object';
    this._rec = ok ? o : { v: 1, since: this._now(), days: {} };
    return this._rec;
  },
  _saveSoon() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, 3000);
  },
  flush() {
    if (!this._rec) return;
    clearTimeout(this._timer); this._timer = null;
    localStorage.setItem(this.KEY, JSON.stringify(this._rec));
  },

  // Cheap enough to call from VexUsage.touch on every use.
  note(id, kind, n = 1) {
    if (!this.enabled()) return false;
    if (!this.KINDS.includes(kind)) throw new Error('A usage count is one of ' + this.KINDS.join(', ') + ', not "' + kind + '"');
    if (typeof id !== 'string' || !id) throw new Error('A usage count needs the feature id');
    if (this._failed) return false;
    let rec;
    // Called from places that must not break because a counter record is unreadable: report once, stop counting this session.
    try { rec = this._load(); }
    catch (err) {
      this._failed = err;
      if (typeof VexProblems !== 'undefined') VexProblems.note('Usage counts', 'The counts could not be read, so nothing is counted until they are reset', err); else console.error('[UsageCounters]', err);
      return false;
    }
    const today = this._day(this._now());
    const day = rec.days[today] || (rec.days[today] = {});
    const row = day[id] || (day[id] = { opened: 0, suppressed: 0, errored: 0, backedOff: 0 });
    row[kind] += n;
    // Old days go.
    const keys = Object.keys(rec.days).sort();
    while (keys.length > this.KEEP_DAYS) delete rec.days[keys.shift()];
    this._saveSoon();
    return true;
  },

  // Sum of one kind for one feature over the last `days` days (today included).
  total(id, kind, days = this.MIN_DAYS, now = this._now()) {
    const rec = this._load();
    let t = 0;
    for (let i = 0; i < days; i++) {
      const row = (rec.days[this._day(now - i * this.DAY_MS)] || {})[id];
      if (row) t += row[kind] || 0;
    }
    return t;
  },
  // On how many of the last `days` days was it opened at least once.
  daysUsed(id, days = this.MIN_DAYS, now = this._now()) {
    const rec = this._load();
    let n = 0;
    for (let i = 0; i < days; i++) {
      const row = (rec.days[this._day(now - i * this.DAY_MS)] || {})[id];
      if (row && row.opened > 0) n++;
    }
    return n;
  },
  // How long counting has been going on, in days.
  age(now = this._now()) { return Math.floor((now - this._load().since) / this.DAY_MS); },

  snapshot(now = this._now()) {
    const ids = new Set();
    for (const day of Object.values(this._load().days)) for (const id of Object.keys(day)) ids.add(id);
    return [...ids].map(id => ({
      id, title: typeof VexRegistry !== 'undefined' && VexRegistry.has(id) ? VexRegistry.get(id).title : id,
      opened: this.total(id, 'opened', this.MIN_DAYS * 2, now), suppressed: this.total(id, 'suppressed', this.MIN_DAYS * 2, now),
      errored: this.total(id, 'errored', this.MIN_DAYS * 2, now), backedOff: this.total(id, 'backedOff', this.MIN_DAYS * 2, now),
      daysUsed: this.daysUsed(id, this.MIN_DAYS * 2, now),
    })).sort((a, b) => b.opened - a.opened);
  },

  reset() {
    this._rec = null;
    clearTimeout(this._timer); this._timer = null;
    localStorage.removeItem(this.KEY);
    localStorage.removeItem(this.STATE_KEY);
    this._state = null;
  },

  // ---- the suggestion state: { v: 1, lastAt, offered: { id: ms }, pinned: [commandId] } -----------
  _state: null,
  state() {
    if (this._state) return this._state;
    let raw = null;
    try { raw = localStorage.getItem(this.STATE_KEY); }
    catch (err) { throw new Error('The suggestion record could not be read: ' + err.message); }
    let o = null;
    if (raw) {
      try { o = JSON.parse(raw); }
      catch (err) { throw new Error('The suggestion record is not readable: ' + err.message); }
    }
    const ok = o && typeof o === 'object' && o.v === 1;
    this._state = ok ? { v: 1, lastAt: o.lastAt || 0, offered: o.offered || {}, pinned: Array.isArray(o.pinned) ? o.pinned : [] } : { v: 1, lastAt: 0, offered: {}, pinned: [] };
    return this._state;
  },
  _saveState() { localStorage.setItem(this.STATE_KEY, JSON.stringify(this._state)); },
  pinnedCommands() { return this.state().pinned.slice(); },

  // ---- what could be suggested (pure over the registry rows it is given) ----------------------
  // rows: VexUsage.list(). -> { hide: [...], pin: [...] }, each { id, title, ... }.
  candidates(rows, now = this._now()) {
    const st = this.state();
    const fresh = (id) => !(st.offered[id] && now - st.offered[id] < this.REOFFER_MS);
    const hide = [], pin = [];
    if (this.age(now) < this.MIN_DAYS) return { hide, pin };
    for (const r of rows) {
      if (!fresh(r.id)) continue;
      const m = typeof VexRegistry !== 'undefined' && VexRegistry.has(r.id) ? VexRegistry.get(r.id) : null;
      if (m && m.killSwitch === 'none') continue;
      if (m && (m.tiers.minimal === true)) continue;                         // the app's own housekeeping
      if (r.on && r.daysSeen >= this.MIN_DAYS && this.total(r.id, 'opened', this.MIN_DAYS, now) === 0 && !r.catalogUsed) hide.push({ id: r.id, title: r.title });
      else if (r.on && m && m.commands.length && this.daysUsed(r.id, this.MIN_DAYS, now) >= this.DAILY_USE_DAYS && !st.pinned.includes(m.commands[0])) {
        pin.push({ id: r.id, title: r.title, command: m.commands[0] });
      }
    }
    return { hide, pin };
  },

  // One suggestion at most, at most once a month. -> what it offered, or null.
  suggest(now = this._now()) {
    if (!this.enabled()) return null;
    if (typeof VexUsage === 'undefined') throw new Error('The usage record is not loaded');
    if (typeof VexAttention === 'undefined') throw new Error('The attention budget is not loaded');
    const st = this.state();
    if (now - st.lastAt < this.EVERY_MS) return null;
    const c = this.candidates(VexUsage.list(), now);
    const pick = c.pin[0] ? { kind: 'pin', ...c.pin[0] } : (c.hide[0] ? { kind: 'hide', ...c.hide[0] } : null);
    if (!pick) return null;
    const added = VexAttention.suggest(pick.kind === 'hide'
      ? { feature: 'usage-suggest', label: 'Suggestion', id: 'hide:' + pick.id, title: 'You have not used ' + pick.title + ' in two weeks. Hide it?', body: 'It is switched off, not removed: you can turn it back on in Settings, or press Undo right after.', action: { label: 'Hide it', key: 'hide:' + pick.id } }
      : { feature: 'usage-suggest', label: 'Suggestion', id: 'pin:' + pick.id, title: 'You use ' + pick.title + ' almost every day. Pin it?', body: 'It goes to the top of the Ctrl+K list.', action: { label: 'Pin it', key: 'pin:' + pick.id } });
    if (!added) return null;
    st.lastAt = now;
    st.offered[pick.id] = now;
    this._saveState();
    return pick;
  },

  // The row's button. Both are undoable from the ledger ("Why did that happen?").
  async accept(key) {
    const m = /^(hide|pin):(.+)$/.exec(String(key));
    if (!m) throw new Error('Unknown suggestion ' + key);
    const id = m[2];
    if (m[1] === 'hide') {
      await VexUsage.disable(id);
      if (typeof VexLedger !== 'undefined') VexLedger.record({ feature: 'usage-suggest', what: 'Switched off ' + id, why: 'You had not used it in two weeks and you pressed Hide it.', undo: { kind: 'usage-suggest:show', id } });
      return 'hidden';
    }
    const manifest = typeof VexRegistry !== 'undefined' && VexRegistry.has(id) ? VexRegistry.get(id) : null;
    const command = manifest && manifest.commands[0];
    if (!command) throw new Error('That feature has no command to pin');
    const st = this.state();
    if (!st.pinned.includes(command)) { st.pinned.unshift(command); this._saveState(); }
    if (typeof VexLedger !== 'undefined') VexLedger.record({ feature: 'usage-suggest', what: 'Pinned ' + id + ' to the top of Ctrl+K', why: 'You used it nearly every day and you pressed Pin it.', undo: { kind: 'usage-suggest:unpin', command } });
    return 'pinned';
  },

  start() {
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('usage-suggest:show', async (token) => { await VexUsage.enable(token.id); });
      VexLedger.registerUndo('usage-suggest:unpin', async (token) => {
        const st = this.state();
        st.pinned = st.pinned.filter(c => c !== token.command);
        this._saveState();
      });
    }
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle('usage-suggest', (key) => this.accept(key));
    if (typeof VexJobs === 'undefined') throw new Error('Usage counters need VexJobs');
    this._job = VexJobs.every('Usage suggestions', this.EVAL_EVERY_MS, () => {
      if (typeof GameMode !== 'undefined' && GameMode.gaming) return;
      this.suggest();
    }, { when: 'ui', deferOnBattery: true, feature: 'usage-counters' });
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Vex counts, on this computer only, how often each feature is opened, held back, fails or is switched off by Vex. After two weeks it may suggest, at most once a month, hiding something you never use or pinning something you use daily. It only suggests; nothing changes unless you press the button.'));
    const rows = this.snapshot().slice(0, 12);
    if (!rows.length) el.appendChild(VexSettingsGroups.note('Nothing counted yet.'));
    for (const r of rows) el.appendChild(VexSettingsGroups.note(r.title + ': opened ' + r.opened + ', held back ' + r.suppressed + ', errors ' + r.errored + ', switched off by Vex ' + r.backedOff + ' (last 4 weeks)'));
    el.appendChild(VexSettingsGroups.button('Reset the counts', async () => {
      const ok = await vexConfirm({ title: 'Reset the usage counts?', message: 'The counts and the record of what was already suggested are erased. Nothing else changes.', okLabel: 'Reset', danger: true });
      if (!ok) return;
      this.reset();
      window.showToast?.('Usage counts reset', 'info');
    }));
  },
};

if (typeof window !== 'undefined') {
  window.VexUsageCounters = VexUsageCounters;
  window.addEventListener('pagehide', () => { try { VexUsageCounters.flush(); } catch (err) { console.error('[UsageCounters] could not save on close:', err.message); } });
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'usage-counters', title: 'Usage counts and suggestions', keywords: 'usage counts counters hide unused pin suggest adaptive local reset never used daily', before: 'about', build: (el) => VexUsageCounters.group(el) });
  }
  if (typeof VexJobs !== 'undefined') VexUsageCounters.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUsageCounters };
