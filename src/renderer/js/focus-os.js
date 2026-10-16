// === Focus OS: goal -> proposed blocks -> run them ============================
//
// You state a goal ("ship the release by Friday, 6 hours"). Vex looks at what
// is already on your days and PROPOSES work blocks; you confirm them; each
// block starts only when you start it (or, for a goal you opted in, a minute
// after its time comes). While a block runs it can bring along:
//
//   the focus flow     a Focus Flow (js/focus-flows.js) chosen for the goal
//   a budget           a distraction-budget limit for chosen site kinds
//   quiet              the notification quiet-hours window, for the block only
//
// Everything outside this file is OPTIONAL and reached through typeof guards:
// each of those modules lives in a different branch and may be absent. An
// absent one is skipped and said so, never an error.
//
//   Calendar      IcsCalendar.between, Calendar.occurrences   events -> busy
//   Quiet hours   window.vex.quiet.get/set                    held notifications
//   Wind-down     ThemeAuto.windState()                       no blocks then
//   Budget        DistractionBudget.state()/save()            per-kind limit
//   Flows         FocusFlows._load()/activate()/end()         the scene
//   Brief         VexBrief.register()                         one line a day
//   Review        VexReview.addSection()                      the weekly look
//   Medals        'vex:medal-signal' {id}                     milestones
//
// What it never does: start anything by itself unless the goal says so,
// count a skipped block against you, keep a streak, or make a sound while a
// game is running. The pure maths is in focus-os-planner.js.
const FocusOS = {
  KEY: 'vex.focusOS',
  OVERRUN_MS: 15 * 60000,       // a block left running this long past its end finishes itself
  _state: null,
  _job: null,
  _busy: false,

  // ---- plumbing --------------------------------------------------------------
  _P() {
    const p = (typeof FocusOSPlanner !== 'undefined') ? FocusOSPlanner : (typeof window !== 'undefined' ? window.FocusOSPlanner : null);
    if (!p) throw new Error('Focus OS needs focus-os-planner.js');
    return p;
  },
  _id(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
  _gaming() {
    try {
      return (typeof GameMode !== 'undefined' && !!GameMode.gaming) || (typeof GameSession !== 'undefined' && !!GameSession.active);
    } catch { return false; }
  },
  // Toasts are the one thing Game mode silences outright.
  _say(text, kind) { if (this._gaming()) return; if (typeof VexAttention !== 'undefined' && !VexAttention.gate('focus-os', text)) return; try { window.showToast?.(text, kind || 'info'); } catch { /* no toast layer */ } },
  _medal(id) {
    const s = this.state();
    if (s.milestones[id]) return;
    s.milestones[id] = Date.now();
    try { this._write(); } catch { /* the medal is not worth failing for */ }
    try { document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id } })); } catch { /* no document */ }
  },
  _changed() { try { document.dispatchEvent(new CustomEvent('vex:focus-os-changed')); } catch { /* no document */ } },

  // ---- storage --------------------------------------------------------------
  defaults() {
    const d = this._P().DEFAULTS;
    return {
      v: 1, goals: [], blocks: [], active: null, milestones: {},
      settings: { workFrom: d.workFrom, workTo: d.workTo, blockMin: d.blockMin, breakMin: d.breakMin, maxPerDay: d.maxPerDay, meals: d.meals.map(m => ({ ...m })), brief: true, weekly: true },
    };
  },
  state() {
    if (this._state) return this._state;
    const d = this.defaults();
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (err) { console.error('[FocusOS] saved state unreadable, starting empty:', err.message); }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (Array.isArray(raw.goals)) d.goals = raw.goals.filter(g => g && typeof g.id === 'string');
      if (Array.isArray(raw.blocks)) d.blocks = raw.blocks.filter(b => b && typeof b.id === 'string' && Number.isFinite(b.start) && Number.isFinite(b.end));
      if (raw.active && typeof raw.active === 'object' && typeof raw.active.blockId === 'string') d.active = raw.active;
      if (raw.milestones && typeof raw.milestones === 'object') d.milestones = raw.milestones;
      if (raw.settings && typeof raw.settings === 'object') d.settings = { ...d.settings, ...raw.settings };
    }
    this._state = d;
    return d;
  },
  _reload() { this._state = null; return this.state(); },
  // Throws when storage refuses: the caller must not say it saved.
  _write() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.state())); }
    catch (err) { throw new Error('Focus OS could not save: ' + ((err && err.message) || 'storage refused the write'), { cause: err }); }
  },
  settings() { return this.state().settings; },
  setSettings(patch) {
    const P = this._P(), s = this.settings(), next = { ...s };
    for (const k of ['workFrom', 'workTo']) if (k in patch) { P._needHM(patch[k], k === 'workFrom' ? 'Work day start' : 'Work day end'); next[k] = patch[k]; }
    if (P.parseHM(next.workFrom) >= P.parseHM(next.workTo)) throw new Error('The work day must end after it starts');
    for (const [k, lo, hi, what] of [['blockMin', 10, 180, 'Block length'], ['breakMin', 0, 60, 'Break'], ['maxPerDay', 1, 10, 'Blocks per day']]) {
      if (!(k in patch)) continue;
      const v = Number(patch[k]);
      if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(what + ' must be a whole number from ' + lo + ' to ' + hi);
      next[k] = v;
    }
    if ('meals' in patch) {
      if (!Array.isArray(patch.meals) || patch.meals.length > 6) throw new Error('At most 6 meal windows');
      next.meals = patch.meals.map(m => { P._needHM(m && m.from, 'Meal start'); P._needHM(m && m.to, 'Meal end'); return { from: m.from, to: m.to }; });
    }
    for (const k of ['brief', 'weekly']) if (k in patch) { if (typeof patch[k] !== 'boolean') throw new Error(k + ' is on or off'); next[k] = patch[k]; }
    this.state().settings = next;
    this._write();
    this._changed();
    return next;
  },

  // ---- goals ----------------------------------------------------------------
  goals() { return this.state().goals; },
  goal(id) { return this.goals().find(g => g.id === id) || null; },
  blocks(goalId) { const b = this.state().blocks; return goalId ? b.filter(x => x.goalId === goalId) : b; },

  _checkGoal(f, { creating }) {
    const t = String(f.title == null ? '' : f.title).trim();
    if (!t) throw new Error('Give the goal a title');
    if (t.length > 120) throw new Error('Keep the title under 120 characters');
    if (!Number.isFinite(f.deadline)) throw new Error('The goal needs a deadline');
    if (creating && f.deadline <= Date.now()) throw new Error('The deadline has already passed');
    const est = Number(f.estimateMin);
    if (!Number.isInteger(est) || est < 15 || est > 6000) throw new Error('Estimated effort must be whole minutes from 15 to 6000');
    if (f.flowId && typeof f.flowId !== 'string') throw new Error('The focus flow is not valid');
    let budget = null;
    if (f.budget) {
      const cats = Array.isArray(f.budget.categories) ? f.budget.categories : [];
      const min = Number(f.budget.minutes);
      if (cats.length && !(Number.isInteger(min) && min >= 1 && min <= 1440)) throw new Error('A budget limit is whole minutes from 1 to 1440');
      if (cats.length) budget = { categories: [...new Set(cats.map(String))], minutes: min, mode: f.budget.mode === 'block' ? 'block' : 'nudge' };
    }
    return { title: t, deadline: f.deadline, estimateMin: est, flowId: f.flowId || '', budget, quiet: f.quiet === true, autoStart: f.autoStart === true, remind: f.remind === true };
  },
  addGoal(fields) {
    const g = { id: this._id('g'), ...this._checkGoal(fields, { creating: true }), status: 'active', createdAt: Date.now() };
    this.state().goals.push(g);
    this._write();
    this._medal('focus-os-first-goal');
    this._changed();
    return g;
  },
  updateGoal(id, patch) {
    const g = this.goal(id);
    if (!g) throw new Error('That goal is gone');
    Object.assign(g, this._checkGoal({ ...g, ...patch }, { creating: false }));
    this._write();
    this._changed();
    return g;
  },
  async removeGoal(id) {
    const s = this.state();
    if (!this.goal(id)) throw new Error('That goal is gone');
    const run = s.active && this.blocks(id).some(b => b.id === s.active.blockId);
    if (run) await this._release();
    for (const b of this.blocks(id)) await this._dropReminder(b);
    s.goals = s.goals.filter(g => g.id !== id);
    s.blocks = s.blocks.filter(b => b.goalId !== id);
    this._write();
    this._changed();
  },
  completeGoal(id) {
    const g = this.goal(id);
    if (!g) throw new Error('That goal is gone');
    g.status = 'done'; g.completedAt = Date.now();
    // Whatever was still waiting is simply cleared away.
    this.state().blocks = this.state().blocks.filter(b => !(b.goalId === id && (b.state === 'proposed' || b.state === 'planned')));
    this._write();
    this._medal('focus-os-goal-done');
    this._changed();
    return g;
  },
  reopenGoal(id) {
    const g = this.goal(id);
    if (!g) throw new Error('That goal is gone');
    g.status = 'active'; delete g.completedAt;
    this._write();
    this._changed();
    return g;
  },

  // ---- what is already on the days ---------------------------------------------
  // Everything optional; `sources` says which were really read so the panel can
  // be honest ("planned around reminders only").
  async context(from, to) {
    const P = this._P(), st = this.settings();
    const out = { busy: [], blocked: [], sources: {}, warnings: [] };
    // Meals.
    out.blocked.push(...st.meals.map(m => ({ from: m.from, to: m.to })));
    out.sources.meals = st.meals.length > 0;
    // Calendar subscriptions.
    try {
      if (typeof IcsCalendar !== 'undefined' && typeof IcsCalendar.between === 'function') {
        out.busy.push(...P.busyFromEvents(IcsCalendar.between(from, to)));
        out.sources.calendar = true;
      } else out.sources.calendar = false;
    } catch (err) { out.sources.calendar = false; out.warnings.push('Calendar: ' + ((err && err.message) || 'unavailable')); }
    // Reminders (a quarter of an hour each: a reminder is a moment, not a slot).
    try {
      const b = window.vex && window.vex.reminders;
      if (b && typeof b.list === 'function' && typeof Calendar !== 'undefined' && typeof Calendar.occurrences === 'function') {
        for (const r of (await b.list()) || []) {
          if (r.kind && r.kind !== 'reminder') continue;
          if (r.focusOsBlock) continue;       // our own block reminders are not obstacles
          for (const at of Calendar.occurrences(r, from, to)) out.busy.push({ start: at, end: at + 15 * 60000 });
        }
        out.sources.reminders = true;
      } else out.sources.reminders = false;
    } catch (err) { out.sources.reminders = false; out.warnings.push('Reminders: ' + ((err && err.message) || 'unavailable')); }
    // Quiet hours.
    try {
      const q = window.vex && window.vex.quiet;
      if (q && typeof q.get === 'function') {
        const c = await q.get();
        // While a block borrows the window, the user's own is the one saved.
        const own = this.state().active && this.state().active.quiet ? this.state().active.quiet.prev : c;
        if (own && own.enabled) out.blocked.push({ from: own.start, to: own.end });
        out.sources.quiet = true;
      } else out.sources.quiet = false;
    } catch (err) { out.sources.quiet = false; out.warnings.push('Quiet hours: ' + ((err && err.message) || 'unavailable')); }
    // Wind-down.
    try {
      if (typeof ThemeAuto !== 'undefined' && typeof ThemeAuto.windState === 'function') {
        const w = ThemeAuto.windState();
        if (w && w.on) out.blocked.push({ from: w.start, to: w.end });
        out.sources.windDown = true;
      } else out.sources.windDown = false;
    } catch (err) { out.sources.windDown = false; out.warnings.push('Wind-down: ' + ((err && err.message) || 'unavailable')); }
    return out;
  },

  // ---- proposing -------------------------------------------------------------------
  // Replaces this goal's earlier proposal. Nothing is on the calendar yet.
  async propose(goalId, now = Date.now()) {
    const P = this._P(), s = this.state(), g = this.goal(goalId), st = s.settings;
    if (!g) throw new Error('That goal is gone');
    if (g.status !== 'active') throw new Error('That goal is finished; reopen it to plan more');
    this._lapse(now);
    s.blocks = s.blocks.filter(b => !(b.goalId === goalId && b.state === 'proposed'));
    const remaining = P.remainingMinutes(g, s.blocks);
    const ctx = await this.context(now, g.deadline);
    const plan = P.planBlocks({
      remainingMin: remaining, deadline: g.deadline, now, goalId,
      busy: ctx.busy, blocked: ctx.blocked, existing: s.blocks.filter(b => b.state === 'planned' || b.state === 'active'),
      workFrom: st.workFrom, workTo: st.workTo, blockMin: st.blockMin, breakMin: st.breakMin, maxPerDay: st.maxPerDay,
    });
    const made = plan.blocks.map(b => ({ id: this._id('b'), goalId, start: b.start, end: b.end, state: 'proposed' }));
    s.blocks.push(...made);
    this._write();
    this._changed();
    return { ...plan, blocks: made, remainingMin: remaining, sources: ctx.sources, warnings: ctx.warnings };
  },
  proposed(goalId) { return this.blocks(goalId).filter(b => b.state === 'proposed'); },
  async discard(goalId) {
    const s = this.state();
    s.blocks = s.blocks.filter(b => !(b.goalId === goalId && b.state === 'proposed'));
    this._write();
    this._changed();
  },

  // The user said yes.
  async confirmGoal(goalId) {
    const P = this._P(), s = this.state(), g = this.goal(goalId);
    if (!g) throw new Error('That goal is gone');
    const mine = this.proposed(goalId);
    if (!mine.length) throw new Error('There is nothing proposed to confirm');
    const errors = [];
    for (const b of mine) {
      Object.assign(b, P.transition(b, 'confirm'));
      if (g.remind) {
        try { await this._addReminder(g, b); } catch (err) { errors.push(err.message); }
      }
    }
    this._write();
    this._medal('focus-os-first-plan');
    this._changed();
    if (errors.length) throw new Error('Planned, but a reminder could not be set: ' + errors[0]);
    return mine;
  },
  async _addReminder(g, b) {
    const r = window.vex && window.vex.reminders;
    if (!r || typeof r.create !== 'function') throw new Error('Reminders are not available in this window');
    const made = await r.create('Focus block: ' + g.title, b.start, { focusOsBlock: b.id });
    if (made && made.id) b.reminderId = made.id;
  },
  async _dropReminder(b) {
    if (!b.reminderId) return;
    const r = window.vex && window.vex.reminders;
    const id = b.reminderId;
    delete b.reminderId;
    if (r && typeof r.delete === 'function') { try { await r.delete(id); } catch (err) { console.error('[FocusOS] could not remove a block reminder:', err.message); } }
  },

  // ---- acting on one block ---------------------------------------------------------
  block(id) { return this.state().blocks.find(b => b.id === id) || null; },
  active() {
    const s = this.state();
    return s.active ? this.block(s.active.blockId) : null;
  },
  next(now = Date.now()) {
    return this.state().blocks.filter(b => b.state === 'planned' && b.end > now).sort((a, c) => a.start - c.start)[0] || null;
  },
  _lapse(now) {
    const P = this._P(), s = this.state();
    const gone = P.lapse(s.blocks, now);
    for (const g of gone) Object.assign(this.block(g.id), g);
    return gone.length;
  },

  async start(blockId, { auto = false, now = Date.now() } = {}) {
    const P = this._P(), s = this.state(), b = this.block(blockId);
    if (!b) throw new Error('That block is gone');
    const g = this.goal(b.goalId);
    if (!g || g.status !== 'active') throw new Error('Its goal is finished');
    if (s.active) throw new Error('A block is already running; finish it first');
    const next = P.transition(b, 'start', now);
    Object.assign(b, next);
    s.active = { blockId, startedAt: now, flowId: null, quiet: null, budget: null };
    this._write();
    const notes = await this._apply(g, b, now, auto);
    this._write();
    this._medal('focus-os-first-block');
    this._changed();
    this._say((auto ? 'Starting ' : 'Started ') + '"' + g.title + '"' + (notes.length ? ' — ' + notes.join(', ') : ''));
    // Only a block Vex started by itself belongs in the "Why did that happen?" list (js/vex-ledger.js).
    if (auto && typeof VexLedger !== 'undefined') {
      VexLedger.note({
        feature: 'focus-os',
        what: 'Started the focus block "' + String(g.title).slice(0, 60) + '"' + (notes.length ? ' (' + notes.join(', ').slice(0, 80) + ')' : ''),
        why: 'It was planned for now and its goal is set to start by itself.',
        undo: { kind: 'focus-finish', blockId },
        stop: { kind: 'focus-no-autostart', goalId: g.id },
      });
    }
    return b;
  },

  async finish(blockId, { now = Date.now(), quiet = false } = {}) {
    const P = this._P(), s = this.state(), b = this.block(blockId);
    if (!b) throw new Error('That block is gone');
    Object.assign(b, P.transition(b, 'finish', now));
    const errs = (s.active && s.active.blockId === blockId) ? await this._release() : [];
    this._write();
    this._changed();
    if (!quiet) this._say(this.progressLine(now));
    const day = P.dayProgress(s.blocks, now);
    if (day.total > 0 && day.done === day.total) this._medal('focus-os-day-clear');
    if (errs.length) throw new Error('The block is done, but putting things back failed: ' + errs[0]);
    return b;
  },

  async skip(blockId, now = Date.now()) {
    const P = this._P(), s = this.state(), b = this.block(blockId);
    if (!b) throw new Error('That block is gone');
    const wasActive = s.active && s.active.blockId === blockId;
    Object.assign(b, P.transition(b, 'skip', now));
    await this._dropReminder(b);
    const errs = wasActive ? await this._release() : [];
    this._write();
    this._changed();
    if (errs.length) throw new Error('The block is skipped, but putting things back failed: ' + errs[0]);
    return b;
  },

  restore(blockId) {
    const P = this._P(), b = this.block(blockId);
    if (!b) throw new Error('That block is gone');
    if (b.end <= Date.now()) throw new Error('That time has passed; plan new blocks instead');
    Object.assign(b, P.transition(b, 'restore'));
    this._write();
    this._changed();
    return b;
  },

  // ---- bringing the scene along ---------------------------------------------------
  _hm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); },
  async _apply(g, b, now, auto) {
    const notes = [];
    const rec = this.state().active;
    // Focus flow: a scene you started yourself is never replaced.
    try {
      if (g.flowId && typeof FocusFlows !== 'undefined' && typeof FocusFlows._load === 'function' && typeof FocusFlows.activate === 'function') {
        const flow = FocusFlows._load().find(f => f && f.id === g.flowId);
        if (!flow) notes.push('its focus flow no longer exists');
        else if (FocusFlows._active) notes.push('your own flow stays on');
        else {
          // No tabs are opened by a block nobody started by hand.
          FocusFlows.activate(auto ? { ...flow, openTabs: [] } : flow);
          rec.flowId = flow.id;
          notes.push('flow "' + flow.name + '"');
        }
      }
    } catch (err) { notes.push('flow failed: ' + err.message); }
    // Distraction budget for the kinds named.
    try {
      if (g.budget && g.budget.categories.length && typeof DistractionBudget !== 'undefined' && typeof DistractionBudget.state === 'function' && typeof DistractionBudget.save === 'function') {
        const st = DistractionBudget.state();
        const prev = { enabled: st.enabled, limits: {}, modes: {} };
        const cats = g.budget.categories.filter(c => !Array.isArray(DistractionBudget.CATEGORIES) || DistractionBudget.CATEGORIES.includes(c));
        for (const c of cats) { prev.limits[c] = st.limits[c] == null ? null : st.limits[c]; prev.modes[c] = st.modes[c] || null; }
        rec.budget = { prev, cats };
        this._write();
        st.enabled = true;
        for (const c of cats) {
          st.limits[c] = st.limits[c] ? Math.min(st.limits[c], g.budget.minutes) : g.budget.minutes;
          if (g.budget.mode === 'block') st.modes[c] = 'block';
        }
        if (DistractionBudget.save() === false) throw new Error('storage refused the write');
        if (cats.length) notes.push('budget ' + g.budget.minutes + ' min');
      }
    } catch (err) { notes.push('budget failed: ' + err.message); }
    // Quiet hours, for the length of the block only.
    try {
      const q = window.vex && window.vex.quiet;
      if (g.quiet && q && typeof q.get === 'function' && typeof q.set === 'function') {
        const cur = await q.get();
        if (cur.enabled && cur.inWindow) notes.push('already quiet');
        else {
          const end = Math.max(b.end, now + 10 * 60000);
          rec.quiet = { prev: { enabled: cur.enabled, start: cur.start, end: cur.end } };
          this._write();
          await q.set({ enabled: true, start: this._hm(now), end: this._hm(end) });
          notes.push('quiet until ' + this._hm(end));
        }
      }
    } catch (err) { notes.push('quiet hours failed: ' + err.message); }
    return notes;
  },

  // Puts back what _apply changed. Returns the problems, never throws midway:
  // one thing failing must not leave the others on.
  async _release() {
    const s = this.state(), rec = s.active, errs = [];
    if (!rec) return errs;
    try {
      if (rec.budget && typeof DistractionBudget !== 'undefined' && typeof DistractionBudget.state === 'function') {
        const st = DistractionBudget.state();
        st.enabled = rec.budget.prev.enabled;
        for (const c of rec.budget.cats) {
          if (rec.budget.prev.limits[c] == null) delete st.limits[c]; else st.limits[c] = rec.budget.prev.limits[c];
          if (rec.budget.prev.modes[c] == null) delete st.modes[c]; else st.modes[c] = rec.budget.prev.modes[c];
        }
        if (DistractionBudget.save() === false) throw new Error('storage refused the write');
      }
    } catch (err) { errs.push('budget: ' + err.message); }
    try {
      const q = window.vex && window.vex.quiet;
      if (rec.quiet && q && typeof q.set === 'function') await q.set({ enabled: rec.quiet.prev.enabled, start: rec.quiet.prev.start, end: rec.quiet.prev.end });
    } catch (err) { errs.push('quiet hours: ' + err.message); }
    try {
      if (rec.flowId && typeof FocusFlows !== 'undefined' && FocusFlows._active && FocusFlows._active.flow && FocusFlows._active.flow.id === rec.flowId) FocusFlows.end();
    } catch (err) { errs.push('flow: ' + err.message); }
    s.active = null;
    try { this._write(); } catch (err) { errs.push(err.message); }
    if (errs.length) { try { window.showToast?.('Focus OS could not put everything back: ' + errs[0], 'error'); } catch { /* no toast layer */ } }
    return errs;
  },

  // ---- the minute check -------------------------------------------------------------
  async tick(now = Date.now()) {
    if (this._busy) return null;
    this._busy = true;
    try {
      const P = this._P(), s = this.state();
      let dirty = this._lapse(now) > 0;
      // A running block left alone well past its end finishes itself.
      const run = this.active();
      if (s.active && !run) { await this._release(); dirty = true; }
      else if (run && now >= run.end + this.OVERRUN_MS) { await this.finish(run.id, { now, quiet: true }); dirty = false; }
      let started = null;
      if (!this._gaming() && !s.active) {
        const due = P.dueForAutoStart(s.goals, s.blocks, now);
        if (due) { await this.start(due.id, { auto: true, now }); started = due; dirty = false; }
      }
      if (dirty) { this._write(); this._changed(); }
      return started;
    } finally { this._busy = false; }
  },

  // ---- words ----------------------------------------------------------------------------
  progressLine(now = Date.now()) {
    const P = this._P(), d = P.dayProgress(this.state().blocks, now);
    return d.text;
  },
  today(now = Date.now()) {
    const P = this._P(), key = P.dayKey(now);
    return this.state().blocks.filter(b => P.dayKey(b.start) === key && b.state !== 'proposed').sort((a, c) => a.start - c.start);
  },

  // ---- the weekly review: reuses weekly-review.js ------------------------------------
  async weeklySection(now = Date.now()) {
    const P = this._P(), s = this.state();
    if (!s.settings.weekly || !s.goals.length) return null;
    const w = P.weekSummary(s.goals, s.blocks, now);
    if (!w.blocksPlanned && !w.blocksDone) return null;
    const hrs = (m) => (m >= 60 ? (Math.round(m / 6) / 10) + ' h' : m + ' min');
    const items = [];
    for (const g of w.perGoal.slice(0, 5)) items.push({ text: g.title, sub: hrs(g.minutes) + ' of focus' });
    for (const t of w.goalsDone) items.push({ text: 'Finished: ' + t, sub: '' });
    if (w.blocksSkipped) items.push({ text: w.blocksSkipped + ' block' + (w.blocksSkipped === 1 ? '' : 's') + ' set aside', sub: 'plan them again whenever you like' });
    return { summary: w.blocksDone + ' of ' + w.blocksPlanned + ' planned blocks done, ' + hrs(w.minutesDone) + ' of focus.', items };
  },

  // ---- brief section ----------------------------------------------------------------------
  brief: {
    id: 'focus-os',
    title: 'Focus',
    icon: 'target',
    order: 35,
    defaultOn: true,
    isEnabled() {
      try {
        const s = FocusOS.state();
        return s.settings.brief !== false && s.goals.some(g => g.status === 'active') && !FocusOS._gaming();
      } catch { return false; }
    },
    build() {
      if (!this.isEnabled()) return null;
      const P = FocusOS._P(), now = Date.now(), s = FocusOS.state();
      const items = [];
      for (const g of s.goals.filter(x => x.status === 'active').slice(0, 3)) {
        const p = P.goalProgress(g, s.blocks);
        items.push({ text: g.title, sub: Math.round(p.fraction * 100) + '% of ' + Math.round(g.estimateMin / 6) / 10 + ' h, due ' + new Date(g.deadline).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) });
      }
      const nxt = FocusOS.next(now);
      return {
        summary: FocusOS.progressLine(now),
        items,
        note: nxt ? 'Next block at ' + new Date(nxt.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '',
      };
    },
  },
  registerBrief() {
    try {
      if (typeof VexBrief !== 'undefined' && typeof VexBrief.register === 'function') {
        VexBrief.register({ ...this.brief, build: () => this.brief.build(), isEnabled: () => this.brief.isEnabled() });
        return true;
      }
    } catch (err) { console.error('[FocusOS] could not join the brief:', err.message); }
    return false;
  },
  registerReview() {
    try {
      if (typeof VexReview !== 'undefined' && typeof VexReview.addSection === 'function') {
        VexReview.addSection({ id: 'focus-os', title: 'Focus blocks', build: (now) => this.weeklySection(now == null ? Date.now() : now) });
        return true;
      }
    } catch (err) { console.error('[FocusOS] could not join the weekly review:', err.message); }
    return false;
  },

  // ---- command bar ------------------------------------------------------------------------
  commands() {
    const fail = (err) => { try { window.showToast?.((err && err.message) || String(err), 'error'); } catch { /* no toast layer */ } };
    return [
      { id: 'focus-os', label: 'Focus OS: Goals and Work Blocks', hint: 'State a goal, review the blocks Vex proposes, then run them', icon: 'target', isPrimary: true, action: () => { if (typeof FocusOSUI !== 'undefined') FocusOSUI.open(); } },
      { id: 'focus-os-new', label: 'Focus OS: New Goal', hint: 'e.g. "ship the release by Friday, 6 hours" — Vex proposes the blocks, you confirm', icon: 'plus', action: () => { if (typeof FocusOSUI !== 'undefined') FocusOSUI.newGoal().catch(fail); } },
      { id: 'focus-os-next', label: 'Focus OS: Start the Next Block', hint: 'Starts the next planned block with its flow, budget and quiet hours', icon: 'play', action: async () => {
        try {
          const n = FocusOS.next();
          if (!n) { window.showToast?.('No block is planned. Open Focus OS to plan some.'); return; }
          await FocusOS.start(n.id);
        } catch (err) { fail(err); }
      } },
      { id: 'focus-os-done', label: 'Focus OS: Finish the Running Block', hint: 'Marks it done and puts the quiet hours, budget and flow back', icon: 'check', action: async () => {
        try {
          const a = FocusOS.active();
          if (!a) { window.showToast?.('No block is running'); return; }
          await FocusOS.finish(a.id);
        } catch (err) { fail(err); }
      } },
    ];
  },
  registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return false;
    CommandBar.commands = CommandBar.commands.filter(c => !String(c.id || '').startsWith('focus-os'));
    for (const c of this.commands()) CommandBar.commands.push(c);
    return true;
  },

  // ---- start-up ---------------------------------------------------------------------------
  async init() {
    const out = { brief: this.registerBrief(), review: this.registerReview(), commands: this.registerCommands() };
    try {
      // A restart while a block ran: put back what it borrowed if the block is no longer running.
      const s = this.state();
      if (s.active && !this.active()) await this._release();
      await this.tick();
    } catch (err) { console.error('[FocusOS] start-up check failed:', err.message); }
    if (!this._job && typeof VexJobs !== 'undefined') {
      this._job = VexJobs.every('Focus OS', 30000, () => this.tick().catch(err => console.error('[FocusOS] tick failed:', err.message)), { when: 'background' });
    }
    // The brief and review modules may load after this one.
    if (!out.brief || !out.review || !out.commands) {
      setTimeout(() => { this.registerBrief(); this.registerReview(); this.registerCommands(); }, 3000);
    }
    return out;
  },
};

// "Why did that happen?" (js/vex-ledger.js): end the block that started by itself, or stop that goal starting blocks by itself.
if (typeof VexLedger !== 'undefined') {
  VexLedger.registerUndo('focus-finish', async (token) => {
    const run = FocusOS.active();
    if (!run || run.id !== token.blockId) throw new Error('That block is no longer running');
    await FocusOS.finish(token.blockId, { quiet: true });
  });
  VexLedger.registerStop('focus-no-autostart', async (token) => {
    const g = FocusOS.goal(token.goalId);
    if (!g) throw new Error('That goal is gone');
    g.autoStart = false;
    FocusOS._write();
    FocusOS._changed();
  });
}

if (typeof window !== 'undefined') window.FocusOS = FocusOS;
if (typeof module !== 'undefined' && module.exports) module.exports = { FocusOS };
