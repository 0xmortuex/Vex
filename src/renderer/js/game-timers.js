// === Reset and season timers (T3-046) ======================================
//
// "When does the daily reset happen, and how long is left of the season?" Named
// timers the person types in (or starts from a template), counted down on the New
// Tab, in the calendar and by Ctrl+K, with an optional reminder before each one.
//
//   daily    every day at HH:MM        (UTC or the local clock)
//   weekly   every <weekday> at HH:MM  (UTC or the local clock)
//   once     one moment: "season ends" (UTC or the local clock)
//
// Nothing is looked up. Vex does not ask any game server when a reset is, and
// the templates are only starting points ("check your game") that the person
// edits. Times are kept as the clock the person chose, so a UTC reset stays at
// the same UTC moment whatever the local clock does; the countdown is always
// right, and the optional reminder (a real Vex reminder, so it is delivered even
// while a game has the screen) is re-aligned once a day because a repeating
// reminder follows the local clock across a daylight-saving change.
//
// Where it shows:
//   New Tab        up to 3 timers marked "show on New Tab", as plain text lines
//                  (VexNewTab.addTextWidget), only when there is one to show
//   Calendar       weekly and one-off timers (a daily one would fill every square)
//   Ctrl+K         "Reset timers" opens the list
//
// Deferred: the second-screen companion window (Wave 2) is not in this build.
const VexGameTimers = {
  KEYS: { on: 'vex.gameTimers.enabled', list: 'vex.gameTimers' },
  MAX: 24,
  KINDS: ['daily', 'weekly', 'once'],
  FEATURE: 'game-timers',
  DAYS: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  // Only starting points. The label says so.
  TEMPLATES: [
    { name: 'Daily reset', kind: 'daily', time: '00:00', tz: 'utc' },
    { name: 'Weekly reset', kind: 'weekly', dow: 2, time: '00:00', tz: 'utc' },
    { name: 'Season ends', kind: 'once', tz: 'utc' },
  ],
  _now() { return Date.now(); },

  enabled() { return VexMediaKit.flag(this.KEYS.on, true); },
  setEnabled(on) { VexMediaKit.setFlag(this.KEYS.on, !!on); },

  // ---- pure --------------------------------------------------------------------
  hm(text) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(text == null ? '' : text).trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('"' + text + '" is not a time of day (HH:MM)');
    return [Number(m[1]), Number(m[2])];
  },
  // Clean a timer the person typed. Throws with the reason.
  clean(input) {
    const name = String(input && input.name != null ? input.name : '').trim();
    if (!name) throw new Error('Name the timer, for example "Daily reset"');
    if (name.length > 60) throw new Error('The name is up to 60 characters');
    if (!this.KINDS.includes(input.kind)) throw new Error('A timer is daily, weekly or one-off');
    const tz = input.tz === 'local' ? 'local' : 'utc';
    const t = { id: input.id || VexMediaKit.uid('gt'), name, kind: input.kind, tz, lead: 0, showNewTab: input.showNewTab !== false, reminderId: input.reminderId || '', reminderAt: Number(input.reminderAt) || 0 };
    if (input.kind !== 'once') {
      const [h, m] = this.hm(input.time);
      t.time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    if (input.kind === 'weekly') {
      const d = Number(input.dow);
      if (!Number.isInteger(d) || d < 0 || d > 6) throw new Error('Choose the day of the week');
      t.dow = d;
    }
    if (input.kind === 'once') {
      const at = Number(input.at);
      if (!Number.isFinite(at) || at <= 0) throw new Error('Give the moment it happens');
      t.at = at;
    }
    const lead = Number(input.lead || 0);
    if (!Number.isInteger(lead) || lead < 0 || lead > 7 * 24 * 60) throw new Error('The reminder lead is 0 to 10080 minutes (0 means no reminder)');
    t.lead = lead;
    return t;
  },
  // The next moment (ms) this timer happens, at or after `now`, or null when a one-off is over.
  next(t, now = this._now()) {
    if (t.kind === 'once') return t.at >= now ? t.at : null;
    const [h, m] = this.hm(t.time);
    const utc = t.tz !== 'local';
    const base = new Date(now);
    const at = (dayOffset) => utc
      ? Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + dayOffset, h, m, 0, 0)
      : new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, h, m, 0, 0).getTime();
    if (t.kind === 'daily') { const a = at(0); return a >= now ? a : at(1); }
    const today = utc ? base.getUTCDay() : base.getDay();
    let ahead = (t.dow - today + 7) % 7;
    let a = at(ahead);
    if (a < now) a = at(ahead + 7);
    return a;
  },
  // "Daily reset in 3 h 12 min", "Season ended".
  line(t, now = this._now()) {
    const n = this.next(t, now);
    if (n == null) return t.name + ' has passed';
    return t.name + ' in ' + VexMediaKit.span(n - now);
  },

  // ---- the saved list ----------------------------------------------------------------
  list() {
    const v = VexMediaKit.read(this.KEYS.list, []);
    if (!Array.isArray(v)) throw new Error('The saved reset timers are not a list');
    return v;
  },
  _save(list) { VexMediaKit.write(this.KEYS.list, list); },
  add(input) {
    const list = this.list();
    if (list.length >= this.MAX) throw new Error('That is as many timers as Vex keeps (' + this.MAX + ')');
    const t = this.clean(input);
    list.push(t);
    this._save(list);
    return t;
  },
  update(id, patch) {
    const list = this.list();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) throw new Error('That timer is not there any more');
    const t = this.clean({ ...list[i], ...patch, id });
    list[i] = t;
    this._save(list);
    return t;
  },
  async remove(id) {
    const list = this.list();
    const t = list.find(x => x.id === id);
    if (!t) throw new Error('That timer is not there any more');
    if (t.reminderId) await this._dropReminder(t.reminderId);
    this._save(list.filter(x => x.id !== id));
  },

  // ---- the optional reminder (a real Vex reminder) ------------------------------------
  _api() {
    const r = window.vex && window.vex.reminders;
    if (!r || typeof r.create !== 'function' || typeof r.delete !== 'function' || typeof r.list !== 'function') throw new Error('Reminders are not available in this window');
    return r;
  },
  async _dropReminder(id) {
    // A reminder that is already gone is not an error here: it fired or was removed by hand.
    const items = await this._api().list();
    if (Array.isArray(items) && items.some(r => r && r.id === id)) await this._api().delete(id);
  },
  // Make (or remake) the reminder for one timer. Returns the timer as saved.
  async remind(t, now = this._now()) {
    if (t.reminderId) await this._dropReminder(t.reminderId);
    let next = { reminderId: '', reminderAt: 0 };
    if (t.lead > 0) {
      const n = this.next(t, now);
      const at = n == null ? 0 : n - t.lead * 60000;
      if (at - now >= 90000) {
        const repeat = t.kind === 'daily' ? 'daily' : (t.kind === 'weekly' ? 'weekly' : undefined);
        const made = await this._api().create(t.name + ' in ' + VexMediaKit.span(t.lead * 60000), at, repeat ? { repeat } : undefined);
        next = { reminderId: (made && made.id) || '', reminderAt: at };
        if (!next.reminderId) throw new Error('The reminder was not created');
      }
    }
    return this.update(t.id, next);
  },
  // Once a day: a repeating reminder follows the local clock, a UTC reset does not.
  async syncReminders(now = this._now()) {
    if (!this.enabled()) return 0;
    const items = await this._api().list();
    let fixed = 0;
    for (const t of this.list()) {
      if (!(t.lead > 0)) continue;
      const n = this.next(t, now);
      if (n == null) continue;
      const want = n - t.lead * 60000;
      const have = Array.isArray(items) ? items.find(r => r && r.id === t.reminderId) : null;
      if (!have || (t.kind !== 'once' && Math.abs(have.at - want) > 60000 && Math.abs(have.at - want) % 86400000 > 60000)) {
        await this.remind(t, now);
        fixed++;
      }
    }
    return fixed;
  },

  // ---- where it shows -----------------------------------------------------------------
  widgetLines(now = this._now()) {
    if (!this.enabled()) return [];
    return this.list().filter(t => t.showNewTab && this.next(t, now) != null)
      .sort((a, b) => this.next(a, now) - this.next(b, now)).slice(0, 3).map(t => this.line(t, now));
  },
  // For js/calendar.js: weekly and one-off timers inside [from, to).
  calendarEvents(from, to) {
    if (!this.enabled()) return [];
    const out = [];
    for (const t of this.list()) {
      if (t.kind === 'daily') continue;
      let at = this.next(t, from);
      for (let i = 0; at != null && at < to && i < 8; i++) {
        out.push({ start: at, end: at + 60000, summary: t.name, allDay: false, location: '', calendar: 'Reset timers' });
        if (t.kind === 'once') break;
        at = this.next(t, at + 60000);
      }
    }
    return out;
  },

  // ---- drawing -------------------------------------------------------------------------
  _form(body, redraw) {
    const K = VexMediaKit;
    const box = K.el('div', 'vex-platform-note');
    const name = K.input('Timer name', { placeholder: 'Daily reset', max: 60 });
    const kind = document.createElement('select'); kind.setAttribute('aria-label', 'How often');
    for (const [v, l] of [['daily', 'Every day'], ['weekly', 'Every week'], ['once', 'One time']]) kind.appendChild(new Option(l, v));
    const dow = document.createElement('select'); dow.setAttribute('aria-label', 'Day of the week');
    this.DAYS.forEach((d, i) => dow.appendChild(new Option(d, String(i))));
    const time = K.input('Time of day', { type: 'time', value: '00:00' });
    const when = K.input('The moment it happens', { placeholder: '2026-12-01 18:00', max: 16 });
    const tz = document.createElement('select'); tz.setAttribute('aria-label', 'Which clock');
    tz.appendChild(new Option('UTC', 'utc')); tz.appendChild(new Option('My clock', 'local'));
    const lead = K.input('Remind me this many minutes before (0 for none)', { type: 'number', value: '0', max: 6 });
    lead.min = '0'; lead.max = '10080';
    const sync = () => { dow.hidden = kind.value !== 'weekly'; time.hidden = kind.value === 'once'; when.hidden = kind.value !== 'once'; };
    kind.addEventListener('change', sync); sync();
    const tpl = document.createElement('select'); tpl.setAttribute('aria-label', 'Start from a template');
    tpl.appendChild(new Option('Start from a template (check your game)...', ''));
    this.TEMPLATES.forEach((t, i) => tpl.appendChild(new Option(t.name + ' - ' + t.kind + (t.time ? ' ' + t.time + ' UTC' : ''), String(i))));
    tpl.addEventListener('change', () => {
      const t = this.TEMPLATES[Number(tpl.value)];
      if (!t) return;
      name.value = t.name; kind.value = t.kind; tz.value = t.tz;
      if (t.time) time.value = t.time;
      if (t.dow != null) dow.value = String(t.dow);
      sync();
    });
    const add = K.button('Add timer', async () => {
      const spec = { name: name.value, kind: kind.value, tz: tz.value, time: time.value, dow: Number(dow.value), lead: Number(lead.value || 0) };
      if (kind.value === 'once') spec.at = K.parseLocal(when.value, tz.value === 'utc');
      const t = this.add(spec);
      if (t.lead > 0) await this.remind(t);
      name.value = ''; when.value = '';
      redraw();
    }, { primary: true });
    box.append(tpl, K.row('Name', name), K.row('How often', kind), K.row('Day', dow), K.row('Time', time), K.row('Moment', when), K.row('Clock', tz), K.row('Reminder (minutes before)', lead), add);
    body.appendChild(box);
  },
  open() {
    const K = VexMediaKit;
    const { body } = K.dialog({ id: 'game-timers', title: 'Reset and season timers', sub: 'Times you type in. Vex never asks a game server.' });
    const redraw = () => {
      body.textContent = '';
      if (!this.enabled()) { body.appendChild(K.info('Reset timers are switched off in Settings.')); return; }
      const now = this._now();
      const list = this.list();
      if (!list.length) body.appendChild(K.info('No timers yet. Add one below.'));
      for (const t of list) {
        const r = K.el('div', 'setting-row');
        r.appendChild(K.el('span', '', this.line(t, now) + (t.lead ? ' (reminder ' + t.lead + ' min before)' : '')));
        r.appendChild(K.button('Remove', async () => { await this.remove(t.id); redraw(); }, { danger: true, label: 'Remove timer ' + t.name }));
        body.appendChild(r);
      }
      this._form(body, redraw);
    };
    redraw();
  },
  render(body) {
    const K = VexMediaKit;
    body.textContent = '';
    body.appendChild(K.info('Daily and weekly resets and the end of a season, counted down on the New Tab and in the calendar. You type the times in; Vex asks no game server.'));
    body.appendChild(K.switchRow('Reset and season timers', this.enabled(), (on) => this.setEnabled(on)));
    body.appendChild(K.button('Edit the timers', () => this.open()));
  },
  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof VexJobs === 'undefined') throw new Error('VexJobs is not loaded: js/jobs.js must come before js/game-timers.js');
    VexJobs.every('Game timers sync', 24 * 3600 * 1000, () => this.syncReminders(), { when: 'background', feature: this.FEATURE });
    if (typeof VexNewTab !== 'undefined' && typeof VexNewTab.addTextWidget === 'function') VexNewTab.addTextWidget(this.FEATURE, () => this.widgetLines());
    if (typeof Calendar !== 'undefined' && typeof Calendar.addProvider === 'function') Calendar.addProvider(this.FEATURE, (from, to) => this.calendarEvents(from, to));
    VexMediaKit.register({
      id: 'game-timers', title: 'Reset and season timers', keywords: 'game reset daily weekly season countdown timer utc',
      render: (b) => this.render(b),
      commands: [{ id: 'game-timers', label: 'Reset and season timers', hint: 'Daily and weekly resets and the end of a season, counted down', icon: 'clock', action: () => { try { this.open(); } catch (err) { VexMediaKit.fail(err); } } }],
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexGameTimers = VexGameTimers;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexGameTimers };
