// === Yesterday's left-overs (T2-009) =========================================
//
// A task written "- [ ] call the plumber @2026-10-12" that was not ticked by the
// 12th just sits there, overdue, among the others. Nothing ever asks "still
// meant?", so tasks evaporate quietly. This asks, once, at the first open of the
// day: each left-over gets three buttons.
//
//   Today      the task is dated today
//   Tomorrow   the task is dated tomorrow
//   Drop       the date is taken off; the task STAYS in its note, undated
//
// A left-over is an open task whose date has passed. (An undated task has no
// "yesterday", so it is never a left-over.) Every choice is written to the
// Ledger with an Undo that puts the old date back. The date is written as an
// absolute day, never "@today": "@today" typed yesterday means today again.
//
//   VexCarry.pick(tasks, now)         pure: which tasks are left-overs, oldest first
//   VexCarry.choose(task, choice, now) pure: the date a choice means ('' for Drop)
//   Morning Brief section "Left over from earlier": three buttons on each row
//   Ctrl+K "Left-overs": the same list in a dialog
//   the first open of the day (vex:first-open) offers it, once a day, through
//   the attention gate (a useful notice; held in the Attention Inbox when the
//   cap says so)
//
// Nothing is sent anywhere. It reads and edits only your own notes.

const VexCarry = {
  PREF: 'vex.carry.enabled',        // 'off' hides the section, the command and the offer
  OFFERED: 'vex.carry.offered',     // the day (YYYY-MM-DD) it was last offered
  FEATURE: 'carry-forward',
  MAX_ROWS: 30,
  CHOICES: ['today', 'tomorrow', 'drop'],
  LABEL: { today: 'Today', tomorrow: 'Tomorrow', drop: 'Drop' },

  enabled() { return VexPlanKit.flag(this.PREF); },
  setEnabled(on) { return VexPlanKit.setFlag(this.PREF, on); },

  // ---- pure ----------------------------------------------------------------------
  pick(tasks, now = Date.now()) {
    const today = VexPlanKit.startOfDay(now);
    return (Array.isArray(tasks) ? tasks : [])
      .filter(t => t && Number.isFinite(t.due) && t.due < today)
      .sort((a, b) => a.due - b.due || String(a.plain).localeCompare(String(b.plain)))
      .map(t => ({ ...t, days: Math.round((today - t.due) / VexPlanKit.DAY) }));
  },
  choose(choice, now = Date.now()) {
    if (!this.CHOICES.includes(choice)) throw new Error('A left-over is moved to Today, to Tomorrow, or dropped');
    if (choice === 'drop') return '';
    const day = VexPlanKit.startOfDay(now);
    return VexPlanKit.isoDay(choice === 'today' ? day : VexPlanKit.addDays(day, 1));
  },
  ageLabel(days) { return days <= 1 ? 'from yesterday' : days + ' days ago'; },

  // ---- reading and acting ------------------------------------------------------------
  list(now = Date.now()) { return this.pick(VexPlanKit.openTasks(now), now); },

  apply(task, choice, now = Date.now()) {
    const tag = this.choose(choice, now);
    const before = VexPlanKit.setTaskDate(task, tag);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({
        feature: this.FEATURE,
        what: (choice === 'drop' ? 'Took the date off "' : 'Moved "') + VexPlanKit.line(task.plain, 70) + '"' + (choice === 'drop' ? '' : ' to ' + (choice === 'today' ? 'today' : 'tomorrow')),
        why: 'You chose ' + this.LABEL[choice] + ' for a task that was left over from earlier.',
        undo: { kind: 'carry-restore', noteId: task.noteId, index: task.index, plain: task.plain.slice(0, 160), now: tag, was: before },
        stop: { kind: 'carry-off' },
      });
    }
    return { tag, before };
  },

  // ---- Morning Brief ------------------------------------------------------------------------
  briefModule() {
    return {
      id: 'carry-forward', title: 'Left over from earlier', icon: 'list',
      isEnabled: () => this.enabled(),
      build: async () => {
        const now = Date.now();
        const all = this.list(now);
        if (!all.length) return null;
        const rows = all.slice(0, 5);
        return {
          summary: all.length === 1 ? 'One task slipped past its day.' : all.length + ' tasks slipped past their day.' + (all.length > rows.length ? ' The oldest ' + rows.length + ' are shown.' : ''),
          lines: rows.map(t => ({
            text: t.plain, detail: t.noteTitle + ' · ' + this.ageLabel(t.days),
            actions: this.CHOICES.map(c => ({ label: this.LABEL[c], run: () => { this.apply(t, c); } })),
          })),
        };
      },
    };
  },

  // ---- the dialog -------------------------------------------------------------------------------
  open() {
    if (!this.enabled()) { window.showToast?.('Left-overs are switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('carry-forward');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-carry', title: 'Left over from earlier', sub: 'Tasks whose day has passed. Today and Tomorrow move the date; Drop takes the date off and keeps the task in its note.' });
    let rows;
    try { rows = this.list(); } catch (err) { body.appendChild(VexSettingsGroups.note('Could not read your tasks: ' + err.message)); return; }
    if (!rows.length) { body.appendChild(VexSettingsGroups.note('Nothing is left over. Every dated task is still ahead of you or done.')); return; }
    const list = document.createElement('div');
    list.className = 'vexsr-list';
    for (const t of rows.slice(0, this.MAX_ROWS)) {
      const { row } = VexPlanKit.listRow(this.ageLabel(t.days), t.plain + '  (' + t.noteTitle + ')');
      const box = document.createElement('span');
      box.style.cssText = 'display:inline-flex;gap:6px;margin-left:auto';
      for (const c of this.CHOICES) {
        box.appendChild(VexSettingsGroups.button(this.LABEL[c], () => {
          try { this.apply(t, c); row.remove(); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        }, { label: this.LABEL[c] + ': ' + t.plain }));
      }
      row.appendChild(box);
      list.appendChild(row);
    }
    body.appendChild(list);
    if (rows.length > this.MAX_ROWS) body.appendChild(VexSettingsGroups.note('The oldest ' + this.MAX_ROWS + ' of ' + rows.length + ' are shown. Do these and open it again.'));
  },

  // ---- the offer at the first open of the day --------------------------------------------------
  offer(now = Date.now()) {
    if (!this.enabled()) return false;
    const day = VexPlanKit.isoDay(now);
    let last = '';
    try { last = localStorage.getItem(this.OFFERED) || ''; } catch (err) { window.VexProblems?.note('Left-overs', 'Could not read when the offer was last made', err); }
    if (last === day) return false;
    const rows = this.list(now);
    if (!rows.length) return false;
    try { localStorage.setItem(this.OFFERED, day); } catch (err) { window.VexProblems?.note('Left-overs', 'Could not remember the offer for today', err); }
    if (typeof VexAttention === 'undefined') throw new Error('The attention gate is not loaded');
    const n = rows.length;
    VexAttention.notify({
      feature: this.FEATURE, label: 'Left-overs from earlier', urgency: 'useful', id: day,
      title: n === 1 ? '1 task slipped past its day' : n + ' tasks slipped past their day',
      body: 'Move each to Today or Tomorrow, or drop it.', action: { label: 'Review', key: 'open' },
    }, () => window.showToast?.(n === 1 ? '1 task slipped past its day' : n + ' tasks slipped past their day', 'info', 12000, { action: { label: 'Review', run: () => this.open() } }));
    return true;
  },

  // ---- wiring ---------------------------------------------------------------------------------------
  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('carry-restore', async (token) => {
        VexPlanKit.setTaskDate({ noteId: token.noteId, index: token.index, plain: token.plain }, token.was || '');
      });
      VexLedger.registerStop('carry-off', () => { this.setEnabled(false); });
    }
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle(this.FEATURE, (key) => { if (key !== 'open') throw new Error('Unknown action ' + key); this.open(); });
    }
    document.addEventListener('vex:first-open', () => {
      try { this.offer(); } catch (err) { window.VexProblems?.note('Left-overs', 'Could not make the offer', err); }
    });
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('At the first open of the day, lists tasks whose date has passed and asks what to do with each: Today, Tomorrow or Drop. Shown in the Morning Brief and in Ctrl+K › Left-overs.'));
    el.appendChild(VexSettingsGroups.button('Review left-overs', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexCarry = VexCarry;
  window.VexBriefModules = window.VexBriefModules || [];
  window.VexBriefModules.push(VexCarry.briefModule());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'carry-forward', title: 'Left-overs from earlier', keywords: 'left over carry forward yesterday overdue tasks today tomorrow drop', before: 'about', build: (el) => VexCarry.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'carry-forward', label: 'Left-overs from earlier', hint: 'Tasks whose day has passed: Today, Tomorrow or Drop', icon: 'list', action: () => VexCarry.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCarry };
