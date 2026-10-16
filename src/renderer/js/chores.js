// === Recurring chores and bills (T2-062) =============================================
//
// Electricity, phone, rent, the backup, the transport card, the password you
// rotate: things that come back every month or season, that nobody reminds you of
// and that cost money or access when forgotten. A short board of them:
//
//   name · how often (monthly / every three months / yearly) · the usual day ·
//   the page to open (the pay or renew page) · how many days before to remind you
//
//   * "Due this week" shows in the Morning Brief with Done and Open page buttons.
//   * Done is the monthly tick. It settles the cycle it falls in, and the chore
//     comes back by itself for the next one. Paying a little late or a little
//     early settles the right cycle (a cycle starts halfway between the
//     previous due date and this one; a tick settles every cycle that has started).
//   * Three days before (your number) a reminder is made for you, with the page
//     address on it, and written to the Ledger with an Undo. It is the ordinary
//     Vex reminder: the OS toast, snooze and the rest all work.
//
// NO PAYMENT. Open page opens the address you gave in a new tab and stops. Vex
// never fills, submits or pays anything here, and the board holds no account
// numbers or amounts. Only https:// addresses are accepted.
//
// Kept on this computer ('vex.chores'); not synced, not sent anywhere.

const VexChores = {
  PREF: 'vex.chores.enabled',
  KEY: 'vex.chores',
  FEATURE: 'chores',
  MAX: 60,
  JOB: 'Chores: reminders',
  CADENCE: { monthly: { label: 'Every month', days: 30.4 }, quarterly: { label: 'Every three months', days: 91 }, yearly: { label: 'Every year', days: 365 } },
  REMIND_HOUR: 9,

  enabled() { return VexPlanKit.flag(this.PREF); },
  setEnabled(on) {
    VexPlanKit.setFlag(this.PREF, on);
    this._syncJob();
    return !!on;
  },

  // ---- pure date maths ------------------------------------------------------------------
  _daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); },
  // Due dates (local midnight) of a chore between two moments, ascending.
  occurrences(c, from, to) {
    const out = [];
    const a = new Date(from), b = new Date(to);
    const startM = a.getFullYear() * 12 + a.getMonth() - 1, endM = b.getFullYear() * 12 + b.getMonth() + 1;
    for (let mm = startM; mm <= endM; mm++) {
      const y = Math.floor(mm / 12), m = mm % 12;
      if (c.cadence === 'quarterly' && (((m - (c.month - 1)) % 3) + 3) % 3 !== 0) continue;
      if (c.cadence === 'yearly' && m !== c.month - 1) continue;
      const t = new Date(y, m, Math.min(c.day, this._daysIn(y, m))).getTime();
      if (t >= VexPlanKit.startOfDay(from) && t <= to) out.push(t);
    }
    return out;
  },
  _settled(c, due) {
    if (!c.lastDone) return false;
    const last = VexPlanKit.parseIso(c.lastDone);
    if (Number.isNaN(last)) return false;
    const occ = this.occurrences(c, due - 400 * 86400000, due + 400 * 86400000);
    const i = occ.indexOf(due);
    if (i < 1) return last >= due - 15 * 86400000;
    // Done at or after the halfway point to the previous due date settles this cycle (and so every earlier one).
    return last >= (occ[i - 1] + due) / 2;
  },
  // The cycle that still needs doing: the earliest due date, from one cycle back, that is not settled.
  nextDue(c, now = Date.now()) {
    const today = VexPlanKit.startOfDay(now);
    const created = c.createdAt ? VexPlanKit.startOfDay(c.createdAt) : 0;
    const span = this.CADENCE[c.cadence].days * 86400000;
    for (const d of this.occurrences(c, today - span, today + 2 * span)) {
      if (d < created) continue;
      if (!this._settled(c, d)) return d;
    }
    return null;
  },
  // -> { due, days (negative = overdue), state: 'overdue'|'today'|'week'|'later' } or null
  status(c, now = Date.now()) {
    const due = this.nextDue(c, now);
    if (due == null) return null;
    const days = Math.round((due - VexPlanKit.startOfDay(now)) / 86400000);
    return { due, days, state: days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 7 ? 'week' : 'later' };
  },
  label(st) {
    if (st.state === 'overdue') return 'Overdue ' + (-st.days) + (st.days === -1 ? ' day' : ' days');
    if (st.state === 'today') return 'Due today';
    if (st.days === 1) return 'Tomorrow';
    return st.state === 'week' ? 'In ' + st.days + ' days' : VexPlanKit.dayName(st.due);
  },

  // ---- validation and storage --------------------------------------------------------------
  clean(f) {
    const name = VexPlanKit.line(f && f.name, 60);
    if (!name) throw new Error('Name the chore, for example "Electricity bill"');
    if (!this.CADENCE[f.cadence]) throw new Error('Choose how often: every month, every three months or every year');
    const day = Number(f.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('The usual day is a number from 1 to 31');
    let month = 1;
    if (f.cadence !== 'monthly') {
      month = Number(f.month);
      if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('The month is a number from 1 to 12');
    }
    let url = String(f.url || '').trim();
    if (url) {
      let u;
      try { u = new URL(url); } catch { throw new Error('That page address is not valid'); }
      if (u.protocol !== 'https:') throw new Error('Only https:// addresses are kept (a payment page should be secure)');
      url = u.href.slice(0, 2048);
    }
    const remind = f.remind === '' || f.remind == null ? 3 : Number(f.remind);
    if (!Number.isInteger(remind) || remind < 0 || remind > 30) throw new Error('Remind me 0 to 30 days before');
    return { name, cadence: f.cadence, day, month, url, remind };
  },
  list() {
    const l = VexPlanKit.readJson(this.KEY, []);
    return Array.isArray(l) ? l.filter(c => c && c.id && this.CADENCE[c.cadence]) : [];
  },
  _save(l) { VexPlanKit.writeJson(this.KEY, l); },
  add(fields, now = Date.now()) {
    const list = this.list();
    if (list.length >= this.MAX) throw new Error('That is ' + this.MAX + ' chores already: remove one first');
    const c = { id: 'ch_' + now.toString(36) + Math.random().toString(36).slice(2, 6), ...this.clean(fields), lastDone: '', createdAt: now, remindFor: '', remindId: '' };
    list.push(c);
    this._save(list);
    return c;
  },
  async remove(id) {
    const list = this.list();
    const c = list.find(x => x.id === id);
    if (!c) throw new Error('That chore is gone');
    await this._dropReminder(c);
    this._save(list.filter(x => x.id !== id));
  },

  // ---- done ------------------------------------------------------------------------------------
  async done(id, now = Date.now()) {
    const list = this.list();
    const c = list.find(x => x.id === id);
    if (!c) throw new Error('That chore is gone');
    c.lastDone = VexPlanKit.isoDay(now);
    await this._dropReminder(c);
    c.remindFor = ''; c.remindId = '';
    this._save(list);
    await this.sync(now);
    return c;
  },
  open(c) {
    if (!c.url) throw new Error('No page address is set for "' + c.name + '"');
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    TabManager.createTab(c.url, true);
  },

  // ---- the reminders made for you ------------------------------------------------------------------
  _bridge() {
    const b = typeof window !== 'undefined' && window.vex && window.vex.reminders;
    if (!b || typeof b.create !== 'function' || typeof b.delete !== 'function') throw new Error('Reminders are not available here');
    return b;
  },
  async _dropReminder(c) {
    if (!c.remindId) return;
    await this._bridge().delete(c.remindId);
  },
  // Makes the reminder for the next due date of each chore that does not have one. -> how many were made.
  async sync(now = Date.now()) {
    if (!this.enabled()) return 0;
    const list = this.list();
    let made = 0;
    let dirty = false;
    for (const c of list) {
      const st = this.status(c, now);
      if (!st || c.remind === 0) continue;
      const dueIso = VexPlanKit.isoDay(st.due);
      if (c.remindFor === dueIso) continue;
      let at = VexPlanKit.addDays(st.due, -c.remind) + this.REMIND_HOUR * 3600000;
      if (at <= now) at = st.due + 24 * 3600000 > now ? now + 60000 : 0;     // late for the early reminder: soon, if the day has not gone
      if (!at) continue;
      const r = await this._bridge().create('Chore due ' + VexPlanKit.dayName(st.due) + ': ' + c.name, at, c.url ? { url: c.url } : undefined);
      if (r && r.ok === false) throw new Error(r.error || 'The reminder for "' + c.name + '" could not be made');
      c.remindFor = dueIso; c.remindId = (r && r.id) || ''; dirty = true; made++;
      if (typeof VexLedger !== 'undefined') {
        VexLedger.note({
          feature: this.FEATURE, what: 'Set a reminder for "' + c.name + '" on ' + VexPlanKit.dayName(at),
          why: 'It is due ' + VexPlanKit.dayName(st.due) + ' and you asked for ' + c.remind + ' days notice.',
          undo: c.remindId ? { kind: 'chore-unremind', chore: c.id, reminder: c.remindId } : null, stop: { kind: 'chores-off' },
        });
      }
    }
    if (dirty) this._save(list);
    return made;
  },
  _syncJob() {
    if (typeof VexJobs === 'undefined') return;
    VexJobs.stop(this.JOB);
    if (this.enabled()) VexJobs.every(this.JOB, 6 * 3600 * 1000, () => this.sync().catch(err => window.VexProblems?.note('Chores', 'Could not make a chore reminder', err)), { feature: this.FEATURE, when: 'background' });
  },

  // ---- Morning Brief ---------------------------------------------------------------------------------
  dueThisWeek(now = Date.now()) {
    return this.list().map(c => ({ c, st: this.status(c, now) })).filter(x => x.st && x.st.state !== 'later').sort((a, b) => a.st.due - b.st.due);
  },
  briefModule() {
    return {
      id: 'chores', title: 'Chores and bills', icon: 'list',
      isEnabled: () => this.enabled(),
      build: async () => {
        const rows = this.dueThisWeek();
        if (!rows.length) return null;
        return {
          summary: rows.length === 1 ? '1 chore is due this week.' : rows.length + ' chores are due this week.',
          lines: rows.slice(0, 6).map(({ c, st }) => ({
            text: c.name, detail: this.label(st),
            actions: [{ label: 'Done', run: async () => { await this.done(c.id); } }, ...(c.url ? [{ label: 'Open page', run: () => { this.open(c); } }] : [])],
          })),
        };
      },
    };
  },

  // ---- the board ------------------------------------------------------------------------------------------
  openBoard() {
    if (!this.enabled()) { window.showToast?.('Chores are switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('chores');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-chores', title: 'Chores and bills', sub: 'Things that come back every month, season or year. Open page opens the address you gave and stops: nothing is paid or filled in.' });
    const draw = () => {
      body.textContent = '';
      let rows;
      try { rows = this.list().map(c => ({ c, st: this.status(c) })).sort((a, b) => (a.st ? a.st.due : Infinity) - (b.st ? b.st.due : Infinity)); }
      catch (err) { body.appendChild(VexSettingsGroups.note('Could not read the chores: ' + err.message)); return; }
      if (!rows.length) body.appendChild(VexSettingsGroups.note('No chores yet. Add the electricity bill, the phone, the rent, the backup...'));
      const list = document.createElement('div'); list.className = 'vexsr-list';
      for (const { c, st } of rows) {
        const { row } = VexPlanKit.listRow(st ? this.label(st) : 'no date', c.name + '  (' + this.CADENCE[c.cadence].label.toLowerCase() + ', day ' + c.day + ')');
        const box = document.createElement('span'); box.style.cssText = 'display:inline-flex;gap:6px;margin-left:auto';
        const act = (text, fn) => box.appendChild(VexSettingsGroups.button(text, async () => { try { await fn(); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { label: text + ': ' + c.name }));
        act('Done', () => this.done(c.id));
        if (c.url) act('Open page', () => this.open(c));
        act('Remove', () => this.remove(c.id));
        row.appendChild(box); list.appendChild(row);
      }
      body.appendChild(list);
      // add form
      const form = document.createElement('form');
      form.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;margin-top:10px';
      const field = (ph, label, type = 'text') => { const i = document.createElement('input'); i.type = type; i.className = 'set-input'; i.placeholder = ph; i.setAttribute('aria-label', label); form.appendChild(i); return i; };
      const name = field('Electricity bill', 'Name');
      const cad = document.createElement('select'); cad.setAttribute('aria-label', 'How often');
      for (const [k, v] of Object.entries(this.CADENCE)) { const o = document.createElement('option'); o.value = k; o.textContent = v.label; cad.appendChild(o); }
      form.appendChild(cad);
      const day = field('Usual day (1-31)', 'Usual day', 'number');
      const month = field('Month (1-12)', 'Month, for yearly and every three months', 'number');
      const url = field('https://pay page', 'Page to open');
      const rem = field('Remind days before (3)', 'Days before to remind', 'number');
      form.appendChild(VexSettingsGroups.button('Add', () => form.requestSubmit(), { primary: true }));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { this.add({ name: name.value, cadence: cad.value, day: day.value, month: month.value, url: url.value, remind: rem.value }); await this.sync(); draw(); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      });
      body.appendChild(form);
    };
    draw();
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('chore-unremind', async (t) => {
        await this._bridge().delete(t.reminder);
        const list = this.list(); const c = list.find(x => x.id === t.chore);
        if (c && c.remindId === t.reminder) { c.remindId = ''; c.remindFor = ''; this._save(list); }
      });
      VexLedger.registerStop('chores-off', () => { this.setEnabled(false); });
    }
    this._syncJob();
    this.sync().catch(err => window.VexProblems?.note('Chores', 'Could not make a chore reminder', err));
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('A board of bills and chores that come back (electricity, phone, rent, backup, transport card, password rotation) with the usual day and the page to open. Due ones show in the Morning Brief; a reminder is made a few days before. Nothing is paid or filled in. Ctrl+K › Chores and bills.'));
    el.appendChild(VexSettingsGroups.button('Open the board', () => this.openBoard(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexChores = VexChores;
  window.VexBriefModules = window.VexBriefModules || [];
  window.VexBriefModules.push(VexChores.briefModule());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'chores', title: 'Chores and bills', keywords: 'chores bills recurring electricity phone rent backup renew monthly due', before: 'about', build: (el) => VexChores.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'chores', label: 'Chores and bills', hint: 'Recurring bills and chores with the page to open', icon: 'list', action: () => VexChores.openBoard() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexChores };
