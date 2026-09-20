// === "every morning at 9" =================================================
//
// The scheduler takes a schedule object: a type, a time, days of the week. A
// person says "every weekday at 8:30", and until now only the panel's own form
// could turn one into the other — so the agent, asked to set something up for
// every morning, could not.
//
// This is that translation, and nothing else. It is deliberately small: it
// understands the shapes people actually say, and says plainly when it does
// not understand rather than guessing at a time and quietly running something
// at the wrong hour.
const ScheduleWords = {
  DAYS: { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 },
  // A time of day named rather than given.
  NAMED: { morning: '09:00', midday: '12:00', noon: '12:00', afternoon: '14:00', evening: '19:00', night: '22:00', midnight: '00:00' },

  // "9", "9am", "09:30", "half past nine" is not supported — say so instead.
  time(text) {
    const s = String(text || '').toLowerCase();
    const m = s.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?|\b(\d{1,2})\s*(am|pm)\b/);
    if (m) {
      let hour = Number(m[1] != null ? m[1] : m[4]);
      const mins = m[2] != null ? Number(m[2]) : 0;
      const ampm = m[3] || m[5];
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      if (hour > 23 || mins > 59) return null;
      return String(hour).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
    }
    // Longest first, or "midnight" is read as "night".
    for (const [word, at] of Object.entries(this.NAMED).sort((a, b) => b[0].length - a[0].length)) {
      if (s.includes(word)) return at;
    }
    return null;
  },

  days(text) {
    const s = String(text || '').toLowerCase();
    if (/\bweekdays?\b|\bevery work(ing)? day\b/.test(s)) return [1, 2, 3, 4, 5];
    if (/\bweekends?\b/.test(s)) return [0, 6];
    const found = new Set();
    for (const [word, n] of Object.entries(this.DAYS)) {
      if (new RegExp('\\b' + word + 's?\\b').test(s)) found.add(n);
    }
    return found.size ? [...found].sort() : null;
  },

  // "every 30 minutes", "hourly", "every 2 hours" → minutes.
  everyMinutes(text) {
    const s = String(text || '').toLowerCase();
    if (/\bhourly\b/.test(s)) return 60;
    const m = s.match(/\bevery\s+(\d+)\s*(min(ute)?s?|h(ou)?rs?)\b/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!n) return null;
    return /^h/.test(m[2]) ? n * 60 : n;
  },

  // → a schedule the engine understands, or an error saying what is missing.
  // Shapes: every N minutes/hours · daily at HH:MM · on named days at HH:MM ·
  // on a day of the month at HH:MM.
  parse(text) {
    const s = String(text || '').trim();
    if (!s) throw new Error('Say when it should run — "every weekday at 8:30", "every morning at 9", "every 30 minutes"');

    const minutes = this.everyMinutes(s);
    if (minutes) return { type: 'interval', intervalMinutes: minutes };

    const at = this.time(s);
    const days = this.days(s);
    const monthDay = (s.match(/\bon the (\d{1,2})(st|nd|rd|th)?\b/i) || [])[1];

    if (!at) {
      throw new Error('That does not say what time — try "every weekday at 8:30" or "every morning at 9"');
    }
    if (monthDay) return { type: 'monthly', time: at, dayOfMonth: Math.min(31, Math.max(1, Number(monthDay))) };
    if (days) return { type: 'weekly', time: at, daysOfWeek: days };
    return { type: 'daily', time: at };
  },

  // The schedule read back in words, for the line the agent shows the user.
  describe(schedule) {
    if (!schedule) return '';
    if (schedule.type === 'interval') {
      const n = schedule.intervalMinutes;
      return n % 60 === 0 && n >= 60 ? 'every ' + (n / 60) + ' hour' + (n === 60 ? '' : 's') : 'every ' + n + ' minutes';
    }
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (schedule.type === 'weekly') {
      const list = (schedule.daysOfWeek || []).map(d => names[d]);
      const every = list.length === 5 && list.every((_, i) => (schedule.daysOfWeek || [])[i] === i + 1) ? 'every weekday' : list.join(', ');
      return every + ' at ' + schedule.time;
    }
    if (schedule.type === 'monthly') return 'on the ' + schedule.dayOfMonth +(schedule.dayOfMonth === 1 ? 'st' : schedule.dayOfMonth === 2 ? 'nd' : schedule.dayOfMonth === 3 ? 'rd' : 'th') + ' at ' + schedule.time;
    return 'every day at ' + schedule.time;
  },
};

if (typeof window !== 'undefined') window.ScheduleWords = ScheduleWords;
if (typeof module !== 'undefined' && module.exports) module.exports = { ScheduleWords };
