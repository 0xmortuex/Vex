// === Turkish dates, amounts and reminders ====================================
//
// "12 Ekim", "yarın akşam 8'de", "haftaya Salı", "1.250,50 TL" -- read the way
// a person writes them in Turkish, and ALWAYS shown back as a confirm line
// before anything is saved (see confirmReminder / QuickCapture). A misparse
// is therefore something you see and correct, never something that happens.
//
//   VexTrParse.parse(text, now)         -> { at, hasTime, start, end, phrase } or null   (pure)
//   VexTrParse.parseWhen(text, now)     -> Date, or throws a plain-words error           (pure)
//   VexTrParse.parseAmount(text)        -> { amount, currency, raw, start, end } or null (pure)
//   VexTrParse.parseNumber("1.250,50")  -> 1250.5                                        (pure)
//   VexTrParse.reminderFromSentence(s)  -> { message, at, hasTime, phrase } or null      (pure)
//   VexTrParse.extractDates(text, now)  -> [{ phrase, at, hasTime }]                     (pure)
//   VexTrParse.isTurkish(text)          -> true when the text uses Turkish date words
//   VexTrParse.describe(ms, hasTime)    -> "Yarın 20:00 (Cuma, 16 Ekim)"
//
// Folding: Turkish letters are matched without their marks (ş->s, ı->i ...), one
// character for one character, so a position found in the folded text is the
// same position in the original. Nothing here sends anything anywhere.
const VexTrParse = {
  PREF: 'vex.tr.enabled',     // 'off' turns the Turkish parsing in reminders and capture off
  MONTHS: { ocak: 0, oca: 0, subat: 1, sub: 1, mart: 2, mar: 2, nisan: 3, nis: 3, mayis: 4, may: 4, haziran: 5, haz: 5, temmuz: 6, tem: 6, agustos: 7, agu: 7, eylul: 8, eyl: 8, ekim: 9, eki: 9, kasim: 10, kas: 10, aralik: 11, ara: 11 },
  MONTH_NAMES: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  WEEKDAYS: { pazartesi: 1, sali: 2, carsamba: 3, persembe: 4, cuma: 5, cumartesi: 6, pazar: 0 },
  DAY_NAMES: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
  // A named part of the day, with the hour it means when no hour is given.
  PARTS: { sabah: 8, ogleden_sonra: 15, ogle: 12, ikindi: 16, aksam: 19, gece: 22 },
  DEFAULT_HOUR: 9,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF, on ? 'on' : 'off'); },

  // ---- folding ----------------------------------------------------------------
  _FOLD: { 'ı': 'i', 'İ': 'i', 'I': 'i', 'ş': 's', 'Ş': 's', 'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u', 'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c', '’': "'", '‘': "'", '`': "'", '´': "'" },
  fold(text) {
    let out = '';
    for (const ch of String(text == null ? '' : text)) out += (this._FOLD[ch] || ch.toLowerCase()).slice(0, 1);
    return out;
  },

  // ---- one Turkish reading of days, clocks and amounts ---------------------------
  // js/vex-tr.js (VexTr) is the strict parser of the daily-flow code (deadlines, snooze, quick
  // reminder). Where the two agree by construction this file asks VexTr, so there is one definition:
  //   - an amount of the plain shapes (1.250,50  1250,5  12.5  1250)  -> VexTr.parseAmount
  //   - a clock hour next to a part of the day ("akşam 8")            -> VexTr.parseClock
  //   - bugün / yarın / öbür gün / ertesi gün and a bare weekday      -> VexTr.parseDay
  // What only this parser reads (a phrase inside a sentence, "haftaya Salı", "2 saat sonra",
  // ikindi, "1,250,000", a sign) stays here, and a test keeps the two in step where they overlap.
  _tr() {
    const t = globalThis.VexTr || (typeof require === 'function' ? require('./vex-tr.js').VexTr : null);
    if (!t) throw new Error('VexTr (js/vex-tr.js) must load before js/tr-parse.js');
    return t;
  },
  _PLAIN_AMOUNT: /^(?:\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+\.\d{1,2})$/,

  // ---- numbers and amounts ------------------------------------------------------
  // Turkish writes 1.250,50: the dot groups thousands, the comma is the decimal point.
  // "1250.5" and "1,250.50" (the English way) are read too when the shape is unambiguous.
  parseNumber(raw) {
    const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, '');
    if (!/^[+-]?\d[\d.,]*$/.test(s)) return null;
    if (this._PLAIN_AMOUNT.test(s)) return this._tr().parseAmount(s).value;
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    let norm;
    if (lastDot >= 0 && lastComma >= 0) {
      // Both present: the later one is the decimal point.
      norm = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      // "1,5" is a decimal; "1,250,000" groups. One comma with 1-2 digits after it is a decimal.
      const parts = s.split(',');
      if (parts.length > 2) norm = s.replace(/,/g, '');
      else norm = parts[0] + '.' + parts[1];
    } else if (lastDot >= 0) {
      const parts = s.split('.');
      // "1.250" and "1.250.000" are thousands in Turkish; "12.5" is a decimal.
      norm = parts.length > 2 || (parts[1].length === 3 && parts[0].length <= 3) ? parts.join('') : s;
    } else norm = s;
    const n = Number(norm);
    return Number.isFinite(n) ? n : null;
  },

  _CUR: '(?:tl|try|₺|lira|türk lirası|turk lirasi)',
  _MULT: { bin: 1e3, milyon: 1e6, milyar: 1e9 },
  // "1.250,50 TL", "₺1.250,50", "TL 99,90", "250 lira", "2,5 milyon TL"
  parseAmount(text) {
    const s = String(text == null ? '' : text);
    const f = this.fold(s).replace(/₺/g, '₺');
    const num = '(\\d[\\d.,]*\\d|\\d)';
    const re = [
      new RegExp(num + '\\s*(bin|milyon|milyar)?\\s*(tl|try|₺|lira|turk lirasi)(?![a-z])', 'i'),
      new RegExp('(?:^|[^a-z])(?:tl|try|₺)\\s*' + num + '\\s*(bin|milyon|milyar)?', 'i'),
    ];
    for (let i = 0; i < re.length; i++) {
      const m = re[i].exec(f);
      if (!m) continue;
      let n = this.parseNumber(m[1]);
      if (n == null) continue;
      if (m[2] && this._MULT[m[2].toLowerCase()]) n *= this._MULT[m[2].toLowerCase()];
      // The match for the second shape starts with the separator; skip it.
      const lead = i === 1 ? m[0].search(/[a-z₺]/i) : 0;
      return { amount: Math.round(n * 100) / 100, currency: 'TRY', raw: s.slice(m.index + lead, m.index + m[0].length), start: m.index + lead, end: m.index + m[0].length };
    }
    return null;
  },

  formatAmount(n, currency) {
    const v = Number(n);
    if (!Number.isFinite(v)) throw new Error('That is not an amount');
    const [int, dec] = v.toFixed(2).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return grouped + (dec === '00' ? '' : ',' + dec) + ' ' + (currency === 'TRY' || !currency ? 'TL' : currency);
  },

  // ---- dates --------------------------------------------------------------------
  _day(base, days) { return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, 0, 0, 0, 0); },
  _mondayOf(d) { const x = this._day(d, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; },

  // An hour from the number and the part of the day it was said with.
  _hour(h, part) {
    if (h > 24 || h < 0) return null;
    // 1-12 beside sabah / öğle / akşam / öğleden sonra / gece, and 1-23 alone: VexTr's clock.
    const word = { sabah: 'sabah', ogle: 'ogle', aksam: 'aksam', ogleden_sonra: 'ogleden sonra', gece: 'gece' }[part];
    if (Number.isInteger(h) && ((word && h >= 1 && h <= 12) || (!part && h >= 1 && h <= 23))) {
      return this._tr().parseClock((word ? word + ' ' : '') + h).hour;
    }
    if (part === 'sabah') return h === 12 ? 12 : h;
    if (part === 'ogle') return h < 6 ? h + 12 : h;
    if (part === 'aksam' || part === 'ogleden_sonra' || part === 'ikindi') return h < 12 ? h + 12 : h;
    if (part === 'gece') return h >= 6 && h < 12 ? h + 12 : (h === 12 ? 0 : h);
    return h === 24 ? 0 : h;
  },

  // Finds the first date/time phrase. now: a Date or ms.
  parse(text, now) {
    const base = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const f = this.fold(text);
    const spans = [];          // [start, end] of every piece that was understood
    const mark = (m, len) => { spans.push([m.index, m.index + (len == null ? m[0].length : len)]); };
    let dayDate = null;        // a Date at 00:00 of the day meant
    let hasDay = false;
    let h = null, mi = 0, part = null, timeExplicit = false;
    let add = null;            // a relative amount in ms ("2 saat sonra")
    let m;

    // relative: "2 saat sonra", "30 dakika sonra", "3 gun sonra", "yarim saat sonra", "bir hafta sonra"
    const NUMW = { bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10 };
    m = /\b(yarim|\d+|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on)\s*(saat|dakika|dk|gun|hafta|ay)\s*(?:sonra|icinde)\b/.exec(f);
    if (m) {
      const n = m[1] === 'yarim' ? 0.5 : (NUMW[m[1]] || Number(m[1]));
      const unit = { saat: 3600e3, dakika: 60e3, dk: 60e3, gun: 86400e3, hafta: 7 * 86400e3 }[m[2]];
      if (m[2] === 'ay') { const d = new Date(base); d.setMonth(d.getMonth() + n); add = d.getTime() - base.getTime(); } else add = n * unit;
      mark(m);
      const at = new Date(Math.ceil((base.getTime() + add) / 60000) * 60000);
      return this._result(text, spans, at.getTime(), true);
    }

    // a numeric date: 12.10.2026, 12/10/2026, 12.10 (day first)
    m = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b(?![:\d])/.exec(f);
    if (m && Number(m[1]) <= 31 && Number(m[2]) <= 12 && !/^\d{1,2}[.]\d{2}$/.test(m[0]) ) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
      dayDate = this._ymd(y, Number(m[2]) - 1, Number(m[1]), base, !m[3]);
      if (dayDate) { hasDay = true; mark(m); }
    }
    // "12 Ekim", "12 Ekim 2026", "12 Ekim Cuma"
    if (!hasDay) {
      m = /\b(\d{1,2})\s*(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|oca|sub|mar|nis|may|haz|tem|agu|eyl|eki|kas|ara)\b(?:\s+(\d{4}))?/.exec(f);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
        dayDate = this._ymd(m[3] ? Number(m[3]) : null, this.MONTHS[m[2]], Number(m[1]), base, !m[3]);
        if (dayDate) { hasDay = true; mark(m); }
      }
    }
    // bugun / yarin / obur gun / ertesi gun / bu aksam / bu gece
    if (!hasDay) {
      m = /\b(bugun|yarin|obur\s*gun|yarindan\s*sonra|ertesi\s*gun)\b/.exec(f);
      if (m) {
        const k = m[1].replace(/\s+/g, ' ');
        // bugün / yarın / öbür gün / ertesi gün are VexTr's words (ertesi gün is the next day, 1);
        // "yarından sonra" is only read here.
        dayDate = k === 'yarindan sonra' ? this._day(base, 2) : this._tr().parseDay(k, base).date;
        hasDay = true; mark(m);
      } else if ((m = /\bbu\s+(aksam|gece|sabah)\b/.exec(f))) {
        dayDate = this._day(base, 0); hasDay = true; part = m[1]; mark(m);
      }
    }
    // a weekday, with haftaya / gelecek hafta / bu hafta / gelecek / bu
    if (!hasDay) {
      m = /\b(haftaya|gelecek\s+hafta|bu\s+hafta|gelecek|bu|onumuzdeki)?\s*(pazartesi|sali|carsamba|persembe|cumartesi|cuma|pazar)(?:ya|ye|da|de|ta|te|yi|yı)?\b/.exec(f);
      if (m && !(m[1] === 'bu' && false)) {
        const wd = this.WEEKDAYS[m[2]];
        const mod = (m[1] || '').replace(/\s+/g, ' ');
        const monday = this._mondayOf(base);
        if (mod === 'haftaya' || mod === 'gelecek hafta') {
          dayDate = this._day(monday, 7 + ((wd + 6) % 7));
        } else if (mod === 'bu hafta') {
          dayDate = this._day(monday, (wd + 6) % 7);
        } else {
          // A bare weekday ("Cuma", "bu Cuma"): the next one, VexTr's reading (a Friday's "Cuma" is next week's).
          dayDate = this._tr().parseDay(m[2], base).date;
        }
        hasDay = true; mark(m, m[0].length);
      } else if ((m = /\b(haftaya|gelecek\s+hafta)\b/.exec(f))) {
        dayDate = this._day(base, 7); hasDay = true; mark(m);
      }
    }
    // part of the day
    const pm = /\b(ogleden\s+sonra|sabah|ogle(?:yin)?|ikindi|aksam|gece)\b/.exec(f);
    if (pm) { part = pm[1].replace(/\s+/g, '_').replace(/^ogle.*/, (s) => (s.startsWith('ogleden') ? 'ogleden_sonra' : 'ogle')); if (!hasDay && !h) { /* time of day alone */ } mark(pm); }
    // Pieces already understood are blanked, so 12.10.2026 is not also read as 12:10.
    let g = f;
    for (const [a0, b0] of spans) g = g.slice(0, a0) + ' '.repeat(b0 - a0) + g.slice(b0);
    // a clock time: "saat 8'de", "8'de", "20:30", "20.30", "8 buçuk"
    let tm = /\b(?:saat\s*)?([01]?\d|2[0-4])\s*[:.]\s*([0-5]\d)(?:\s*'?\s*(?:de|da|te|ta))?\b/.exec(g);
    if (tm) { h = Number(tm[1]); mi = Number(tm[2]); timeExplicit = true; mark(tm); }
    else if ((tm = /\b(?:saat\s*)?(\d{1,2})\s*buc(?:uk)\b/.exec(g))) { h = Number(tm[1]); mi = 30; timeExplicit = true; mark(tm); }
    else if ((tm = /\bsaat\s*(\d{1,2})\b(?:\s*'?\s*(?:de|da|te|ta))?/.exec(g)) || ((tm = /\b(\d{1,2})\s*'\s*(?:de|da|te|ta)\b/.exec(g)))) { h = Number(tm[1]); timeExplicit = true; mark(tm); }
    else if (hasDay || part) {
      // "yarın akşam 8" -- a bare hour next to a part of the day
      const bare = part && /\b(\d{1,2})\b(?!\s*(?:ekim|kasim|mart|nisan|ocak|subat|mayis|haziran|temmuz|agustos|eylul|aralik))/.exec(f.replace(/\d{1,2}\s*(?:ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)/g, (s) => ' '.repeat(s.length)));
      if (bare && Number(bare[1]) <= 24) { h = Number(bare[1]); timeExplicit = true; mark(bare); }
    }
    if (!hasDay && !timeExplicit && !part) return null;
    if (h != null && (h > 24 || (h === 24 && mi > 0))) return null;

    let hour, hasTime = true;
    if (h != null) hour = this._hour(h, part);
    else if (part) hour = this.PARTS[part];
    else { hour = this.DEFAULT_HOUR; hasTime = false; }
    if (hour == null) return null;

    let when;
    if (hasDay) when = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour, mi, 0, 0);
    else {
      // A time alone: today if still to come, otherwise tomorrow.
      when = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, mi, 0, 0);
      if (when.getTime() <= base.getTime()) when = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, hour, mi, 0, 0);
    }
    return this._result(text, spans, when.getTime(), hasTime);
  },

  // A real calendar date, or null for 31 Nisan. With no year: this year, or next when it has passed.
  _ymd(year, month, day, base, rollYear) {
    let y = year == null ? base.getFullYear() : year;
    const make = (yy) => { const d = new Date(yy, month, day, 0, 0, 0, 0); return d.getMonth() === month && d.getDate() === day ? d : null; };
    let d = make(y);
    if (d && rollYear && d.getTime() < new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()) d = make(y + 1);
    return d;
  },

  _result(text, spans, at, hasTime) {
    const start = Math.min(...spans.map(s => s[0])), end = Math.max(...spans.map(s => s[1]));
    return { at, hasTime, start, end, phrase: String(text).slice(start, end).trim() };
  },

  // The same contract as VexQuickReminder.parseWhen: a Date in the future, or a plain error.
  parseWhen(text, now) {
    const base = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const r = this.parse(text, base);
    if (!r) throw new Error('Zamanı anlayamadım / Could not read "' + String(text).trim() + '" as a time. Try "yarın akşam 8\'de", "12 Ekim 14:30" or "haftaya Salı".');
    if (r.at <= base.getTime()) throw new Error('Bu an geçti / That moment has already passed -- give a time in the future.');
    return new Date(r.at);
  },

  describe(ms, hasTime = true, now) {
    const d = new Date(ms), b = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const days = Math.round((this._day(d, 0) - this._day(b, 0)) / 86400000);
    const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const long = this.DAY_NAMES[d.getDay()] + ', ' + d.getDate() + ' ' + this.MONTH_NAMES[d.getMonth()] + (d.getFullYear() !== b.getFullYear() ? ' ' + d.getFullYear() : '');
    const lead = days === 0 ? 'Bugün' : (days === 1 ? 'Yarın' : null);
    return (lead ? lead + (hasTime ? ' ' + hhmm : '') + ' (' + long + ')' : long + (hasTime ? ' ' + hhmm : ''));
  },

  // Words only Turkish uses, so English text is left to the English parser.
  isTurkish(text) {
    const f = this.fold(text);
    return /\b(bugun|yarin|obur gun|ertesi gun|haftaya|gelecek hafta|bu aksam|bu gece|aksam|sabah|ogleden sonra|ikindi|saat\s*\d|hatirla|dakika sonra|saat sonra|gun sonra|hafta sonra|pazartesi|sali|carsamba|persembe|cumartesi|ocak|subat|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\b/.test(f)
      || /\b\d{1,2}\s*'\s*(?:de|da|te|ta)\b/.test(f) || /\b\d\S*\s*(?:tl|lira)\b/.test(f);
  },

  // "yarın akşam 8'de annemi ara hatırlat" -> { message: 'annemi ara', at, hasTime, phrase }
  reminderFromSentence(text, now) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return null;
    const f = this.fold(raw);
    const ask = /\b(?:bana\s+)?hatirlat(?:ir\s*misin|\s*misin)?\b|\bhatirlatma\b|\bhatirla\b/.exec(f);
    const r = this.parse(raw, now);
    if (!r) return null;
    if (!ask) return null;
    // Take the date phrase out, then the ask-word (positions are shared by folding).
    let msg = raw.slice(0, r.start) + ' ' + raw.slice(r.end);
    const cut = /\b(?:bana\s+)?hatirlat(?:ir\s*misin|\s*misin)?\b|\bhatirlatma\b|\bhatirla\b/.exec(this.fold(msg));
    if (cut) msg = msg.slice(0, cut.index) + ' ' + msg.slice(cut.index + cut[0].length);
    msg = msg.replace(/\s+/g, ' ').replace(/^[\s,.;:'-]+|[\s,.;:'-]+$/g, '').replace(/^(?:ve|ki)\s+/i, '').trim();
    if (!msg) return null;
    return { message: msg, at: r.at, hasTime: r.hasTime, phrase: r.phrase };
  },

  // Every date phrase in a text, one per sentence, for the deadline extractor and clips.
  extractDates(text, now) {
    const out = [];
    for (const sentence of String(text == null ? '' : text).split(/(?<=[.!?\n])\s+/)) {
      if (!sentence.trim()) continue;
      const r = this.parse(sentence, now);
      if (r) out.push({ phrase: r.phrase, at: r.at, hasTime: r.hasTime, sentence: sentence.trim().slice(0, 240) });
    }
    return out;
  },

  // The confirm line. Resolves to true only when the person says yes.
  async confirmReminder(parsed) {
    if (typeof window === 'undefined' || typeof window.vexConfirm !== 'function') throw new Error('The confirm dialog is not available');
    return window.vexConfirm({
      title: 'Hatırlatıcı / Reminder',
      message: '"' + parsed.message + '"\n' + this.describe(parsed.at, parsed.hasTime) + (parsed.hasTime ? '' : '\n(saat verilmedi: ' + String(this.DEFAULT_HOUR).padStart(2, '0') + ':00 / no time given)'),
      okLabel: 'Kaydet / Save',
    });
  },
};

if (typeof window !== 'undefined') window.VexTrParse = VexTrParse;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTrParse };
