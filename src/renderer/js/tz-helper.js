// === Timezone helper (T3-020) =================================================
//
// Announcing an event to a community in several countries means turning "21:00
// Istanbul" into what everyone sees. Type it as you would say it:
//
//   21:00 Istanbul           tomorrow 9pm new york        2026-11-02 18:30 tokyo
//
// and get that moment in your own time and in the zones you keep a list of, plus
// the Discord timestamp text (<t:1760000000:F>) that every reader sees in THEIR
// own zone, ready to paste. Nothing is read or sent; it is arithmetic on the
// zone database the browser already carries, so daylight-saving changes are
// right on the day. With no day given, the next time that clock reading comes
// round is meant, and the result says so.
const VexTimezone = {
  KEY: 'vex.tzHelper',
  MAX_ZONES: 8,
  // Words people use for a place, mapped to the zone database's names. A name from the database
  // itself ("Europe/Istanbul") is accepted as it is.
  ALIASES: {
    utc: 'UTC', gmt: 'UTC', z: 'UTC',
    istanbul: 'Europe/Istanbul', turkey: 'Europe/Istanbul', ankara: 'Europe/Istanbul', trt: 'Europe/Istanbul', tr: 'Europe/Istanbul',
    london: 'Europe/London', uk: 'Europe/London', britain: 'Europe/London', bst: 'Europe/London',
    berlin: 'Europe/Berlin', germany: 'Europe/Berlin', paris: 'Europe/Paris', france: 'Europe/Paris', madrid: 'Europe/Madrid', rome: 'Europe/Rome',
    amsterdam: 'Europe/Amsterdam', cet: 'Europe/Berlin', cest: 'Europe/Berlin', athens: 'Europe/Athens', kyiv: 'Europe/Kyiv', kiev: 'Europe/Kyiv',
    moscow: 'Europe/Moscow', msk: 'Europe/Moscow', dubai: 'Asia/Dubai', riyadh: 'Asia/Riyadh', tehran: 'Asia/Tehran', cairo: 'Africa/Cairo',
    lagos: 'Africa/Lagos', johannesburg: 'Africa/Johannesburg',
    mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata', kolkata: 'Asia/Kolkata', india: 'Asia/Kolkata', karachi: 'Asia/Karachi', dhaka: 'Asia/Dhaka',
    bangkok: 'Asia/Bangkok', jakarta: 'Asia/Jakarta', singapore: 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong', manila: 'Asia/Manila',
    shanghai: 'Asia/Shanghai', beijing: 'Asia/Shanghai', china: 'Asia/Shanghai', seoul: 'Asia/Seoul', korea: 'Asia/Seoul', kst: 'Asia/Seoul',
    tokyo: 'Asia/Tokyo', japan: 'Asia/Tokyo', jst: 'Asia/Tokyo',
    sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', perth: 'Australia/Perth', auckland: 'Pacific/Auckland',
    'new york': 'America/New_York', ny: 'America/New_York', nyc: 'America/New_York', est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York',
    toronto: 'America/Toronto', chicago: 'America/Chicago', cst: 'America/Chicago', cdt: 'America/Chicago', ct: 'America/Chicago',
    denver: 'America/Denver', mst: 'America/Denver', mdt: 'America/Denver', mt: 'America/Denver',
    'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', seattle: 'America/Los_Angeles',
    pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles',
    mexico: 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo', brazil: 'America/Sao_Paulo', 'buenos aires': 'America/Argentina/Buenos_Aires',
  },
  DAY_WORDS: ['today', 'tomorrow'],

  _now() { return Date.now(); },
  localZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone; },

  // ---- preferences --------------------------------------------------------------
  prefs() {
    const p = CommsStore.record(this.KEY, { on: true, zones: ['UTC'] }, 'timezone helper settings');
    return { on: p.on !== false, zones: Array.isArray(p.zones) ? p.zones.filter(z => typeof z === 'string').slice(0, this.MAX_ZONES) : ['UTC'] };
  },
  enabled() { return this.prefs().on; },
  setEnabled(on) { const p = this.prefs(); p.on = !!on; CommsStore.write(this.KEY, p); },
  zones() { return this.prefs().zones; },
  addZone(text) {
    const zone = this.resolveZone(text);
    if (!zone) throw new Error('"' + CommsStore.line(text, 40) + '" is not a place or zone Vex knows. Try a city, or a name like Europe/Istanbul.');
    const p = this.prefs();
    if (p.zones.includes(zone)) return zone;
    if (p.zones.length >= this.MAX_ZONES) throw new Error('At most ' + this.MAX_ZONES + ' zones. Remove one first.');
    p.zones.push(zone);
    CommsStore.write(this.KEY, p);
    return zone;
  },
  removeZone(zone) {
    const p = this.prefs();
    const next = p.zones.filter(z => z !== zone);
    if (next.length === p.zones.length) return false;
    p.zones = next; CommsStore.write(this.KEY, p);
    return true;
  },

  // ---- zones ------------------------------------------------------------------------
  validZone(name) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: name }); return true; }
    catch { return false; }
  },
  // "Istanbul", "new york", "EST" or "Europe/Istanbul" -> the database's name, or '' when unknown.
  resolveZone(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return '';
    const key = raw.toLowerCase().replace(/\s+/g, ' ');
    if (this.ALIASES[key]) return this.ALIASES[key];
    if (/^[A-Za-z]+(?:\/[A-Za-z_+-]+){1,2}$/.test(raw) && this.validZone(raw)) return raw;
    return '';
  },

  // The zone's offset from UTC at an instant, in ms (Istanbul: +3 h).
  offsetMs(ts, zone) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = {};
    for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
  },
  // The wall date in a zone at an instant -> { y, mo, d }
  dateIn(ts, zone) {
    const off = this.offsetMs(ts, zone);
    const d = new Date(ts + off);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() };
  },
  // A wall-clock reading in a zone -> the instant. Across a clock change the reading that does not
  // exist (02:30 on the spring-forward night) is moved forward, as calendars do.
  zonedToUtc(y, mo, d, h, mi, zone) {
    const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
    let t = guess - this.offsetMs(guess, zone);
    const off2 = this.offsetMs(t, zone);
    t = guess - off2;
    return t;
  },

  // ---- reading what was typed ----------------------------------------------------------
  // -> { time: {h, mi}, rest } or null when there is no clock reading in the text.
  // A bare number ("21") is not a time: it needs a colon, am/pm, or the word noon/midnight.
  _time(text) {
    const re = /(?:^|\s)(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)(?=$|\s)/gi;
    for (const m of text.matchAll(re)) {
      let h, mi = 0;
      if (/^noon$/i.test(m[1])) h = 12;
      else if (/^midnight$/i.test(m[1])) h = 0;
      else {
        if (m[3] === undefined && !m[4]) continue;
        h = Number(m[2]); mi = m[3] === undefined ? 0 : Number(m[3]);
        if (mi > 59) throw new Error('There is no minute ' + mi + ': minutes run :00 to :59');
        if (m[4]) {
          if (h < 1 || h > 12) throw new Error('With am or pm the hour runs 1 to 12');
          if (/pm/i.test(m[4]) && h !== 12) h += 12;
          if (/am/i.test(m[4]) && h === 12) h = 0;
        } else if (h > 23) throw new Error('There is no hour ' + h + ': use 0 to 23, or say am or pm');
      }
      return { time: { h, mi }, rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
    }
    return null;
  },

  // "21:00 Istanbul" -> { ts, zone, label, assumed } ; throws what it could not read.
  parse(input, now = this._now()) {
    let text = String(input == null ? '' : input).trim().replace(/[,]/g, ' ').replace(/\s+/g, ' ');
    if (!text) throw new Error('Type a time and a place, like 21:00 Istanbul');
    const t = this._time(text);
    if (!t) throw new Error('There is no time in "' + CommsStore.line(input, 60) + '". Write it like 21:00 or 9pm.');
    text = t.rest;
    let day = '';
    const dm = /(?:^|\s)(today|tomorrow|\d{4}-\d{2}-\d{2})(?=$|\s)/i.exec(text);
    if (dm) { day = dm[1].toLowerCase(); text = (text.slice(0, dm.index) + ' ' + text.slice(dm.index + dm[0].length)).replace(/\s+/g, ' ').trim(); }
    text = text.replace(/(?:^|\s)(in|at|@|time|o'clock)(?=$|\s)/gi, ' ').replace(/\s+/g, ' ').trim();
    const zone = text ? this.resolveZone(text) : this.localZone();
    if (!zone) throw new Error('"' + CommsStore.line(text, 40) + '" is not a place or zone Vex knows. Try a city, or a name like Europe/Istanbul.');
    let y, mo, d, assumed = '';
    const bump = () => { const n = new Date(Date.UTC(y, mo - 1, d + 1)); y = n.getUTCFullYear(); mo = n.getUTCMonth() + 1; d = n.getUTCDate(); };
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      [y, mo, d] = day.split('-').map(Number);
      const chk = new Date(Date.UTC(y, mo - 1, d));
      if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) throw new Error(day + ' is not a real date');
    } else {
      ({ y, mo, d } = this.dateIn(now, zone));
      if (day === 'tomorrow') bump();
      else if (!day) {
        if (this.zonedToUtc(y, mo, d, t.time.h, t.time.mi, zone) <= now) bump();
        assumed = 'No day was given, so this is the next ' + this.hm(t.time) + ' in ' + this.nameOf(zone) + '.';
      }
    }
    const ts = this.zonedToUtc(y, mo, d, t.time.h, t.time.mi, zone);
    return { ts, zone, label: this.nameOf(zone), assumed };
  },

  hm(t) { return String(t.h).padStart(2, '0') + ':' + String(t.mi).padStart(2, '0'); },
  nameOf(zone) { return zone === 'UTC' ? 'UTC' : zone.split('/').pop().replace(/_/g, ' '); },
  offsetLabel(ts, zone) {
    const m = Math.round(this.offsetMs(ts, zone) / 60000);
    const a = Math.abs(m);
    return 'UTC' + (m < 0 ? '-' : '+') + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
  },
  format(ts, zone) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return f.format(new Date(ts)) + ' (' + this.offsetLabel(ts, zone) + ')';
  },

  // The Discord timestamp text. Every reader sees it in their own zone.
  discord(ts) {
    const n = Math.floor(ts / 1000);
    const s = (style) => '<t:' + n + ':' + style + '>';
    return { short: s('t'), time: s('T'), date: s('d'), long: s('D'), full: s('f'), weekday: s('F'), relative: s('R'), raw: '<t:' + n + '>' };
  },

  // The whole answer for one line of text: -> { when, rows: [{ zone, label, text }], discord, assumed }
  convert(input, now = this._now()) {
    const p = this.parse(input, now);
    const local = this.localZone();
    const rows = [{ zone: p.zone, label: p.label + ' (the time you typed)', text: this.format(p.ts, p.zone) }];
    const seen = new Set([p.zone]);
    for (const z of [local, ...this.zones()]) {
      if (seen.has(z)) continue;
      seen.add(z);
      rows.push({ zone: z, label: z === local ? 'You (' + this.nameOf(z) + ')' : this.nameOf(z), text: this.format(p.ts, z) });
    }
    return { ts: p.ts, rows, discord: this.discord(p.ts), assumed: p.assumed };
  },
};

if (typeof window !== 'undefined') window.VexTimezone = VexTimezone;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTimezone };
