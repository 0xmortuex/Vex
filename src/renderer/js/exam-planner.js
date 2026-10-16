// === Exam countdown planner and revision schedule ==============================
//
// You enter an exam: course, title, date and the topics with the hours each needs.
// Vex PROPOSES, and you confirm:
//
//   * T-minus reminders at 09:00, 14, 7, 3 and 1 days before (the ones still to come);
//   * one Focus OS goal ("Revise <course>: <title>") whose deadline is the start of the
//     exam, sized by the hours you gave. Focus OS then proposes work blocks around your
//     calendar, reminders, meals and quiet hours (the due-ness / calendar engine of
//     js/focus-os.js); you confirm the blocks there as for any goal.
//   * when blocks were missed, "Re-plan" asks Focus OS for a new proposal for the hours
//     that are still left, and a quiet suggestion appears in the Attention Inbox.
//
// FlashMind keeps the cards and the spaced repetition (js/flashmind-bridge.js); this keeps
// only the dates. An exam can name a FlashMind deck so the plan shows it.
//
// Nothing is created without a confirmation. Local only; no network.
//
//   VexExamPlanner.proposal(exam, now)   pure: { reminders, goal, warnings }
//   VexExamPlanner.dueItems(now)         exams in the shape of the due-ness list (read-only)
const VexExamPlanner = {
  KEY: 'vex.exams',
  PREF: 'vex.exams.enabled',
  OFFSETS: [14, 7, 3, 1],
  REMIND_HOUR: 9,
  MAX_EXAMS: 40,
  MAX_TOPICS: 30,
  JOB: 'Exam planner',

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF, on ? 'on' : 'off'); },

  // ---- store --------------------------------------------------------------------
  _read() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch (err) { throw new Error('The exams could not be read: ' + err.message); }
    if (!raw) return [];
    let a;
    try { a = JSON.parse(raw); } catch (err) { throw new Error('The saved exams are damaged: ' + err.message); }
    return (Array.isArray(a) ? a : []).filter(e => e && typeof e.id === 'string' && Number.isFinite(e.date));
  },
  _write(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); }
    catch (err) { throw new Error('The exams could not be saved: ' + err.message, { cause: err }); }
    try { document.dispatchEvent(new CustomEvent('vex:exams-changed')); } catch (err) { console.error('[ExamPlanner] event failed:', err); }
  },
  list() { return this._read().sort((a, b) => a.date - b.date); },
  get(id) { return this._read().find(e => e.id === id) || null; },

  // ---- pure -----------------------------------------------------------------------
  clean(f) {
    const title = String(f && f.title == null ? '' : f.title).trim();
    if (!title) throw new Error('Give the exam a title');
    if (title.length > 100) throw new Error('Keep the title under 100 characters');
    const course = String((f && f.course) || '').trim().slice(0, 80);
    const date = Number(f && f.date);
    if (!Number.isFinite(date)) throw new Error('The exam needs a date');
    const topics = (Array.isArray(f && f.topics) ? f.topics : []).map(t => ({ name: String((t && t.name) || '').trim().slice(0, 80), hours: Number(t && t.hours) })).filter(t => t.name);
    if (topics.length > this.MAX_TOPICS) throw new Error('At most ' + this.MAX_TOPICS + ' topics');
    for (const t of topics) if (!(t.hours >= 0.5 && t.hours <= 100)) throw new Error('Hours for "' + t.name + '" must be between 0.5 and 100');
    return { title, course, date, hasTime: f && f.hasTime === true, topics, deck: String((f && f.deck) || '').trim().slice(0, 100) };
  },
  totalMinutes(exam) { return Math.round(exam.topics.reduce((s, t) => s + t.hours, 0) * 60); },
  daysTo(exam, now = Date.now()) {
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    const d1 = new Date(exam.date); d1.setHours(0, 0, 0, 0);
    return Math.round((d1.getTime() - d0.getTime()) / 86400000);
  },
  // The instant revision must be done by: the start of the exam (or an hour before a timed one).
  deadline(exam) {
    if (exam.hasTime) return exam.date - 3600e3;
    const d = new Date(exam.date); d.setHours(0, 0, 0, 0);
    return d.getTime();
  },
  proposal(exam, now = Date.now()) {
    const warnings = [];
    const reminders = [];
    for (const k of this.OFFSETS) {
      const d = new Date(exam.date);
      d.setDate(d.getDate() - k);
      d.setHours(this.REMIND_HOUR, 0, 0, 0);
      if (d.getTime() > now) reminders.push({ at: d.getTime(), daysBefore: k, text: 'Exam in ' + (k === 1 ? '1 day' : k + ' days') + ': ' + (exam.course ? exam.course + ' - ' : '') + exam.title });
    }
    if (!reminders.length) warnings.push('The exam is too close for T-minus reminders.');
    const est = this.totalMinutes(exam);
    const deadline = this.deadline(exam);
    let goal = null;
    if (est < 15) warnings.push('Add topics with hours to get revision blocks.');
    else if (deadline <= now) warnings.push('The exam has started or passed, so no revision blocks can be planned.');
    else goal = { title: 'Revise ' + (exam.course ? exam.course + ': ' : '') + exam.title, deadline, estimateMin: Math.min(6000, est), remind: true };
    if (est > 6000) warnings.push('More than 100 hours is cut to 100 hours for the plan.');
    return { reminders, goal, warnings };
  },
  // Exams in the shape of the due-ness list ({id,kind,text,at,hasTime}); read-only, for the Due list
  // and the brief. kind 'event' so the ranking treats it as a calendar entry.
  dueItems(now = Date.now()) {
    return this.list().filter(e => e.date >= now - 3600e3).map(e => ({ id: 'exam:' + e.id, kind: 'event', text: (e.course ? e.course + ': ' : '') + e.title, at: e.date, hasTime: !!e.hasTime }));
  },
  briefLine(now = Date.now()) {
    const next = this.list().find(e => e.date >= now - 3600e3);
    if (!next) return null;
    const d = this.daysTo(next, now);
    return (next.course ? next.course + ' ' : '') + next.title + ': ' + (d <= 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days');
  },

  // ---- changes ------------------------------------------------------------------------
  add(fields) {
    const list = this._read();
    if (list.length >= this.MAX_EXAMS) throw new Error('At most ' + this.MAX_EXAMS + ' exams');
    const e = { id: 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...this.clean(fields), createdAt: Date.now(), goalId: '', reminderIds: [] };
    list.push(e);
    this._write(list);
    return e;
  },
  update(id, fields) {
    const list = this._read();
    const e = list.find(x => x.id === id);
    if (!e) throw new Error('That exam is gone');
    Object.assign(e, this.clean({ ...e, ...fields }));
    this._write(list);
    return e;
  },
  async remove(id) {
    const list = this._read();
    const e = list.find(x => x.id === id);
    if (!e) throw new Error('That exam is gone');
    // The plan made for it goes too, so no reminder is left for an exam that is gone.
    const errors = [];
    const b = window.vex && window.vex.reminders;
    for (const rid of e.reminderIds || []) {
      try { if (b && typeof b.delete === 'function') await b.delete(rid); } catch (err) { errors.push(err.message); }
    }
    if (e.goalId && typeof FocusOS !== 'undefined' && FocusOS.goal(e.goalId)) await FocusOS.removeGoal(e.goalId);
    this._write(list.filter(x => x.id !== id));
    if (errors.length) throw new Error('Removed, but a reminder could not be deleted: ' + errors[0]);
  },

  // ---- making the plan (asks first) -----------------------------------------------------
  async confirmPlan(id, now = Date.now()) {
    if (typeof FocusOS === 'undefined') throw new Error('Focus OS is not part of this build');
    const e = this.get(id);
    if (!e) throw new Error('That exam is gone');
    if (e.goalId && FocusOS.goal(e.goalId)) throw new Error('This exam already has a plan: use Re-plan');
    const p = this.proposal(e, now);
    if (!p.reminders.length && !p.goal) throw new Error(p.warnings.join(' ') || 'There is nothing to plan');
    const lines = [];
    if (p.reminders.length) lines.push(p.reminders.length + ' reminder(s) at 09:00: ' + p.reminders.map(r => new Date(r.at).toLocaleDateString()).join(', '));
    if (p.goal) lines.push('A Focus OS goal "' + p.goal.title + '" of ' + Math.round(p.goal.estimateMin / 60 * 10) / 10 + ' h before ' + new Date(p.goal.deadline).toLocaleString() + '. Vex then proposes the blocks; you confirm those too.');
    for (const w of p.warnings) lines.push(w);
    if (!await window.vexConfirm({ title: 'Plan for ' + e.title + '?', message: lines.join('\n\n'), okLabel: 'Create the plan' })) return null;
    const out = { reminders: 0, blocks: 0 };
    const list = this._read();
    const mine = list.find(x => x.id === id);
    mine.reminderIds = mine.reminderIds || [];
    for (const r of p.reminders) {
      const made = await this._remind(r.text, r.at);
      if (made && made.id) mine.reminderIds.push(made.id);
      out.reminders++;
    }
    if (p.goal) {
      const g = FocusOS.addGoal(p.goal);
      mine.goalId = g.id;
      this._write(list);
      const plan = await FocusOS.propose(g.id, now);
      out.blocks = plan.blocks.length;
      if (plan.blocks.length) await this._confirmBlocks(g.id, plan);
    } else this._write(list);
    return out;
  },
  async _remind(text, at) {
    if (typeof VexQuickReminder === 'undefined') throw new Error('Reminders are not available');
    return VexQuickReminder.create(text, new Date(at));
  },
  async _confirmBlocks(goalId, plan) {
    const when = plan.blocks.slice(0, 6).map(b => new Date(b.start).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })).join('\n');
    const more = plan.blocks.length > 6 ? '\n... and ' + (plan.blocks.length - 6) + ' more' : '';
    const ok = await window.vexConfirm({ title: plan.blocks.length + ' revision block(s) proposed', message: when + more + (plan.shortfallMin ? '\n\nThere is not room for everything: ' + plan.shortfallMin + ' min would not fit before the exam.' : ''), okLabel: 'Put them in my days' });
    if (ok) await FocusOS.confirmGoal(goalId); else await FocusOS.discard(goalId);
    return ok;
  },

  // Blocks of this exam's goal whose time passed untouched.
  missed(exam, now = Date.now()) {
    if (typeof FocusOS === 'undefined' || !exam.goalId || !FocusOS.goal(exam.goalId)) return 0;
    return FocusOS.blocks(exam.goalId).filter(b => b.state === 'skipped' && b.lapsed || (b.state === 'planned' && b.end <= now)).length;
  },
  async replan(id, now = Date.now()) {
    const e = this.get(id);
    if (!e || !e.goalId || typeof FocusOS === 'undefined' || !FocusOS.goal(e.goalId)) throw new Error('This exam has no plan yet');
    const plan = await FocusOS.propose(e.goalId, now);
    if (!plan.blocks.length) throw new Error(plan.remainingMin ? 'No free time was found before the exam for the ' + plan.remainingMin + ' min left' : 'Nothing is left to plan');
    return this._confirmBlocks(e.goalId, plan);
  },
  // The periodic look: a missed block becomes one quiet suggestion in the Attention Inbox.
  check(now = Date.now()) {
    if (!this.enabled() || typeof VexAttention === 'undefined') return 0;
    let n = 0;
    for (const e of this.list()) {
      if (e.date < now) continue;
      const m = this.missed(e, now);
      if (m > 0 && VexAttention.suggest({ feature: 'exam-planner', id: e.id + ':' + new Date(now).toDateString(), title: m + ' revision block(s) for ' + e.title + ' were missed', body: 'Open Exams and press Re-plan to fit the hours that are left.' })) n++;
    }
    return n;
  },

  // ---- screen ---------------------------------------------------------------------------------
  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('exam-planner');
    const G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-exams', title: 'Exams', sub: 'Dates and topics here; the cards stay in FlashMind. Plans are made only when you confirm.' });
    const draw = () => {
      body.textContent = '';
      body.appendChild(G.button('Add an exam', async () => { try { await this._addDialog(); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true }));
      const exams = this.list();
      if (!exams.length) body.appendChild(G.note('No exams yet.'));
      for (const e of exams) {
        const d = this.daysTo(e);
        const box = document.createElement('div');
        box.className = 'vexsr-rule';
        box.style.cssText = 'display:block;margin:10px 0';
        const t = document.createElement('div');
        t.textContent = (e.course ? e.course + ': ' : '') + e.title + ' - ' + new Date(e.date).toLocaleDateString() + (d >= 0 ? ' (' + (d === 0 ? 'today' : d + ' days') + ')' : ' (past)');
        const s = G.note(e.topics.length ? e.topics.map(x => x.name + ' ' + x.hours + ' h').join(', ') + (e.deck ? ' | FlashMind deck: ' + e.deck : '') : 'No topics yet' + (e.deck ? ' | FlashMind deck: ' + e.deck : ''));
        const m = this.missed(e);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
        const hasPlan = !!(e.goalId && typeof FocusOS !== 'undefined' && FocusOS.goal(e.goalId));
        if (hasPlan) row.appendChild(G.button(m ? 'Re-plan (' + m + ' missed)' : 'Re-plan', async () => { try { await this.replan(e.id); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
        else row.appendChild(G.button('Plan revision', async () => { try { const r = await this.confirmPlan(e.id); if (r) window.showToast?.('Plan made: ' + r.reminders + ' reminders, ' + r.blocks + ' blocks'); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
        row.appendChild(G.button('Remove', async () => {
          if (!await window.vexConfirm({ title: 'Remove this exam?', message: 'Its reminders and Focus OS goal are removed too.', okLabel: 'Remove', danger: true })) return;
          try { await this.remove(e.id); } catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }, { danger: true }));
        box.append(t, s, row);
        body.appendChild(box);
      }
    };
    draw();
  },

  async _addDialog() {
    const title = await window.vexPrompt({ title: 'Exam', label: 'Title', placeholder: 'Midterm', okLabel: 'Next' });
    if (title == null) return;
    const course = await window.vexPrompt({ title: 'Course or subject', label: 'Course (optional)', okLabel: 'Next' });
    if (course == null) return;
    const dateText = await window.vexPrompt({ title: 'Exam date', message: 'Write it like 2026-12-18 14:00, or in Turkish: 18 Aralık 14:00.', label: 'Date', okLabel: 'Next' });
    if (dateText == null) return;
    let date, hasTime = false;
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(dateText.trim());
    if (iso) { date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), iso[4] ? Number(iso[4]) : 0, iso[5] ? Number(iso[5]) : 0).getTime(); hasTime = !!iso[4]; }
    else if (typeof VexTrParse !== 'undefined') { const r = VexTrParse.parse(dateText); if (!r) throw new Error('Could not read that date'); date = r.at; hasTime = r.hasTime; if (!hasTime) { const d = new Date(date); d.setHours(0, 0, 0, 0); date = d.getTime(); } }
    else throw new Error('Write the date as YYYY-MM-DD HH:MM');
    const topicText = await window.vexPrompt({ title: 'Topics and hours', message: 'One per line: name, hours. For example "Integrals, 4".', multiline: true, label: 'Topics', okLabel: 'Add the exam' });
    if (topicText == null) return;
    const topics = topicText.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = /^(.*?)[,;:\t ]+(\d+(?:[.,]\d+)?)\s*(?:h|sa|saat)?$/i.exec(l); if (!m) throw new Error('Write each topic as "name, hours": "' + l + '"'); return { name: m[1], hours: Number(m[2].replace(',', '.')) }; });
    const deck = await window.vexPrompt({ title: 'FlashMind deck', message: 'The name of the deck in FlashMind for this exam (optional).', label: 'Deck', okLabel: 'Save' });
    this.add({ title, course, date, hasTime, topics, deck: deck || '' });
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Give an exam, its date and topics; Vex proposes reminders and revision blocks and creates them only after you confirm. Cards stay in FlashMind.'));
    el.appendChild(G.button('Open exams', () => this.open(), { primary: true }));
    const line = this.briefLine();
    if (line) el.appendChild(G.note('Next: ' + line));
  },

  init() {
    if (this._wired || typeof VexJobs === 'undefined') return;
    this._wired = true;
    VexJobs.every(this.JOB, 6 * 3600e3, () => this.check(), { feature: 'exam-planner' });
  },
};

if (typeof window !== 'undefined') {
  window.VexExamPlanner = VexExamPlanner;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'exam-planner', title: 'Exams', keywords: 'exam countdown revision schedule study plan t-minus', build: (el) => VexExamPlanner.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'exams', label: 'Exams', hint: 'Exam dates, countdown reminders and a revision plan', icon: 'calendar', action: () => VexExamPlanner.open() });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexExamPlanner.init());
    else VexExamPlanner.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExamPlanner };
