// === Close the day (T2-024) ===================================================
//
// One dialog at the end of the day, so nothing is left hanging in your head:
//
//   1. What is still open from today: tasks dated today or earlier, parked
//      contexts (Park and resume), a note with text that is not saved yet.
//      Each gets   Keep   Tomorrow   Drop   (a note can only be saved)
//   2. "Top 3 for tomorrow": three lines. Each becomes a task dated tomorrow in
//      your To-do note, or, if you picked one of the tasks you already have,
//      that task is dated tomorrow. Those dates feed What is due.
//
//   Keep       nothing changes
//   Tomorrow   a task is dated tomorrow; a parked context gets a reminder at 09:00
//   Drop       a task loses its date (it stays in its note); a parked card is dismissed
//
// Unsent mail drafts are NOT swept: Vex never stores one (mail is read-only here;
// a reply draft lives in a box until you close it), so there is nothing to list.
// A source that does keep drafts can add itself:
//   VexCloseDay.registerSource({ id, title, list() -> [{ id, text, sub }],
//                                actions: [{ key:'keep'|'tomorrow'|'drop', run(item) }] })
//
// It only runs when you open it (Ctrl+K › Close the day). Optionally, at an hour
// you choose in Settings, one useful notice offers it, through the attention
// gate. Nothing is sent anywhere.

const VexCloseDay = {
  PREF: 'vex.closeDay.enabled',
  PREFS: 'vex.closeDay.prefs',     // { nudgeAt: '' | 'HH:MM' }
  NUDGED: 'vex.closeDay.nudged',   // the day (YYYY-MM-DD) the notice was last shown
  FEATURE: 'close-day',
  JOB: 'Close the day: evening notice',
  _sources: new Map(),

  enabled() { return VexPlanKit.flag(this.PREF); },
  setEnabled(on) {
    VexPlanKit.setFlag(this.PREF, on);
    this._syncJob();
    return !!on;
  },

  // ---- settings -------------------------------------------------------------------
  prefs() {
    const raw = VexPlanKit.readJson(this.PREFS, null);
    const at = raw && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw.nudgeAt)) ? raw.nudgeAt : '';
    return { nudgeAt: at };
  },
  setPrefs(patch) {
    const next = { ...this.prefs(), ...patch };
    if (next.nudgeAt !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(next.nudgeAt))) throw new Error('The hour is written 21:30, or left empty for no notice');
    VexPlanKit.writeJson(this.PREFS, { nudgeAt: next.nudgeAt });
    this._syncJob();
    return this.prefs();
  },

  // ---- sources -----------------------------------------------------------------------
  registerSource(src) {
    if (!src || !/^[a-z][a-z0-9-]{1,40}$/.test(String(src.id || ''))) throw new Error('A close-the-day source needs an id of lowercase letters, digits and dashes');
    if (typeof src.list !== 'function') throw new Error('Source "' + src.id + '" needs list()');
    if (!Array.isArray(src.actions) || !src.actions.length) throw new Error('Source "' + src.id + '" needs actions');
    this._sources.set(src.id, src);
    return src.id;
  },

  _builtins(now) {
    const out = [];
    const tomorrow = VexPlanKit.addDays(VexPlanKit.startOfDay(now), 1);
    out.push({
      id: 'tasks', title: 'Tasks for today',
      list: () => VexPlanKit.openTasks(now).filter(t => Number.isFinite(t.due) && t.due < tomorrow).sort((a, b) => a.due - b.due)
        .map(t => ({ id: t.noteId + ':' + t.index, text: t.plain, sub: t.noteTitle + (t.due < VexPlanKit.startOfDay(now) ? ' · overdue' : ''), task: t })),
      actions: [
        { key: 'keep', label: 'Keep', run: () => {} },
        { key: 'tomorrow', label: 'Tomorrow', run: (it) => { VexPlanKit.setTaskDate(it.task, VexPlanKit.isoDay(tomorrow)); } },
        { key: 'drop', label: 'Drop', run: (it) => { VexPlanKit.setTaskDate(it.task, ''); } },
      ],
    });
    if (typeof VexPark !== 'undefined' && typeof VexPark.cards === 'function') {
      out.push({
        id: 'parked', title: 'Parked contexts',
        list: () => VexPark.cards().filter(c => !c.resumedAt && !c.dismissedAt).map(c => ({ id: c.id, text: c.note, sub: (c.wsName || 'Workspace') + ' · ' + c.tabs.length + ' tabs', card: c })),
        actions: [
          { key: 'keep', label: 'Keep', run: () => {} },
          { key: 'tomorrow', label: 'Tomorrow', run: async (it) => { await this._remind('Resume: ' + it.text, VexPlanKit.addDays(VexPlanKit.startOfDay(now), 1) + 9 * 3600 * 1000); } },
          { key: 'drop', label: 'Drop', run: (it) => { if (typeof VexPark._patch !== 'function') throw new Error('Park and resume cannot dismiss a card in this build'); VexPark._patch(it.card.id, { dismissedAt: now }); } },
        ],
      });
    }
    if (typeof NotesPanel !== 'undefined' && typeof NotesPanel._editorDirty === 'function') {
      out.push({
        id: 'notes', title: 'Unsaved notes',
        list: () => (NotesPanel._editorDirty() ? [{ id: 'editor', text: 'The note you are writing has text that is not saved yet', sub: '' }] : []),
        actions: [{ key: 'keep', label: 'Save now', run: () => { NotesPanel.flush(); } }],
      });
    }
    return out;
  },

  sources(now = Date.now()) { return [...this._builtins(now), ...this._sources.values()]; },

  // -> [{ source, items }] for every source that has something.
  collect(now = Date.now()) {
    const out = [];
    const errors = [];
    for (const src of this.sources(now)) {
      let items = [];
      try { items = src.list() || []; } catch (err) { errors.push(src.title + ': ' + err.message); continue; }
      if (items.length) out.push({ source: src, items });
    }
    return { groups: out, errors };
  },

  async _remind(message, at) {
    if (!window.VexQuickReminder || typeof window.VexQuickReminder.create !== 'function') throw new Error('Reminders are not available here');
    return window.VexQuickReminder.create(message, new Date(at));
  },

  // ---- top 3 -------------------------------------------------------------------------------
  // lines: [{ text, task? }]; empty lines are skipped; at most 3. -> how many were set.
  setTop3(lines, now = Date.now()) {
    const day = VexPlanKit.isoDay(VexPlanKit.addDays(VexPlanKit.startOfDay(now), 1));
    const take = (Array.isArray(lines) ? lines : []).map(l => ({ text: String(l && l.text || '').replace(/\s+/g, ' ').trim(), task: l && l.task })).filter(l => l.text);
    if (take.length > 3) throw new Error('Three is the limit: pick the three that matter');
    let n = 0;
    for (const l of take) {
      if (l.task && l.task.plain === l.text) VexPlanKit.setTaskDate(l.task, day);
      else {
        if (typeof OpenTasks === 'undefined') throw new Error('Open tasks are not loaded');
        OpenTasks.add(l.text + ' @' + day);
      }
      n++;
    }
    return n;
  },

  // ---- the dialog ------------------------------------------------------------------------------
  open() {
    if (!this.enabled()) { window.showToast?.('Close the day is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('close-day');
    const now = Date.now();
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-close-day', title: 'Close the day', sub: 'Decide what happens to what is still open, then name the three things for tomorrow.' });
    let res;
    try { res = this.collect(now); } catch (err) { body.appendChild(VexSettingsGroups.note('Could not read what is open: ' + err.message)); return; }
    if (!res.groups.length) body.appendChild(VexSettingsGroups.note('Nothing is hanging open: no tasks for today, no parked contexts, nothing unsaved.'));
    for (const { source, items } of res.groups) {
      const h = document.createElement('div');
      h.className = 'vex-platform-note';
      h.style.fontWeight = '650';
      h.textContent = source.title + ' · ' + items.length;
      body.appendChild(h);
      const list = document.createElement('div');
      list.className = 'vexsr-list';
      for (const it of items) {
        const { row, chip } = VexPlanKit.listRow('open', it.text + (it.sub ? '  (' + it.sub + ')' : ''));
        const box = document.createElement('span');
        box.style.cssText = 'display:inline-flex;gap:6px;margin-left:auto';
        for (const a of source.actions) {
          box.appendChild(VexSettingsGroups.button(a.label, async () => {
            try { await a.run(it); chip.textContent = a.label.toLowerCase(); box.remove(); }
            catch (err) { window.showToast?.(err.message, 'error'); }
          }, { label: a.label + ': ' + it.text }));
        }
        row.appendChild(box);
        list.appendChild(row);
      }
      body.appendChild(list);
    }
    if (res.errors.length) body.appendChild(VexSettingsGroups.note('Could not read: ' + res.errors.join('; ')));

    // Top 3
    const h3 = document.createElement('div');
    h3.className = 'vex-platform-note';
    h3.style.cssText = 'font-weight:650;margin-top:12px';
    h3.textContent = 'Top 3 for tomorrow';
    body.appendChild(h3);
    let existing = [];
    try { existing = VexPlanKit.openTasks(now).slice(0, 40); } catch (err) { body.appendChild(VexSettingsGroups.note('Could not list your tasks to pick from: ' + err.message)); }
    const slots = [];
    for (let i = 0; i < 3; i++) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:6px;margin:4px 0';
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'set-input'; input.style.flex = '1'; input.maxLength = 200;
      input.setAttribute('aria-label', 'Tomorrow, number ' + (i + 1)); input.placeholder = (i + 1) + '. What matters tomorrow';
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Or pick a task you already have, number ' + (i + 1));
      const none = document.createElement('option'); none.value = ''; none.textContent = 'or pick a task'; sel.appendChild(none);
      existing.forEach((t, k) => { const o = document.createElement('option'); o.value = String(k); o.textContent = VexPlanKit.line(t.plain, 50); sel.appendChild(o); });
      const slot = { input, task: null };
      sel.addEventListener('change', () => { const t = existing[Number(sel.value)]; slot.task = t || null; if (t) input.value = t.plain; });
      input.addEventListener('input', () => { if (slot.task && slot.task.plain !== input.value.trim()) slot.task = null; });
      wrap.append(input, sel);
      body.appendChild(wrap);
      slots.push(slot);
    }
    body.appendChild(VexSettingsGroups.button('Set tomorrow and finish', () => {
      try {
        const n = this.setTop3(slots.map(s => ({ text: s.input.value, task: s.task })), now);
        window.showToast?.(n ? n + (n === 1 ? ' task' : ' tasks') + ' set for tomorrow' : 'Day closed', 'info');
        close();
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }, { primary: true }));
  },

  // ---- the optional evening notice ----------------------------------------------------------------
  nudgeDue(now = Date.now(), prefs = this.prefs(), last = '') {
    if (!prefs.nudgeAt) return false;
    const [h, m] = prefs.nudgeAt.split(':').map(Number);
    const at = VexPlanKit.startOfDay(now) + (h * 60 + m) * 60000;
    return now >= at && last !== VexPlanKit.isoDay(now);
  },
  nudge(now = Date.now()) {
    if (!this.enabled()) return false;
    let last = '';
    try { last = localStorage.getItem(this.NUDGED) || ''; } catch (err) { window.VexProblems?.note('Close the day', 'Could not read when the notice was last shown', err); }
    if (!this.nudgeDue(now, this.prefs(), last)) return false;
    if (typeof VexAttention === 'undefined') throw new Error('The attention gate is not loaded');
    const day = VexPlanKit.isoDay(now);
    const d = VexAttention.notify({
      feature: this.FEATURE, label: 'Close the day', urgency: 'useful', id: day, title: 'Close the day?', body: 'Decide what stays open and name three things for tomorrow.', action: { label: 'Close the day', key: 'open' },
    }, () => window.showToast?.('Close the day? Three things for tomorrow.', 'info', 12000, { action: { label: 'Open', run: () => this.open() } }));
    // A notice held back by the gate counts as made: it waits in the Attention Inbox.
    if (d.route !== 'drop') { try { localStorage.setItem(this.NUDGED, day); } catch (err) { window.VexProblems?.note('Close the day', 'Could not remember the notice for today', err); } }
    return d.route !== 'drop';
  },
  _syncJob() {
    if (typeof VexJobs === 'undefined') return;
    VexJobs.stop(this.JOB);
    if (this.enabled() && this.prefs().nudgeAt) {
      VexJobs.every(this.JOB, 5 * 60 * 1000, () => this.nudge(), { feature: this.FEATURE });
    }
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') VexLedger.registerStop('close-day-off', () => { this.setEnabled(false); });
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle(this.FEATURE, (key) => { if (key !== 'open') throw new Error('Unknown action ' + key); this.open(); });
    this._syncJob();
    return true;
  },

  group(el) {
    const p = this.prefs();
    el.appendChild(VexSettingsGroups.note('One dialog at the end of the day: what is still open (tasks for today, parked contexts, an unsaved note) with Keep, Tomorrow or Drop, then your top 3 for tomorrow. Ctrl+K › Close the day.'));
    const row = document.createElement('div'); row.className = 'setting-toggle-row';
    const lab = document.createElement('span'); lab.textContent = 'Offer it at (empty = never)';
    const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = '21:30'; inp.value = p.nudgeAt; inp.maxLength = 5; inp.setAttribute('aria-label', 'Hour to offer closing the day');
    inp.addEventListener('change', () => { try { this.setPrefs({ nudgeAt: inp.value.trim() }); } catch (err) { window.showToast?.(err.message, 'error'); inp.value = this.prefs().nudgeAt; } });
    row.append(lab, inp);
    el.appendChild(row);
    el.appendChild(VexSettingsGroups.button('Close the day now', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexCloseDay = VexCloseDay;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'close-day', title: 'Close the day', keywords: 'close day evening sweep tomorrow top 3 tasks parked unsaved', before: 'about', build: (el) => VexCloseDay.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'close-day', label: 'Close the day', hint: 'Sweep what is open, then name three things for tomorrow', icon: 'moon', action: () => VexCloseDay.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCloseDay };
