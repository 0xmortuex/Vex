// === Plan the week from last week (T2-045) =============================================
//
// The week you plan on Sunday evening is mostly last week again: the same
// Tuesday study block, the Thursday call, the Friday invoice reminder. This opens
// a 7-day grid already filled from last week and creates the reminders in one
// click.
//
//   Prefilled from last week (the week before the one you plan):
//     * one-off reminders that were set for that week (a reminder that already
//       repeats is left alone: it will come back by itself)
//     * Focus OS blocks of that week (done, skipped or planned), by their goal
//   Each item lands on the same weekday and time in the planned week. Past
//   moments are left out, and so is anything you already have at that moment.
//   Every item has a tick; unticked ones are not created.
//   Create makes ORDINARY Vex reminders (they fire, snooze and show in What is
//   due like any other) and writes one line to the Ledger whose Undo deletes the
//   reminders it made.
//
//   VexWeekSkeleton.weekStart / build / existing     pure
//   Ctrl+K "Plan the week"                           the grid
//
// Nothing is created until you press Create. Calendar events are not carried:
// your calendar already repeats them. Sends nothing.

const VexWeekSkeleton = {
  PREF: 'vex.weekSkeleton.enabled',
  FEATURE: 'week-skeleton',
  MAX_ITEMS: 60,

  enabled() { return VexPlanKit.flag(this.PREF); },
  setEnabled(on) { return VexPlanKit.setFlag(this.PREF, on); },

  // ---- pure --------------------------------------------------------------------------------
  // Monday 00:00 of the week that contains `ms`, or of the next one.
  weekStart(ms, next = false) {
    const d = new Date(VexPlanKit.startOfDay(ms));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + (next ? 7 : 0));
    return d.getTime();
  },
  // The same weekday and clock time, in the planned week.
  shift(at, fromWeek, toWeek) {
    const d = new Date(at);
    const dayIdx = Math.round((VexPlanKit.startOfDay(at) - fromWeek) / 86400000);
    const t = new Date(toWeek);
    t.setDate(t.getDate() + dayIdx);
    t.setHours(d.getHours(), d.getMinutes(), 0, 0);
    return { at: t.getTime(), dayIdx };
  },
  // items: [{ id, text, at, source }] from last week -> [{ key, text, at, dayIdx, source }]
  build(items, fromWeek, toWeek, { now = Date.now(), existing = [] } = {}) {
    const taken = new Set((existing || []).map(e => (e.at ? Math.floor(e.at / 60000) : 0) + '|' + String(e.text || '').toLowerCase()));
    const out = [];
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || !it.text || !Number.isFinite(it.at)) continue;
      if (it.at < fromWeek || it.at >= fromWeek + 7 * 86400000) continue;
      const s = this.shift(it.at, fromWeek, toWeek);
      if (s.at <= now) continue;
      const dupe = Math.floor(s.at / 60000) + '|' + String(it.text).toLowerCase();
      if (taken.has(dupe)) continue;
      taken.add(dupe);
      out.push({ key: it.source + ':' + (it.id || out.length), text: String(it.text), at: s.at, dayIdx: s.dayIdx, source: it.source });
    }
    return out.sort((a, b) => a.at - b.at).slice(0, this.MAX_ITEMS);
  },

  // ---- the stores ---------------------------------------------------------------------------
  async _reminders() {
    const b = typeof window !== 'undefined' && window.vex && window.vex.reminders;
    if (!b || typeof b.list !== 'function') throw new Error('Reminders are not available here');
    return (await b.list()) || [];
  },
  // -> { lastWeek: [items], existing: [items of the planned week], errors }
  async read(fromWeek, toWeek) {
    const errors = [];
    const lastWeek = [];
    const existing = [];
    let rems = [];
    try { rems = await this._reminders(); } catch (err) { errors.push('reminders: ' + err.message); }
    for (const r of rems) {
      if (!r || !Number.isFinite(r.at) || (r.kind && r.kind !== 'reminder') || r.focusOsBlock) continue;
      if (r.at >= toWeek && r.at < toWeek + 7 * 86400000) existing.push({ at: r.at, text: r.message });
      if (r.repeat || r.at < fromWeek || r.at >= fromWeek + 7 * 86400000) continue;
      lastWeek.push({ id: r.id, text: String(r.message || ''), at: r.at, source: 'reminder' });
    }
    try {
      if (typeof FocusOS !== 'undefined' && typeof FocusOS.state === 'function') {
        for (const b of FocusOS.state().blocks) {
          if (!b || !['done', 'skipped', 'planned'].includes(b.state) || !(b.start >= fromWeek && b.start < fromWeek + 7 * 86400000)) continue;
          const g = typeof FocusOS.goal === 'function' ? FocusOS.goal(b.goalId) : null;
          lastWeek.push({ id: b.id, text: 'Focus block: ' + (g ? g.title : 'focus'), at: b.start, source: 'focus' });
        }
        for (const b of FocusOS.state().blocks) {
          if (b && b.state === 'planned' && b.start >= toWeek && b.start < toWeek + 7 * 86400000) {
            const g = typeof FocusOS.goal === 'function' ? FocusOS.goal(b.goalId) : null;
            existing.push({ at: b.start, text: 'Focus block: ' + (g ? g.title : 'focus') });
          }
        }
      }
    } catch (err) { errors.push('Focus OS: ' + err.message); }
    return { lastWeek, existing, errors };
  },

  // ---- creating ---------------------------------------------------------------------------------
  async create(items, now = Date.now()) {
    const picked = (Array.isArray(items) ? items : []).filter(i => i && i.text && i.at > now);
    if (!picked.length) throw new Error('Tick at least one item to create');
    const b = typeof window !== 'undefined' && window.vex && window.vex.reminders;
    if (!b || typeof b.create !== 'function') throw new Error('Reminders are not available here');
    const ids = [];
    try {
      for (const i of picked) {
        const r = await b.create(i.text.slice(0, 500), i.at);
        if (r && r.ok === false) throw new Error(r.error || 'A reminder could not be made');
        if (r && r.id) ids.push(r.id);
      }
    } catch (err) {
      // Do not leave half a week behind: undo what was made, then say so.
      for (const id of ids) { try { await b.delete(id); } catch (e2) { window.VexProblems?.note('Plan the week', 'Could not take back a reminder after a failure', e2); } }
      throw new Error('Nothing was created: ' + err.message);
    }
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({
        feature: this.FEATURE, what: 'Made ' + ids.length + ' reminders for the week of ' + VexPlanKit.dayName(this.weekStart(picked[0].at)),
        why: 'You pressed Create on the week skeleton built from last week.',
        undo: ids.length && JSON.stringify(ids).length < 1500 ? { kind: 'week-uncarry', ids } : null, stop: { kind: 'week-skeleton-off' },
      });
    }
    return ids.length;
  },

  // ---- the grid ------------------------------------------------------------------------------------
  async open() {
    if (!this.enabled()) { window.showToast?.('Plan the week is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('week-skeleton');
    const now = Date.now();
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-week-skeleton', title: 'Plan the week', sub: 'Filled from last week. Untick what should not come back, then Create.' });
    const state = { next: true };
    const toggle = document.createElement('div');
    toggle.style.cssText = 'display:flex;gap:6px;margin-bottom:8px';
    const grid = document.createElement('div');
    body.append(toggle, grid);
    const draw = async () => {
      grid.textContent = '';
      const toWeek = this.weekStart(now, state.next);
      const fromWeek = VexPlanKit.addDays(toWeek, -7);
      let data;
      try { data = await this.read(fromWeek, toWeek); } catch (err) { grid.appendChild(VexSettingsGroups.note('Could not read last week: ' + err.message)); return; }
      const items = this.build(data.lastWeek, fromWeek, toWeek, { now, existing: data.existing });
      if (!items.length) grid.appendChild(VexSettingsGroups.note('Nothing from last week needs to come back. Reminders that repeat on their own are not listed.'));
      const cols = document.createElement('div');
      cols.style.cssText = 'display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px';
      const checks = [];
      for (let d = 0; d < 7; d++) {
        const col = document.createElement('div');
        col.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:6px;min-height:80px;font-size:11.5px';
        const h = document.createElement('div'); h.style.cssText = 'font-weight:650;margin-bottom:4px'; h.textContent = VexPlanKit.dayName(VexPlanKit.addDays(toWeek, d)); col.appendChild(h);
        for (const it of items.filter(i => i.dayIdx === d)) {
          const lab = document.createElement('label'); lab.style.cssText = 'display:flex;gap:5px;align-items:flex-start;margin:3px 0;cursor:pointer';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.setAttribute('aria-label', VexPlanKit.hhmm(it.at) + ' ' + it.text);
          const t = document.createElement('span'); t.textContent = VexPlanKit.hhmm(it.at) + ' ' + VexPlanKit.line(it.text, 50);
          lab.append(cb, t); col.appendChild(lab); checks.push({ cb, it });
        }
        cols.appendChild(col);
      }
      grid.appendChild(cols);
      if (data.errors.length) grid.appendChild(VexSettingsGroups.note('Could not read: ' + data.errors.join('; ')));
      if (items.length) {
        grid.appendChild(VexSettingsGroups.button('Create the ticked reminders', async () => {
          try { const n = await this.create(checks.filter(c => c.cb.checked).map(c => c.it), Date.now()); window.showToast?.(n + ' reminders created', 'info'); close(); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        }, { primary: true }));
      }
    };
    for (const [label, next] of [['Next week', true], ['This week', false]]) {
      toggle.appendChild(VexSettingsGroups.button(label, () => { state.next = next; draw(); }));
    }
    await draw();
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('week-uncarry', async (t) => {
        const b = window.vex && window.vex.reminders;
        if (!b || typeof b.delete !== 'function') throw new Error('Reminders are not available here');
        for (const id of t.ids) await b.delete(id);
      });
      VexLedger.registerStop('week-skeleton-off', () => { this.setEnabled(false); });
    }
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('A 7-day grid filled from last week (one-off reminders and Focus OS blocks) with one click to create the reminders. Nothing is made until you press Create, and the Ledger can undo it. Ctrl+K › Plan the week.'));
    el.appendChild(VexSettingsGroups.button('Plan the week', () => { this.open().catch(err => window.showToast?.(err.message, 'error')); }, { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexWeekSkeleton = VexWeekSkeleton;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'week-skeleton', title: 'Plan the week', keywords: 'plan week skeleton grid carry over recurring reminders focus blocks', before: 'about', build: (el) => VexWeekSkeleton.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'week-skeleton', label: 'Plan the week', hint: 'A 7-day grid filled from last week, one click to create the reminders', icon: 'calendar', action: () => { VexWeekSkeleton.open().catch(err => window.showToast?.(err.message, 'error')); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWeekSkeleton };
