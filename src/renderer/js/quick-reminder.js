// === Vex quick reminder ====================================================
//
// Paste what you have to do, say when, and Vex tells you later.
//
// Vex already has the whole machine for this: js/scheduler.js runs saved tasks
// on a schedule, and one of its action types is a reminder. What it did not
// have was a way in that takes ten seconds. Creating a reminder meant opening
// the Schedules panel, adding a task, naming it, choosing a schedule type,
// filling a date and a time, choosing the action and pasting the text — a form,
// for something you want to fire and forget.
//
// So this is an entry point, not an engine. It parses "in 2 hours" or "tomorrow
// 9am" into a moment, and writes a one-off task the existing Scheduler owns.
// Everything after that — firing once, never twice, catching up an occurrence
// missed while Vex was closed — is the Scheduler's job already.
//
// The parser is the part worth testing, so it is a pure function of (text, now)
// and throws with a message naming what it could not read. A reminder that
// silently lands at the wrong time is worse than one that refuses to be set.
const VexQuickReminder = {

  DEFAULT_HOUR: 9,       // "tomorrow", with no time given
  TONIGHT_HOUR: 20,      // "tonight"
  MAX_MESSAGE: 2000,

  WEEKDAYS: {
    sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5, saturday: 6, sat: 6,
  },

  UNITS: {
    m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
    h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
    d: 86400, day: 86400, days: 86400,
    w: 604800, week: 604800, weeks: 604800,
  },

  // ---------------------------------------------------------------- the clock
  //
  // Dates are built from local wall-clock fields rather than by adding
  // milliseconds, for the same reason the Scheduler does it: adding 86400000 to
  // 09:00 the day before a DST change gives 08:00 or 10:00, not 09:00.
  _at(base, { days = 0, hour, minute = 0 } = {}) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days,
      hour === undefined ? base.getHours() : hour, minute, 0, 0);
    return d;
  },

  // "9am", "9:30 am", "17:00", "5pm", "noon", "midnight" -> { hour, minute }
  // Returns null when the text is not a time at all, so a caller can try
  // something else. Throws only when it IS a time and the numbers are impossible.
  _parseTime(raw) {
    const s = String(raw || '').trim().toLowerCase().replace(/\./g, '');
    if (!s) return null;
    if (s === 'noon' || s === 'midday') return { hour: 12, minute: 0 };
    if (s === 'midnight') return { hour: 0, minute: 0 };

    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let hour = Number(m[1]);
    const minute = m[2] === undefined ? 0 : Number(m[2]);
    const suffix = m[3];

    if (minute > 59) throw new Error(`There is no minute ${minute} — times run :00 to :59.`);
    if (suffix) {
      if (hour < 1 || hour > 12) throw new Error(`"${raw}" is not a time — with am or pm the hour runs 1 to 12.`);
      if (suffix === 'pm' && hour !== 12) hour += 12;
      if (suffix === 'am' && hour === 12) hour = 0;
    } else {
      // A bare number is only a time when it could be one on a 24-hour clock.
      if (hour > 23) throw new Error(`There is no ${hour} o'clock — use 0 to 23, or say am/pm.`);
    }
    return { hour, minute };
  },

  // The whole point of the feature: text in, a moment out.
  //
  // `now` is injectable so the tests are not a coin flip on what time it is.
  parseWhen(text, now) {
    const at = now instanceof Date ? now : new Date();
    const s = String(text || '').trim().toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/^(remind me|remind|me)\s+/g, '')
      .replace(/\bat\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!s) throw new Error('Say when — "in 2 hours", "tomorrow 9am", "friday", or a time.');

    // in <n> <unit>
    let m = s.match(/^in (\d+(?:\.\d+)?) ?([a-z]+)$/);
    if (m) {
      const n = Number(m[1]);
      const unit = this.UNITS[m[2]];
      if (!unit) throw new Error(`"${m[2]}" is not a length of time — try minutes, hours, days or weeks.`);
      if (n <= 0) throw new Error('That is not in the future.');
      const when = new Date(at.getTime() + n * unit * 1000);
      when.setSeconds(0, 0);
      return this._checkFuture(when, at);
    }

    // an explicit date, optionally with a time
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?: (.+))?$/);
    if (m) {
      const time = m[4] ? this._parseTime(m[4]) : null;
      if (m[4] && !time) throw new Error(`Could not read "${m[4]}" as a time.`);
      const when = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        time ? time.hour : this.DEFAULT_HOUR, time ? time.minute : 0, 0, 0);
      if (Number.isNaN(when.getTime()) || when.getMonth() !== Number(m[2]) - 1) {
        throw new Error(`${m[0]} is not a real date.`);
      }
      return this._checkFuture(when, at);
    }

    // tonight / this evening
    if (s === 'tonight' || s === 'this evening') {
      return this._checkFuture(this._at(at, { hour: this.TONIGHT_HOUR }), at);
    }

    // today / tomorrow, with or without a time
    m = s.match(/^(today|tomorrow|tmr|tmrw)(?: (.+))?$/);
    if (m) {
      const days = m[1] === 'today' ? 0 : 1;
      const time = m[2] ? this._parseTime(m[2]) : null;
      if (m[2] && !time) throw new Error(`Could not read "${m[2]}" as a time.`);
      const when = this._at(at, {
        days,
        hour: time ? time.hour : this.DEFAULT_HOUR,
        minute: time ? time.minute : 0,
      });
      return this._checkFuture(when, at);
    }

    // a weekday, with or without a time. "next friday" and "friday" agree:
    // both mean the next one that has not happened yet.
    m = s.match(/^(?:next |this )?([a-z]+)(?: (.+))?$/);
    if (m && this.WEEKDAYS[m[1]] !== undefined) {
      const target = this.WEEKDAYS[m[1]];
      const time = m[2] ? this._parseTime(m[2]) : null;
      if (m[2] && !time) throw new Error(`Could not read "${m[2]}" as a time.`);
      let days = (target - at.getDay() + 7) % 7;
      const hour = time ? time.hour : this.DEFAULT_HOUR;
      const minute = time ? time.minute : 0;
      // Today, but the hour has already gone: they mean next week.
      if (days === 0) {
        const todayAt = this._at(at, { hour, minute });
        if (todayAt.getTime() <= at.getTime()) days = 7;
      }
      return this._checkFuture(this._at(at, { days, hour, minute }), at);
    }

    // a bare time — today if it is still to come, otherwise tomorrow
    const time = this._parseTime(s);
    if (time) {
      let when = this._at(at, { hour: time.hour, minute: time.minute });
      if (when.getTime() <= at.getTime()) when = this._at(at, { days: 1, hour: time.hour, minute: time.minute });
      return this._checkFuture(when, at);
    }

    throw new Error(`Could not read "${text}" as a time. Try "in 2 hours", "tomorrow 9am", "friday 17:00" or "2026-09-20 14:00".`);
  },

  // The Scheduler stores a one-off as a date and a time, so anything under a
  // minute away cannot be represented. Saying so beats rounding it silently.
  _checkFuture(when, now) {
    if (Number.isNaN(when.getTime())) throw new Error('That is not a real time.');
    if (when.getTime() <= now.getTime()) {
      throw new Error('That moment has already passed — give a time in the future.');
    }
    if (when.getTime() - now.getTime() < 60000) {
      throw new Error('Reminders are set to the minute — choose at least a minute from now.');
    }
    return when;
  },

  // "Tomorrow at 09:00", "Friday at 17:00", "20 Sep at 14:00" — the line under
  // the box that proves Vex read the same thing the person meant.
  describe(when, now) {
    const at = now instanceof Date ? now : new Date();
    const hhmm = String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
    const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((midnight(when) - midnight(at)) / 86400000);
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    let day;
    if (days === 0) day = 'Today';
    else if (days === 1) day = 'Tomorrow';
    else if (days > 1 && days < 7) day = names[when.getDay()];
    else day = `${when.getDate()} ${months[when.getMonth()]}`;

    return `${day} at ${hhmm} — ${this._relative(when.getTime() - at.getTime())} from now`;
  },

  _relative(ms) {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'}`;
  },

  // ---------------------------------------------------------------- creating
  //
  // A reminder is a one-off task with the reminder action. The name is what a
  // notification shows as its title, so it is the first line of the text rather
  // than "Untitled Task".
  _name(message) {
    const first = String(message).trim().split('\n')[0].trim();
    return (first.length > 60 ? first.slice(0, 57).trimEnd() + '…' : first) || 'Reminder';
  },

  create(message, when) {
    const text = String(message || '').trim();
    if (!text) throw new Error('Write what you want to be reminded of.');
    if (text.length > this.MAX_MESSAGE) throw new Error(`That is longer than ${this.MAX_MESSAGE} characters — put the detail in a note and remind yourself to open it.`);
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) throw new Error('That is not a real time.');
    if (typeof Scheduler === 'undefined' || typeof Scheduler.createTask !== 'function') {
      throw new Error('The scheduler is not available in this build.');
    }

    const pad = (n) => String(n).padStart(2, '0');
    const task = Scheduler.createTask({
      name: this._name(text),
      description: 'Quick reminder',
      schedule: {
        type: 'once',
        date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
        time: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
      },
      action: { type: 'reminder', message: text },
      // A reminder missed because Vex was closed is still worth showing when it
      // opens — that is the whole reason catch-up exists.
      catchUp: true,
      catchUpWindowMin: 7 * 24 * 60,
    });

    // Ask for notification permission at the one moment it is expected: the
    // person has just asked to be told something later. Without it the reminder
    // degrades to a toast, which they only see if they are looking.
    this._ensureNotifications();
    return task;
  },

  _ensureNotifications() {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } catch { /* blocked or unavailable — the Scheduler still shows a toast */ }
  },

  // ------------------------------------------------------------------- the UI
  open(prefill) {
    document.getElementById('vex-quick-reminder')?.remove();
    const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
    const icon = (n, sz) => (window.VexIcons && VexIcons.has(n)) ? VexIcons.svg(n, { size: sz || 15 }) : '';

    const wrap = document.createElement('div');
    wrap.id = 'vex-quick-reminder';
    wrap.className = 'qr-overlay';
    wrap.innerHTML = `
      <div class="qr-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-title">
        <div class="qr-head">
          <span class="qr-head-icon">${icon('alarm', 16)}</span>
          <span class="qr-title" id="qr-title">Remind me</span>
          <button class="qr-close" id="qr-close" title="Close" aria-label="Close">${icon('x', 14)}</button>
        </div>
        <label class="qr-label" for="qr-text">What do you have to do?</label>
        <textarea class="qr-text" id="qr-text" rows="4" placeholder="Paste the task here"></textarea>
        <label class="qr-label" for="qr-when">When?</label>
        <input class="qr-when" id="qr-when" type="text" placeholder="in 2 hours" autocomplete="off">
        <div class="qr-chips">
          <button class="qr-chip" data-when="in 30 minutes">in 30 min</button>
          <button class="qr-chip" data-when="in 2 hours">in 2 hours</button>
          <button class="qr-chip" data-when="tonight">tonight</button>
          <button class="qr-chip" data-when="tomorrow 9am">tomorrow 9am</button>
          <button class="qr-chip" data-when="monday 9am">monday 9am</button>
        </div>
        <div class="qr-preview" id="qr-preview" aria-live="polite"></div>
        <div class="qr-actions">
          <button class="qr-btn" id="qr-cancel">Cancel</button>
          <button class="qr-btn qr-primary" id="qr-save">Remind me</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const textEl = wrap.querySelector('#qr-text');
    const whenEl = wrap.querySelector('#qr-when');
    const preview = wrap.querySelector('#qr-preview');
    if (prefill) textEl.value = String(prefill).slice(0, this.MAX_MESSAGE);

    const close = () => wrap.remove();
    let parsed = null;

    const refresh = () => {
      const raw = whenEl.value.trim();
      if (!raw) { parsed = null; preview.textContent = ''; preview.className = 'qr-preview'; return; }
      try {
        parsed = this.parseWhen(raw);
        preview.textContent = this.describe(parsed);
        preview.className = 'qr-preview qr-ok';
      } catch (err) {
        parsed = null;
        preview.textContent = (err && err.message) || 'Could not read that time.';
        preview.className = 'qr-preview qr-bad';
      }
    };

    whenEl.addEventListener('input', refresh);
    wrap.querySelectorAll('.qr-chip').forEach(c => c.addEventListener('click', () => {
      whenEl.value = c.dataset.when;
      refresh();
      whenEl.focus();
    }));

    const save = () => {
      try {
        if (!textEl.value.trim()) { textEl.focus(); throw new Error('Write what you want to be reminded of.'); }
        // Re-parse rather than trusting the preview: the clock has moved since
        // it was drawn, and "in 1 minute" typed two minutes ago is now past.
        const when = this.parseWhen(whenEl.value);
        this.create(textEl.value, when);
        window.showToast?.('Reminder set — ' + this.describe(when));
        close();
      } catch (err) {
        window.showToast?.((err && err.message) || 'Could not set that reminder', 'error');
        refresh();
      }
    };

    wrap.querySelector('#qr-save').addEventListener('click', save);
    wrap.querySelector('#qr-cancel').addEventListener('click', close);
    wrap.querySelector('#qr-close').addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      // Enter saves from the when box; the text box is a textarea, where Enter
      // is a newline and Ctrl+Enter saves.
      if (e.key === 'Enter' && (e.target === whenEl || e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    });

    setTimeout(() => (prefill ? whenEl : textEl).focus(), 40);
    return wrap;
  },
};

if (typeof window !== 'undefined') window.VexQuickReminder = VexQuickReminder;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexQuickReminder };
