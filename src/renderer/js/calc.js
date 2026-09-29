// === Vex inline calculator / converter ===
// Powers a top result in the command bar: type "12*7", "20cm to in",
// "100 f to c", or "10 usd to eur" and get the answer to copy. Math and unit
// conversion are fully offline; currency uses exchange rates fetched + cached by
// the main process (VexCalc.init loads them). evaluate() is pure given _rates, so
// it's unit-testable.
const VexCalc = {
  _rates: null,
  _ratesBase: 'USD',

  async init() {
    try {
      const r = await (window.vex && window.vex.fxRates ? window.vex.fxRates() : null);
      if (r && r.rates) { this._rates = r.rates; this._ratesBase = r.base || 'USD'; }
    } catch {}
  },

  // Returns { text, value, unavailable? } or null when the query isn't a calc.
  evaluate(qRaw) {
    const q = String(qRaw || '').trim();
    if (!q) return null;

    // Currency: "10 usd to eur"
    // Three-letter units ("5000 lbs to ton") are not currencies: both codes
    // being units skips this, and a code that is not a known currency falls
    // through to units instead of answering nothing (found 2026-09-29).
    let m = q.match(/^([\d,.]+)\s*([a-z]{3})\s*(?:to|in|=>|->)\s*([a-z]{3})$/i);
    if (m && !(this._isUnit(m[2].toLowerCase()) && this._isUnit(m[3].toLowerCase()))) {
      const r = this._currency(this._num(m[1]), m[2].toUpperCase(), m[3].toUpperCase());
      if (r) return r;
    }

    // Units: "20 cm to in", "100 f to c"
    m = q.match(/^([\d,.]+)\s*([a-z"'°]+)\s*(?:to|in)\s*([a-z"'°]+)$/i);
    if (m) { const r = this._unit(this._num(m[1]), m[2].toLowerCase().replace('°', ''), m[3].toLowerCase().replace('°', '')); if (r) return r; }

    // Arithmetic: digits + operators only (no identifiers, so eval is injection-safe)
    if (/^[0-9+\-*/%^().\s,]+$/.test(q) && /[0-9]/.test(q) && /[+\-*/%^]/.test(q)) return this._math(q);

    return null;
  },

  _num(s) { return parseFloat(String(s).replace(/,/g, '')); },
  _round(n) { return Math.round(n * 1e6) / 1e6; },
  _fmt(n) {
    if (!isFinite(n)) return String(n);
    return this._round(n).toLocaleString('en-US', { maximumFractionDigits: 6 });
  },
  // What is copied is the rounded figure that is shown: "0.1+0.2" showed 0.3
  // and copied 0.30000000000000004 (found 2026-09-29).
  _val(n) { return String(this._round(n)); },
  _isUnit(u) { return !!(this._LEN[u] || this._MASS[u] || this._TEMP[u]); },

  // Worked out by a small parser, not Function(): the window's CSP has no
  // 'unsafe-eval', so Function() threw in the real app and every sum ("12*7",
  // the agent's calculate tool) came back as nothing — only the tests, which
  // have no CSP, ever saw it work (2026-09-28).
  _math(q) {
    // "1 2 + 3" is two numbers, not 12 + 3.
    if (/[\d.]\s+[\d.]/.test(q)) return null;
    const src = q.replace(/,/g, '').replace(/\*\*/g, '^').replace(/\s+/g, '');
    if (!/^[0-9+\-*/%^.()]+$/.test(src)) return null;
    let i = 0;
    const peek = () => src[i];
    const number = () => {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/i.exec(src.slice(i));
      if (!m) throw new Error('number expected');
      i += m[0].length;
      return parseFloat(m[0]);
    };
    const primary = () => {
      if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error(') expected'); i++; return v; }
      return number();
    };
    // ^ binds tighter than a leading minus (-2^2 = -4) and groups to the right.
    const power = () => { const b = primary(); if (peek() === '^') { i++; return Math.pow(b, unary()); } return b; };
    const unary = () => { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return power(); };
    const term = () => {
      let v = unary();
      while (peek() === '*' || peek() === '/' || peek() === '%') { const op = src[i++]; const r = unary(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; }
      return v;
    };
    const expr = () => {
      let v = term();
      while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
      return v;
    };
    try {
      const val = expr();
      if (i !== src.length || typeof val !== 'number' || !isFinite(val)) return null;
      return { text: '= ' + this._fmt(val), value: this._val(val) };
    } catch { return null; }
  },

  // Metres / grams canonical scales.
  _LEN: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, '"': 0.0254, inch: 0.0254, inches: 0.0254, ft: 0.3048, "'": 0.3048, feet: 0.3048, foot: 0.3048, yd: 0.9144, yard: 0.9144, mi: 1609.344, mile: 1609.344, miles: 1609.344 },
  _MASS: { mg: 0.001, g: 1, gram: 1, grams: 1, kg: 1000, oz: 28.349523, lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237, ton: 1e6, tonne: 1e6 },

  _TEMP: { c: 'c', celsius: 'c', f: 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' },

  _unit(v, from, to) {
    if (!isFinite(v)) return null;
    if (this._LEN[from] && this._LEN[to]) return { text: this._fmt(v * this._LEN[from] / this._LEN[to]) + ' ' + to, value: this._val(v * this._LEN[from] / this._LEN[to]) };
    if (this._MASS[from] && this._MASS[to]) return { text: this._fmt(v * this._MASS[from] / this._MASS[to]) + ' ' + to, value: this._val(v * this._MASS[from] / this._MASS[to]) };
    const T = this._TEMP;
    if (T[from] && T[to]) return this._temp(v, T[from], T[to]);
    return null;
  },

  _temp(v, from, to) {
    let c;
    if (from === 'c') c = v; else if (from === 'f') c = (v - 32) * 5 / 9; else c = v - 273.15;
    let out;
    if (to === 'c') out = c; else if (to === 'f') out = c * 9 / 5 + 32; else out = c + 273.15;
    // Kelvin takes no degree sign: "273.15 K", not "273.15°K" (found 2026-09-29).
    return { text: this._fmt(out) + (to === 'k' ? ' K' : '°' + to.toUpperCase()), value: this._val(out) };
  },

  _currency(v, from, to) {
    if (!isFinite(v)) return null;
    const R = this._rates;
    if (!R) return { text: 'currency rates unavailable (offline)', value: '', unavailable: true };
    const rf = from === this._ratesBase ? 1 : R[from];
    const rt = to === this._ratesBase ? 1 : R[to];
    if (!rf || !rt) return null; // unknown currency code
    const out = (v / rf) * rt;
    return { text: this._fmt(out) + ' ' + to, value: this._val(out) };
  },
};

if (typeof window !== 'undefined') { window.VexCalc = VexCalc; }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCalc };
