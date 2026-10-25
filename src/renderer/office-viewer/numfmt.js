// Spreadsheet number formats: what a cell's saved number is shown as ("#,##0.00 TL", "0.0%", "dd.mm.yyyy", "h:mm", ...).
// A format is a number (one of the built-in ones) or a format code. This covers what school and office sheets use: digits and
// separators, percent, scientific, simple fractions, text, currency marks, sections for positive / negative / zero / text, and
// dates and times with day and month names in English or Turkish. A code it cannot read is shown as the plain number.

const BUILTIN = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'DATE', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'DATETIME',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 48: '##0.0E+0', 49: '@',
};
const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
};
const DAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  tr: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
};

const pad = (n, w) => String(n).padStart(w, '0');

// ---- serial dates --------------------------------------------------------------------------------------
export function serialToParts(serial, date1904) {
  let s = serial;
  if (!date1904 && s < 61) s += 1;           // Excel believes 1900 was a leap year
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = Math.round(s * 86400000);
  const d = new Date(base + ms);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds(), total: serial };
}

// ---- reading a code --------------------------------------------------------------------------------------------
function splitSections(code) {
  const out = [];
  let cur = '', q = false, br = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '\\' && !q) { cur += ch + (code[i + 1] || ''); i++; continue; }
    if (ch === '"') q = !q;
    else if (!q && ch === '[') br = true;
    else if (!q && ch === ']') br = false;
    if (ch === ';' && !q && !br) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

function tokenize(section) {
  const tokens = [];
  const s = section;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') { const j = s.indexOf('"', i + 1); const end = j < 0 ? s.length : j; tokens.push({ lit: s.slice(i + 1, end) }); i = end + 1; continue; }
    if (ch === '\\') { tokens.push({ lit: s[i + 1] || '' }); i += 2; continue; }
    if (ch === '_') { tokens.push({ lit: ' ' }); i += 2; continue; }
    if (ch === '*') { i += 2; continue; }
    if (ch === '[') {
      const j = s.indexOf(']', i);
      const body = s.slice(i + 1, j < 0 ? s.length : j);
      i = j < 0 ? s.length : j + 1;
      if (/^[hms]+$/i.test(body)) { tokens.push({ elapsed: body[0].toLowerCase(), width: body.length }); continue; }
      const cur = /^\$([^-\]]*)/.exec(body);
      if (cur && cur[1]) tokens.push({ lit: cur[1] });
      const cond = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(body);
      if (cond) tokens.push({ cond: [cond[1], parseFloat(cond[2])] });
      continue;                                     // colours and locale ids are ignored
    }
    const rest = s.slice(i);
    let m;
    if ((m = /^(AM\/PM|am\/pm|A\/P|a\/p)/.exec(rest))) { tokens.push({ ampm: m[1] }); i += m[1].length; continue; }
    if ((m = /^(y{1,4}|m{1,5}|d{1,4}|h{1,2}|s{1,2})/i.exec(rest))) { tokens.push({ dt: m[1][0].toLowerCase(), width: m[1].length }); i += m[1].length; continue; }
    if ((m = /^E[+-]/i.exec(rest))) { tokens.push({ exp: m[0][1] }); i += 2; continue; }
    if (/[0#?]/.test(ch)) { tokens.push({ digit: ch }); i++; continue; }
    if (ch === '.' || ch === ',' || ch === '%' || ch === '/' || ch === '@') { tokens.push({ sym: ch }); i++; continue; }
    tokens.push({ lit: ch });
    i++;
  }
  return tokens;
}

const isDateTokens = (tokens) => tokens.some((t) => t.dt || t.ampm || t.elapsed);

// ---- formatting ------------------------------------------------------------------------------------------------------
function formatNumberTokens(tokens, value, locale) {
  const dec = locale === 'tr' ? ',' : '.';
  const grp = locale === 'tr' ? '.' : ',';
  let percent = 0;
  let digitsBefore = 0, digitsAfter = 0, afterPoint = false, thousands = false, scale = 0, seenDigit = false, inExp = false;
  const exp = tokens.find((t) => t.exp);
  if (!tokens.some((t) => t.digit || t.exp)) return { text: tokens.map((t) => (t.lit != null ? t.lit : t.sym === '%' ? '%' : '')).join(''), neg: false };
  const frac = tokens.some((t) => t.sym === '/');
  tokens.forEach((t, idx) => {
    if (t.exp) inExp = true;
    if (t.sym === '%') percent++;
    if (t.sym === '.') afterPoint = true;
    if (t.digit && !inExp) { seenDigit = true; if (afterPoint) digitsAfter++; else digitsBefore++; }
    if (t.sym === ',') {
      const next = tokens.slice(idx + 1).find((x) => x.digit || x.sym === '.' || x.lit != null);
      if (seenDigit && (!next || !next.digit)) scale++;
      else if (seenDigit) thousands = true;
    }
  });
  let v = value * Math.pow(100, percent) / Math.pow(1000, scale);
  const neg = v < 0;
  v = Math.abs(v);
  let body;
  if (exp) {
    const s = v.toExponential(digitsAfter);
    const [mant, e] = s.split('e');
    const expo = parseInt(e, 10);
    const expDigits = tokens.filter((t) => t.digit && tokens.indexOf(t) > tokens.indexOf(exp)).length || 2;
    const sign = expo < 0 ? '-' : (exp.exp === '+' ? '+' : '');
    body = mant.replace('.', dec) + 'E' + sign + pad(Math.abs(expo), expDigits);
    return finish(tokens, body, neg, { simple: true });
  }
  if (frac) {
    const whole = Math.floor(v);
    let f = v - whole;
    const denDigits = tokens.filter((t) => t.digit).length > 2 ? 2 : 1;
    const maxDen = Math.pow(10, denDigits) - 1;
    let best = [0, 1], err = f;
    for (let d = 1; d <= maxDen; d++) { const n = Math.round(f * d); const e = Math.abs(f - n / d); if (e < err - 1e-12) { err = e; best = [n, d]; } }
    const hasWhole = tokens.some((t) => t.digit) && /#\s|0\s/.test(tokens.map((t) => t.digit || (t.lit === ' ' ? ' ' : t.sym || '')).join(''));
    let [n, d] = best;
    let w = whole;
    if (n === d) { w += 1; n = 0; }
    let text;
    if (!hasWhole) text = (w * d + n) + '/' + d;
    else text = (w ? w + ' ' : '') + (n ? n + '/' + d : '');
    const r = finish(tokens.filter((t) => t.lit !== ' '), text.trim() || '0', neg, { simple: true });
    return r;
  }
  const fixed = v.toFixed(digitsAfter);
  let [ip, fp = ''] = fixed.split('.');
  // '#' placeholders drop leading zeros; zeros before the point keep them
  const zerosBefore = tokens.filter((t) => t.digit === '0' && tokens.indexOf(t) < (tokens.findIndex((x) => x.sym === '.') < 0 ? Infinity : tokens.findIndex((x) => x.sym === '.'))).length;
  ip = ip.replace(/^0+(?=\d)/, '');
  if (ip === '0' && zerosBefore === 0 && digitsBefore > 0) ip = '';
  if (ip.length < zerosBefore) ip = ip.padStart(zerosBefore, '0');
  // trailing '#' after the point drop trailing zeros
  const zerosAfter = tokens.filter((t, idx) => t.digit === '0' && idx > tokens.findIndex((x) => x.sym === '.') && tokens.findIndex((x) => x.sym === '.') >= 0).length;
  if (digitsAfter > zerosAfter) { while (fp.length > zerosAfter && fp.endsWith('0')) fp = fp.slice(0, -1); }
  if (thousands) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, grp);
  body = ip + (fp ? dec + fp : '');
  if (!body) body = '0';
  return finish(tokens, body, neg, {});
}

// Puts the literal text around the digits: the digit tokens collapse into one place.
function finish(tokens, body, neg, opts) {
  let out = '', placed = false;
  for (const t of tokens) {
    if (t.digit || (t.sym && t.sym !== '%' && t.sym !== '@') || t.exp) {
      if (!placed) { out += body; placed = true; }
      continue;
    }
    if (t.sym === '%') out += '%';
    else if (t.lit != null) out += t.lit;
  }
  if (!placed) out += body;
  return { text: out, neg };
}

function formatDateTokens(tokens, value, { date1904, locale }) {
  const p = serialToParts(value, date1904);
  const hasAmPm = tokens.some((t) => t.ampm);
  const ms = Math.round((value - Math.floor(value)) * 86400000);
  const total = value;
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.lit != null) { out += t.lit; continue; }
    if (t.sym) { out += t.sym; continue; }
    if (t.digit) { out += t.digit === '0' ? '0' : ''; continue; }
    if (t.ampm) { out += p.h >= 12 ? (t.ampm.length === 1 || t.ampm[1] === '/' && t.ampm.length === 3 ? 'P' : 'PM') : (t.ampm.length === 3 ? 'A' : 'AM'); continue; }
    if (t.elapsed) {
      const unit = t.elapsed === 'h' ? 3600000 : t.elapsed === 'm' ? 60000 : 1000;
      out += pad(Math.floor(Math.round(total * 86400000) / unit), t.width);
      continue;
    }
    if (!t.dt) continue;
    switch (t.dt) {
      case 'y': out += t.width <= 2 ? pad(p.y % 100, 2) : pad(p.y, 4); break;
      case 'd': out += t.width === 1 ? p.d : t.width === 2 ? pad(p.d, 2) : (t.width === 3 ? DAYS[locale][p.wd].slice(0, 3) : DAYS[locale][p.wd]); break;
      case 'h': { const h = hasAmPm ? (p.h % 12 || 12) : p.h; out += t.width === 2 ? pad(h, 2) : h; break; }
      case 's': out += t.width === 2 ? pad(p.s, 2) : p.s; break;
      case 'm': {
        // minutes when the nearest neighbouring field is an hour or a second, else a month
        let prev = null, next = null;
        for (let k = i - 1; k >= 0; k--) if (tokens[k].dt || tokens[k].elapsed) { prev = tokens[k]; break; }
        for (let k = i + 1; k < tokens.length; k++) if (tokens[k].dt || tokens[k].elapsed) { next = tokens[k]; break; }
        const minute = (prev && (prev.dt === 'h' || prev.elapsed === 'h')) || (next && (next.dt === 's' || next.elapsed === 's'));
        if (minute) out += t.width === 2 ? pad(p.mi, 2) : p.mi;
        else if (t.width === 1) out += p.mo + 1;
        else if (t.width === 2) out += pad(p.mo + 1, 2);
        else if (t.width === 3) out += MONTHS[locale][p.mo].slice(0, 3);
        else if (t.width === 4) out += MONTHS[locale][p.mo];
        else out += MONTHS[locale][p.mo][0];
        break;
      }
      default: break;
    }
    // fractional seconds: ss.00
    if (t.dt === 's' && tokens[i + 1] && tokens[i + 1].sym === '.' && tokens[i + 2] && tokens[i + 2].digit) {
      let n = 0; let k = i + 2;
      while (tokens[k] && tokens[k].digit) { n++; k++; }
      out += '.' + pad(Math.floor(ms % 1000), 3).slice(0, n);
      i = k - 1;
    }
  }
  return out;
}

function general(value) {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const a = Math.abs(value);
  if (a >= 1e11 || a < 1e-9) return value.toExponential(5).replace(/\.?0+e/, 'E').replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2');
  return String(+value.toPrecision(11));
}

function localizeGeneral(text, locale) { return locale === 'tr' ? text.replace('.', ',') : text; }

const compiled = new Map();
function compile(code) {
  let c = compiled.get(code);
  if (c) return c;
  const sections = splitSections(code).map((s) => ({ tokens: tokenize(s) }));
  for (const sec of sections) { const cond = sec.tokens.find((t) => t.cond); sec.cond = cond ? cond.cond : null; sec.date = isDateTokens(sec.tokens); }
  c = { sections, date: sections.some((s) => s.date) };
  compiled.set(code, c);
  return c;
}

export function formatCodeOf(nf, locale) {
  if (nf == null || nf === 0) return null;
  if (typeof nf === 'string') return nf;
  const code = BUILTIN[nf];
  if (code === 'DATE') return locale === 'tr' ? 'dd.mm.yyyy' : 'm/d/yyyy';
  if (code === 'DATETIME') return locale === 'tr' ? 'dd.mm.yyyy hh:mm' : 'm/d/yyyy h:mm';
  return code || null;
}

export function isDateFormat(nf, locale) {
  const code = formatCodeOf(nf, locale);
  if (!code) return false;
  try { return compile(code).date; } catch { return false; }
}

// value: a number | string | boolean | error text.  type: 'n' | 's' | 'b' | 'e'.  -> the text to show
export function formatCell(value, type, nf, { date1904 = false, locale = 'en' } = {}) {
  if (value == null) return '';
  if (type === 'b') return value ? 'TRUE' : 'FALSE';
  if (type === 'e') return String(value);
  if (type === 's' || typeof value === 'string') {
    const code = formatCodeOf(nf, locale);
    if (code && code.includes('@') && !code.includes('@;') ) { /* text section: show as is */ }
    return String(value);
  }
  const code = formatCodeOf(nf, locale);
  if (!code || code === 'General') return localizeGeneral(general(value), locale);
  let c;
  try { c = compile(code); } catch { return localizeGeneral(general(value), locale); }
  const secs = c.sections;
  let sec = secs[0];
  let abs = false;
  if (secs.length > 1) {
    const conds = secs.some((s) => s.cond);
    if (conds) {
      const hit = secs.find((s) => s.cond && cmp(value, s.cond));
      sec = hit || secs[secs.length - 1];
    } else if (value < 0 && secs[1]) { sec = secs[1]; abs = true; }
    else if (value === 0 && secs[2]) sec = secs[2];
  }
  if (sec.date) {
    if (value < 0 || value > 2958465) return '#'.repeat(10);
    return formatDateTokens(sec.tokens, value, { date1904, locale });
  }
  if (sec.tokens.length === 1 && sec.tokens[0].sym === '@') return String(value);
  const r = formatNumberTokens(sec.tokens, abs ? Math.abs(value) : value, locale);
  return (r.neg && !abs ? '-' : '') + r.text;
}

function cmp(v, [op, n]) {
  switch (op) { case '<': return v < n; case '>': return v > n; case '<=': return v <= n; case '>=': return v >= n; case '=': return v === n; case '<>': return v !== n; default: return false; }
}
