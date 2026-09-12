// === Vex Toolbox pack: money, business, dates and health ===
// Loans, savings, pricing, business metrics, calendar maths and health
// estimates — plain arithmetic, no live data. Contract: js/toolbox-packs.js.
(function () {
  // ------------------------------------------------------------ numbers
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // Validate a number field; `what` reads like "the loan amount".
  function need(x, what, o = {}) {
    if (typeof x !== 'number' || Number.isNaN(x)) throw new Error(`Enter ${what}.`);
    if (!Number.isFinite(x)) throw new Error(`${cap(what)} is too large.`);
    if (o.int && !Number.isInteger(x)) throw new Error(`${cap(what)} must be a whole number.`);
    if (o.gt !== undefined && !(x > o.gt)) throw new Error(`${cap(what)} must be more than ${o.gt}.`);
    if (o.min !== undefined && x < o.min) throw new Error(`${cap(what)} can't be less than ${o.min}.`);
    if (o.max !== undefined && x > o.max) throw new Error(`${cap(what)} can't be more than ${o.max}.`);
    return x;
  }
  // An optional number field: null when left empty.
  const maybe = (x, what, o) => (Number.isNaN(x) ? null : need(x, what, o));

  // Round half away from zero, ignoring binary float noise (1.005 -> 1.01).
  function round(x, d = 0) {
    const m = 10 ** d;
    return Math.sign(x) * Math.round(Number((Math.abs(x) * m).toPrecision(15))) / m;
  }
  // Fixed decimals with thousands separators: 1234.5 -> "1,234.50".
  function fmt(x, d = 2) {
    if (!Number.isFinite(x)) throw new Error('The result is too large to show.');
    const r = round(x, d);
    if (Math.abs(r) >= 1e21) throw new Error('The result is too large to show.');
    const [i, f] = Math.abs(r).toFixed(d).split('.');
    return (r < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
  }
  const money = x => fmt(x, 2);
  const pct = (x, d = 2) => fmt(x, d) + '%';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // Whole units needed to cover x (13.000000000002 still means 13).
  const ceilUp = x => Math.ceil(x - 1e-9);
  const pad2 = n => String(n).padStart(2, '0');
  const lines = t => String(t).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  function toNumber(s) {
    const t = String(s).trim().replace(/^[−–]/, '-');
    return /^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : NaN;
  }
  function monthsText(n) {
    const y = Math.floor(n / 12), m = n % 12;
    if (!y) return plural(m, 'month');
    return m ? `${plural(y, 'year')}, ${plural(m, 'month')}` : plural(y, 'year');
  }
  function wholeMonths(years) {
    const n = Math.round(years * 12);
    if (Math.abs(n - years * 12) > 1e-9 || n < 1) throw new Error('The number of years must work out to a whole number of months (e.g. 2.5).');
    return n;
  }
  const payment = (P, i, n) => (i === 0 ? P / n : P * i / (1 - (1 + i) ** -n));
  function loanTerms(v) {
    const P = need(v.amount, 'the loan amount', { gt: 0 });
    const rate = need(v.rate, 'the interest rate', { min: 0, max: 100 });
    const years = need(v.years, 'the term', { gt: 0, max: 100 });
    return { P, i: rate / 1200, n: wholeMonths(years) };
  }
  // Numbers separated by new lines, commas, semicolons or spaces.
  function numberList(text, what) {
    const toks = String(text).split(/[\s,;]+/).filter(Boolean);
    if (!toks.length) throw new Error(`Enter ${what}.`);
    return toks.map(t => {
      const n = toNumber(t);
      if (Number.isNaN(n)) throw new Error(`"${t}" isn't a number.`);
      return n;
    });
  }

  const npvAt = (flows, r) => flows.reduce((s, cf, t) => s + cf / (1 + r) ** t, 0);
  // Rates from -99% to 10,000% to scan for NPV sign changes; each change is
  // then narrowed down by bisection. Finds every root not closer than 1% apart.
  const IRR_GRID = (() => {
    const g = [];
    for (let k = -99; k <= 100; k++) g.push(k / 100);
    for (let k = 11; k <= 100; k++) g.push(k / 10);
    return g.concat([20, 50, 100]);
  })();
  function irrRoots(flows) {
    const roots = [];
    for (let k = 0; k < IRR_GRID.length - 1; k++) {
      let lo = IRR_GRID[k], hi = IRR_GRID[k + 1];
      let flo = npvAt(flows, lo);
      const fhi = npvAt(flows, hi);
      if (flo === 0) { roots.push(lo); continue; }
      if (fhi === 0 || flo * fhi > 0) continue; // an exact zero at hi is found as the next lo
      for (let it = 0; it < 100; it++) {
        const mid = (lo + hi) / 2, fm = npvAt(flows, mid);
        if (fm === 0) { lo = hi = mid; break; }
        if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; }
      }
      roots.push((lo + hi) / 2);
    }
    if (npvAt(flows, IRR_GRID[IRR_GRID.length - 1]) === 0) roots.push(IRR_GRID[IRR_GRID.length - 1]);
    return roots;
  }

  // Complementary error function (Numerical Recipes erfcc, relative error
  // below 1.2e-7) — plenty for 4-decimal p-values.
  function erfc(x) {
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
      + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }

  // -------------------------------------------------------------- dates
  // Dates are whole days since 1970-01-01, built and read only through UTC
  // getters so no result depends on the machine's time zone.
  const DAY_MS = 86400000;
  const TODAY = new Date().toISOString().slice(0, 10); // field default only
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  function toDays(y, m, d) {
    const t = new Date(0);
    t.setUTCFullYear(y, m - 1, d); // unlike Date.UTC, keeps years 0-99 literal
    return Math.round(t.getTime() / DAY_MS);
  }
  function ymd(days) {
    const t = new Date(days * DAY_MS);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  function parseDate(s, what) {
    const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(s || '');
    if (!m) throw new Error(`Enter ${what} as YYYY-MM-DD.`);
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > dim(y, mo)) throw new Error(`${cap(what)} (${s.trim()}) isn't a real date.`);
    return toDays(y, mo, d);
  }
  function iso(days) {
    const { y, m, d } = ymd(days);
    return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
  }
  const weekday = days => ((days + 4) % 7 + 7) % 7; // 0 = Sunday; 1970-01-01 was a Thursday
  const isoWeekday = days => weekday(days) || 7;
  const isoDay = days => `${iso(days)} (${WEEKDAYS[weekday(days)]})`;
  function longDate(days) {
    const { y, m, d } = ymd(days);
    return `${WEEKDAYS[weekday(days)]}, ${d} ${MONTHS[m - 1]} ${y}`;
  }
  // Add calendar months; a day past the end of the new month becomes its last day.
  function addMonths(days, n) {
    const { y, m, d } = ymd(days);
    const t = y * 12 + (m - 1) + n;
    const ny = Math.floor(t / 12), nm = t - ny * 12 + 1;
    return toDays(ny, nm, Math.min(d, dim(ny, nm)));
  }
  // Whole years, months and days from a to b (a <= b). A month only counts
  // once its day number is reached, so 31 Jan -> 29 Feb is 29 days.
  function diffYMD(a, b) {
    const A = ymd(a), B = ymd(b);
    let months = (B.y - A.y) * 12 + (B.m - A.m);
    if (B.d < A.d) months--;
    const days = b - addMonths(a, months);
    return { years: Math.floor(months / 12), months: months % 12, days };
  }
  const ymdText = r => `${plural(r.years, 'year')}, ${plural(r.months, 'month')}, ${plural(r.days, 'day')}`;
  const weeksText = n => (n % 7 ? `${plural(Math.floor(n / 7), 'week')}, ${plural(n % 7, 'day')}` : plural(n / 7, 'week'));
  function isoWeek(days) {
    const thursday = days - isoWeekday(days) + 4;
    const year = ymd(thursday).y;
    return { year, week: Math.floor((thursday - toDays(year, 1, 1)) / 7) + 1 };
  }
  // A list of holiday dates (one per line or comma-separated) as a Set of days.
  function holidaySet(text) {
    const set = new Set();
    for (const tok of String(text).split(/[\s,;]+/).filter(Boolean)) set.add(parseDate(tok, `the holiday "${tok}"`));
    return set;
  }
  const isWeekend = days => weekday(days) === 0 || weekday(days) === 6;

  // -------------------------------------------------------------- times
  // "HH:MM" (24-hour) -> minutes after midnight.
  function parseClock(s, what) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(s || '');
    if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`Enter ${what} as HH:MM (24-hour).`);
    return +m[1] * 60 + +m[2];
  }
  const clock = min => `${pad2(Math.floor((((min % 1440) + 1440) % 1440) / 60))}:${pad2((((min % 1440) + 1440) % 1440) % 60)}`;
  // Minutes -> "h:mm" (can exceed 24 hours).
  function hm(min) {
    const a = Math.round(Math.abs(min));
    return `${min < 0 && a ? '-' : ''}${Math.floor(a / 60)}:${pad2(a % 60)}`;
  }
  // "+05:30", "-5", "UTC+9", "Z" -> minutes east of UTC.
  function parseOffset(s, what) {
    const t = String(s).trim().toUpperCase().replace(/^(UTC|GMT)\s*/, '').replace('−', '-');
    if (t === '' || t === 'Z') return 0;
    const m = /^([+-])?(\d{1,2})(?::?(\d{2}))?$/.exec(t);
    const min = m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : NaN;
    if (!m || +(m[3] || 0) > 59 || min < -720 || min > 840) throw new Error(`Enter ${what} like +05:30 or -08:00 (between -12:00 and +14:00).`);
    return min;
  }
  const offsetText = min => `${min < 0 ? '-' : '+'}${pad2(Math.floor(Math.abs(min) / 60))}:${pad2(Math.abs(min) % 60)}`;
  // "h:mm:ss" or "mm:ss" -> seconds.
  function parseRaceTime(s, what) {
    const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)\s*$/.exec(s || '');
    if (!m || +m[3] >= 60 || (m[1] !== undefined && +m[2] > 59)) throw new Error(`Enter ${what} as h:mm:ss or mm:ss.`);
    const sec = (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3];
    if (!(sec > 0)) throw new Error(`${cap(what)} must be more than zero.`);
    return sec;
  }
  function hms(sec) {
    const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
  }

  // ------------------------------------------------------------- health
  const LB = 0.45359237, INCH = 2.54;
  const UNITS = [['metric', 'Metric (kg, cm)'], ['imperial', 'Imperial (lb, inches)']];
  const kgOf = (w, units) => (units === 'imperial' ? w * LB : w);
  const cmOf = (h, units) => (units === 'imperial' ? h * INCH : h);
  const SEX = [['male', 'Male'], ['female', 'Female']];
  const MILE = 1.609344; // km
  const RACES = [['5', '5 km'], ['10', '10 km'], ['21.0975', 'Half marathon (21.1 km)'], ['42.195', 'Marathon (42.2 km)'], ['other', 'Other (km below)']];
  // Mifflin-St Jeor resting energy, kcal/day.
  function bmr(v) {
    const age = need(v.age, 'your age', { min: 1, max: 120 });
    const kg = kgOf(need(v.weight, 'your weight', { gt: 0, max: 1500 }), v.units);
    const cm = cmOf(need(v.height, 'your height', { gt: 0, max: 300 }), v.units);
    return 10 * kg + 6.25 * cm - 5 * age + (v.sex === 'female' ? -161 : 5);
  }
  function paceRows(secPerKm) {
    const kmh = 3600 / secPerKm;
    return [['Pace per km', hms(secPerKm)], ['Pace per mile', hms(secPerKm * MILE)], ['Speed', `${fmt(kmh)} km/h · ${fmt(kmh / MILE)} mph`]];
  }

  // ----------------------------------------------------------- everyday
  const GRADE_POINTS = { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0 };
  const VULGAR = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 };
  const Q = '(\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?(?:\\s*[½⅓⅔¼¾⅛⅜⅝⅞])?|[½⅓⅔¼¾⅛⅜⅝⅞])';
  // A leading quantity or range, then the rest of the ingredient line.
  const QTY_LINE = new RegExp(`^${Q}(?:\\s*[-–]\\s*${Q})?(.*)$`);
  function parseQty(s) {
    let m;
    if ((m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s))) return +m[1] + +m[2] / +m[3];
    if ((m = /^(\d+)\/(\d+)$/.exec(s))) return +m[1] / +m[2];
    if ((m = /^(\d+(?:\.\d+)?)?\s*([½⅓⅔¼¾⅛⅜⅝⅞])?$/.exec(s))) return (m[1] ? +m[1] : 0) + (m[2] ? VULGAR[m[2]] : 0);
    return NaN;
  }
  // Kitchen-friendly amount: whole numbers, halves, thirds, quarters and
  // eighths as fractions; anything else to 2 decimals.
  function fmtQty(x) {
    const whole = Math.floor(x + 1e-9), frac = x - whole;
    if (frac < 0.01) return String(whole);
    if (frac > 0.99) return String(whole + 1);
    for (const den of [2, 3, 4, 8]) {
      const n = Math.round(frac * den);
      if (n > 0 && n < den && Math.abs(n / den - frac) < 0.01) return `${whole ? whole + ' ' : ''}${n}/${den}`;
    }
    return String(round(x, 2));
  }

  // ============================================================== PACK
  const PACK = [
    // ------------------------------------------------------------ Money
    {
      id: 'fin-loan', name: 'Loan & mortgage payment', family: 'finance',
      desc: 'Monthly payment, total paid and total interest for a fixed-rate loan.',
      keywords: 'mortgage amortized installment emi car loan repayment',
      fields: [
        { id: 'amount', label: 'Loan amount', type: 'number', value: 200000, min: 0 },
        { id: 'rate', label: 'Interest rate (% per year)', type: 'number', value: 6, min: 0, step: 0.01 },
        { id: 'years', label: 'Term (years)', type: 'number', value: 30, min: 0 },
      ],
      run(v) {
        const { P, i, n } = loanTerms(v);
        const pmt = payment(P, i, n);
        return [['Monthly payment', money(pmt)], ['Number of payments', String(n)], ['Total paid', money(pmt * n)], ['Total interest', money(pmt * n - P)]];
      },
      examples: [
        { in: { amount: 200000, rate: 6, years: 30 }, out: [['Monthly payment', '1,199.10'], ['Number of payments', '360'], ['Total paid', '431,676.38'], ['Total interest', '231,676.38']] },
        { in: { amount: 100000, rate: 5, years: 15 }, out: [['Monthly payment', '790.79'], ['Number of payments', '180'], ['Total paid', '142,342.85'], ['Total interest', '42,342.85']] },
        { in: { amount: 10000, rate: 0, years: 1 }, out: [['Monthly payment', '833.33'], ['Number of payments', '12'], ['Total paid', '10,000.00'], ['Total interest', '0.00']] },
      ],
    },
    {
      id: 'fin-amortization', name: 'Amortization schedule', family: 'finance',
      desc: 'The first months of a loan: how each payment splits into interest and principal.',
      keywords: 'mortgage loan schedule table principal interest balance',
      fields: [
        { id: 'amount', label: 'Loan amount', type: 'number', value: 200000, min: 0 },
        { id: 'rate', label: 'Interest rate (% per year)', type: 'number', value: 6, min: 0, step: 0.01 },
        { id: 'years', label: 'Term (years)', type: 'number', value: 30, min: 0 },
        { id: 'rows', label: 'Months to show', type: 'number', value: 12, min: 1, max: 600 },
      ],
      run(v) {
        const { P, i, n } = loanTerms(v);
        const rows = Math.min(need(v.rows, 'the number of months to show', { min: 1, int: true }), n);
        const pmt = payment(P, i, n);
        const out = [];
        let bal = P, paidInt = 0;
        for (let k = 1; k <= rows; k++) {
          const int = bal * i, prin = k === n ? bal : pmt - int;
          bal -= prin; paidInt += int;
          out.push([`Month ${k}`, `payment ${money(int + prin)} · interest ${money(int)} · principal ${money(prin)} · balance ${money(Math.max(bal, 0))}`]);
        }
        out.push([`After ${plural(rows, 'month')}`, `interest paid ${money(paidInt)} · principal paid ${money(P - bal)}`]);
        return out;
      },
      examples: [
        { in: { amount: 200000, rate: 6, years: 30, rows: 2 }, out: [
          ['Month 1', 'payment 1,199.10 · interest 1,000.00 · principal 199.10 · balance 199,800.90'],
          ['Month 2', 'payment 1,199.10 · interest 999.00 · principal 200.10 · balance 199,600.80'],
          ['After 2 months', 'interest paid 1,999.00 · principal paid 399.20'],
        ] },
        { in: { amount: 1200, rate: 0, years: 1, rows: 99 }, match: /Month 12: payment 100\.00 · interest 0\.00 · principal 100\.00 · balance 0\.00\nAfter 12 months: interest paid 0\.00 · principal paid 1,200\.00$/ },
      ],
    },
    {
      id: 'fin-compound', name: 'Compound interest', family: 'finance',
      desc: 'Grow a starting amount with compound interest and optional monthly deposits (made at the end of each month).',
      keywords: 'savings investment growth future value deposits contributions',
      fields: [
        { id: 'principal', label: 'Starting amount', type: 'number', value: 10000, min: 0 },
        { id: 'rate', label: 'Interest rate (% per year)', type: 'number', value: 5, min: 0, step: 0.01 },
        { id: 'years', label: 'Years', type: 'number', value: 10, min: 0 },
        { id: 'freq', label: 'Compounding', type: 'select', value: '12', options: [['1', 'Yearly'], ['4', 'Quarterly'], ['12', 'Monthly'], ['365', 'Daily']] },
        { id: 'monthly', label: 'Monthly deposit', type: 'number', value: 0, min: 0 },
      ],
      run(v) {
        const P = need(v.principal, 'the starting amount', { min: 0 });
        const r = need(v.rate, 'the interest rate', { min: 0, max: 100 }) / 100;
        const years = need(v.years, 'the number of years', { gt: 0, max: 200 });
        const C = need(v.monthly, 'the monthly deposit (0 for none)', { min: 0 });
        const k = Number(v.freq), months = wholeMonths(years);
        const i = (1 + r / k) ** (k / 12) - 1; // monthly rate equivalent to this compounding
        const fv = P * (1 + r / k) ** (k * years) + (i === 0 ? C * months : C * ((1 + i) ** months - 1) / i);
        const deposited = P + C * months;
        return [['Future value', money(fv)], ['Total deposited', money(deposited)], ['Interest earned', money(fv - deposited)]];
      },
      examples: [
        { in: { principal: 10000, rate: 5, years: 10, freq: '1', monthly: 0 }, out: [['Future value', '16,288.95'], ['Total deposited', '10,000.00'], ['Interest earned', '6,288.95']] },
        { in: { principal: 1000, rate: 5, years: 10, freq: '12', monthly: 0 }, out: [['Future value', '1,647.01'], ['Total deposited', '1,000.00'], ['Interest earned', '647.01']] },
        { in: { principal: 0, rate: 6, years: 10, freq: '12', monthly: 100 }, out: [['Future value', '16,387.93'], ['Total deposited', '12,000.00'], ['Interest earned', '4,387.93']] },
      ],
    },
    {
      id: 'fin-simple-interest', name: 'Simple interest', family: 'finance',
      desc: 'Interest that is not compounded: principal × rate × time.',
      keywords: 'flat interest',
      fields: [
        { id: 'principal', label: 'Principal', type: 'number', value: 1000, min: 0 },
        { id: 'rate', label: 'Interest rate (% per year)', type: 'number', value: 5, min: 0, step: 0.01 },
        { id: 'years', label: 'Years', type: 'number', value: 3, min: 0 },
      ],
      run(v) {
        const P = need(v.principal, 'the principal', { min: 0 });
        const r = need(v.rate, 'the interest rate', { min: 0 });
        const t = need(v.years, 'the number of years', { min: 0 });
        const interest = P * r / 100 * t;
        return [['Interest', money(interest)], ['Total', money(P + interest)]];
      },
      examples: [{ in: { principal: 1000, rate: 5, years: 3 }, out: [['Interest', '150.00'], ['Total', '1,150.00']] }],
    },
    {
      id: 'fin-savings-goal', name: 'Savings goal', family: 'finance',
      desc: 'How much to save each month to reach a goal by a deadline, with interest compounded monthly.',
      keywords: 'save target monthly deposit needed',
      fields: [
        { id: 'goal', label: 'Goal amount', type: 'number', value: 20000, min: 0 },
        { id: 'current', label: 'Already saved', type: 'number', value: 5000, min: 0 },
        { id: 'rate', label: 'Interest rate (% per year)', type: 'number', value: 4, min: 0, step: 0.01 },
        { id: 'years', label: 'Years to reach it', type: 'number', value: 3, min: 0 },
      ],
      run(v) {
        const goal = need(v.goal, 'the goal amount', { gt: 0 });
        const S = need(v.current, 'the amount already saved (0 for none)', { min: 0 });
        const i = need(v.rate, 'the interest rate', { min: 0, max: 100 }) / 1200;
        const n = wholeMonths(need(v.years, 'the number of years', { gt: 0, max: 100 }));
        const grown = S * (1 + i) ** n;
        if (grown >= goal) return `What you have already grows to ${money(grown)} in ${monthsText(n)} — no more deposits needed.`;
        const pmt = i === 0 ? (goal - grown) / n : (goal - grown) * i / ((1 + i) ** n - 1);
        return [['Monthly deposit needed', money(pmt)], ['Months', String(n)], ['Your savings grow to', money(grown)], ['Total you deposit', money(pmt * n)], ['Interest earned', money(goal - S - pmt * n)]];
      },
      examples: [
        { in: { goal: 10000, current: 0, rate: 0, years: 2 }, out: [['Monthly deposit needed', '416.67'], ['Months', '24'], ['Your savings grow to', '0.00'], ['Total you deposit', '10,000.00'], ['Interest earned', '0.00']] },
        { in: { goal: 20000, current: 5000, rate: 4, years: 3 }, out: [['Monthly deposit needed', '376.19'], ['Months', '36'], ['Your savings grow to', '5,636.36'], ['Total you deposit', '13,542.95'], ['Interest earned', '1,457.05']] },
        { in: { goal: 1000, current: 1000, rate: 2, years: 1 }, out: 'What you have already grows to 1,020.18 in 1 year — no more deposits needed.' },
      ],
    },
    {
      id: 'fin-retirement', name: 'Retirement savings', family: 'finance',
      desc: 'Project a retirement balance from monthly contributions, and the income it supports under the 4% rule. Not adjusted for inflation.',
      keywords: 'pension 401k ira annuity future value nest egg 4% rule',
      fields: [
        { id: 'age', label: 'Current age', type: 'number', value: 30, min: 0 },
        { id: 'retire', label: 'Retirement age', type: 'number', value: 65, min: 0 },
        { id: 'saved', label: 'Saved so far', type: 'number', value: 10000, min: 0 },
        { id: 'monthly', label: 'Monthly contribution', type: 'number', value: 500, min: 0 },
        { id: 'rate', label: 'Expected return (% per year)', type: 'number', value: 6, step: 0.1 },
        { id: 'withdraw', label: 'Withdrawal rate (% per year)', type: 'number', value: 4, min: 0, step: 0.1 },
      ],
      run(v) {
        const age = need(v.age, 'your current age', { min: 0, max: 120 });
        const retire = need(v.retire, 'the retirement age', { max: 120 });
        if (!(retire > age)) throw new Error('The retirement age must be after your current age.');
        const S = need(v.saved, 'the amount saved so far (0 for none)', { min: 0 });
        const C = need(v.monthly, 'the monthly contribution (0 for none)', { min: 0 });
        const i = need(v.rate, 'the expected return', { min: -50, max: 100 }) / 1200;
        const w = need(v.withdraw, 'the withdrawal rate', { min: 0, max: 100 }) / 100;
        const n = wholeMonths(retire - age);
        const g = (1 + i) ** n;
        const bal = S * g + (i === 0 ? C * n : C * (g - 1) / i);
        const paidIn = S + C * n;
        return [['Years to grow', fmt(n / 12, n % 12 ? 1 : 0)], ['Balance at retirement', money(bal)], ['Total you put in', money(paidIn)], ['Investment growth', money(bal - paidIn)],
          [`Yearly income at ${fmt(w * 100, 1)}%`, money(bal * w)], ['Monthly income', money(bal * w / 12)]];
      },
      examples: [
        { in: { age: 30, retire: 65, saved: 10000, monthly: 500, rate: 6, withdraw: 4 }, out: [['Years to grow', '35'], ['Balance at retirement', '793,590.66'], ['Total you put in', '220,000.00'], ['Investment growth', '573,590.66'], ['Yearly income at 4.0%', '31,743.63'], ['Monthly income', '2,645.30']] },
        { in: { age: 60, retire: 65, saved: 0, monthly: 1000, rate: 0, withdraw: 4 }, out: [['Years to grow', '5'], ['Balance at retirement', '60,000.00'], ['Total you put in', '60,000.00'], ['Investment growth', '0.00'], ['Yearly income at 4.0%', '2,400.00'], ['Monthly income', '200.00']] },
      ],
    },
    {
      id: 'fin-present-value', name: 'Present value', family: 'finance',
      desc: 'What a future amount is worth today at a given discount rate.',
      keywords: 'pv discount time value of money',
      fields: [
        { id: 'future', label: 'Future amount', type: 'number', value: 10000 },
        { id: 'rate', label: 'Discount rate (% per year)', type: 'number', value: 5, step: 0.01 },
        { id: 'years', label: 'Years from now', type: 'number', value: 10, min: 0 },
        { id: 'freq', label: 'Compounding', type: 'select', value: '1', options: [['1', 'Yearly'], ['4', 'Quarterly'], ['12', 'Monthly'], ['365', 'Daily']] },
      ],
      run(v) {
        const F = need(v.future, 'the future amount');
        const r = need(v.rate, 'the discount rate', { gt: -100, max: 1000 }) / 100;
        const t = need(v.years, 'the number of years', { min: 0, max: 500 });
        const k = Number(v.freq);
        const pv = F / (1 + r / k) ** (k * t);
        return [['Present value', money(pv)], ['Discount', money(F - pv)]];
      },
      examples: [
        { in: { future: 10000, rate: 5, years: 10, freq: '1' }, out: [['Present value', '6,139.13'], ['Discount', '3,860.87']] },
        { in: { future: 1000, rate: 0, years: 3, freq: '12' }, out: [['Present value', '1,000.00'], ['Discount', '0.00']] },
      ],
    },
    {
      id: 'fin-npv', name: 'Net present value (NPV)', family: 'finance',
      desc: 'NPV of a series of cash flows. The first flow is today (usually the negative investment); each next one is one period later.',
      keywords: 'npv discounted cash flow dcf investment appraisal',
      fields: [
        { id: 'rate', label: 'Discount rate (% per period)', type: 'number', value: 10, step: 0.01 },
        { id: 'flows', label: 'Cash flows (one per line, or comma-separated)', type: 'textarea', value: '-1000\n300\n400\n500' },
      ],
      run(v) {
        const r = need(v.rate, 'the discount rate', { gt: -100 }) / 100;
        const flows = numberList(v.flows, 'the cash flows');
        const pvs = flows.map((cf, t) => cf / (1 + r) ** t);
        const npv = pvs.reduce((a, b) => a + b, 0);
        return [['Net present value', money(npv)], ['Present value of later flows', money(npv - pvs[0])], ['Periods', String(flows.length - 1)]];
      },
      examples: [
        { in: { rate: 10, flows: '-1000\n300\n400\n500' }, out: [['Net present value', '-21.04'], ['Present value of later flows', '978.96'], ['Periods', '3']] },
        { in: { rate: 0, flows: '-100, 60, 60' }, out: [['Net present value', '20.00'], ['Present value of later flows', '120.00'], ['Periods', '2']] },
      ],
    },
    {
      id: 'fin-irr', name: 'Internal rate of return (IRR)', family: 'finance',
      desc: 'The rate per period that makes the NPV of your cash flows zero. First flow is today.',
      keywords: 'irr yield return investment cash flows',
      fields: [{ id: 'flows', label: 'Cash flows (one per line, or comma-separated)', type: 'textarea', value: '-1000\n300\n400\n500' }],
      run(v) {
        const flows = numberList(v.flows, 'the cash flows');
        if (!flows.some(x => x < 0) || !flows.some(x => x > 0)) throw new Error('IRR needs at least one negative (money out) and one positive (money in) cash flow.');
        const roots = irrRoots(flows);
        if (!roots.length) throw new Error('No rate between -99% and 10,000% makes the NPV zero for these cash flows.');
        roots.sort((a, b) => Math.abs(a) - Math.abs(b));
        const out = [['IRR', pct(roots[0] * 100)]];
        if (roots.length > 1) {
          out.push(['Other rates with NPV = 0', roots.slice(1).sort((a, b) => a - b).map(r => pct(r * 100)).join(', ')]);
          out.push(['Note', 'The cash flows change sign more than once, so more than one rate makes the NPV zero.']);
        }
        return out;
      },
      examples: [
        { in: { flows: '-100\n110' }, out: [['IRR', '10.00%']] },
        { in: { flows: '-1000\n300\n400\n500' }, out: [['IRR', '8.90%']] },
        { in: { flows: '-100, 230, -132' }, out: [['IRR', '10.00%'], ['Other rates with NPV = 0', '20.00%'], ['Note', 'The cash flows change sign more than once, so more than one rate makes the NPV zero.']] },
      ],
    },
    {
      id: 'fin-roi', name: 'Return on investment (ROI)', family: 'finance',
      desc: 'Gain, ROI and (given the years held) the annualized return.',
      keywords: 'roi return profit gain annualized',
      fields: [
        { id: 'cost', label: 'Amount invested', type: 'number', value: 1000, min: 0 },
        { id: 'value', label: 'Amount returned (final value)', type: 'number', value: 1500, min: 0 },
        { id: 'years', label: 'Years held (optional)', type: 'number', value: 2, min: 0 },
      ],
      run(v) {
        const cost = need(v.cost, 'the amount invested', { gt: 0 });
        const val = need(v.value, 'the amount returned', { min: 0 });
        const years = maybe(v.years, 'the years held', { gt: 0 });
        const out = [['Gain', money(val - cost)], ['ROI', pct((val - cost) / cost * 100)]];
        if (years !== null) out.push(['Annualized return', pct(((val / cost) ** (1 / years) - 1) * 100)]);
        return out;
      },
      examples: [
        { in: { cost: 1000, value: 1500, years: 2 }, out: [['Gain', '500.00'], ['ROI', '50.00%'], ['Annualized return', '22.47%']] },
        { in: { cost: 2000, value: 1500, years: '' }, out: [['Gain', '-500.00'], ['ROI', '-25.00%']] },
      ],
    },
    {
      id: 'fin-cagr', name: 'CAGR (compound annual growth)', family: 'finance',
      desc: 'The steady yearly growth rate that takes a start value to an end value.',
      keywords: 'cagr growth rate annual compound',
      fields: [
        { id: 'start', label: 'Start value', type: 'number', value: 100 },
        { id: 'end', label: 'End value', type: 'number', value: 200 },
        { id: 'years', label: 'Years', type: 'number', value: 5, min: 0 },
      ],
      run(v) {
        const a = need(v.start, 'the start value', { gt: 0 });
        const b = need(v.end, 'the end value', { min: 0 });
        const t = need(v.years, 'the number of years', { gt: 0 });
        return [['CAGR', pct(((b / a) ** (1 / t) - 1) * 100)], ['Total growth', pct((b / a - 1) * 100)]];
      },
      examples: [{ in: { start: 100, end: 200, years: 5 }, out: [['CAGR', '14.87%'], ['Total growth', '100.00%']] }],
    },
    {
      id: 'fin-inflation', name: 'Inflation adjuster', family: 'finance',
      desc: 'What something costs after years of inflation at a rate you choose, and how much buying power money loses. No live data.',
      keywords: 'inflation purchasing power real value cpi',
      fields: [
        { id: 'amount', label: 'Amount today', type: 'number', value: 100, min: 0 },
        { id: 'rate', label: 'Inflation (% per year)', type: 'number', value: 3, step: 0.1 },
        { id: 'years', label: 'Years', type: 'number', value: 10, min: 0 },
      ],
      run(v) {
        const A = need(v.amount, 'the amount', { min: 0 });
        const r = need(v.rate, 'the inflation rate', { gt: -100, max: 1000 }) / 100;
        const t = need(v.years, 'the number of years', { min: 0, max: 500 });
        const f = (1 + r) ** t;
        return [[`Same things cost after ${fmt(t, t % 1 ? 1 : 0)} years`, money(A * f)], [`Buying power of ${money(A)} then`, money(A / f)], ['Cumulative inflation', pct((f - 1) * 100)]];
      },
      examples: [{ in: { amount: 100, rate: 3, years: 10 }, out: [['Same things cost after 10 years', '134.39'], ['Buying power of 100.00 then', '74.41'], ['Cumulative inflation', '34.39%']] }],
    },
    {
      id: 'fin-tip', name: 'Tip & bill split', family: 'finance',
      desc: 'Tip, total and each person\'s share — optionally rounded up to a whole amount per person.',
      keywords: 'gratuity restaurant split bill share',
      fields: [
        { id: 'bill', label: 'Bill', type: 'number', value: 85.5, min: 0 },
        { id: 'tip', label: 'Tip (%)', type: 'number', value: 18, min: 0 },
        { id: 'people', label: 'People', type: 'number', value: 3, min: 1 },
        { id: 'roundUp', label: 'Round each share up to a whole amount', type: 'checkbox' },
      ],
      run(v) {
        const bill = need(v.bill, 'the bill', { min: 0 });
        const tipPct = need(v.tip, 'the tip percentage', { min: 0, max: 100 });
        const people = need(v.people, 'the number of people', { min: 1, int: true });
        let each = bill * (1 + tipPct / 100) / people;
        if (v.roundUp) each = ceilUp(each);
        const total = each * people;
        const out = [['Tip', money(total - bill)], ['Total', money(total)], ['Each person pays', money(each)]];
        if (v.roundUp && bill > 0) out.push(['Effective tip', pct((total - bill) / bill * 100)]);
        return out;
      },
      examples: [
        { in: { bill: 85.5, tip: 18, people: 3 }, out: [['Tip', '15.39'], ['Total', '100.89'], ['Each person pays', '33.63']] },
        { in: { bill: 85.5, tip: 18, people: 3, roundUp: true }, out: [['Tip', '16.50'], ['Total', '102.00'], ['Each person pays', '34.00'], ['Effective tip', '19.30%']] },
      ],
    },
    {
      id: 'fin-sales-tax', name: 'Sales tax / VAT', family: 'finance',
      desc: 'Add tax to a net price, or take it out of a price that already includes it.',
      keywords: 'vat gst tax inclusive exclusive net gross',
      fields: [
        { id: 'amount', label: 'Amount', type: 'number', value: 100, min: 0 },
        { id: 'rate', label: 'Tax rate (%)', type: 'number', value: 20, min: 0, step: 0.01 },
        { id: 'mode', label: 'The amount is', type: 'select', value: 'add', options: [['add', 'Before tax (add tax)'], ['remove', 'Tax included (remove tax)']] },
      ],
      run(v) {
        const A = need(v.amount, 'the amount', { min: 0 });
        const r = need(v.rate, 'the tax rate', { min: 0, max: 1000 }) / 100;
        const net = v.mode === 'remove' ? A / (1 + r) : A;
        return [['Before tax', money(net)], ['Tax', money(net * r)], ['Total with tax', money(net * (1 + r))]];
      },
      examples: [
        { in: { amount: 100, rate: 20, mode: 'add' }, out: [['Before tax', '100.00'], ['Tax', '20.00'], ['Total with tax', '120.00']] },
        { in: { amount: 120, rate: 20, mode: 'remove' }, out: [['Before tax', '100.00'], ['Tax', '20.00'], ['Total with tax', '120.00']] },
        { in: { amount: 50, rate: 8.25, mode: 'add' }, out: [['Before tax', '50.00'], ['Tax', '4.13'], ['Total with tax', '54.13']] },
      ],
    },
    {
      id: 'fin-discount', name: 'Discount & sale price', family: 'finance',
      desc: 'Sale price after a discount, with an optional second discount taken off the reduced price.',
      keywords: 'sale percent off coupon stacked',
      fields: [
        { id: 'price', label: 'Original price', type: 'number', value: 80, min: 0 },
        { id: 'off', label: 'Discount (%)', type: 'number', value: 25, min: 0, max: 100 },
        { id: 'extra', label: 'Extra discount (%, optional)', type: 'number', value: '', min: 0, max: 100 },
      ],
      run(v) {
        const p = need(v.price, 'the original price', { min: 0 });
        const d1 = need(v.off, 'the discount', { min: 0, max: 100 });
        const d2 = maybe(v.extra, 'the extra discount', { min: 0, max: 100 }) || 0;
        const sale = p * (1 - d1 / 100) * (1 - d2 / 100);
        const out = [['Sale price', money(sale)], ['You save', money(p - sale)]];
        if (d2 && p > 0) out.push(['Total discount', pct((p - sale) / p * 100)]);
        return out;
      },
      examples: [
        { in: { price: 80, off: 25, extra: '' }, out: [['Sale price', '60.00'], ['You save', '20.00']] },
        { in: { price: 80, off: 25, extra: 10 }, out: [['Sale price', '54.00'], ['You save', '26.00'], ['Total discount', '32.50%']] },
      ],
    },
    {
      id: 'fin-markup-margin', name: 'Markup vs margin', family: 'finance',
      desc: 'Profit, markup (profit ÷ cost) and margin (profit ÷ price) from a cost and a price, markup or margin.',
      keywords: 'markup margin gross profit pricing cost price',
      fields: [
        { id: 'cost', label: 'Cost', type: 'number', value: 60, min: 0 },
        { id: 'mode', label: 'I know the', type: 'select', value: 'price', options: [['price', 'Selling price'], ['markup', 'Markup %'], ['margin', 'Margin %']] },
        { id: 'value', label: 'Price, markup % or margin %', type: 'number', value: 100 },
      ],
      run(v) {
        const cost = need(v.cost, 'the cost', { gt: 0 });
        let price;
        if (v.mode === 'markup') price = cost * (1 + need(v.value, 'the markup', { gt: -100 }) / 100);
        else if (v.mode === 'margin') {
          const m = need(v.value, 'the margin');
          if (m >= 100) throw new Error('A margin must be below 100% — at 100% the cost would be zero.');
          price = cost / (1 - m / 100);
        } else price = need(v.value, 'the selling price', { gt: 0 });
        const profit = price - cost;
        return [['Selling price', money(price)], ['Profit', money(profit)], ['Markup', pct(profit / cost * 100)], ['Margin', pct(profit / price * 100)]];
      },
      examples: [
        { in: { cost: 60, mode: 'price', value: 100 }, out: [['Selling price', '100.00'], ['Profit', '40.00'], ['Markup', '66.67%'], ['Margin', '40.00%']] },
        { in: { cost: 60, mode: 'margin', value: 40 }, out: [['Selling price', '100.00'], ['Profit', '40.00'], ['Markup', '66.67%'], ['Margin', '40.00%']] },
        { in: { cost: 60, mode: 'markup', value: 50 }, out: [['Selling price', '90.00'], ['Profit', '30.00'], ['Markup', '50.00%'], ['Margin', '33.33%']] },
      ],
    },
    {
      id: 'fin-break-even', name: 'Break-even point', family: 'finance',
      desc: 'How many units you must sell to cover fixed costs.',
      keywords: 'breakeven contribution margin units fixed variable cost',
      fields: [
        { id: 'fixed', label: 'Fixed costs', type: 'number', value: 10000, min: 0 },
        { id: 'price', label: 'Price per unit', type: 'number', value: 50, min: 0 },
        { id: 'variable', label: 'Variable cost per unit', type: 'number', value: 30, min: 0 },
      ],
      run(v) {
        const F = need(v.fixed, 'the fixed costs', { min: 0 });
        const p = need(v.price, 'the price per unit', { gt: 0 });
        const c = need(v.variable, 'the variable cost per unit', { min: 0 });
        if (p <= c) throw new Error('The price must be higher than the variable cost, or no amount of sales breaks even.');
        const units = F / (p - c), whole = ceilUp(units);
        return [['Contribution per unit', money(p - c)], ['Units to break even', Math.abs(units - whole) < 1e-9 ? fmt(whole, 0) : `${fmt(whole, 0)} (exactly ${fmt(units, 2)})`], ['Break-even revenue', money(units * p)]];
      },
      examples: [
        { in: { fixed: 10000, price: 50, variable: 30 }, out: [['Contribution per unit', '20.00'], ['Units to break even', '500'], ['Break-even revenue', '25,000.00']] },
        { in: { fixed: 1000, price: 7, variable: 4 }, out: [['Contribution per unit', '3.00'], ['Units to break even', '334 (exactly 333.33)'], ['Break-even revenue', '2,333.33']] },
      ],
    },
    {
      id: 'fin-card-payoff', name: 'Credit card payoff', family: 'finance',
      desc: 'How long a fixed monthly payment takes to clear a card balance, and the interest paid on the way.',
      keywords: 'credit card debt payoff apr months interest',
      fields: [
        { id: 'balance', label: 'Balance', type: 'number', value: 5000, min: 0 },
        { id: 'apr', label: 'APR (%)', type: 'number', value: 18, min: 0, step: 0.01 },
        { id: 'payment', label: 'Monthly payment', type: 'number', value: 200, min: 0 },
      ],
      run(v) {
        let bal = need(v.balance, 'the balance', { gt: 0 });
        const i = need(v.apr, 'the APR', { min: 0, max: 1000 }) / 1200;
        const pay = need(v.payment, 'the monthly payment', { gt: 0 });
        if (pay <= bal * i) throw new Error(`The payment doesn't cover the first month's interest (${money(bal * i)}), so the balance never goes down.`);
        let months = 0, interest = 0;
        const start = bal;
        while (bal > 1e-9) {
          const int = bal * i;
          interest += int; bal += int - Math.min(pay, bal + int); months++;
        }
        return [['Months to pay off', `${months} (${monthsText(months)})`], ['Total interest', money(interest)], ['Total paid', money(start + interest)]];
      },
      examples: [
        { in: { balance: 5000, apr: 18, payment: 200 }, out: [['Months to pay off', '32 (2 years, 8 months)'], ['Total interest', '1,313.96'], ['Total paid', '6,313.96']] },
        { in: { balance: 1000, apr: 0, payment: 300 }, out: [['Months to pay off', '4 (4 months)'], ['Total interest', '0.00'], ['Total paid', '1,000.00']] },
      ],
    },
    {
      id: 'fin-debt-payoff', name: 'Debt snowball / avalanche', family: 'finance',
      desc: 'Order to pay off several debts and when each is cleared. Snowball: smallest balance first; avalanche: highest APR first. Freed-up payments roll into the next debt.',
      keywords: 'debt snowball avalanche payoff plan order loans cards',
      fields: [
        { id: 'debts', label: 'Debts — one per line: name, balance, APR %, minimum payment', type: 'textarea', value: 'Card, 2000, 20, 50\nCar loan, 1000, 5, 50' },
        { id: 'extra', label: 'Extra per month on top of the minimums', type: 'number', value: 100, min: 0 },
        { id: 'method', label: 'Method', type: 'select', value: 'snowball', options: [['snowball', 'Snowball (smallest balance first)'], ['avalanche', 'Avalanche (highest APR first)']] },
      ],
      run(v) {
        const extra = need(v.extra, 'the extra monthly payment (0 for none)', { min: 0 });
        const debts = lines(v.debts).map((line, k) => {
          const parts = line.split(/\s*[,;\t]\s*/);
          if (parts.length !== 4) throw new Error(`Line ${k + 1}: write it as "name, balance, APR %, minimum payment" (no thousands separators).`);
          const bal = toNumber(parts[1]), apr = toNumber(parts[2]), min = toNumber(parts[3]);
          if (!(bal > 0) || !(apr >= 0) || !(min > 0)) throw new Error(`Line ${k + 1}: the balance and minimum must be above 0 and the APR 0 or more.`);
          return { name: parts[0] || `Debt ${k + 1}`, bal, apr, min, idx: k, paidMonth: 0 };
        });
        if (!debts.length) throw new Error('Enter at least one debt.');
        const order = debts.slice().sort(v.method === 'avalanche'
          ? (x, y) => y.apr - x.apr || x.bal - y.bal || x.idx - y.idx
          : (x, y) => x.bal - y.bal || y.apr - x.apr || x.idx - y.idx);
        const budget = extra + debts.reduce((s, d) => s + d.min, 0);
        const owed = debts.reduce((s, d) => s + d.bal, 0);
        let month = 0, interest = 0;
        while (debts.some(d => d.bal > 1e-9)) {
          if (++month > 1200) throw new Error('At these payments the debts are never paid off — the interest grows faster than you pay.');
          let pool = budget;
          for (const d of debts) if (d.bal > 1e-9) { const int = d.bal * d.apr / 1200; d.bal += int; interest += int; }
          for (const d of debts) if (d.bal > 1e-9) { const p = Math.min(d.min, d.bal, pool); d.bal -= p; pool -= p; }
          for (const d of order) if (d.bal > 1e-9 && pool > 0) { const p = Math.min(d.bal, pool); d.bal -= p; pool -= p; }
          for (const d of debts) if (!d.paidMonth && d.bal <= 1e-9) d.paidMonth = month;
        }
        const done = order.slice().sort((x, y) => x.paidMonth - y.paidMonth);
        return [...done.map((d, k) => [`${k + 1}. ${d.name}`, `paid off in month ${d.paidMonth}`]),
          ['Debt-free after', monthsText(month)], ['Total interest', money(interest)], ['Total paid', money(owed + interest)]];
      },
      examples: [
        { in: { debts: 'Card A, 1000, 0, 100\nCard B, 500, 0, 50', extra: 50, method: 'snowball' }, out: [['1. Card B', 'paid off in month 5'], ['2. Card A', 'paid off in month 8'], ['Debt-free after', '8 months'], ['Total interest', '0.00'], ['Total paid', '1,500.00']] },
        { in: { debts: 'Card, 2000, 20, 50\nCar loan, 1000, 5, 50', extra: 100, method: 'avalanche' }, out: [['1. Card', 'paid off in month 16'], ['2. Car loan', 'paid off in month 17'], ['Debt-free after', '1 year, 5 months'], ['Total interest', '324.64'], ['Total paid', '3,324.64']] },
      ],
    },
    {
      id: 'fin-salary', name: 'Salary ⇄ hourly', family: 'finance',
      desc: 'Convert pay between hourly, weekly, monthly and yearly for your hours and weeks worked.',
      keywords: 'salary wage hourly annual income pay conversion',
      fields: [
        { id: 'amount', label: 'Pay', type: 'number', value: 50000, min: 0 },
        { id: 'per', label: 'Per', type: 'select', value: 'year', options: [['hour', 'Hour'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']] },
        { id: 'hours', label: 'Hours per week', type: 'number', value: 40, min: 0 },
        { id: 'weeks', label: 'Weeks worked per year', type: 'number', value: 52, min: 0, max: 52.143 },
      ],
      run(v) {
        const A = need(v.amount, 'the pay', { min: 0 });
        const h = need(v.hours, 'the hours per week', { gt: 0, max: 168 });
        const w = need(v.weeks, 'the weeks per year', { gt: 0, max: 53 });
        const yearly = { hour: A * h * w, week: A * w, month: A * 12, year: A }[v.per];
        return [['Hourly', money(yearly / w / h)], ['Weekly', money(yearly / w)], ['Monthly', money(yearly / 12)], ['Yearly', money(yearly)]];
      },
      examples: [
        { in: { amount: 50000, per: 'year', hours: 40, weeks: 52 }, out: [['Hourly', '24.04'], ['Weekly', '961.54'], ['Monthly', '4,166.67'], ['Yearly', '50,000.00']] },
        { in: { amount: 25, per: 'hour', hours: 40, weeks: 52 }, out: [['Hourly', '25.00'], ['Weekly', '1,000.00'], ['Monthly', '4,333.33'], ['Yearly', '52,000.00']] },
      ],
    },
    {
      id: 'fin-pay-rise', name: 'Pay rise', family: 'finance',
      desc: 'The percentage of a raise between two salaries, or the new salary after a percentage raise.',
      keywords: 'raise salary increase percent',
      fields: [
        { id: 'current', label: 'Current pay', type: 'number', value: 50000, min: 0 },
        { id: 'mode', label: 'I know the', type: 'select', value: 'new', options: [['new', 'New pay'], ['pct', 'Raise %']] },
        { id: 'value', label: 'New pay or raise %', type: 'number', value: 53000 },
      ],
      run(v) {
        const cur = need(v.current, 'the current pay', { gt: 0 });
        const next = v.mode === 'pct' ? cur * (1 + need(v.value, 'the raise percentage', { min: -100 }) / 100) : need(v.value, 'the new pay', { min: 0 });
        return [['New pay', money(next)], ['Change', money(next - cur)], ['Raise', pct((next - cur) / cur * 100)]];
      },
      examples: [
        { in: { current: 50000, mode: 'new', value: 53000 }, out: [['New pay', '53,000.00'], ['Change', '3,000.00'], ['Raise', '6.00%']] },
        { in: { current: 42000, mode: 'pct', value: 3.5 }, out: [['New pay', '43,470.00'], ['Change', '1,470.00'], ['Raise', '3.50%']] },
      ],
    },
    {
      id: 'fin-currency-format', name: 'Currency formatter', family: 'finance',
      desc: 'Write an amount the way different countries do (1,234.56 · 1.234,56 · 12,34,567). Formatting only — no exchange rates.',
      keywords: 'money format thousands separator decimal comma locale',
      fields: [
        { id: 'amount', label: 'Amount', type: 'number', value: 1234567.891 },
        { id: 'style', label: 'Style', type: 'select', value: 'en', options: [['en', '1,234,567.89 (US/UK)'], ['de', '1.234.567,89 (Germany, Spain…)'], ['fr', '1 234 567,89 (France, Nordics…)'], ['ch', "1'234'567.89 (Switzerland)"], ['in', '12,34,567.89 (India)'], ['plain', '1234567.89 (no grouping)']] },
        { id: 'decimals', label: 'Decimals', type: 'select', value: '2', options: [['0', '0'], ['2', '2'], ['3', '3']] },
        { id: 'symbol', label: 'Symbol or code (optional)', type: 'text', value: '$' },
        { id: 'position', label: 'Symbol goes', type: 'select', value: 'before', options: [['before', 'Before the number'], ['after', 'After the number']] },
      ],
      run(v) {
        const A = need(v.amount, 'the amount');
        const d = Number(v.decimals);
        const [i, f] = Math.abs(round(A, d)).toFixed(d).split('.');
        let int;
        if (v.style === 'in') int = i.length > 3 ? i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + i.slice(-3) : i;
        else int = i.replace(/\B(?=(\d{3})+(?!\d))/g, { en: ',', de: '.', fr: ' ', ch: "'", plain: '' }[v.style]);
        const mark = v.style === 'de' || v.style === 'fr' ? ',' : '.';
        let s = int + (f ? mark + f : '');
        const sym = v.symbol.trim();
        if (sym) s = v.position === 'after' ? `${s} ${sym}` : sym + (/[A-Za-z]$/.test(sym) ? ' ' : '') + s;
        return (round(A, d) < 0 ? '-' : '') + s;
      },
      examples: [
        { in: { amount: 1234567.891, style: 'en', decimals: '2', symbol: '$', position: 'before' }, out: '$1,234,567.89' },
        { in: { amount: 1234567.891, style: 'de', decimals: '2', symbol: '€', position: 'after' }, out: '1.234.567,89 €' },
        { in: { amount: 1234567.891, style: 'in', decimals: '2', symbol: '₹', position: 'before' }, out: '₹12,34,567.89' },
        { in: { amount: -1234.5, style: 'ch', decimals: '2', symbol: 'CHF', position: 'before' }, out: "-CHF 1'234.50" },
        { in: { amount: 999.5, style: 'fr', decimals: '0', symbol: '', position: 'before' }, out: '1 000' },
      ],
    },
    {
      id: 'fin-budget', name: '50/30/20 budget', family: 'finance',
      desc: 'Split take-home pay into needs (50%), wants (30%) and savings or debt repayment (20%).',
      keywords: 'budget split needs wants savings rule',
      fields: [{ id: 'income', label: 'Monthly take-home pay', type: 'number', value: 4000, min: 0 }],
      run(v) {
        const I = need(v.income, 'your take-home pay', { min: 0 });
        return [['Needs (50%)', money(I * 0.5)], ['Wants (30%)', money(I * 0.3)], ['Savings & debt (20%)', money(I * 0.2)]];
      },
      examples: [{ in: { income: 4000 }, out: [['Needs (50%)', '2,000.00'], ['Wants (30%)', '1,200.00'], ['Savings & debt (20%)', '800.00']] }],
    },
    {
      id: 'fin-rule-72', name: 'Rule of 72', family: 'finance',
      desc: 'Roughly how many years money takes to double at a yearly rate, next to the exact answer.',
      keywords: 'doubling time rule of 70 72',
      fields: [{ id: 'rate', label: 'Growth rate (% per year)', type: 'number', value: 6, step: 0.1 }],
      run(v) {
        const r = need(v.rate, 'the growth rate', { gt: 0, max: 1000 });
        return [['Rule of 72', `${fmt(72 / r)} years`], ['Exact (compounded yearly)', `${fmt(Math.LN2 / Math.log(1 + r / 100))} years`]];
      },
      examples: [
        { in: { rate: 6 }, out: [['Rule of 72', '12.00 years'], ['Exact (compounded yearly)', '11.90 years']] },
        { in: { rate: 8 }, out: [['Rule of 72', '9.00 years'], ['Exact (compounded yearly)', '9.01 years']] },
      ],
    },
    {
      id: 'fin-depreciation', name: 'Depreciation schedule', family: 'finance',
      desc: 'Yearly depreciation and book value: straight-line, double- or 150%-declining balance (never below salvage, like Excel DDB) or sum-of-years\' digits.',
      keywords: 'depreciation straight line declining balance ddb syd asset book value',
      fields: [
        { id: 'cost', label: 'Asset cost', type: 'number', value: 10000, min: 0 },
        { id: 'salvage', label: 'Salvage value', type: 'number', value: 1000, min: 0 },
        { id: 'life', label: 'Useful life (years)', type: 'number', value: 5, min: 1 },
        { id: 'method', label: 'Method', type: 'select', value: 'sl', options: [['sl', 'Straight-line'], ['ddb', 'Double-declining balance'], ['db150', '150% declining balance'], ['syd', "Sum-of-years' digits"]] },
      ],
      run(v) {
        const cost = need(v.cost, 'the asset cost', { gt: 0 });
        const salvage = need(v.salvage, 'the salvage value', { min: 0 });
        if (salvage > cost) throw new Error('The salvage value can\'t be more than the cost.');
        const life = need(v.life, 'the useful life', { min: 1, max: 100, int: true });
        const out = [];
        let book = cost;
        for (let y = 1; y <= life; y++) {
          let dep;
          if (v.method === 'sl') dep = (cost - salvage) / life;
          else if (v.method === 'syd') dep = (cost - salvage) * (life - y + 1) / (life * (life + 1) / 2);
          else dep = Math.min(book * (v.method === 'ddb' ? 2 : 1.5) / life, book - salvage);
          book -= dep;
          out.push([`Year ${y}`, `depreciation ${money(dep)} · book value ${money(book)}`]);
        }
        out.push(['Total depreciation', money(cost - book)]);
        return out;
      },
      examples: [
        { in: { cost: 10000, salvage: 1000, life: 3, method: 'sl' }, out: [['Year 1', 'depreciation 3,000.00 · book value 7,000.00'], ['Year 2', 'depreciation 3,000.00 · book value 4,000.00'], ['Year 3', 'depreciation 3,000.00 · book value 1,000.00'], ['Total depreciation', '9,000.00']] },
        { in: { cost: 10000, salvage: 1000, life: 5, method: 'ddb' }, out: [['Year 1', 'depreciation 4,000.00 · book value 6,000.00'], ['Year 2', 'depreciation 2,400.00 · book value 3,600.00'], ['Year 3', 'depreciation 1,440.00 · book value 2,160.00'], ['Year 4', 'depreciation 864.00 · book value 1,296.00'], ['Year 5', 'depreciation 296.00 · book value 1,000.00'], ['Total depreciation', '9,000.00']] },
        { in: { cost: 10000, salvage: 1000, life: 5, method: 'syd' }, match: /^Year 1: depreciation 3,000\.00 · book value 7,000\.00\nYear 2: depreciation 2,400\.00[\s\S]*Year 5: depreciation 600\.00 · book value 1,000\.00\n/ },
      ],
    },
    {
      id: 'fin-invoice', name: 'Invoice total', family: 'finance',
      desc: 'Total an invoice from "qty x price" lines, with an optional discount, tax and (untaxed) shipping.',
      keywords: 'invoice quote line items subtotal tax total bill',
      fields: [
        { id: 'items', label: 'Line items — "2 x 15.50 Widget" (description before or after)', type: 'textarea', value: '2 x 15.50 Widget\n3 x 4 Gadget' },
        { id: 'discount', label: 'Discount (%)', type: 'number', value: 0, min: 0, max: 100 },
        { id: 'tax', label: 'Tax (%)', type: 'number', value: 10, min: 0 },
        { id: 'shipping', label: 'Shipping', type: 'number', value: 0, min: 0 },
      ],
      run(v) {
        const disc = need(v.discount, 'the discount (0 for none)', { min: 0, max: 100 });
        const tax = need(v.tax, 'the tax rate (0 for none)', { min: 0, max: 1000 });
        const ship = need(v.shipping, 'the shipping (0 for none)', { min: 0 });
        const rows = [];
        let sub = 0;
        lines(v.items).forEach((line, k) => {
          const m = /^(.*?)(\d+(?:\.\d+)?)\s*[x×*]\s*[$€£¥₹]?\s*(\d+(?:\.\d+)?)(.*)$/i.exec(line);
          if (!m) throw new Error(`Line ${k + 1} needs a quantity and price like "2 x 15.50".`);
          const q = +m[2], p = +m[3];
          const name = `${m[1]} ${m[4]}`.trim().replace(/\s*[:\-–]$/, '') || `Line ${k + 1}`;
          sub += q * p;
          rows.push([name, `${fmt(q, q % 1 ? 2 : 0)} × ${money(p)} = ${money(q * p)}`]);
        });
        if (!rows.length) throw new Error('Enter at least one line item.');
        const off = sub * disc / 100, taxAmt = (sub - off) * tax / 100;
        rows.push(['Subtotal', money(sub)]);
        if (off) rows.push([`Discount (${fmt(disc, disc % 1 ? 2 : 0)}%)`, '-' + money(off)]);
        rows.push([`Tax (${fmt(tax, tax % 1 ? 2 : 0)}%)`, money(taxAmt)]);
        if (ship) rows.push(['Shipping', money(ship)]);
        rows.push(['Total', money(sub - off + taxAmt + ship)]);
        return rows;
      },
      examples: [
        { in: { items: '2 x 15.50 Widget\n3 x 4 Gadget', discount: 0, tax: 10, shipping: 0 }, out: [['Widget', '2 × 15.50 = 31.00'], ['Gadget', '3 × 4.00 = 12.00'], ['Subtotal', '43.00'], ['Tax (10%)', '4.30'], ['Total', '47.30']] },
        { in: { items: 'Consulting: 7.5 x 80\n1 x $120 setup', discount: 10, tax: 20, shipping: 15 }, out: [['Consulting', '7.50 × 80.00 = 600.00'], ['setup', '1 × 120.00 = 120.00'], ['Subtotal', '720.00'], ['Discount (10%)', '-72.00'], ['Tax (20%)', '129.60'], ['Shipping', '15.00'], ['Total', '792.60']] },
      ],
    },
    {
      id: 'fin-unit-price', name: 'Unit price comparison', family: 'finance',
      desc: 'Which pack size is the better deal: compares price per unit (per 100 g, per litre…).',
      keywords: 'unit price compare grocery best value per kg per litre',
      fields: [
        { id: 'items', label: 'One per line: name, price, quantity', type: 'textarea', value: 'Small, 2.49, 500\nLarge, 4.29, 1000' },
        { id: 'per', label: 'Compare the price per … units', type: 'number', value: 100, min: 0 },
      ],
      run(v) {
        const per = need(v.per, 'the units to compare per', { gt: 0 });
        const items = lines(v.items).map((line, k) => {
          const p = line.split(/\s*[,;\t]\s*/);
          const price = toNumber(p[1]), qty = toNumber(p[2]);
          if (p.length !== 3 || !(price >= 0) || !(qty > 0)) throw new Error(`Line ${k + 1}: write it as "name, price, quantity".`);
          return { name: p[0] || `Item ${k + 1}`, price, qty, unit: price / qty * per };
        });
        if (items.length < 2) throw new Error('Enter at least two items to compare.');
        const best = items.reduce((a, b) => (b.unit < a.unit ? b : a));
        const worst = items.reduce((a, b) => (b.unit > a.unit ? b : a));
        const out = items.map(it => [it.name, `${fmt(it.unit, 4)} per ${fmt(per, per % 1 ? 2 : 0)} (${money(it.price)} for ${fmt(it.qty, it.qty % 1 ? 2 : 0)})`]);
        out.push(['Best value', best.unit === worst.unit ? 'All the same' : `${best.name} — ${pct((worst.unit - best.unit) / worst.unit * 100)} cheaper per unit than ${worst.name}`]);
        return out;
      },
      examples: [{ in: { items: 'Small, 2.49, 500\nLarge, 4.29, 1000', per: 100 }, out: [['Small', '0.4980 per 100 (2.49 for 500)'], ['Large', '0.4290 per 100 (4.29 for 1,000)'], ['Best value', 'Large — 13.86% cheaper per unit than Small']] }],
    },
    {
      id: 'fin-fuel-cost', name: 'Trip fuel cost', family: 'finance',
      desc: 'Fuel used and cost for a drive, optionally round trip and split between passengers.',
      keywords: 'gas petrol fuel trip mpg litres cost road',
      fields: [
        { id: 'units', label: 'Units', type: 'select', value: 'metric', options: [['metric', 'km · L/100 km · price per litre'], ['us', 'miles · US mpg · price per US gallon']] },
        { id: 'distance', label: 'Distance (one way)', type: 'number', value: 500, min: 0 },
        { id: 'economy', label: 'Fuel economy (L/100 km or mpg)', type: 'number', value: 6.5, min: 0 },
        { id: 'price', label: 'Fuel price', type: 'number', value: 1.8, min: 0 },
        { id: 'roundTrip', label: 'Round trip', type: 'checkbox' },
        { id: 'people', label: 'Split between people', type: 'number', value: 1, min: 1 },
      ],
      run(v) {
        const d = need(v.distance, 'the distance', { min: 0 }) * (v.roundTrip ? 2 : 1);
        const e = need(v.economy, 'the fuel economy', { gt: 0 });
        const p = need(v.price, 'the fuel price', { min: 0 });
        const n = need(v.people, 'the number of people', { min: 1, int: true });
        const us = v.units === 'us';
        const fuel = us ? d / e : d * e / 100;
        const out = [['Distance', `${fmt(d, d % 1 ? 1 : 0)} ${us ? 'miles' : 'km'}`], ['Fuel needed', `${fmt(fuel)} ${us ? 'gal' : 'L'}`], ['Fuel cost', money(fuel * p)]];
        if (n > 1) out.push(['Each person', money(fuel * p / n)]);
        return out;
      },
      examples: [
        { in: { units: 'metric', distance: 500, economy: 6.5, price: 1.8, people: 1 }, out: [['Distance', '500 km'], ['Fuel needed', '32.50 L'], ['Fuel cost', '58.50']] },
        { in: { units: 'us', distance: 300, economy: 30, price: 3.5, roundTrip: true, people: 4 }, out: [['Distance', '600 miles'], ['Fuel needed', '20.00 gal'], ['Fuel cost', '70.00'], ['Each person', '17.50']] },
      ],
    },
    {
      id: 'fin-electricity', name: 'Electricity cost', family: 'finance',
      desc: 'Energy use (kWh) and running cost of an appliance from its wattage and hours of use.',
      keywords: 'kwh power watt appliance energy bill running cost',
      fields: [
        { id: 'watts', label: 'Power (watts)', type: 'number', value: 100, min: 0 },
        { id: 'hours', label: 'Hours per day', type: 'number', value: 5, min: 0, max: 24 },
        { id: 'days', label: 'Days', type: 'number', value: 30, min: 0 },
        { id: 'price', label: 'Price per kWh', type: 'number', value: 0.15, min: 0, step: 0.01 },
      ],
      run(v) {
        const W = need(v.watts, 'the power', { min: 0 });
        const h = need(v.hours, 'the hours per day', { min: 0, max: 24 });
        const days = need(v.days, 'the number of days', { min: 0 });
        const p = need(v.price, 'the price per kWh', { min: 0 });
        const perDay = W * h / 1000;
        return [['Energy', `${fmt(perDay * days)} kWh`], ['Cost', money(perDay * days * p)], ['Cost per day', money(perDay * p)], ['Cost per year (365 days)', money(perDay * 365 * p)]];
      },
      examples: [{ in: { watts: 100, hours: 5, days: 30, price: 0.15 }, out: [['Energy', '15.00 kWh'], ['Cost', '2.25'], ['Cost per day', '0.08'], ['Cost per year (365 days)', '27.38']] }],
    },
    {
      id: 'fin-rent-vs-buy', name: 'Rent vs buy', family: 'finance',
      desc: 'Simplified comparison of renting versus buying over a number of years. Ignores closing costs and tax effects; buying cost counts the growth your down payment could have earned.',
      keywords: 'rent buy house home mortgage compare',
      fields: [
        { id: 'price', label: 'Home price', type: 'number', value: 300000, min: 0 },
        { id: 'down', label: 'Down payment (%)', type: 'number', value: 20, min: 0, max: 100 },
        { id: 'rate', label: 'Mortgage rate (% per year)', type: 'number', value: 6, min: 0, step: 0.01 },
        { id: 'term', label: 'Mortgage term (years)', type: 'number', value: 30, min: 1 },
        { id: 'upkeep', label: 'Property tax, insurance & upkeep (% of home value per year)', type: 'number', value: 1.5, min: 0, step: 0.1 },
        { id: 'growth', label: 'Home price growth (% per year)', type: 'number', value: 3, step: 0.1 },
        { id: 'rent', label: 'Monthly rent', type: 'number', value: 1500, min: 0 },
        { id: 'rentUp', label: 'Rent increase (% per year)', type: 'number', value: 3, step: 0.1 },
        { id: 'invest', label: 'Return you could earn on the down payment (% per year)', type: 'number', value: 5, step: 0.1 },
        { id: 'years', label: 'Years to compare', type: 'number', value: 10, min: 1 },
      ],
      run(v) {
        const price = need(v.price, 'the home price', { gt: 0 });
        const down = price * need(v.down, 'the down payment', { min: 0, max: 100 }) / 100;
        const i = need(v.rate, 'the mortgage rate', { min: 0, max: 100 }) / 1200;
        const n = need(v.term, 'the mortgage term', { min: 1, max: 50, int: true }) * 12;
        const upkeep = need(v.upkeep, 'the yearly ownership costs', { min: 0, max: 100 }) / 100;
        const growth = need(v.growth, 'the home price growth', { min: -50, max: 100 }) / 100;
        const rent = need(v.rent, 'the monthly rent', { min: 0 });
        const rentUp = need(v.rentUp, 'the rent increase', { min: -50, max: 100 }) / 100;
        const invest = need(v.invest, 'the investment return', { min: -50, max: 100 }) / 100;
        const years = need(v.years, 'the number of years', { min: 1, max: 50, int: true });
        const loan = price - down, pmt = loan > 0 ? payment(loan, i, n) : 0;
        const k = Math.min(years * 12, n);
        const balance = k === n || loan === 0 ? 0 : (i === 0 ? loan - pmt * k : loan * (1 + i) ** k - pmt * ((1 + i) ** k - 1) / i);
        let owning = 0, rentPaid = 0;
        for (let y = 0; y < years; y++) { owning += price * (1 + growth) ** y * upkeep; rentPaid += rent * 12 * (1 + rentUp) ** y; }
        const equity = price * (1 + growth) ** years - balance;
        const lost = down * ((1 + invest) ** years - 1);
        const buy = down + pmt * k + owning + lost - equity;
        const diff = Math.abs(buy - rentPaid);
        return [['Monthly mortgage payment', money(pmt)], ['Mortgage payments', money(pmt * k)], ['Ownership costs', money(owning)], ['Down payment\'s lost growth', money(lost)],
          [`Home equity after ${years} years`, money(equity)], ['Net cost of buying', money(buy)], ['Net cost of renting', money(rentPaid)],
          ['Verdict', round(diff, 2) === 0 ? 'About the same' : `${buy < rentPaid ? 'Buying' : 'Renting'} is cheaper by ${money(diff)} over ${plural(years, 'year')}`]];
      },
      examples: [
        { in: { price: 120000, down: 0, rate: 0, term: 10, upkeep: 0, growth: 0, rent: 500, rentUp: 0, invest: 0, years: 10 }, out: [['Monthly mortgage payment', '1,000.00'], ['Mortgage payments', '120,000.00'], ['Ownership costs', '0.00'], ['Down payment\'s lost growth', '0.00'], ['Home equity after 10 years', '120,000.00'], ['Net cost of buying', '0.00'], ['Net cost of renting', '60,000.00'], ['Verdict', 'Buying is cheaper by 60,000.00 over 10 years']] },
        { in: { price: 300000, down: 20, rate: 6, term: 30, upkeep: 1.5, growth: 3, rent: 1500, rentUp: 3, invest: 5, years: 10 }, out: [['Monthly mortgage payment', '1,438.92'], ['Mortgage payments', '172,670.55'], ['Ownership costs', '51,587.46'], ['Down payment\'s lost growth', '37,733.68'], ['Home equity after 10 years', '202,329.17'], ['Net cost of buying', '119,662.51'], ['Net cost of renting', '206,349.83'], ['Verdict', 'Buying is cheaper by 86,687.32 over 10 years']] },
      ],
    },
    // --------------------------------------------------------- Business
    {
      id: 'biz-profit-margin', name: 'Profit margins', family: 'business',
      desc: 'Gross and net profit and margins from revenue, cost of goods and operating expenses.',
      keywords: 'gross margin net margin profit revenue cogs opex',
      fields: [
        { id: 'revenue', label: 'Revenue', type: 'number', value: 100000, min: 0 },
        { id: 'cogs', label: 'Cost of goods sold', type: 'number', value: 60000, min: 0 },
        { id: 'opex', label: 'Operating expenses', type: 'number', value: 25000, min: 0 },
      ],
      run(v) {
        const R = need(v.revenue, 'the revenue', { gt: 0 });
        const C = need(v.cogs, 'the cost of goods sold', { min: 0 });
        const O = need(v.opex, 'the operating expenses (0 for none)', { min: 0 });
        return [['Gross profit', money(R - C)], ['Gross margin', pct((R - C) / R * 100)], ['Net profit (before tax)', money(R - C - O)], ['Net margin', pct((R - C - O) / R * 100)]];
      },
      examples: [{ in: { revenue: 100000, cogs: 60000, opex: 25000 }, out: [['Gross profit', '40,000.00'], ['Gross margin', '40.00%'], ['Net profit (before tax)', '15,000.00'], ['Net margin', '15.00%']] }],
    },
    {
      id: 'biz-cac', name: 'Customer acquisition cost', family: 'business',
      desc: 'CAC: sales and marketing spend divided by the customers it won.',
      keywords: 'cac marketing cost per customer acquisition',
      fields: [
        { id: 'marketing', label: 'Marketing spend', type: 'number', value: 5000, min: 0 },
        { id: 'sales', label: 'Sales spend', type: 'number', value: 3000, min: 0 },
        { id: 'customers', label: 'New customers', type: 'number', value: 40, min: 0 },
      ],
      run(v) {
        const spend = need(v.marketing, 'the marketing spend', { min: 0 }) + need(v.sales, 'the sales spend (0 for none)', { min: 0 });
        const n = need(v.customers, 'the number of new customers', { gt: 0 });
        return [['CAC', money(spend / n)], ['Total spend', money(spend)]];
      },
      examples: [{ in: { marketing: 5000, sales: 3000, customers: 40 }, out: [['CAC', '200.00'], ['Total spend', '8,000.00']] }],
    },
    {
      id: 'biz-ltv', name: 'Customer lifetime value', family: 'business',
      desc: 'LTV from monthly revenue per customer, gross margin and churn — and the LTV:CAC ratio if you know CAC.',
      keywords: 'ltv clv lifetime value churn arpu cac ratio saas',
      fields: [
        { id: 'arpu', label: 'Revenue per customer per month', type: 'number', value: 50, min: 0 },
        { id: 'margin', label: 'Gross margin (%)', type: 'number', value: 80, min: 0, max: 100 },
        { id: 'churn', label: 'Monthly churn (%)', type: 'number', value: 5, min: 0, step: 0.1 },
        { id: 'cac', label: 'CAC (optional)', type: 'number', value: 200, min: 0 },
      ],
      run(v) {
        const arpu = need(v.arpu, 'the revenue per customer', { gt: 0 });
        const m = need(v.margin, 'the gross margin', { gt: 0, max: 100 }) / 100;
        const churn = need(v.churn, 'the monthly churn', { gt: 0, max: 100 }) / 100;
        const cac = maybe(v.cac, 'the CAC', { gt: 0 });
        const out = [['Average lifetime', `${fmt(1 / churn, 1)} months`], ['LTV (revenue)', money(arpu / churn)], ['LTV (gross profit)', money(arpu * m / churn)]];
        if (cac !== null) out.push(['LTV : CAC', `${fmt(arpu * m / churn / cac)} : 1`], ['Months to earn back CAC', fmt(cac / (arpu * m), 1)]);
        return out;
      },
      examples: [
        { in: { arpu: 50, margin: 80, churn: 5, cac: 200 }, out: [['Average lifetime', '20.0 months'], ['LTV (revenue)', '1,000.00'], ['LTV (gross profit)', '800.00'], ['LTV : CAC', '4.00 : 1'], ['Months to earn back CAC', '5.0']] },
        { in: { arpu: 30, margin: 100, churn: 2.5, cac: '' }, out: [['Average lifetime', '40.0 months'], ['LTV (revenue)', '1,200.00'], ['LTV (gross profit)', '1,200.00']] },
      ],
    },
    {
      id: 'biz-churn', name: 'Churn rate', family: 'business',
      desc: 'Customer churn and retention for a period, and what that churn adds up to over a year.',
      keywords: 'churn retention attrition customers lost subscription',
      fields: [
        { id: 'start', label: 'Customers at start', type: 'number', value: 1000, min: 0 },
        { id: 'end', label: 'Customers at end', type: 'number', value: 950, min: 0 },
        { id: 'added', label: 'New customers during the period', type: 'number', value: 50, min: 0 },
        { id: 'period', label: 'Period', type: 'select', value: 'month', options: [['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']] },
      ],
      run(v) {
        const s = need(v.start, 'the customers at start', { gt: 0, int: true });
        const e = need(v.end, 'the customers at end', { min: 0, int: true });
        const a = need(v.added, 'the new customers (0 for none)', { min: 0, int: true });
        const lost = s + a - e;
        if (lost < 0) throw new Error('The end count is more than start plus new customers — check the numbers.');
        if (lost > s) throw new Error('More customers were lost than you started with — new customers who left should be left out of both counts.');
        const c = lost / s;
        const out = [['Customers lost', fmt(lost, 0)], ['Churn rate', pct(c * 100)], ['Retention rate', pct((1 - c) * 100)]];
        const per = { month: 12, quarter: 4 }[v.period];
        if (per) out.push(['Yearly churn at this pace', pct((1 - (1 - c) ** per) * 100)]);
        return out;
      },
      examples: [
        { in: { start: 1000, end: 950, added: 50, period: 'month' }, out: [['Customers lost', '100'], ['Churn rate', '10.00%'], ['Retention rate', '90.00%'], ['Yearly churn at this pace', '71.76%']] },
        { in: { start: 200, end: 190, added: 0, period: 'year' }, out: [['Customers lost', '10'], ['Churn rate', '5.00%'], ['Retention rate', '95.00%']] },
      ],
    },
    {
      id: 'biz-conversion', name: 'Conversion rate', family: 'business',
      desc: 'Conversion rate from visitors and conversions, plus revenue per visitor if you add a value.',
      keywords: 'conversion rate cvr visitors signups sales funnel',
      fields: [
        { id: 'visitors', label: 'Visitors', type: 'number', value: 2500, min: 0 },
        { id: 'conversions', label: 'Conversions', type: 'number', value: 75, min: 0 },
        { id: 'value', label: 'Value per conversion (optional)', type: 'number', value: '', min: 0 },
      ],
      run(v) {
        const n = need(v.visitors, 'the number of visitors', { gt: 0 });
        const c = need(v.conversions, 'the number of conversions', { min: 0 });
        if (c > n) throw new Error('There can\'t be more conversions than visitors.');
        const val = maybe(v.value, 'the value per conversion', { min: 0 });
        const out = [['Conversion rate', pct(c / n * 100)]];
        if (c > 0) out.push(['Visitors per conversion', fmt(n / c, 1)]);
        if (val !== null) out.push(['Revenue', money(c * val)], ['Revenue per visitor', money(c * val / n)]);
        return out;
      },
      examples: [
        { in: { visitors: 2500, conversions: 75, value: '' }, out: [['Conversion rate', '3.00%'], ['Visitors per conversion', '33.3']] },
        { in: { visitors: 2500, conversions: 75, value: 40 }, out: [['Conversion rate', '3.00%'], ['Visitors per conversion', '33.3'], ['Revenue', '3,000.00'], ['Revenue per visitor', '1.20']] },
      ],
    },
    {
      id: 'biz-ab-test', name: 'A/B test significance', family: 'business',
      desc: 'Is variant B really different from A? Two-proportion z-test with a two-sided p-value.',
      keywords: 'ab split test significance p-value z-test conversion experiment',
      fields: [
        { id: 'nA', label: 'A — visitors', type: 'number', value: 1000, min: 0 },
        { id: 'cA', label: 'A — conversions', type: 'number', value: 100, min: 0 },
        { id: 'nB', label: 'B — visitors', type: 'number', value: 1000, min: 0 },
        { id: 'cB', label: 'B — conversions', type: 'number', value: 130, min: 0 },
        { id: 'level', label: 'Confidence', type: 'select', value: '95', options: [['90', '90%'], ['95', '95%'], ['99', '99%']] },
      ],
      run(v) {
        const nA = need(v.nA, 'the visitors for A', { gt: 0, int: true }), nB = need(v.nB, 'the visitors for B', { gt: 0, int: true });
        const cA = need(v.cA, 'the conversions for A', { min: 0, int: true, max: nA }), cB = need(v.cB, 'the conversions for B', { min: 0, int: true, max: nB });
        const pA = cA / nA, pB = cB / nB, pool = (cA + cB) / (nA + nB);
        const se = Math.sqrt(pool * (1 - pool) * (1 / nA + 1 / nB));
        if (se === 0) throw new Error('Both variants converted at 0% or 100% — there is nothing to compare.');
        const z = (pB - pA) / se, p = erfc(Math.abs(z) / Math.SQRT2);
        const level = Number(v.level);
        const out = [['A conversion rate', pct(pA * 100)], ['B conversion rate', pct(pB * 100)]];
        if (pA > 0) out.push(['Relative lift (B vs A)', (pB >= pA ? '+' : '') + pct((pB - pA) / pA * 100)]);
        out.push(['z-score', fmt(z)], ['p-value (two-sided)', p < 0.0001 ? '< 0.0001' : fmt(p, 4)],
          ['Result', p < 1 - level / 100 ? `Significant at ${level}% — B is ${pB > pA ? 'better' : 'worse'} than A` : `Not significant at ${level}% — keep testing or treat as no difference`]);
        return out;
      },
      examples: [
        { in: { nA: 1000, cA: 100, nB: 1000, cB: 130, level: '95' }, out: [['A conversion rate', '10.00%'], ['B conversion rate', '13.00%'], ['Relative lift (B vs A)', '+30.00%'], ['z-score', '2.10'], ['p-value (two-sided)', '0.0355'], ['Result', 'Significant at 95% — B is better than A']] },
        { in: { nA: 1000, cA: 100, nB: 1000, cB: 130, level: '99' }, match: /p-value \(two-sided\): 0\.0355\nResult: Not significant at 99%/ },
      ],
    },
    {
      id: 'biz-nps', name: 'Net Promoter Score', family: 'business',
      desc: 'NPS from how many people answered 9–10 (promoters), 7–8 (passives) and 0–6 (detractors).',
      keywords: 'nps net promoter score survey customer satisfaction',
      fields: [
        { id: 'promoters', label: 'Promoters (9–10)', type: 'number', value: 60, min: 0 },
        { id: 'passives', label: 'Passives (7–8)', type: 'number', value: 25, min: 0 },
        { id: 'detractors', label: 'Detractors (0–6)', type: 'number', value: 15, min: 0 },
      ],
      run(v) {
        const P = need(v.promoters, 'the number of promoters', { min: 0, int: true });
        const S = need(v.passives, 'the number of passives', { min: 0, int: true });
        const D = need(v.detractors, 'the number of detractors', { min: 0, int: true });
        const n = P + S + D;
        if (!n) throw new Error('Enter at least one response.');
        return [['NPS', fmt((P - D) / n * 100, 0)], ['Promoters', pct(P / n * 100)], ['Passives', pct(S / n * 100)], ['Detractors', pct(D / n * 100)], ['Responses', fmt(n, 0)]];
      },
      examples: [
        { in: { promoters: 60, passives: 25, detractors: 15 }, out: [['NPS', '45'], ['Promoters', '60.00%'], ['Passives', '25.00%'], ['Detractors', '15.00%'], ['Responses', '100']] },
        { in: { promoters: 1, passives: 0, detractors: 3 }, out: [['NPS', '-50'], ['Promoters', '25.00%'], ['Passives', '0.00%'], ['Detractors', '75.00%'], ['Responses', '4']] },
      ],
    },
    {
      id: 'biz-meeting-cost', name: 'Meeting cost', family: 'business',
      desc: 'What a meeting costs in paid time: people × hourly rate × length, and per year if it repeats.',
      keywords: 'meeting cost time salary people hourly',
      fields: [
        { id: 'people', label: 'People', type: 'number', value: 8, min: 1 },
        { id: 'rate', label: 'Average hourly cost per person', type: 'number', value: 50, min: 0 },
        { id: 'minutes', label: 'Length (minutes)', type: 'number', value: 90, min: 0 },
        { id: 'perYear', label: 'Times per year', type: 'number', value: 52, min: 1 },
      ],
      run(v) {
        const n = need(v.people, 'the number of people', { min: 1, int: true });
        const r = need(v.rate, 'the hourly cost', { min: 0 });
        const m = need(v.minutes, 'the length in minutes', { gt: 0 });
        const times = need(v.perYear, 'the times per year (1 for a one-off)', { min: 1, int: true });
        const cost = n * r * m / 60;
        const out = [['Cost of one meeting', money(cost)], ['Cost per minute', money(n * r / 60)], ['Person-hours', fmt(n * m / 60, 1)]];
        if (times > 1) out.push([`Per year (${times}×)`, money(cost * times)]);
        return out;
      },
      examples: [{ in: { people: 8, rate: 50, minutes: 90, perYear: 52 }, out: [['Cost of one meeting', '600.00'], ['Cost per minute', '6.67'], ['Person-hours', '12.0'], ['Per year (52×)', '31,200.00']] }],
    },
    {
      id: 'biz-deadline', name: 'Project deadline (workdays)', family: 'business',
      desc: 'The date that is a number of working days after a start date, skipping weekends and the holidays you list.',
      keywords: 'deadline working days business days due date sla add workdays',
      fields: [
        { id: 'start', label: 'Start date', type: 'date', value: TODAY },
        { id: 'days', label: 'Working days', type: 'number', value: 10, min: 0 },
        { id: 'holidays', label: 'Holidays to skip (YYYY-MM-DD, one per line)', type: 'textarea', value: '' },
      ],
      run(v) {
        const start = parseDate(v.start, 'the start date');
        const n = need(v.days, 'the number of working days', { min: 0, max: 10000, int: true });
        const hol = holidaySet(v.holidays);
        let d = start, weekends = 0, skipped = 0;
        for (let left = n; left > 0;) {
          d++;
          if (isWeekend(d)) weekends++;
          else if (hol.has(d)) skipped++;
          else left--;
        }
        return [['Deadline', isoDay(d)], ['Calendar days', fmt(d - start, 0)], ['Weekend days skipped', String(weekends)], ['Holidays skipped', String(skipped)]];
      },
      examples: [
        { in: { start: '2024-01-05', days: 10, holidays: '' }, out: [['Deadline', '2024-01-19 (Friday)'], ['Calendar days', '14'], ['Weekend days skipped', '4'], ['Holidays skipped', '0']] },
        { in: { start: '2024-01-05', days: 10, holidays: '2024-01-15' }, out: [['Deadline', '2024-01-22 (Monday)'], ['Calendar days', '17'], ['Weekend days skipped', '6'], ['Holidays skipped', '1']] },
      ],
    },
    {
      id: 'biz-okr-score', name: 'OKR score', family: 'business',
      desc: 'Average key-result scores (0–1, a percentage, or progress like 35/50; each capped at 1.0) and the usual green/yellow/red rating.',
      keywords: 'okr key results objectives score grade average',
      fields: [{ id: 'krs', label: 'Key results — one per line, e.g. "Signups: 0.7", "NPS 60%", "Deals 35/50"', type: 'textarea', value: 'Signups: 0.7\nChurn: 50%\nLaunch: 1' }],
      run(v) {
        const rows = lines(v.krs).map((line, k) => {
          const m = /^(.*?)(\d+(?:\.\d+)?)\s*(?:(%)|\/\s*(\d+(?:\.\d+)?))?\s*$/.exec(line);
          if (!m) throw new Error(`Line ${k + 1} needs a score at the end, like 0.7, 70% or 35/50.`);
          let s = +m[2];
          if (m[4] !== undefined) { if (!(+m[4] > 0)) throw new Error(`Line ${k + 1}: the target can't be 0.`); s /= +m[4]; } else if (m[3] || s > 1) s /= 100;
          return [m[1].replace(/[\s:=,\-–]+$/, '').trim() || `Key result ${k + 1}`, Math.min(s, 1)];
        });
        if (!rows.length) throw new Error('Enter at least one key result score.');
        const avg = rows.reduce((a, r) => a + r[1], 0) / rows.length;
        const rating = avg >= 0.7 ? 'Green — 0.7 or more is a strong result' : avg >= 0.4 ? 'Yellow — progress, but short of the goal' : 'Red — little real progress';
        return [...rows.map(([name, s]) => [name, fmt(s)]), ['Average', fmt(avg)], ['Rating', rating]];
      },
      examples: [
        { in: { krs: 'Signups: 0.7\nChurn: 50%\nLaunch: 1' }, out: [['Signups', '0.70'], ['Churn', '0.50'], ['Launch', '1.00'], ['Average', '0.73'], ['Rating', 'Green — 0.7 or more is a strong result']] },
        { in: { krs: 'Deals 35/50\n0.2\nKR3 120%' }, out: [['Deals', '0.70'], ['Key result 2', '0.20'], ['KR3', '1.00'], ['Average', '0.63'], ['Rating', 'Yellow — progress, but short of the goal']] },
      ],
    },
    {
      id: 'biz-subject-line', name: 'Email subject line check', family: 'business',
      desc: 'Length of an email subject against typical inbox cut-offs (≈40 characters on phones, ≈60 on desktop), with shouting and spam-word flags.',
      keywords: 'email subject line length newsletter marketing spam preview',
      fields: [{ id: 'subject', label: 'Subject line', type: 'text', value: 'Your March invoice is ready to view' }],
      run(v) {
        const s = v.subject.trim();
        if (!s) throw new Error('Enter a subject line.');
        const chars = [...s].length, words = s.split(/\s+/).length;
        const loud = s.match(/\b[A-Z]{2,}\b/g) || [];
        const spam = ['free', 'act now', 'urgent', 'winner', 'guaranteed', 'cash', 'risk-free', 'click here', 'limited time', 'buy now', 'no cost', 'congratulations']
          .filter(w => new RegExp(`\\b${w}\\b`, 'i').test(s));
        return [['Characters', String(chars)], ['Words', String(words)],
          ['Phone inbox (≈40)', chars <= 40 ? 'Fits' : `Cut off — shows "${[...s].slice(0, 40).join('').trimEnd()}…"`],
          ['Desktop inbox (≈60)', chars <= 60 ? 'Fits' : 'Cut off'],
          ['ALL-CAPS words', loud.length ? loud.join(', ') : 'None'], ['Exclamation marks', String((s.match(/!/g) || []).length)],
          ['Spam-trigger words', spam.length ? spam.join(', ') : 'None']];
      },
      examples: [
        { in: { subject: 'Your March invoice is ready to view' }, out: [['Characters', '35'], ['Words', '7'], ['Phone inbox (≈40)', 'Fits'], ['Desktop inbox (≈60)', 'Fits'], ['ALL-CAPS words', 'None'], ['Exclamation marks', '0'], ['Spam-trigger words', 'None']] },
        { in: { subject: 'FREE gift!!! Act now before this limited time deal ends' }, out: [['Characters', '55'], ['Words', '10'], ['Phone inbox (≈40)', 'Cut off — shows "FREE gift!!! Act now before this limited…"'], ['Desktop inbox (≈60)', 'Fits'], ['ALL-CAPS words', 'FREE'], ['Exclamation marks', '3'], ['Spam-trigger words', 'free, act now, limited time']] },
      ],
    },
    {
      id: 'biz-speaking-time', name: 'Speech & presentation time', family: 'business',
      desc: 'How long a script takes to say out loud (and to read silently), from pasted text or a word count.',
      keywords: 'speech talk presentation speaking time words per minute wpm script',
      fields: [
        { id: 'text', label: 'Script (or leave empty and give a word count)', type: 'textarea', value: '' },
        { id: 'words', label: 'Word count', type: 'number', value: 650, min: 0 },
        { id: 'wpm', label: 'Speaking pace', type: 'select', value: '130', options: [['110', 'Slow (110 wpm)'], ['130', 'Average (130 wpm)'], ['160', 'Fast (160 wpm)']] },
      ],
      run(v) {
        const counted = (v.text.match(/\S+/g) || []).length;
        const words = counted || need(v.words, 'a script or a word count', { gt: 0, int: true });
        const wpm = Number(v.wpm);
        return [['Words', fmt(words, 0)], [`Speaking time (${wpm} wpm)`, hms(words / wpm * 60)], ['Silent reading (238 wpm)', hms(words / 238 * 60)]];
      },
      examples: [
        { in: { text: '', words: 650, wpm: '130' }, out: [['Words', '650'], ['Speaking time (130 wpm)', '5:00'], ['Silent reading (238 wpm)', '2:44']] },
        { in: { text: 'Thank you all for coming today.', words: '', wpm: '110' }, out: [['Words', '6'], ['Speaking time (110 wpm)', '0:03'], ['Silent reading (238 wpm)', '0:02']] },
      ],
    },
    {
      id: 'biz-payback', name: 'Payback period', family: 'business',
      desc: 'How long an investment takes to earn back its cost from a steady monthly net cash flow.',
      keywords: 'payback period investment break even months',
      fields: [
        { id: 'cost', label: 'Investment', type: 'number', value: 12000, min: 0 },
        { id: 'monthly', label: 'Net cash flow per month', type: 'number', value: 1500, min: 0 },
      ],
      run(v) {
        const c = need(v.cost, 'the investment', { gt: 0 });
        const m = need(v.monthly, 'the monthly cash flow', { gt: 0 });
        return [['Payback period', `${fmt(c / m, 1)} months`], ['In years', fmt(c / m / 12)]];
      },
      examples: [{ in: { cost: 12000, monthly: 1500 }, out: [['Payback period', '8.0 months'], ['In years', '0.67']] }],
    },
    {
      id: 'biz-inventory-turnover', name: 'Inventory turnover', family: 'business',
      desc: 'How many times stock sells through in a year, and the average days it sits on the shelf.',
      keywords: 'inventory turnover stock days dio cogs',
      fields: [
        { id: 'cogs', label: 'Cost of goods sold (year)', type: 'number', value: 500000, min: 0 },
        { id: 'begin', label: 'Inventory at start', type: 'number', value: 80000, min: 0 },
        { id: 'end', label: 'Inventory at end', type: 'number', value: 120000, min: 0 },
      ],
      run(v) {
        const cogs = need(v.cogs, 'the cost of goods sold', { gt: 0 });
        const avg = (need(v.begin, 'the starting inventory', { min: 0 }) + need(v.end, 'the ending inventory', { min: 0 })) / 2;
        if (!avg) throw new Error('The average inventory is 0, so turnover can\'t be calculated.');
        return [['Average inventory', money(avg)], ['Turnover', `${fmt(cogs / avg)} times a year`], ['Days of inventory', fmt(365 * avg / cogs, 1)]];
      },
      examples: [{ in: { cogs: 500000, begin: 80000, end: 120000 }, out: [['Average inventory', '100,000.00'], ['Turnover', '5.00 times a year'], ['Days of inventory', '73.0']] }],
    },
    {
      id: 'biz-ad-metrics', name: 'Ad metrics (CPM, CTR, CPC)', family: 'business',
      desc: 'Cost per thousand impressions, click-through rate, cost per click and, with conversions, cost per acquisition.',
      keywords: 'cpm ctr cpc cpa advertising ads campaign',
      fields: [
        { id: 'spend', label: 'Ad spend', type: 'number', value: 500, min: 0 },
        { id: 'impressions', label: 'Impressions', type: 'number', value: 100000, min: 0 },
        { id: 'clicks', label: 'Clicks', type: 'number', value: 1500, min: 0 },
        { id: 'conversions', label: 'Conversions (optional)', type: 'number', value: 30, min: 0 },
      ],
      run(v) {
        const s = need(v.spend, 'the ad spend', { min: 0 });
        const imp = need(v.impressions, 'the impressions', { gt: 0 });
        const cl = need(v.clicks, 'the clicks', { min: 0, max: imp });
        const conv = maybe(v.conversions, 'the conversions', { min: 0 });
        const out = [['CPM', money(s / imp * 1000)], ['CTR', pct(cl / imp * 100)]];
        if (cl > 0) out.push(['CPC', money(s / cl)]);
        if (conv !== null && cl > 0) out.push(['Conversion rate (of clicks)', pct(conv / cl * 100)]);
        if (conv) out.push(['Cost per acquisition', money(s / conv)]);
        return out;
      },
      examples: [{ in: { spend: 500, impressions: 100000, clicks: 1500, conversions: 30 }, out: [['CPM', '5.00'], ['CTR', '1.50%'], ['CPC', '0.33'], ['Conversion rate (of clicks)', '2.00%'], ['Cost per acquisition', '16.67']] }],
    },
    // ------------------------------------------------------ Date & Time
    {
      id: 'date-days-between', name: 'Days between dates', family: 'date',
      desc: 'Number of days, weeks, and years/months/days between two dates.',
      keywords: 'date difference duration how many days interval',
      fields: [
        { id: 'start', label: 'Start date', type: 'date', value: TODAY },
        { id: 'end', label: 'End date', type: 'date', value: TODAY },
        { id: 'inclusive', label: 'Count the end date too', type: 'checkbox' },
      ],
      run(v) {
        const a = parseDate(v.start, 'the start date'), b = parseDate(v.end, 'the end date');
        const lo = Math.min(a, b), hi = Math.max(a, b) + (v.inclusive ? 1 : 0);
        const n = hi - lo;
        const out = [['Days', fmt(n, 0)], ['Weeks', weeksText(n)], ['Years, months, days', ymdText(diffYMD(lo, hi))]];
        if (b < a) out.push(['Note', 'The end date is before the start date']);
        return out;
      },
      examples: [
        { in: { start: '2024-01-01', end: '2024-12-31' }, out: [['Days', '365'], ['Weeks', '52 weeks, 1 day'], ['Years, months, days', '0 years, 11 months, 30 days']] },
        { in: { start: '2024-01-01', end: '2024-12-31', inclusive: true }, out: [['Days', '366'], ['Weeks', '52 weeks, 2 days'], ['Years, months, days', '1 year, 0 months, 0 days']] },
        { in: { start: '2000-03-15', end: '1999-03-15' }, out: [['Days', '366'], ['Weeks', '52 weeks, 2 days'], ['Years, months, days', '1 year, 0 months, 0 days'], ['Note', 'The end date is before the start date']] },
      ],
    },
    {
      id: 'date-add', name: 'Add to a date', family: 'date',
      desc: 'Add or subtract days, weeks, months or years. A day past the end of the new month becomes its last day (31 Jan + 1 month = 28/29 Feb).',
      keywords: 'date add subtract plus minus days weeks months years later ago',
      fields: [
        { id: 'date', label: 'Date', type: 'date', value: TODAY },
        { id: 'op', label: 'Operation', type: 'select', value: 'add', options: [['add', 'Add'], ['sub', 'Subtract']] },
        { id: 'amount', label: 'Amount', type: 'number', value: 30, min: 0 },
        { id: 'unit', label: 'Unit', type: 'select', value: 'days', options: [['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'], ['years', 'Years']] },
      ],
      run(v) {
        const d = parseDate(v.date, 'the date');
        const n = need(v.amount, 'the amount', { min: 0, max: 1e6, int: true }) * (v.op === 'sub' ? -1 : 1);
        const months = v.unit === 'months' ? n : v.unit === 'years' ? n * 12 : 0;
        const res = months ? addMonths(d, months) : d + n * (v.unit === 'weeks' ? 7 : 1);
        const Y = ymd(res).y;
        if (Y < 1 || Y > 9999) throw new Error('The result is outside the years 1–9999.');
        const out = [['Result', iso(res)], ['Day of the week', WEEKDAYS[weekday(res)]]];
        if (months && ymd(res).d !== ymd(d).d) out.push(['Note', `${MONTHS[ymd(res).m - 1]} ${Y} has no day ${ymd(d).d}, so its last day is used`]);
        return out;
      },
      examples: [
        { in: { date: '2024-01-31', op: 'add', amount: 1, unit: 'months' }, out: [['Result', '2024-02-29'], ['Day of the week', 'Thursday'], ['Note', 'February 2024 has no day 31, so its last day is used']] },
        { in: { date: '2024-02-29', op: 'sub', amount: 1, unit: 'years' }, out: [['Result', '2023-02-28'], ['Day of the week', 'Tuesday'], ['Note', 'February 2023 has no day 29, so its last day is used']] },
        { in: { date: '2024-12-20', op: 'add', amount: 2, unit: 'weeks' }, out: [['Result', '2025-01-03'], ['Day of the week', 'Friday']] },
        { in: { date: '2024-03-01', op: 'sub', amount: 1, unit: 'days' }, out: [['Result', '2024-02-29'], ['Day of the week', 'Thursday']] },
      ],
    },
    {
      id: 'date-business-days', name: 'Business days between', family: 'date',
      desc: 'Weekdays (Mon–Fri) from one date to another, counting both ends, minus any holidays you list.',
      keywords: 'working days weekdays business days count exclude weekends holidays',
      fields: [
        { id: 'start', label: 'Start date', type: 'date', value: TODAY },
        { id: 'end', label: 'End date', type: 'date', value: TODAY },
        { id: 'holidays', label: 'Holidays (YYYY-MM-DD, one per line)', type: 'textarea', value: '' },
      ],
      run(v) {
        let a = parseDate(v.start, 'the start date'), b = parseDate(v.end, 'the end date');
        if (b < a) [a, b] = [b, a];
        if (b - a > 1e6) throw new Error('That range is too long.');
        const hol = holidaySet(v.holidays);
        let work = 0, weekend = 0, off = 0;
        for (let d = a; d <= b; d++) {
          if (isWeekend(d)) weekend++;
          else if (hol.has(d)) off++;
          else work++;
        }
        const out = [['Business days', fmt(work, 0)], ['Weekend days', fmt(weekend, 0)]];
        if (hol.size) out.push(['Holidays on weekdays', String(off)]);
        out.push(['Calendar days (both ends)', fmt(b - a + 1, 0)]);
        return out;
      },
      examples: [
        { in: { start: '2024-01-01', end: '2024-01-31', holidays: '' }, out: [['Business days', '23'], ['Weekend days', '8'], ['Calendar days (both ends)', '31']] },
        { in: { start: '2024-01-31', end: '2024-01-01', holidays: '2024-01-01\n2024-01-06' }, out: [['Business days', '22'], ['Weekend days', '8'], ['Holidays on weekdays', '1'], ['Calendar days (both ends)', '31']] },
        { in: { start: '2024-01-06', end: '2024-01-07', holidays: '' }, out: [['Business days', '0'], ['Weekend days', '2'], ['Calendar days (both ends)', '2']] },
      ],
    },
    {
      id: 'date-age', name: 'Age calculator', family: 'date',
      desc: 'Exact age in years, months and days on a given date, plus the next birthday. A 29 February birthday counts on 1 March in other years.',
      keywords: 'age birthday born how old years months days',
      fields: [
        { id: 'birth', label: 'Date of birth', type: 'date', value: '1990-05-15' },
        { id: 'on', label: 'Age on', type: 'date', value: TODAY },
      ],
      run(v) {
        const b = parseDate(v.birth, 'the date of birth'), on = parseDate(v.on, 'the "age on" date');
        if (on < b) throw new Error('The date of birth is after the "age on" date.');
        const age = diffYMD(b, on), B = ymd(b);
        const anniversary = y => (B.m === 2 && B.d === 29 && !isLeap(y) ? toDays(y, 3, 1) : toDays(y, B.m, B.d));
        let y = ymd(on).y;
        if (anniversary(y) < on) y++;
        const next = anniversary(y), turning = y - B.y;
        return [['Age', ymdText(age)], ['Total days', fmt(on - b, 0)], ['Total weeks', weeksText(on - b)],
          ['Next birthday', next === on ? `Today — turning ${turning}` : `${isoDay(next)}, in ${plural(next - on, 'day')} (turning ${turning})`]];
      },
      examples: [
        { in: { birth: '1990-05-15', on: '2024-03-10' }, out: [['Age', '33 years, 9 months, 24 days'], ['Total days', '12,353'], ['Total weeks', '1764 weeks, 5 days'], ['Next birthday', '2024-05-15 (Wednesday), in 66 days (turning 34)']] },
        { in: { birth: '2000-01-31', on: '2000-03-01' }, match: /^Age: 0 years, 1 month, 1 day\n/ },
        { in: { birth: '2000-02-29', on: '2001-02-28' }, match: /^Age: 0 years, 11 months, 30 days\nTotal days: 365\n[\s\S]*Next birthday: 2001-03-01 \(Thursday\), in 1 day \(turning 1\)$/ },
      ],
    },
    {
      id: 'date-weekday', name: 'Day of the week', family: 'date',
      desc: 'Which weekday any date falls on.',
      keywords: 'weekday day of week what day monday',
      fields: [{ id: 'date', label: 'Date', type: 'date', value: TODAY }],
      run(v) {
        const d = parseDate(v.date, 'the date');
        return [['Day of the week', WEEKDAYS[weekday(d)]], ['ISO weekday', `${isoWeekday(d)} (Monday = 1)`], ['Written out', longDate(d)]];
      },
      examples: [
        { in: { date: '2000-01-01' }, out: [['Day of the week', 'Saturday'], ['ISO weekday', '6 (Monday = 1)'], ['Written out', 'Saturday, 1 January 2000']] },
        { in: { date: '1969-07-20' }, out: [['Day of the week', 'Sunday'], ['ISO weekday', '7 (Monday = 1)'], ['Written out', 'Sunday, 20 July 1969']] },
      ],
    },
    {
      id: 'date-week-number', name: 'ISO week number', icon: '#', family: 'date',
      desc: 'ISO 8601 week number and week-date (weeks start Monday; week 1 contains the year\'s first Thursday).',
      keywords: 'week number iso 8601 calendar week kw',
      fields: [{ id: 'date', label: 'Date', type: 'date', value: TODAY }],
      run(v) {
        const d = parseDate(v.date, 'the date');
        const { year, week } = isoWeek(d);
        const weeks = isoWeek(toDays(year, 12, 28)).week;
        return [['ISO week', `${year}-W${pad2(week)}`], ['ISO week date', `${year}-W${pad2(week)}-${isoWeekday(d)}`], [`Weeks in ISO year ${year}`, String(weeks)]];
      },
      examples: [
        { in: { date: '2021-01-03' }, out: [['ISO week', '2020-W53'], ['ISO week date', '2020-W53-7'], ['Weeks in ISO year 2020', '53']] },
        { in: { date: '2024-12-30' }, out: [['ISO week', '2025-W01'], ['ISO week date', '2025-W01-1'], ['Weeks in ISO year 2025', '52']] },
        { in: { date: '2026-01-01' }, out: [['ISO week', '2026-W01'], ['ISO week date', '2026-W01-4'], ['Weeks in ISO year 2026', '53']] },
      ],
    },
    {
      id: 'date-day-of-year', name: 'Day of the year', family: 'date',
      desc: 'Day number within the year (1–366), days left, and the quarter.',
      keywords: 'day of year ordinal date julian quarter days left remaining',
      fields: [{ id: 'date', label: 'Date', type: 'date', value: TODAY }],
      run(v) {
        const d = parseDate(v.date, 'the date');
        const { y, m } = ymd(d);
        const len = isLeap(y) ? 366 : 365, n = d - toDays(y, 1, 1) + 1;
        return [['Day of the year', String(n)], ['Days left in the year', String(len - n)], ['Quarter', `Q${Math.ceil(m / 3)}`], ['Year length', `${len} days${len === 366 ? ' (leap year)' : ''}`]];
      },
      examples: [
        { in: { date: '2024-12-31' }, out: [['Day of the year', '366'], ['Days left in the year', '0'], ['Quarter', 'Q4'], ['Year length', '366 days (leap year)']] },
        { in: { date: '2023-03-01' }, out: [['Day of the year', '60'], ['Days left in the year', '305'], ['Quarter', 'Q1'], ['Year length', '365 days']] },
      ],
    },
    {
      id: 'date-countdown', name: 'Countdown to a date', family: 'date',
      desc: 'Days (and weeks) from one date until another — or how long ago it was.',
      keywords: 'countdown days until how long until event since ago',
      fields: [
        { id: 'target', label: 'Event date', type: 'date', value: `${Number(TODAY.slice(0, 4)) + 1}-01-01` },
        { id: 'from', label: 'Counting from', type: 'date', value: TODAY },
      ],
      run(v) {
        const t = parseDate(v.target, 'the event date'), f = parseDate(v.from, 'the "counting from" date');
        const n = t - f;
        if (n === 0) return [['Countdown', 'It\'s today!'], ['Event day', WEEKDAYS[weekday(t)]]];
        return [['Countdown', n > 0 ? `${plural(n, 'day')} to go` : `${plural(-n, 'day')} ago`], ['Weeks', weeksText(Math.abs(n))], ['Event day', isoDay(t)]];
      },
      examples: [
        { in: { target: '2024-12-25', from: '2024-12-01' }, out: [['Countdown', '24 days to go'], ['Weeks', '3 weeks, 3 days'], ['Event day', '2024-12-25 (Wednesday)']] },
        { in: { target: '2024-01-01', from: '2024-01-15' }, out: [['Countdown', '14 days ago'], ['Weeks', '2 weeks'], ['Event day', '2024-01-01 (Monday)']] },
        { in: { target: '2030-06-01', from: '2030-06-01' }, out: [['Countdown', 'It\'s today!'], ['Event day', 'Saturday']] },
      ],
    },
    {
      id: 'date-utc-offset', name: 'Time zone offset converter', family: 'date',
      desc: 'Convert a date and time between two UTC offsets (e.g. -05:00 to +09:00). Uses the offsets you give — no daylight-saving database.',
      keywords: 'timezone time zone utc gmt offset convert meeting',
      fields: [
        { id: 'date', label: 'Date', type: 'date', value: TODAY },
        { id: 'time', label: 'Time', type: 'time', value: '09:00' },
        { id: 'from', label: 'From UTC offset (e.g. -05:00)', type: 'text', value: '-05:00' },
        { id: 'to', label: 'To UTC offset (e.g. +09:00)', type: 'text', value: '+09:00' },
      ],
      run(v) {
        const d = parseDate(v.date, 'the date'), t = parseClock(v.time, 'the time');
        const from = parseOffset(v.from, 'the "from" offset'), to = parseOffset(v.to, 'the "to" offset');
        const utc = d * 1440 + t - from, out = utc + to;
        const stamp = m => `${iso(Math.floor(m / 1440))} ${clock(m)}`;
        const diff = to - from;
        return [['Converted', `${stamp(out)} (UTC${offsetText(to)})`], ['Same moment in UTC', stamp(utc)], ['Difference', (diff < 0 ? '-' : '+') + hm(Math.abs(diff))]];
      },
      examples: [
        { in: { date: '2024-03-10', time: '09:00', from: '-05:00', to: '+09:00' }, out: [['Converted', '2024-03-10 23:00 (UTC+09:00)'], ['Same moment in UTC', '2024-03-10 14:00'], ['Difference', '+14:00']] },
        { in: { date: '2024-12-31', time: '22:00', from: 'UTC', to: '+5:30' }, out: [['Converted', '2025-01-01 03:30 (UTC+05:30)'], ['Same moment in UTC', '2024-12-31 22:00'], ['Difference', '+5:30']] },
        { in: { date: '2024-01-01', time: '01:00', from: '+10', to: '-3' }, out: [['Converted', '2023-12-31 12:00 (UTC-03:00)'], ['Same moment in UTC', '2023-12-31 15:00'], ['Difference', '-13:00']] },
      ],
    },
    {
      id: 'date-duration-sum', name: 'Add up durations', family: 'date',
      desc: 'Total a list of h:mm (or h:mm:ss) durations; start a line with - to subtract it.',
      keywords: 'duration add hours minutes sum total time h:mm',
      fields: [{ id: 'items', label: 'Durations, one per line (h:mm or h:mm:ss)', type: 'textarea', value: '1:30\n2:45\n-0:15' }],
      run(v) {
        let total = 0, secs = false;
        lines(v.items).forEach((line, k) => {
          const m = /^([+\-−]?)\s*(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(line);
          if (!m || +m[3] > 59 || (m[4] && +m[4] > 59)) throw new Error(`Line ${k + 1}: write durations as h:mm or h:mm:ss.`);
          if (m[4] !== undefined) secs = true;
          total += (m[1] && m[1] !== '+' ? -1 : 1) * (+m[2] * 3600 + +m[3] * 60 + +(m[4] || 0));
        });
        const a = Math.abs(total), sign = total < 0 ? '-' : '';
        const text = sign + (secs ? `${Math.floor(a / 3600)}:${pad2(Math.floor(a % 3600 / 60))}:${pad2(a % 60)}` : hm(a / 60));
        return [['Total', text], ['Decimal hours', fmt(total / 3600)], ['Total minutes', fmt(total / 60, secs && total % 60 ? 2 : 0)]];
      },
      examples: [
        { in: { items: '1:30\n2:45\n-0:15' }, out: [['Total', '4:00'], ['Decimal hours', '4.00'], ['Total minutes', '240']] },
        { in: { items: '0:45:30\n0:20:45' }, out: [['Total', '1:06:15'], ['Decimal hours', '1.10'], ['Total minutes', '66.25']] },
        { in: { items: '0:30\n-2:00' }, out: [['Total', '-1:30'], ['Decimal hours', '-1.50'], ['Total minutes', '-90']] },
      ],
    },
    {
      id: 'date-time-diff', name: 'Time between two clock times', family: 'date',
      desc: 'Hours worked between clock-in and clock-out, minus a break. An end time earlier than the start means it ended the next day.',
      keywords: 'time difference clock in out shift hours worked overnight',
      fields: [
        { id: 'start', label: 'Start', type: 'time', value: '09:00' },
        { id: 'end', label: 'End', type: 'time', value: '17:30' },
        { id: 'break', label: 'Break (minutes)', type: 'number', value: 30, min: 0 },
      ],
      run(v) {
        const s = parseClock(v.start, 'the start time'), e = parseClock(v.end, 'the end time');
        const br = need(v.break, 'the break minutes (0 for none)', { min: 0 });
        const span = e >= s ? e - s : e + 1440 - s;
        if (br > span) throw new Error('The break is longer than the time between start and end.');
        const out = [['Duration', hm(span - br)], ['Decimal hours', fmt((span - br) / 60)]];
        if (e < s) out.push(['Note', 'Overnight — the end time is on the next day']);
        return out;
      },
      examples: [
        { in: { start: '09:00', end: '17:30', break: 30 }, out: [['Duration', '8:00'], ['Decimal hours', '8.00']] },
        { in: { start: '22:00', end: '06:30', break: 0 }, out: [['Duration', '8:30'], ['Decimal hours', '8.50'], ['Note', 'Overnight — the end time is on the next day']] },
      ],
    },
    {
      id: 'date-timesheet', name: 'Timesheet hours', family: 'date',
      desc: 'Total hours from clock-in/clock-out lines like "Mon 09:00-17:30 30" (break minutes optional); overnight shifts are handled.',
      keywords: 'timesheet hours worked shifts clock in out weekly total pay',
      fields: [
        { id: 'shifts', label: 'Shifts — "[label] HH:MM-HH:MM [break minutes]", one per line', type: 'textarea', value: 'Mon 09:00-17:30 30\nTue 22:00-06:00' },
        { id: 'rate', label: 'Hourly rate (optional)', type: 'number', value: '', min: 0 },
      ],
      run(v) {
        const rate = maybe(v.rate, 'the hourly rate', { min: 0 });
        let total = 0;
        const rows = lines(v.shifts).map((line, k) => {
          const m = /^(.*?)(\d{1,2}:\d{2})\s*(?:-|–|to)\s*(\d{1,2}:\d{2})(?:\s+(\d+)\s*(?:m|min|mins|minutes)?)?$/i.exec(line);
          if (!m) throw new Error(`Line ${k + 1}: write it like "Mon 09:00-17:30 30".`);
          const s = parseClock(m[2], `the start time on line ${k + 1}`), e = parseClock(m[3], `the end time on line ${k + 1}`);
          const br = m[4] ? +m[4] : 0, span = e >= s ? e - s : e + 1440 - s;
          if (br > span) throw new Error(`Line ${k + 1}: the break is longer than the shift.`);
          total += span - br;
          return [m[1].trim() || `Shift ${k + 1}`, `${m[2]}–${m[3]}${e < s ? ' (overnight)' : ''}${br ? ` − ${br} min` : ''} = ${hm(span - br)}`];
        });
        if (!rows.length) throw new Error('Enter at least one shift.');
        rows.push(['Total', hm(total)], ['Decimal hours', fmt(total / 60)]);
        if (rate !== null) rows.push(['Pay', money(total / 60 * rate)]);
        return rows;
      },
      examples: [
        { in: { shifts: 'Mon 09:00-17:30 30\nTue 22:00-06:00', rate: 20 }, out: [['Mon', '09:00–17:30 − 30 min = 8:00'], ['Tue', '22:00–06:00 (overnight) = 8:00'], ['Total', '16:00'], ['Decimal hours', '16.00'], ['Pay', '320.00']] },
        { in: { shifts: '08:15 to 12:40\n13:10-17:05 5 min', rate: '' }, out: [['Shift 1', '08:15–12:40 = 4:25'], ['Shift 2', '13:10–17:05 − 5 min = 3:50'], ['Total', '8:15'], ['Decimal hours', '8.25']] },
      ],
    },
    {
      id: 'date-leap-year', name: 'Leap year check', family: 'date',
      desc: 'Whether a year is a leap year in the Gregorian calendar, and why.',
      keywords: 'leap year february 29 366 days',
      fields: [{ id: 'year', label: 'Year', type: 'number', value: Number(TODAY.slice(0, 4)), min: 1 }],
      run(v) {
        const y = need(v.year, 'the year', { min: 1, max: 99999, int: true });
        const why = y % 400 === 0 ? `${y} is divisible by 400` : y % 100 === 0 ? `${y} is divisible by 100 but not by 400` : y % 4 === 0 ? `${y} is divisible by 4 and not by 100` : `${y} is not divisible by 4`;
        let next = y + 1;
        while (!isLeap(next)) next++;
        return [['Leap year', isLeap(y) ? 'Yes' : 'No'], ['Why', why], ['Days in the year', isLeap(y) ? '366' : '365'], ['Next leap year', String(next)]];
      },
      examples: [
        { in: { year: 2024 }, out: [['Leap year', 'Yes'], ['Why', '2024 is divisible by 4 and not by 100'], ['Days in the year', '366'], ['Next leap year', '2028']] },
        { in: { year: 1900 }, out: [['Leap year', 'No'], ['Why', '1900 is divisible by 100 but not by 400'], ['Days in the year', '365'], ['Next leap year', '1904']] },
        { in: { year: 2000 }, out: [['Leap year', 'Yes'], ['Why', '2000 is divisible by 400'], ['Days in the year', '366'], ['Next leap year', '2004']] },
        { in: { year: 2097 }, out: [['Leap year', 'No'], ['Why', '2097 is not divisible by 4'], ['Days in the year', '365'], ['Next leap year', '2104']] },
      ],
    },
    {
      id: 'date-month-calendar', name: 'Month calendar', family: 'date',
      desc: 'A plain-text calendar for any month, with weeks starting Monday or Sunday.',
      keywords: 'calendar month print text grid',
      fields: [
        { id: 'year', label: 'Year', type: 'number', value: Number(TODAY.slice(0, 4)), min: 1 },
        { id: 'month', label: 'Month', type: 'select', value: String(Number(TODAY.slice(5, 7))), options: MONTHS.map((m, k) => [String(k + 1), m]) },
        { id: 'start', label: 'Weeks start on', type: 'select', value: 'mon', options: [['mon', 'Monday'], ['sun', 'Sunday']] },
      ],
      run(v) {
        const y = need(v.year, 'the year', { min: 1, max: 9999, int: true }), m = Number(v.month);
        const sun = v.start === 'sun';
        const first = toDays(y, m, 1);
        const lead = sun ? weekday(first) : isoWeekday(first) - 1;
        const cells = Array(lead).fill('  ');
        for (let d = 1; d <= dim(y, m); d++) cells.push(String(d).padStart(2, ' '));
        const out = [`${MONTHS[m - 1]} ${y}`, sun ? 'Su Mo Tu We Th Fr Sa' : 'Mo Tu We Th Fr Sa Su'];
        for (let k = 0; k < cells.length; k += 7) out.push(cells.slice(k, k + 7).join(' ').trimEnd());
        return out.join('\n');
      },
      examples: [
        { in: { year: 2024, month: '2', start: 'mon' }, out: 'February 2024\nMo Tu We Th Fr Sa Su\n          1  2  3  4\n 5  6  7  8  9 10 11\n12 13 14 15 16 17 18\n19 20 21 22 23 24 25\n26 27 28 29' },
        { in: { year: 2026, month: '11', start: 'sun' }, out: 'November 2026\nSu Mo Tu We Th Fr Sa\n 1  2  3  4  5  6  7\n 8  9 10 11 12 13 14\n15 16 17 18 19 20 21\n22 23 24 25 26 27 28\n29 30' },
      ],
    },
    {
      id: 'date-easter', name: 'Easter date', family: 'date',
      desc: 'Western (Gregorian) and Orthodox Easter for a year, with the feasts that follow from it.',
      keywords: 'easter computus good friday pentecost ash wednesday orthodox',
      fields: [{ id: 'year', label: 'Year', type: 'number', value: Number(TODAY.slice(0, 4)), min: 1583, max: 4099 }],
      run(v) {
        const Y = need(v.year, 'the year', { min: 1583, max: 4099, int: true });
        // Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
        const a = Y % 19, b = Math.floor(Y / 100), c = Y % 100, d = Math.floor(b / 4), e = b % 4;
        const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
        const easter = toDays(Y, month, day);
        // Meeus's Julian algorithm, shifted into the Gregorian calendar.
        const jd = (19 * (Y % 19) + 15) % 30, je = (2 * (Y % 4) + 4 * (Y % 7) - jd + 34) % 7;
        const jm = Math.floor((jd + je + 114) / 31), jday = ((jd + je + 114) % 31) + 1;
        const orthodox = toDays(Y, jm, jday) + Math.floor(Y / 100) - Math.floor(Y / 400) - 2;
        return [['Easter Sunday', iso(easter)], ['Ash Wednesday', iso(easter - 46)], ['Good Friday', iso(easter - 2)], ['Ascension Day', iso(easter + 39)], ['Pentecost', iso(easter + 49)], ['Orthodox Easter', iso(orthodox)]];
      },
      examples: [
        { in: { year: 2024 }, out: [['Easter Sunday', '2024-03-31'], ['Ash Wednesday', '2024-02-14'], ['Good Friday', '2024-03-29'], ['Ascension Day', '2024-05-09'], ['Pentecost', '2024-05-19'], ['Orthodox Easter', '2024-05-05']] },
        { in: { year: 2025 }, match: /^Easter Sunday: 2025-04-20\n[\s\S]*Orthodox Easter: 2025-04-20$/ },
        { in: { year: 2019 }, match: /^Easter Sunday: 2019-04-21\n[\s\S]*Orthodox Easter: 2019-04-28$/ },
      ],
    },
    {
      id: 'date-julian-day', name: 'Julian day number', family: 'date',
      desc: 'Julian Day Number, Julian Date and Modified Julian Date for a UTC date and time (proleptic Gregorian calendar).',
      keywords: 'julian day jd jdn mjd astronomy',
      fields: [
        { id: 'date', label: 'Date (UTC)', type: 'date', value: TODAY },
        { id: 'time', label: 'Time (UTC)', type: 'time', value: '00:00' },
      ],
      run(v) {
        const d = parseDate(v.date, 'the date'), t = parseClock(v.time, 'the time');
        const jd = d + 2440587.5 + t / 1440; // 1970-01-01 00:00 UTC is JD 2440587.5
        return [['Julian Day Number', String(d + 2440588)], ['Julian Date', fmt(jd, 5).replace(/,/g, '')], ['Modified Julian Date', fmt(jd - 2400000.5, 5).replace(/,/g, '')]];
      },
      examples: [
        { in: { date: '2000-01-01', time: '12:00' }, out: [['Julian Day Number', '2451545'], ['Julian Date', '2451545.00000'], ['Modified Julian Date', '51544.50000']] },
        { in: { date: '1858-11-17', time: '00:00' }, out: [['Julian Day Number', '2400001'], ['Julian Date', '2400000.50000'], ['Modified Julian Date', '0.00000']] },
      ],
    },
    // ----------------------------------------------------------- Health
    {
      id: 'health-bmi', name: 'BMI', family: 'health',
      desc: 'Body mass index with the WHO category, where you sit inside it, the healthy weight range for your height, and the measures that work better than BMI.',
      keywords: 'bmi body mass index weight height obese overweight waist prime ponderal bsa',
      fields: [
        { id: 'units', label: 'Units', type: 'select', value: 'metric', options: UNITS },
        { id: 'weight', label: 'Weight (kg or lb)', type: 'number', value: 70, min: 0 },
        { id: 'height', label: 'Height (cm or inches)', type: 'number', value: 175, min: 0 },
        { id: 'waist', label: 'Waist (optional, cm or inches)', type: 'number', value: '', min: 0 },
        { id: 'age', label: 'Age (optional)', type: 'number', value: '', min: 0, max: 120 },
        { id: 'ethnicity', label: 'Category thresholds', type: 'select', value: 'who',
          options: [['who', 'WHO general'], ['asian', 'Asian (lower thresholds)']] },
      ],
      run(v) {
        const kg = kgOf(need(v.weight, 'your weight', { gt: 0, max: 1500 }), v.units);
        const cm = cmOf(need(v.height, 'your height', { gt: 0, max: 300 }), v.units);
        const m = cm / 100;
        const bmi = round(kg / (m * m), 1);
        const imperial = v.units === 'imperial';
        const unit = imperial ? 'lb' : 'kg';
        const lenUnit = imperial ? 'in' : 'cm';
        const conv = x => (imperial ? x / LB : x);
        const convLen = x => (imperial ? x / 2.54 : x);

        // WHO thresholds, and the lower set used across much of Asia where the
        // same BMI carries higher metabolic risk.
        const asian = v.ethnicity === 'asian';
        const BANDS = asian
          ? [[0, 18.5, 'Underweight'], [18.5, 23, 'Healthy weight'], [23, 27.5, 'Overweight'], [27.5, 32.5, 'Obese (class I)'], [32.5, 37.5, 'Obese (class II)'], [37.5, Infinity, 'Obese (class III)']]
          : [[0, 18.5, 'Underweight'], [18.5, 25, 'Healthy weight'], [25, 30, 'Overweight'], [30, 35, 'Obese (class I)'], [35, 40, 'Obese (class II)'], [40, Infinity, 'Obese (class III)']];
        const band = BANDS.find(([lo, hi]) => bmi >= lo && bmi < hi) || BANDS[BANDS.length - 1];
        const healthyLo = BANDS[1][0], healthyHi = BANDS[1][1];

        const rows = [
          ['BMI', fmt(bmi, 1)],
          ['Category', band[2]],
          ['This band', band[1] === Infinity ? `${fmt(band[0], 1)} and above` : `${fmt(band[0], 1)} – ${fmt(band[1] - 0.1, 1)}`],
          ['Healthy weight for your height', `${fmt(conv(healthyLo * m * m), 1)}–${fmt(conv((healthyHi - 0.1) * m * m), 1)} ${unit}`],
        ];

        // How far from the nearest healthy edge, which is the number people
        // actually want when they are outside the band.
        if (bmi < healthyLo) {
          rows.push(['To reach healthy', `gain ${fmt(conv(healthyLo * m * m - kg), 1)} ${unit}`]);
        } else if (bmi >= healthyHi) {
          rows.push(['To reach healthy', `lose ${fmt(conv(kg - (healthyHi - 0.1) * m * m), 1)} ${unit}`]);
        }

        rows.push(['BMI Prime', fmt(bmi / healthyHi, 2) + (bmi / healthyHi > 1 ? ' (above the healthy ceiling)' : ' (at or below the ceiling)')]);
        rows.push(['Ponderal index', fmt(kg / (m * m * m), 1) + ' kg/m³ — scales better at very tall or short heights']);
        // Du Bois, the formula most drug dosing uses.
        rows.push(['Body surface area', fmt(0.007184 * Math.pow(cm, 0.725) * Math.pow(kg, 0.425), 2) + ' m² (Du Bois)']);

        const waistRaw = Number(v.waist);
        if (Number.isFinite(waistRaw) && waistRaw > 0) {
          const waistCm = cmOf(waistRaw, v.units);
          const whtr = waistCm / cm;
          const whtrNote = whtr < 0.4 ? 'below the healthy range' : whtr < 0.5 ? 'healthy' : whtr < 0.6 ? 'increased risk' : 'high risk';
          rows.push(['Waist', `${fmt(convLen(waistCm), 1)} ${lenUnit}`]);
          rows.push(['Waist-to-height', `${fmt(whtr, 2)} — ${whtrNote}`]);
          rows.push(['Keep waist under', `${fmt(convLen(cm * 0.5), 1)} ${lenUnit} (half your height)`]);
        }

        const age = Number(v.age);
        if (Number.isFinite(age) && age > 0 && age < 20) {
          rows.push(['Note', 'Under 20, adult BMI categories do not apply — children and teenagers are read against age-and-sex percentile charts instead.']);
        } else if (Number.isFinite(age) && age >= 65) {
          rows.push(['Note', 'Over 65, a slightly higher BMI is associated with better outcomes; being underweight carries more risk than being mildly overweight.']);
        }
        return rows;
      },
      details: [
        { title: 'What BMI is', text: 'Weight divided by height squared. Devised in the 1830s to describe populations, not individuals — it is a screening number, and it cannot tell muscle from fat.' },
        { title: 'The categories', rows: [
          ['under 18.5', 'Underweight'],
          ['18.5 – 24.9', 'Healthy weight'],
          ['25 – 29.9', 'Overweight'],
          ['30 – 34.9', 'Obese, class I'],
          ['35 – 39.9', 'Obese, class II'],
          ['40 and over', 'Obese, class III'],
        ] },
        { title: 'Where it misleads', rows: [
          ['Muscle', 'A trained athlete routinely reads "obese" on BMI alone.'],
          ['Age', 'Muscle is lost with age, so the same BMI hides more fat at 70 than at 30.'],
          ['Ancestry', 'Risk rises at lower BMI across much of Asia — hence the second threshold set.'],
          ['Pregnancy', 'BMI does not apply.'],
          ['Children', 'Under 20 uses percentile charts, not these bands.'],
        ] },
        { title: 'Waist beats BMI', text: 'Waist-to-height ratio predicts metabolic risk better than BMI, because it measures where the weight sits. The rule is simple: keep your waist under half your height.' },
        { title: 'Not medical advice', text: 'A number from a formula. It cannot diagnose anything, and it is no substitute for asking a doctor.' },
      ],
      examples: [
        { in: { units: 'metric', weight: 70, height: 175, waist: '', age: '', ethnicity: 'who' }, match: /BMI: 22\.9[\s\S]*Healthy weight/ },
        { in: { units: 'imperial', weight: 180, height: 70, waist: '', age: '', ethnicity: 'who' }, match: /Overweight/ },
        { in: { units: 'metric', weight: 70, height: 175, waist: 80, age: '', ethnicity: 'who' }, match: /Waist-to-height: 0\.46/ },
        // 24.5 is healthy on the WHO scale and overweight on the Asian one —
        // which is the whole reason the second threshold set exists.
        { in: { units: 'metric', weight: 75, height: 175, waist: '', age: '', ethnicity: 'asian' }, match: /Overweight/ },
        { in: { units: 'metric', weight: 75, height: 175, waist: '', age: '', ethnicity: 'who' }, match: /Healthy weight/ },
      ],
    },
    {
      id: 'health-bmr', name: 'BMR (Mifflin-St Jeor)', family: 'health',
      desc: 'Estimated calories your body burns at rest, by the Mifflin-St Jeor equation. An estimate, not medical advice.',
      keywords: 'bmr basal metabolic rate calories resting mifflin',
      fields: [
        { id: 'sex', label: 'Sex', type: 'select', value: 'male', options: SEX },
        { id: 'age', label: 'Age (years)', type: 'number', value: 30, min: 0 },
        { id: 'units', label: 'Units', type: 'select', value: 'metric', options: UNITS },
        { id: 'weight', label: 'Weight (kg or lb)', type: 'number', value: 70, min: 0 },
        { id: 'height', label: 'Height (cm or inches)', type: 'number', value: 175, min: 0 },
      ],
      run(v) { return [['BMR', `${fmt(bmr(v), 0)} kcal/day`]]; },
      examples: [
        { in: { sex: 'male', age: 30, units: 'metric', weight: 70, height: 175 }, out: [['BMR', '1,649 kcal/day']] },
        { in: { sex: 'female', age: 30, units: 'metric', weight: 70, height: 175 }, out: [['BMR', '1,483 kcal/day']] },
      ],
    },
    {
      id: 'health-tdee', name: 'Daily calorie needs (TDEE)', family: 'health',
      desc: 'Estimated total daily energy use: Mifflin-St Jeor BMR × an activity factor, with simple targets to lose or gain. An estimate, not medical advice.',
      keywords: 'tdee calories maintenance diet cut bulk activity',
      fields: [
        { id: 'sex', label: 'Sex', type: 'select', value: 'male', options: SEX },
        { id: 'age', label: 'Age (years)', type: 'number', value: 30, min: 0 },
        { id: 'units', label: 'Units', type: 'select', value: 'metric', options: UNITS },
        { id: 'weight', label: 'Weight (kg or lb)', type: 'number', value: 70, min: 0 },
        { id: 'height', label: 'Height (cm or inches)', type: 'number', value: 175, min: 0 },
        { id: 'activity', label: 'Activity', type: 'select', value: '1.55', options: [['1.2', 'Sedentary (desk job, little exercise)'], ['1.375', 'Light (exercise 1–3 days/week)'], ['1.55', 'Moderate (3–5 days/week)'], ['1.725', 'Very active (6–7 days/week)'], ['1.9', 'Extra active (physical job + training)']] },
      ],
      run(v) {
        const b = bmr(v), t = b * Number(v.activity);
        return [['BMR', `${fmt(b, 0)} kcal/day`], ['Maintenance (TDEE)', `${fmt(t, 0)} kcal/day`], ['Lose about 0.5 kg / 1 lb a week', `${fmt(t - 500, 0)} kcal/day`], ['Gain slowly', `${fmt(t + 300, 0)} kcal/day`]];
      },
      examples: [{ in: { sex: 'male', age: 30, units: 'metric', weight: 70, height: 175, activity: '1.55' }, out: [['BMR', '1,649 kcal/day'], ['Maintenance (TDEE)', '2,556 kcal/day'], ['Lose about 0.5 kg / 1 lb a week', '2,056 kcal/day'], ['Gain slowly', '2,856 kcal/day']] }],
    },
    {
      id: 'health-water', name: 'Daily water intake', family: 'health',
      desc: 'Rough daily fluid guideline: 35 ml per kg of body weight plus 350 ml per 30 minutes of exercise. An estimate, not medical advice — needs vary with climate and health.',
      keywords: 'water hydration drink fluid intake litres cups',
      fields: [
        { id: 'units', label: 'Units', type: 'select', value: 'metric', options: [['metric', 'kg'], ['imperial', 'lb']] },
        { id: 'weight', label: 'Weight', type: 'number', value: 70, min: 0 },
        { id: 'exercise', label: 'Exercise (minutes per day)', type: 'number', value: 30, min: 0 },
      ],
      run(v) {
        const kg = kgOf(need(v.weight, 'your weight', { gt: 0, max: 1500 }), v.units);
        const ex = need(v.exercise, 'the exercise minutes (0 for none)', { min: 0, max: 1440 });
        const ml = kg * 35 + ex / 30 * 350;
        return [['Daily water (estimate)', `${fmt(ml / 1000)} L`], ['In US cups (8 fl oz)', fmt(ml / 236.5882365, 1)], ['In US fl oz', fmt(ml / 29.5735295625, 1)]];
      },
      examples: [{ in: { units: 'metric', weight: 70, exercise: 30 }, out: [['Daily water (estimate)', '2.80 L'], ['In US cups (8 fl oz)', '11.8'], ['In US fl oz', '94.7']] }],
    },
    {
      id: 'health-ideal-weight', name: 'Ideal body weight', family: 'health',
      desc: 'Ideal weight by the Devine, Robinson, Miller and Hamwi formulas (designed for adults over 5 ft). Estimates, not medical advice.',
      keywords: 'ideal body weight ibw devine robinson miller hamwi',
      fields: [
        { id: 'sex', label: 'Sex', type: 'select', value: 'male', options: SEX },
        { id: 'units', label: 'Units', type: 'select', value: 'metric', options: [['metric', 'cm → kg'], ['imperial', 'inches → lb']] },
        { id: 'height', label: 'Height (cm or inches)', type: 'number', value: 177.8, min: 0 },
      ],
      run(v) {
        const inches = cmOf(need(v.height, 'your height', { gt: 0, max: 300 }), v.units) / INCH;
        const over = inches - 60, male = v.sex === 'male';
        const f = { Devine: male ? [50, 2.3] : [45.5, 2.3], Robinson: male ? [52, 1.9] : [49, 1.7], Miller: male ? [56.2, 1.41] : [53.1, 1.36], Hamwi: male ? [48, 2.7] : [45.5, 2.2] };
        const out = Object.entries(f).map(([name, [base, per]]) => {
          const kg = base + per * over;
          return [name, v.units === 'imperial' ? `${fmt(kg / LB, 1)} lb` : `${fmt(kg, 1)} kg`];
        });
        if (over < 0) out.push(['Note', 'These formulas were made for heights over 5 ft (152.4 cm); below that they are unreliable.']);
        return out;
      },
      examples: [
        { in: { sex: 'male', units: 'metric', height: 177.8 }, out: [['Devine', '73.0 kg'], ['Robinson', '71.0 kg'], ['Miller', '70.3 kg'], ['Hamwi', '75.0 kg']] },
        { in: { sex: 'female', units: 'imperial', height: 64 }, out: [['Devine', '120.6 lb'], ['Robinson', '123.0 lb'], ['Miller', '129.1 lb'], ['Hamwi', '119.7 lb']] },
      ],
    },
    {
      id: 'health-body-fat', name: 'Body fat % (US Navy)', family: 'health',
      desc: 'Body fat estimate from tape measurements using the US Navy formula. An estimate, not medical advice.',
      keywords: 'body fat percentage navy method waist neck hip',
      fields: [
        { id: 'sex', label: 'Sex', type: 'select', value: 'male', options: SEX },
        { id: 'units', label: 'Units', type: 'select', value: 'metric', options: [['metric', 'cm (kg)'], ['imperial', 'inches (lb)']] },
        { id: 'height', label: 'Height', type: 'number', value: 178, min: 0 },
        { id: 'neck', label: 'Neck', type: 'number', value: 38, min: 0 },
        { id: 'waist', label: 'Waist (at the navel for men, narrowest point for women)', type: 'number', value: 85, min: 0 },
        { id: 'hip', label: 'Hips (women only)', type: 'number', value: '', min: 0 },
        { id: 'weight', label: 'Weight (optional, for fat mass)', type: 'number', value: '', min: 0 },
      ],
      run(v) {
        const cm = x => cmOf(x, v.units);
        const h = cm(need(v.height, 'your height', { gt: 0 })), neck = cm(need(v.neck, 'your neck measurement', { gt: 0 })), waist = cm(need(v.waist, 'your waist measurement', { gt: 0 }));
        const male = v.sex === 'male';
        let bf;
        if (male) {
          if (waist <= neck) throw new Error('The waist must be larger than the neck for this formula.');
          bf = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(h)) - 450;
        } else {
          const hip = cm(need(v.hip, 'your hip measurement', { gt: 0 }));
          if (waist + hip <= neck) throw new Error('Waist plus hips must be larger than the neck for this formula.');
          bf = 495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.221 * Math.log10(h)) - 450;
        }
        if (!(bf > 0 && bf < 75)) throw new Error('These measurements give an impossible result — please check them.');
        const bands = male ? [[6, 'Essential fat'], [14, 'Athletic'], [18, 'Fit'], [25, 'Average'], [Infinity, 'Above average (obese range)']] : [[14, 'Essential fat'], [21, 'Athletic'], [25, 'Fit'], [32, 'Average'], [Infinity, 'Above average (obese range)']];
        const out = [['Body fat', pct(bf, 1)], ['Category (ACE)', bands.find(([lim]) => round(bf, 1) < lim)[1]]];
        const w = maybe(v.weight, 'your weight', { gt: 0 });
        if (w !== null) { const u = v.units === 'imperial' ? 'lb' : 'kg'; out.push(['Fat mass', `${fmt(w * bf / 100, 1)} ${u}`], ['Lean mass', `${fmt(w * (1 - bf / 100), 1)} ${u}`]); }
        return out;
      },
      examples: [
        { in: { sex: 'male', units: 'metric', height: 178, neck: 38, waist: 85, hip: '', weight: 80 }, out: [['Body fat', '16.4%'], ['Category (ACE)', 'Fit'], ['Fat mass', '13.1 kg'], ['Lean mass', '66.9 kg']] },
        { in: { sex: 'female', units: 'metric', height: 165, neck: 34, waist: 76, hip: 98, weight: '' }, out: [['Body fat', '28.4%'], ['Category (ACE)', 'Average']] },
      ],
    },
    {
      id: 'health-hr-zones', name: 'Heart-rate zones', family: 'health',
      desc: 'Five training zones from max heart rate (220 − age); with a resting heart rate it uses the Karvonen (heart-rate reserve) method. Estimates, not medical advice.',
      keywords: 'heart rate zones training karvonen max hr bpm cardio',
      fields: [
        { id: 'age', label: 'Age (years)', type: 'number', value: 30, min: 0 },
        { id: 'resting', label: 'Resting heart rate (optional)', type: 'number', value: 60, min: 0 },
      ],
      run(v) {
        const age = need(v.age, 'your age', { gt: 0, max: 120 });
        const rest = maybe(v.resting, 'the resting heart rate', { min: 30, max: 120 });
        const max = 220 - age;
        if (rest !== null && rest >= max) throw new Error('The resting heart rate must be below the maximum.');
        const at = p => Math.round(rest === null ? max * p : rest + (max - rest) * p);
        const names = ['very light', 'light', 'moderate', 'hard', 'maximum'];
        return [['Max heart rate (220 − age)', `${fmt(max, 0)} bpm`], ['Method', rest === null ? '% of max heart rate' : `Karvonen (resting ${rest} bpm)`],
          ...names.map((n, k) => [`Zone ${k + 1} · ${50 + 10 * k}–${60 + 10 * k}% · ${n}`, `${at(0.5 + k / 10)}–${at(0.6 + k / 10)} bpm`])];
      },
      examples: [
        { in: { age: 30, resting: 60 }, out: [['Max heart rate (220 − age)', '190 bpm'], ['Method', 'Karvonen (resting 60 bpm)'], ['Zone 1 · 50–60% · very light', '125–138 bpm'], ['Zone 2 · 60–70% · light', '138–151 bpm'], ['Zone 3 · 70–80% · moderate', '151–164 bpm'], ['Zone 4 · 80–90% · hard', '164–177 bpm'], ['Zone 5 · 90–100% · maximum', '177–190 bpm']] },
        { in: { age: 30, resting: '' }, out: [['Max heart rate (220 − age)', '190 bpm'], ['Method', '% of max heart rate'], ['Zone 1 · 50–60% · very light', '95–114 bpm'], ['Zone 2 · 60–70% · light', '114–133 bpm'], ['Zone 3 · 70–80% · moderate', '133–152 bpm'], ['Zone 4 · 80–90% · hard', '152–171 bpm'], ['Zone 5 · 90–100% · maximum', '171–190 bpm']] },
      ],
    },
    {
      id: 'health-run-pace', name: 'Running pace', family: 'health',
      desc: 'Pace per km and per mile, and speed, from a distance and finish time.',
      keywords: 'pace running speed min per km mile race time jogging',
      fields: [
        { id: 'distance', label: 'Distance', type: 'number', value: 10, min: 0 },
        { id: 'unit', label: 'Unit', type: 'select', value: 'km', options: [['km', 'km'], ['mi', 'miles']] },
        { id: 'time', label: 'Time (h:mm:ss or mm:ss)', type: 'text', value: '50:00' },
      ],
      run(v) {
        const km = need(v.distance, 'the distance', { gt: 0 }) * (v.unit === 'mi' ? MILE : 1);
        return paceRows(parseRaceTime(v.time, 'the time') / km);
      },
      examples: [
        { in: { distance: 10, unit: 'km', time: '50:00' }, out: [['Pace per km', '5:00'], ['Pace per mile', '8:03'], ['Speed', '12.00 km/h · 7.46 mph']] },
        { in: { distance: 26.2, unit: 'mi', time: '4:00:00' }, out: [['Pace per km', '5:42'], ['Pace per mile', '9:10'], ['Speed', '10.54 km/h · 6.55 mph']] },
      ],
    },
    {
      id: 'health-pace-convert', name: 'Pace ⇄ speed', icon: '⇄', family: 'health',
      desc: 'Convert between min/km, min/mile, km/h and mph.',
      keywords: 'pace speed convert min per km kmh mph treadmill',
      fields: [
        { id: 'value', label: 'Value (pace as m:ss, speed as a number)', type: 'text', value: '5:00' },
        { id: 'from', label: 'It is', type: 'select', value: 'pkm', options: [['pkm', 'Pace per km'], ['pmi', 'Pace per mile'], ['kmh', 'Speed in km/h'], ['mph', 'Speed in mph']] },
      ],
      run(v) {
        let secPerKm;
        if (v.from === 'pkm' || v.from === 'pmi') secPerKm = parseRaceTime(v.value, 'the pace') / (v.from === 'pmi' ? MILE : 1);
        else {
          const s = toNumber(v.value);
          if (!(s > 0)) throw new Error('Enter the speed as a number above 0.');
          secPerKm = 3600 / (s * (v.from === 'mph' ? MILE : 1));
        }
        return paceRows(secPerKm);
      },
      examples: [
        { in: { value: '5:00', from: 'pkm' }, out: [['Pace per km', '5:00'], ['Pace per mile', '8:03'], ['Speed', '12.00 km/h · 7.46 mph']] },
        { in: { value: '10', from: 'kmh' }, out: [['Pace per km', '6:00'], ['Pace per mile', '9:39'], ['Speed', '10.00 km/h · 6.21 mph']] },
        { in: { value: '8:00', from: 'pmi' }, out: [['Pace per km', '4:58'], ['Pace per mile', '8:00'], ['Speed', '12.07 km/h · 7.50 mph']] },
      ],
    },
    {
      id: 'health-race-predictor', name: 'Race time predictor', family: 'health',
      desc: 'Predict a race time at another distance from a recent result, with Riegel\'s formula T2 = T1 × (D2/D1)^1.06. An estimate — training for the distance matters.',
      keywords: 'race predictor riegel marathon half 5k 10k finish time',
      fields: [
        { id: 'from', label: 'Distance you ran', type: 'select', value: '10', options: RACES },
        { id: 'fromKm', label: 'Other distance you ran (km)', type: 'number', value: '', min: 0 },
        { id: 'time', label: 'Your time (h:mm:ss or mm:ss)', type: 'text', value: '50:00' },
        { id: 'to', label: 'Distance to predict', type: 'select', value: '21.0975', options: RACES },
        { id: 'toKm', label: 'Other distance to predict (km)', type: 'number', value: '', min: 0 },
      ],
      run(v) {
        const d1 = v.from === 'other' ? need(v.fromKm, 'the other distance you ran', { gt: 0 }) : Number(v.from);
        const d2 = v.to === 'other' ? need(v.toKm, 'the other distance to predict', { gt: 0 }) : Number(v.to);
        const t2 = parseRaceTime(v.time, 'your time') * (d2 / d1) ** 1.06;
        return [['Predicted time', hms(t2)], ['Pace per km', hms(t2 / d2)], ['Pace per mile', hms(t2 / d2 * MILE)]];
      },
      examples: [
        { in: { from: '10', time: '50:00', to: '21.0975' }, out: [['Predicted time', '1:50:19'], ['Pace per km', '5:14'], ['Pace per mile', '8:25']] },
        { in: { from: '10', time: '50:00', to: '42.195' }, out: [['Predicted time', '3:50:01'], ['Pace per km', '5:27'], ['Pace per mile', '8:46']] },
        { in: { from: 'other', fromKm: 8, time: '40:00', to: '5' }, out: [['Predicted time', '24:18'], ['Pace per km', '4:52'], ['Pace per mile', '7:49']] },
      ],
    },
    {
      id: 'health-calories-met', name: 'Calories burned (MET)', family: 'health',
      desc: 'Calories burned by an activity: MET × body weight (kg) × hours, with MET values from the Compendium of Physical Activities. An estimate.',
      keywords: 'calories burned exercise met activity workout kcal',
      fields: [
        { id: 'activity', label: 'Activity', type: 'select', value: '9.8', options: [['3.5', 'Walking, 3 mph / 4.8 km/h (3.5 MET)'], ['5', 'Brisk walking, 4 mph / 6.4 km/h (5.0 MET)'], ['9.8', 'Running, 6 mph / 9.7 km/h (9.8 MET)'], ['8', 'Cycling, 12–14 mph (8.0 MET)'], ['5.8', 'Swimming laps, moderate (5.8 MET)'], ['2.5', 'Yoga, hatha (2.5 MET)'], ['6', 'Weight training, vigorous (6.0 MET)'], ['other', 'Other (enter MET below)']] },
        { id: 'met', label: 'MET (for "Other")', type: 'number', value: '', min: 0 },
        { id: 'units', label: 'Units', type: 'select', value: 'metric', options: [['metric', 'kg'], ['imperial', 'lb']] },
        { id: 'weight', label: 'Weight', type: 'number', value: 70, min: 0 },
        { id: 'minutes', label: 'Minutes', type: 'number', value: 30, min: 0 },
      ],
      run(v) {
        const met = v.activity === 'other' ? need(v.met, 'the MET value', { gt: 0, max: 30 }) : Number(v.activity);
        const kg = kgOf(need(v.weight, 'your weight', { gt: 0, max: 1500 }), v.units);
        const min = need(v.minutes, 'the minutes', { gt: 0 });
        return [['Calories burned', `${fmt(met * kg * min / 60, 0)} kcal`], ['Per hour', `${fmt(met * kg, 0)} kcal`], ['MET used', fmt(met, 1)]];
      },
      examples: [
        { in: { activity: '9.8', units: 'metric', weight: 70, minutes: 30 }, out: [['Calories burned', '343 kcal'], ['Per hour', '686 kcal'], ['MET used', '9.8']] },
        { in: { activity: 'other', met: 4, units: 'imperial', weight: 200, minutes: 45 }, out: [['Calories burned', '272 kcal'], ['Per hour', '363 kcal'], ['MET used', '4.0']] },
      ],
    },
    {
      id: 'health-macros', name: 'Macro split', family: 'health',
      desc: 'Grams of protein, carbs and fat for a calorie target and percentage split (4 / 4 / 9 kcal per gram).',
      keywords: 'macros protein carbs fat grams diet calories split',
      fields: [
        { id: 'calories', label: 'Calories per day', type: 'number', value: 2000, min: 0 },
        { id: 'protein', label: 'Protein (%)', type: 'number', value: 30, min: 0, max: 100 },
        { id: 'carbs', label: 'Carbs (%)', type: 'number', value: 40, min: 0, max: 100 },
        { id: 'fat', label: 'Fat (%)', type: 'number', value: 30, min: 0, max: 100 },
      ],
      run(v) {
        const kcal = need(v.calories, 'the calories', { gt: 0 });
        const p = need(v.protein, 'the protein percentage', { min: 0 }), c = need(v.carbs, 'the carbs percentage', { min: 0 }), f = need(v.fat, 'the fat percentage', { min: 0 });
        if (Math.abs(p + c + f - 100) > 1e-9) throw new Error(`The percentages add up to ${fmt(p + c + f, 1).replace(/\.0$/, '')}% — they need to add up to 100%.`);
        const row = (name, share, per) => [name, `${fmt(kcal * share / 100 / per, 1)} g (${fmt(kcal * share / 100, 0)} kcal)`];
        return [row('Protein', p, 4), row('Carbs', c, 4), row('Fat', f, 9)];
      },
      examples: [
        { in: { calories: 2000, protein: 30, carbs: 40, fat: 30 }, out: [['Protein', '150.0 g (600 kcal)'], ['Carbs', '200.0 g (800 kcal)'], ['Fat', '66.7 g (600 kcal)']] },
      ],
    },
    {
      id: 'health-due-date', name: 'Pregnancy due date', family: 'health',
      desc: 'Estimated due date from the first day of the last period (Naegele\'s rule: + 280 days, adjusted for cycle length) and how far along on a given date. An estimate — your clinician\'s dating (e.g. by ultrasound) takes priority.',
      keywords: 'pregnancy due date naegele lmp gestational age weeks trimester',
      fields: [
        { id: 'lmp', label: 'First day of last period', type: 'date', value: TODAY },
        { id: 'cycle', label: 'Usual cycle length (days)', type: 'number', value: 28, min: 20, max: 45 },
        { id: 'on', label: 'Show progress on', type: 'date', value: TODAY },
      ],
      run(v) {
        const lmp = parseDate(v.lmp, 'the first day of the last period');
        const cycle = need(v.cycle, 'the cycle length', { min: 20, max: 45, int: true });
        const on = parseDate(v.on, 'the progress date');
        const due = lmp + 280 + (cycle - 28);
        const out = [['Estimated due date', isoDay(due)], ['Estimated conception', iso(lmp + cycle - 14)]];
        const ga = on - lmp - (cycle - 28); // gestational age in days, cycle-adjusted
        if (on >= lmp && ga >= 0 && ga <= 44 * 7) {
          const w = Math.floor(ga / 7), tri = w < 14 ? 'first' : w < 28 ? 'second' : 'third';
          out.push([`Pregnancy on ${iso(on)}`, `${plural(w, 'week')}, ${plural(ga % 7, 'day')} (${tri} trimester)`], ['Days to go', due >= on ? String(due - on) : `${due - on} (past the due date)`]);
        }
        return out;
      },
      examples: [
        { in: { lmp: '2024-01-01', cycle: 28, on: '2024-03-01' }, out: [['Estimated due date', '2024-10-07 (Monday)'], ['Estimated conception', '2024-01-15'], ['Pregnancy on 2024-03-01', '8 weeks, 4 days (first trimester)'], ['Days to go', '220']] },
        { in: { lmp: '2024-01-01', cycle: 32, on: '2023-12-01' }, out: [['Estimated due date', '2024-10-11 (Friday)'], ['Estimated conception', '2024-01-19']] },
      ],
    },
    {
      id: 'health-ovulation', name: 'Ovulation & fertile window', family: 'health',
      desc: 'Estimated ovulation (14 days before the next period), fertile window and next period from your cycle. An estimate only — not a method of contraception.',
      keywords: 'ovulation fertile window fertility period cycle',
      fields: [
        { id: 'lmp', label: 'First day of last period', type: 'date', value: TODAY },
        { id: 'cycle', label: 'Usual cycle length (days)', type: 'number', value: 28, min: 20, max: 45 },
      ],
      run(v) {
        const lmp = parseDate(v.lmp, 'the first day of the last period');
        const cycle = need(v.cycle, 'the cycle length', { min: 20, max: 45, int: true });
        const ov = lmp + cycle - 14;
        return [['Estimated ovulation', isoDay(ov)], ['Fertile window (estimate)', `${iso(ov - 5)} to ${iso(ov + 1)}`], ['Next period expected', isoDay(lmp + cycle)], ['Following ovulation', iso(ov + cycle)]];
      },
      examples: [{ in: { lmp: '2024-01-01', cycle: 28 }, out: [['Estimated ovulation', '2024-01-15 (Monday)'], ['Fertile window (estimate)', '2024-01-10 to 2024-01-16'], ['Next period expected', '2024-01-29 (Monday)'], ['Following ovulation', '2024-02-12']] }],
    },
    {
      id: 'health-sleep-cycles', name: 'Sleep cycle times', family: 'health',
      desc: 'Bedtimes for a wake-up time (or wake times for a bedtime) in whole 90-minute sleep cycles. A rule of thumb — real cycles vary.',
      keywords: 'sleep cycle bedtime wake up alarm 90 minutes rem',
      fields: [
        { id: 'mode', label: 'I want to', type: 'select', value: 'wake', options: [['wake', 'Wake up at…'], ['bed', 'Go to bed at…']] },
        { id: 'time', label: 'Time', type: 'time', value: '07:00' },
        { id: 'fallAsleep', label: 'Minutes to fall asleep', type: 'number', value: 15, min: 0 },
      ],
      run(v) {
        const t = parseClock(v.time, 'the time');
        const lag = need(v.fallAsleep, 'the minutes to fall asleep', { min: 0, max: 180 });
        const counts = v.mode === 'bed' ? [3, 4, 5, 6] : [6, 5, 4, 3];
        return counts.map(n => [`${n} cycles (${hm(n * 90)} sleep)`, v.mode === 'bed' ? `wake at ${clock(t + lag + n * 90)}` : `go to bed at ${clock(t - lag - n * 90)}`]);
      },
      examples: [
        { in: { mode: 'wake', time: '07:00', fallAsleep: 15 }, out: [['6 cycles (9:00 sleep)', 'go to bed at 21:45'], ['5 cycles (7:30 sleep)', 'go to bed at 23:15'], ['4 cycles (6:00 sleep)', 'go to bed at 00:45'], ['3 cycles (4:30 sleep)', 'go to bed at 02:15']] },
        { in: { mode: 'bed', time: '22:30', fallAsleep: 15 }, out: [['3 cycles (4:30 sleep)', 'wake at 03:15'], ['4 cycles (6:00 sleep)', 'wake at 04:45'], ['5 cycles (7:30 sleep)', 'wake at 06:15'], ['6 cycles (9:00 sleep)', 'wake at 07:45']] },
      ],
    },
    {
      id: 'health-caffeine', name: 'Caffeine remaining', family: 'health',
      desc: 'Caffeine still in your system after some hours, using a half-life (about 5 h for most adults, but it varies widely). An estimate.',
      keywords: 'caffeine half life coffee sleep mg',
      fields: [
        { id: 'dose', label: 'Caffeine (mg) — a coffee is about 95', type: 'number', value: 200, min: 0 },
        { id: 'hours', label: 'Hours since you had it', type: 'number', value: 10, min: 0 },
        { id: 'halfLife', label: 'Half-life (hours)', type: 'number', value: 5, min: 0 },
        { id: 'target', label: 'Low level to wait for (mg)', type: 'number', value: 25, min: 0 },
      ],
      run(v) {
        const dose = need(v.dose, 'the caffeine amount', { gt: 0 });
        const h = need(v.hours, 'the hours since', { min: 0 });
        const hl = need(v.halfLife, 'the half-life', { gt: 0, max: 48 });
        const target = need(v.target, 'the low level', { gt: 0 });
        const left = dose * 0.5 ** (h / hl);
        const until = hl * Math.log2(dose / target) - h;
        return [['Caffeine left now', `${fmt(left, 1)} mg`], ['Share of the dose', pct(left / dose * 100, 1)],
          [`Below ${fmt(target, target % 1 ? 1 : 0)} mg`, until <= 0 ? 'Already' : `in ${fmt(until, 1)} h (${fmt(until + h, 1)} h after the dose)`]];
      },
      examples: [
        { in: { dose: 200, hours: 10, halfLife: 5, target: 25 }, out: [['Caffeine left now', '50.0 mg'], ['Share of the dose', '25.0%'], ['Below 25 mg', 'in 5.0 h (15.0 h after the dose)']] },
        { in: { dose: 100, hours: 20, halfLife: 5, target: 25 }, out: [['Caffeine left now', '6.3 mg'], ['Share of the dose', '6.3%'], ['Below 25 mg', 'Already']] },
      ],
    },
    {
      id: 'health-bac', name: 'Blood alcohol estimate', family: 'health',
      desc: 'Rough blood alcohol estimate by the Widmark formula. A crude estimate only — never use it to decide whether you can drive.',
      keywords: 'bac blood alcohol widmark drinks promille',
      fields: [
        { id: 'sex', label: 'Sex', type: 'select', value: 'male', options: SEX },
        { id: 'units', label: 'Units', type: 'select', value: 'metric', options: [['metric', 'kg'], ['imperial', 'lb']] },
        { id: 'weight', label: 'Weight', type: 'number', value: 80, min: 0 },
        { id: 'drinks', label: 'Number of drinks', type: 'number', value: 3, min: 0 },
        { id: 'size', label: 'Drink size', type: 'select', value: '14', options: [['14', 'US standard drink (14 g alcohol)'], ['10', 'Australia/NZ standard drink (10 g)'], ['8', 'UK unit (8 g)']] },
        { id: 'hours', label: 'Hours since the first drink', type: 'number', value: 2, min: 0 },
      ],
      run(v) {
        const kg = kgOf(need(v.weight, 'your weight', { gt: 0, max: 1500 }), v.units);
        const grams = need(v.drinks, 'the number of drinks', { min: 0 }) * Number(v.size);
        const h = need(v.hours, 'the hours since the first drink', { min: 0 });
        const r = v.sex === 'female' ? 0.55 : 0.68;
        const bac = Math.max(0, grams / (r * kg * 1000) * 100 - 0.015 * h); // % (g per 100 ml)
        return [['Estimated BAC', `${fmt(bac, 3)}%`], ['Per mille (‰)', `${fmt(bac * 10)}‰`], ['Back to zero in about', bac > 0 ? `${fmt(bac / 0.015, 1)} h` : 'Now'],
          ['Warning', 'A crude estimate — never use it to decide whether you can drive.']];
      },
      examples: [
        { in: { sex: 'male', units: 'metric', weight: 80, drinks: 3, size: '14', hours: 2 }, out: [['Estimated BAC', '0.047%'], ['Per mille (‰)', '0.47‰'], ['Back to zero in about', '3.1 h'], ['Warning', 'A crude estimate — never use it to decide whether you can drive.']] },
        { in: { sex: 'female', units: 'metric', weight: 60, drinks: 1, size: '10', hours: 3 }, match: /^Estimated BAC: 0\.000%\nPer mille \(‰\): 0\.00‰\nBack to zero in about: Now\n/ },
      ],
    },
    {
      id: 'health-one-rep-max', name: 'One-rep max', family: 'health',
      desc: 'Estimate the most you could lift once from a set of reps (Epley and Brzycki formulas; most accurate under about 10 reps).',
      keywords: '1rm one rep max strength lifting epley brzycki',
      fields: [
        { id: 'weight', label: 'Weight lifted', type: 'number', value: 100, min: 0 },
        { id: 'reps', label: 'Reps', type: 'number', value: 5, min: 1, max: 20 },
      ],
      run(v) {
        const w = need(v.weight, 'the weight lifted', { gt: 0 });
        const n = need(v.reps, 'the reps', { min: 1, max: 20, int: true });
        const ep = n === 1 ? w : w * (1 + n / 30), br = w * 36 / (37 - n);
        return [['Epley', fmt(ep, 1)], ['Brzycki', fmt(br, 1)], ['Average', fmt((ep + br) / 2, 1)]];
      },
      examples: [
        { in: { weight: 100, reps: 5 }, out: [['Epley', '116.7'], ['Brzycki', '112.5'], ['Average', '114.6']] },
        { in: { weight: 80, reps: 1 }, out: [['Epley', '80.0'], ['Brzycki', '80.0'], ['Average', '80.0']] },
      ],
    },
    // --------------------------------------------------------- Everyday
    {
      id: 'everyday-gpa', name: 'GPA calculator', family: 'general',
      desc: 'Credit-weighted GPA on the 4.0 scale from letter grades (A = 4.0, A- = 3.7, B+ = 3.3 … F = 0) or grade points.',
      keywords: 'gpa grade point average college school credits letter grades',
      fields: [{ id: 'courses', label: 'One course per line: [name] grade credits — e.g. "Math A- 4"', type: 'textarea', value: 'Math, A, 3\nHistory, B+, 4\nArt, C, 3' }],
      run(v) {
        let pts = 0, credits = 0;
        lines(v.courses).forEach((line, k) => {
          const t = line.split(/[\s,;\t]+/);
          if (t.length < 2) throw new Error(`Line ${k + 1}: give a grade and the credits, like "A- 3".`);
          const g = t[t.length - 2].toUpperCase(), cr = toNumber(t[t.length - 1]);
          const gp = g in GRADE_POINTS ? GRADE_POINTS[g] : toNumber(g);
          if (!(gp >= 0 && gp <= 4.3)) throw new Error(`Line ${k + 1}: "${t[t.length - 2]}" isn't a letter grade (A+ … F) or grade points (0–4.3).`);
          if (!(cr > 0)) throw new Error(`Line ${k + 1}: the credits must be a number above 0.`);
          pts += gp * cr; credits += cr;
        });
        if (!credits) throw new Error('Enter at least one course.');
        return [['GPA', fmt(pts / credits)], ['Credits', fmt(credits, credits % 1 ? 1 : 0)], ['Grade points', fmt(pts)]];
      },
      examples: [
        { in: { courses: 'Math, A, 3\nHistory, B+, 4\nArt, C, 3' }, out: [['GPA', '3.12'], ['Credits', '10'], ['Grade points', '31.20']] },
        { in: { courses: 'A- 4\nIntro to Physics B- 3\nF 1' }, out: [['GPA', '2.86'], ['Credits', '8'], ['Grade points', '22.90']] },
      ],
    },
    {
      id: 'everyday-final-grade', name: 'Grade needed on the final', family: 'general',
      desc: 'The final-exam score you need to reach a target course grade.',
      keywords: 'final exam grade needed target score weight course',
      fields: [
        { id: 'current', label: 'Current grade (%)', type: 'number', value: 82, min: 0 },
        { id: 'weight', label: 'Final exam weight (% of the course)', type: 'number', value: 40, min: 0, max: 100 },
        { id: 'target', label: 'Grade you want (%)', type: 'number', value: 85, min: 0 },
      ],
      run(v) {
        const cur = need(v.current, 'your current grade', { min: 0, max: 200 });
        const w = need(v.weight, 'the final exam weight', { gt: 0, max: 100 }) / 100;
        const target = need(v.target, 'the grade you want', { min: 0, max: 200 });
        const needed = (target - cur * (1 - w)) / w;
        const out = [['Score needed on the final', pct(needed)]];
        if (needed > 100) out.push(['Note', 'More than 100% — out of reach without extra credit']);
        else if (needed <= 0) out.push(['Note', 'You reach the target even with 0% on the final']);
        out.push(['Course grade if you score 100%', pct(cur * (1 - w) + 100 * w)], ['Course grade if you score 0%', pct(cur * (1 - w))]);
        return out;
      },
      examples: [
        { in: { current: 82, weight: 40, target: 85 }, out: [['Score needed on the final', '89.50%'], ['Course grade if you score 100%', '89.20%'], ['Course grade if you score 0%', '49.20%']] },
        { in: { current: 85, weight: 30, target: 90 }, out: [['Score needed on the final', '101.67%'], ['Note', 'More than 100% — out of reach without extra credit'], ['Course grade if you score 100%', '89.50%'], ['Course grade if you score 0%', '59.50%']] },
      ],
    },
    {
      id: 'everyday-grade-percent', name: 'Test score to grade', family: 'general',
      desc: 'Percentage and US letter grade (A+ at 97, A at 93, A- at 90 … F below 60) from points earned.',
      keywords: 'test score percent letter grade points marks',
      fields: [
        { id: 'earned', label: 'Points earned', type: 'number', value: 45, min: 0 },
        { id: 'total', label: 'Points possible', type: 'number', value: 50, min: 0 },
      ],
      run(v) {
        const e = need(v.earned, 'the points earned', { min: 0 });
        const t = need(v.total, 'the points possible', { gt: 0 });
        const p = round(e / t * 100, 2);
        const letter = [[97, 'A+'], [93, 'A'], [90, 'A-'], [87, 'B+'], [83, 'B'], [80, 'B-'], [77, 'C+'], [73, 'C'], [70, 'C-'], [67, 'D+'], [63, 'D'], [60, 'D-']].find(([min]) => p >= min);
        return [['Score', pct(p)], ['Letter grade', letter ? letter[1] : 'F']];
      },
      examples: [
        { in: { earned: 45, total: 50 }, out: [['Score', '90.00%'], ['Letter grade', 'A-']] },
        { in: { earned: 17, total: 30 }, out: [['Score', '56.67%'], ['Letter grade', 'F']] },
      ],
    },
    {
      id: 'everyday-recipe-scale', name: 'Recipe scaler', family: 'general',
      desc: 'Scale ingredient amounts to a new number of servings. Understands 1 1/2, 3/4, ½, 1.5 and ranges like 2-3.',
      keywords: 'recipe scale servings ingredients cooking baking multiply halve double',
      fields: [
        { id: 'from', label: 'Recipe serves', type: 'number', value: 4, min: 0 },
        { id: 'to', label: 'I want to serve', type: 'number', value: 6, min: 0 },
        { id: 'items', label: 'Ingredients, one per line', type: 'textarea', value: '2 cups flour\n1/2 tsp salt\n1 1/2 cups milk\n3 eggs\nPinch of pepper' },
      ],
      run(v) {
        const f = need(v.to, 'the servings you want', { gt: 0 }) / need(v.from, 'the servings in the recipe', { gt: 0 });
        const rows = lines(v.items);
        if (!rows.length) throw new Error('Enter at least one ingredient.');
        return rows.map(line => {
          const m = QTY_LINE.exec(line);
          if (!m) return line;
          const a = fmtQty(parseQty(m[1]) * f);
          return (m[2] ? `${a}–${fmtQty(parseQty(m[2]) * f)}` : a) + m[3];
        }).join('\n');
      },
      examples: [
        { in: { from: 4, to: 6, items: '2 cups flour\n1/2 tsp salt\n1 1/2 cups milk\n3 eggs\n½ cup sugar\n250 g butter\n2-3 cloves garlic\nPinch of pepper' }, out: '3 cups flour\n3/4 tsp salt\n2 1/4 cups milk\n4 1/2 eggs\n3/4 cup sugar\n375 g butter\n3–4 1/2 cloves garlic\nPinch of pepper' },
        { in: { from: 3, to: 2, items: '1 cup rice\n1½ tsp cumin\n0.5 l stock' }, out: '2/3 cup rice\n1 tsp cumin\n1/3 l stock' },
        { in: { from: 2, to: 5, items: '1.1 kg potatoes\n3/8 cup oil' }, out: '2 3/4 kg potatoes\n0.94 cup oil' },
      ],
    },
    {
      id: 'everyday-paint', name: 'Paint for a room', family: 'general',
      desc: 'Wall area and paint needed for a rectangular room, minus doors (≈1.9 m² / 20 ft² each) and windows (≈1.5 m² / 15 ft² each).',
      keywords: 'paint room walls litres gallons coverage decorating',
      fields: [
        { id: 'units', label: 'Units', type: 'select', value: 'metric', options: [['metric', 'Metres & litres'], ['imperial', 'Feet & US gallons']] },
        { id: 'length', label: 'Room length', type: 'number', value: 4, min: 0 },
        { id: 'width', label: 'Room width', type: 'number', value: 3, min: 0 },
        { id: 'height', label: 'Wall height', type: 'number', value: 2.5, min: 0 },
        { id: 'doors', label: 'Doors', type: 'number', value: 1, min: 0 },
        { id: 'windows', label: 'Windows', type: 'number', value: 1, min: 0 },
        { id: 'coats', label: 'Coats', type: 'number', value: 2, min: 1 },
        { id: 'coverage', label: 'Coverage (m² per litre, or ft² per gallon — see the tin)', type: 'number', value: 10, min: 0 },
        { id: 'ceiling', label: 'Paint the ceiling too', type: 'checkbox' },
      ],
      run(v) {
        const imp = v.units === 'imperial';
        const L = need(v.length, 'the room length', { gt: 0 }), W = need(v.width, 'the room width', { gt: 0 }), H = need(v.height, 'the wall height', { gt: 0 });
        const doors = need(v.doors, 'the number of doors', { min: 0, int: true }), wins = need(v.windows, 'the number of windows', { min: 0, int: true });
        const coats = need(v.coats, 'the number of coats', { min: 1, int: true });
        const cover = need(v.coverage, 'the coverage', { gt: 0 });
        const area = 2 * (L + W) * H - doors * (imp ? 20 : 1.9) - wins * (imp ? 15 : 1.5) + (v.ceiling ? L * W : 0);
        if (area <= 0) throw new Error('The doors and windows take up more than the walls — check the sizes.');
        const [au, vu] = imp ? ['ft²', 'gal'] : ['m²', 'L'];
        return [['Area to paint', `${fmt(area)} ${au}`], [`Paint needed (${plural(coats, 'coat')})`, `${fmt(area * coats / cover)} ${vu}`]];
      },
      examples: [
        { in: { units: 'metric', length: 4, width: 3, height: 2.5, doors: 1, windows: 1, coats: 2, coverage: 10 }, out: [['Area to paint', '31.60 m²'], ['Paint needed (2 coats)', '6.32 L']] },
        { in: { units: 'imperial', length: 12, width: 10, height: 8, doors: 1, windows: 2, coats: 2, coverage: 350, ceiling: true }, out: [['Area to paint', '422.00 ft²'], ['Paint needed (2 coats)', '2.41 gal']] },
      ],
    },
    {
      id: 'everyday-flooring', name: 'Flooring & tiles', family: 'general',
      desc: 'Floor area with a waste allowance, and how many tiles or boxes to buy.',
      keywords: 'flooring tiles laminate carpet area waste boxes square metres feet',
      fields: [
        { id: 'units', label: 'Units', type: 'select', value: 'metric', options: [['metric', 'Metres (tiles in cm)'], ['imperial', 'Feet (tiles in inches)']] },
        { id: 'length', label: 'Room length', type: 'number', value: 5, min: 0 },
        { id: 'width', label: 'Room width', type: 'number', value: 4, min: 0 },
        { id: 'waste', label: 'Waste allowance (%)', type: 'number', value: 10, min: 0 },
        { id: 'tileL', label: 'Tile length (optional)', type: 'number', value: '', min: 0 },
        { id: 'tileW', label: 'Tile width (optional)', type: 'number', value: '', min: 0 },
        { id: 'box', label: 'Area per box (optional, m² or ft²)', type: 'number', value: 1.6, min: 0 },
      ],
      run(v) {
        const imp = v.units === 'imperial', au = imp ? 'ft²' : 'm²';
        const area = need(v.length, 'the room length', { gt: 0 }) * need(v.width, 'the room width', { gt: 0 });
        const waste = need(v.waste, 'the waste allowance (0 for none)', { min: 0, max: 100 });
        const total = area * (1 + waste / 100);
        const out = [['Floor area', `${fmt(area)} ${au}`], [`With ${fmt(waste, waste % 1 ? 1 : 0)}% waste`, `${fmt(total)} ${au}`]];
        const tl = maybe(v.tileL, 'the tile length', { gt: 0 }), tw = maybe(v.tileW, 'the tile width', { gt: 0 });
        if ((tl === null) !== (tw === null)) throw new Error('Enter both the tile length and width, or neither.');
        if (tl !== null) out.push([`Tiles (${fmt(tl, tl % 1 ? 1 : 0)} × ${fmt(tw, tw % 1 ? 1 : 0)} ${imp ? 'in' : 'cm'})`, fmt(ceilUp(total / (imp ? tl * tw / 144 : tl * tw / 10000)), 0)]);
        const box = maybe(v.box, 'the area per box', { gt: 0 });
        if (box !== null) out.push(['Boxes', fmt(ceilUp(total / box), 0)]);
        return out;
      },
      examples: [
        { in: { units: 'metric', length: 5, width: 4, waste: 10, tileL: 60, tileW: 30, box: 1.6 }, out: [['Floor area', '20.00 m²'], ['With 10% waste', '22.00 m²'], ['Tiles (60 × 30 cm)', '123'], ['Boxes', '14']] },
        { in: { units: 'imperial', length: 12, width: 10, waste: 0, tileL: 12, tileW: 12, box: 20 }, out: [['Floor area', '120.00 ft²'], ['With 0% waste', '120.00 ft²'], ['Tiles (12 × 12 in)', '120'], ['Boxes', '6']] },
      ],
    },
    {
      id: 'everyday-split-expenses', name: 'Split shared expenses', family: 'general',
      desc: 'Who owes whom after a trip or dinner: list what each person paid and get the fewest simple payments to settle up evenly.',
      keywords: 'split expenses settle up owe group trip splitwise share costs',
      fields: [{ id: 'paid', label: 'One per line: name amount paid (0 if nothing; repeat a name to add more)', type: 'textarea', value: 'Ann 100\nBen 50\nCal 30\nDee 20' }],
      run(v) {
        const paid = new Map();
        lines(v.paid).forEach((line, k) => {
          const m = /^(.*?)[\s:,=]*[$€£¥₹]?\s*(\d+(?:\.\d+)?)$/.exec(line);
          if (!m || !m[1].trim()) throw new Error(`Line ${k + 1}: write a name then the amount, like "Ann 25.50".`);
          const name = m[1].trim();
          paid.set(name, (paid.get(name) || 0) + Math.round(+m[2] * 100));
        });
        if (paid.size < 2) throw new Error('List at least two people.');
        const names = [...paid.keys()], total = [...paid.values()].reduce((a, b) => a + b, 0);
        const base = Math.floor(total / names.length), extra = total - base * names.length;
        // Work in cents; the first people listed absorb any leftover cent.
        const bal = names.map((n, k) => ({ n, c: paid.get(n) - base - (k < extra ? 1 : 0) }));
        const cred = bal.filter(b => b.c > 0).sort((a, b) => b.c - a.c), debt = bal.filter(b => b.c < 0).sort((a, b) => a.c - b.c);
        const out = [['Total', money(total / 100)], ['Each person\'s share', money(total / names.length / 100)]];
        for (let i = 0, j = 0; i < debt.length && j < cred.length;) {
          const amt = Math.min(-debt[i].c, cred[j].c);
          out.push([`${debt[i].n} pays ${cred[j].n}`, money(amt / 100)]);
          debt[i].c += amt; cred[j].c -= amt;
          if (!debt[i].c) i++;
          if (!cred[j].c) j++;
        }
        if (out.length === 2) out.push(['Result', 'Everyone is even']);
        return out;
      },
      examples: [
        { in: { paid: 'Ann 100\nBen 50\nCal 30\nDee 20' }, out: [['Total', '200.00'], ['Each person\'s share', '50.00'], ['Dee pays Ann', '30.00'], ['Cal pays Ann', '20.00']] },
        { in: { paid: 'Alice: 10\nBob 0\nCara 0' }, out: [['Total', '10.00'], ['Each person\'s share', '3.33'], ['Bob pays Alice', '3.33'], ['Cara pays Alice', '3.33']] },
        { in: { paid: 'Ann 20\nBen 15\nBen 5' }, out: [['Total', '40.00'], ['Each person\'s share', '20.00'], ['Result', 'Everyone is even']] },
      ],
    },
  ];

  if (typeof ToolboxPacks !== 'undefined') ToolboxPacks.add(PACK);
  if (typeof module !== 'undefined' && module.exports) module.exports = PACK;
})();
