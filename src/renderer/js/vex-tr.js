// === Turkish-correct text (VexTr) ============================================
//
// Turkish has two letters I: dotted (i / İ) and dotless (ı / I). JavaScript's
// default toLowerCase()/toUpperCase() follow the English rule, so "İstanbul"
// lower-cases to "i̇stanbul" (an i and a combining dot) and "ISPARTA" to
// "isparta" instead of "ısparta". A search for "istanbul" then missed
// "İstanbul", and a case-insensitive compare called "Işık" and "IŞIK" different.
//
// This file is the one place that knows the rule, with no dependency on the
// ICU locale data that the running Electron happens to carry: every function
// here is plain string work, so the same call gives the same answer in the
// renderer, in main and in a test.
//
//   VexTr.lower(s) / VexTr.upper(s)   Turkish-correct casing (I -> ı, İ -> i, i -> İ)
//   VexTr.fold(s)                     for SEARCH: case, dotted/dotless I and the
//                                     Turkish accents all removed ("İstanbul",
//                                     "ISTANBUL", "istanbul" and "Şişli" ~ "sisli")
//   VexTr.equals(a, b)                case-insensitive equality, Turkish rules (ı != i)
//   VexTr.includes(hay, needle)       folded substring test
//   VexTr.compare(a, b)               Turkish collation for sorting (c < ç, g < ğ, ı < i ...)
//   VexTr.score(query, text)          0..100 match strength for a ranked list
//   VexTr.parseAmount(s)              "1.234,56 TL" -> { value, cents, currency }
//   VexTr.parseDay(s, now)            "yarın", "15.03.2026", "15 Mart", "cuma" -> a day
//   VexTr.parseClock(s)               "saat 14:30", "akşam 8", "öğlen" -> { hour, minute }
//   VexTr.parseWhen(s, now)           a day with an optional time -> Date or null
//
// A parser returns null for text that is not in Turkish form and THROWS for
// text that is (a month name, a dd.mm.yyyy) but impossible (31 Şubat): a
// reminder that lands on the wrong day is worse than one that refuses.
const VexTr = {
  // ---- casing -----------------------------------------------------------------
  lower(s) {
    return String(s == null ? '' : s).normalize('NFC').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  },
  upper(s) {
    return String(s == null ? '' : s).normalize('NFC').replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
  },

  // The accents Turkish adds to Latin letters, and the circumflexed vowels of
  // loan words (kâğıt, hilâl), as plain letters.
  _PLAIN: { ç: 'c', ğ: 'g', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u', ê: 'e', ô: 'o' },

  // Search form. Every I becomes i first, so a keyboard without the Turkish
  // layout (typing "Istanbul" for "İstanbul", "ısparta" for "Isparta") matches.
  fold(s) {
    const t = String(s == null ? '' : s).normalize('NFC')
      .replace(/[İIı]/g, 'i')
      .replace(/̇/g, '')
      .toLowerCase();
    let out = '';
    for (const ch of t) out += this._PLAIN[ch] || ch;
    return out;
  },

  equals(a, b) { return this.lower(a) === this.lower(b); },
  includes(hay, needle) { return this.fold(hay).includes(this.fold(needle)); },

  // ---- collation --------------------------------------------------------------
  // { ignoreCase: true } puts "ışık" and "IŞIK" level (but not ı and i).
  _collators: {},
  compare(a, b, { ignoreCase = false } = {}) {
    const key = ignoreCase ? 'case' : 'variant';
    if (!this._collators[key]) {
      const c = new Intl.Collator('tr', { sensitivity: ignoreCase ? 'accent' : 'variant', numeric: true });
      if (!/^tr/i.test(c.resolvedOptions().locale)) throw new Error('This build has no Turkish collation data (Intl.Collator("tr") resolved to ' + c.resolvedOptions().locale + ')');
      this._collators[key] = c;
    }
    return this._collators[key].compare(String(a == null ? '' : a), String(b == null ? '' : b));
  },

  // ---- ranked matching --------------------------------------------------------
  // How well `query` matches `text`, 0 (no match) to 100. Every word of the
  // query has to match; the weakest word decides. Tiers per word: the whole
  // text 100, its start 90, the start of one of its words 80, inside it 60, the
  // letters in order ("gh" in "GitHub") 35 for queries of two letters or more.
  // { fuzzy: false } leaves out the last tier (for long texts, where letters in order are noise).
  score(query, text, { fuzzy = true } = {}) {
    const q = this.fold(query).trim();
    if (!q) return 0;
    const t = this.fold(text);
    if (!t) return 0;
    if (t === q) return 100;
    let weakest = 100;
    for (const w of q.split(/\s+/)) {
      let s = 0;
      if (t.startsWith(w)) s = 90;
      else if (new RegExp('(?:^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t)) s = 80;
      else if (t.includes(w)) s = 60;
      else if (fuzzy && w.length >= 2) {
        let from = 0, ok = true;
        for (const ch of w) { const at = t.indexOf(ch, from); if (at < 0) { ok = false; break; } from = at + 1; }
        if (ok) s = 35;
      }
      if (!s) return 0;
      weakest = Math.min(weakest, s);
    }
    return weakest;
  },

  // ---- amounts ----------------------------------------------------------------
  _CURRENCY: [
    [/₺|\btl\b|\btry\b|\blira\b/, 'TRY'],
    [/\$|\busd\b|\bdolar\b|\bdollars?\b/, 'USD'],
    [/€|\beur\b|\beuro\b/, 'EUR'],
    [/£|\bgbp\b|\bsterlin\b|\bpounds?\b/, 'GBP'],
  ],

  // Turkish writes 1.234,56: the dot groups thousands, the comma is the
  // decimal point. A dot followed by one or two digits ("12.5") is read the
  // English way, as a decimal, because nobody groups thousands that way; "1,234.56"
  // (comma first, dot last) is English too. Anything else is refused.
  // → { value, cents, currency|null }
  parseAmount(text) {
    const raw = String(text == null ? '' : text);
    const lowered = this.fold(raw.replace(/₺/g, ' ₺ ').replace(/\$/g, ' $ ').replace(/€/g, ' € ').replace(/£/g, ' £ '));
    let currency = null;
    for (const [re, code] of this._CURRENCY) if (re.test(lowered)) { currency = code; break; }
    const num = raw.replace(/[\s ]/g, '').replace(/[^\d.,-]/g, '');
    if (!/\d/.test(num)) throw new Error('No amount in "' + raw + '"');
    if (num.startsWith('-') || num.includes('-')) throw new Error('"' + raw + '" is a negative or malformed amount');
    let whole, frac = '';
    const dots = (num.match(/\./g) || []).length, commas = (num.match(/,/g) || []).length;
    if (dots && commas) {
      // Whichever comes last is the decimal point.
      const decimal = num.lastIndexOf(',') > num.lastIndexOf('.') ? ',' : '.';
      const group = decimal === ',' ? '.' : ',';
      if (num.split(decimal).length !== 2 || num.split(decimal)[1].includes(group)) throw new Error('"' + raw + '" does not look like an amount');
      const [w, f] = num.split(decimal);
      if (!/^\d{1,3}(?:[.,]\d{3})*$/.test(w) && !/^\d+$/.test(w)) throw new Error('"' + raw + '" does not look like an amount');
      whole = w.replace(/[.,]/g, ''); frac = f;
    } else if (commas) {
      if (commas > 1) throw new Error('"' + raw + '" does not look like an amount');
      [whole, frac] = num.split(',');
    } else if (dots) {
      const parts = num.split('.');
      const grouped = parts.length > 1 && /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every(p => /^\d{3}$/.test(p));
      if (grouped) whole = parts.join('');
      else if (dots === 1 && /^\d{1,2}$/.test(parts[1])) { whole = parts[0]; frac = parts[1]; }
      else throw new Error('"' + raw + '" does not look like an amount');
    } else whole = num;
    if (!/^\d+$/.test(whole || '0') || (frac && !/^\d{1,2}$/.test(frac))) throw new Error('"' + raw + '" does not look like an amount');
    const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
    if (!Number.isSafeInteger(cents)) throw new Error('That amount is too large');
    return { value: cents / 100, cents, currency };
  },

  // ---- days and clocks --------------------------------------------------------
  _MONTHS: { ocak: 0, oca: 0, subat: 1, sub: 1, mart: 2, mar: 2, nisan: 3, nis: 3, mayis: 4, may: 4, haziran: 5, haz: 5, temmuz: 6, tem: 6, agustos: 7, agu: 7, eylul: 8, eyl: 8, ekim: 9, eki: 9, kasim: 10, kas: 10, aralik: 11, ara: 11 },
  _WEEKDAYS: { pazar: 0, pazartesi: 1, sali: 2, carsamba: 3, persembe: 4, cuma: 5, cumartesi: 6 },
  _DAY_WORDS: { bugun: 0, yarin: 1, 'obur gun': 2, 'ertesi gun': 1 },

  _midnight(now) { const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); },
  _real(y, m, d, what) {
    const dt = new Date(y, m, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) throw new Error(what + ' is not a real date');
    return dt;
  },

  // The start of `text` as a day. → { date, rest } (rest: what follows, folded
  // and trimmed, for a clock) or null when the text does not begin with a
  // Turkish day. A day without a year is the next one that has not passed.
  parseDay(text, now) {
    const s = this.fold(text).replace(/\s+/g, ' ').trim();
    const today = this._midnight(now);
    let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?=$|\s)\s*(.*)$/.exec(s);
    if (m) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return { date: this._real(y, Number(m[2]) - 1, Number(m[1]), m[0].split(/\s/)[0]), rest: m[4] };
    }
    m = /^(\d{1,2})[./](\d{1,2})(?=$|\s)\s*(.*)$/.exec(s);
    // "14.30" is a clock, not the 14th of month 30: a month past 12 is not a day here.
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
      let dt = this._real(today.getFullYear(), Number(m[2]) - 1, Number(m[1]), m[1] + '.' + m[2]);
      if (dt < today) dt = this._real(today.getFullYear() + 1, Number(m[2]) - 1, Number(m[1]), m[1] + '.' + m[2]);
      return { date: dt, rest: m[3] };
    }
    m = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?(?=$|\s)\s*(.*)$/.exec(s);
    if (m && Object.prototype.hasOwnProperty.call(this._MONTHS, m[2])) {
      const mon = this._MONTHS[m[2]];
      if (m[3]) return { date: this._real(Number(m[3]), mon, Number(m[1]), m[1] + ' ' + m[2]), rest: m[4] };
      let dt = this._real(today.getFullYear(), mon, Number(m[1]), m[1] + ' ' + m[2]);
      if (dt < today) dt = this._real(today.getFullYear() + 1, mon, Number(m[1]), m[1] + ' ' + m[2]);
      return { date: dt, rest: m[4] };
    }
    for (const word of Object.keys(this._DAY_WORDS)) {
      if (s === word || s.startsWith(word + ' ')) {
        const d = new Date(today); d.setDate(d.getDate() + this._DAY_WORDS[word]);
        return { date: d, rest: s.slice(word.length).trim() };
      }
    }
    m = /^(?:gelecek |haftaya |bu )?([a-z]+)(?: (.*))?$/.exec(s);
    if (m && Object.prototype.hasOwnProperty.call(this._WEEKDAYS, m[1])) {
      const want = this._WEEKDAYS[m[1]];
      let add = (want - today.getDay() + 7) % 7;
      if (add === 0) add = 7;           // "cuma" said on a Friday: the next one
      if (/^haftaya /.test(s)) add += 7;
      const d = new Date(today); d.setDate(d.getDate() + add);
      return { date: d, rest: m[2] || '' };
    }
    return null;
  },

  // "14:30", "14.30", "saat 14", "saat 14:30", "sabah 9", "öğleden sonra 3",
  // "akşam 8", "gece 11", "öğlen", "gece yarısı". → { hour, minute } or null.
  parseClock(text) {
    const s = this.fold(text).replace(/\s+/g, ' ').trim().replace(/^saat /, '');
    if (!s) return null;
    if (s === 'ogle' || s === 'oglen') return { hour: 12, minute: 0 };
    if (s === 'gece yarisi') return { hour: 0, minute: 0 };
    // A part of the day with no number: "yarın sabah", "cuma akşam".
    const PART = { sabah: 9, 'ogleden sonra': 14, aksam: 19, gece: 22 };
    if (Object.prototype.hasOwnProperty.call(PART, s)) return { hour: PART[s], minute: 0 };
    const m = /^(?:(sabah|ogleden sonra|aksam|gece|ogle) )?(\d{1,2})(?:[:.](\d{2}))?(?: da| de| ta| te)?$/.exec(s);
    if (!m) return null;
    let hour = Number(m[2]);
    const minute = m[3] === undefined ? 0 : Number(m[3]);
    if (minute > 59) throw new Error('There is no minute ' + minute);
    const part = m[1];
    if (part) {
      if (hour < 1 || hour > 12) throw new Error('"' + text + '": with ' + part + ' the hour runs 1 to 12');
      if (part === 'ogleden sonra' || part === 'aksam') { if (hour < 12) hour += 12; }
      else if (part === 'gece') { if (hour === 12) hour = 0; else if (hour >= 6) hour += 12; }
      else if (part === 'ogle') { if (hour < 12 && hour < 6) hour += 12; }
    } else if (hour > 23) throw new Error('There is no ' + hour + ' o\'clock');
    return { hour, minute };
  },

  // A Turkish day with an optional clock → a Date, or null when `text` does
  // not begin with a Turkish day. `defaultHour` is used when no clock is given.
  parseWhen(text, now, defaultHour = 9) {
    const day = this.parseDay(text, now);
    if (!day) return null;
    let hour = defaultHour, minute = 0;
    if (day.rest) {
      const c = this.parseClock(day.rest);
      if (!c) throw new Error('Could not read "' + day.rest + '" as a time of day');
      hour = c.hour; minute = c.minute;
    }
    return new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate(), hour, minute, 0, 0);
  },
};

if (typeof window !== 'undefined') window.VexTr = VexTr;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTr };
