// @vitest-environment jsdom
// Toolbox pack: money, business, dates and health — every example, the
// defaults, tricky edge cases, and time-zone independence of the date maths.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
const PACK = require('../../src/renderer/js/toolbox-pack-money-date-health.js');

const SRC = path.resolve(__dirname, '../../src/renderer/js/toolbox-pack-money-date-health.js');
const PACKS_SRC = path.resolve(__dirname, '../../src/renderer/js/toolbox-packs.js');

ToolboxPacks.specs = [];
ToolboxPacks.add(PACK);

const spec = id => {
  const s = ToolboxPacks.specs.find(t => t.id === id);
  if (!s) throw new Error(`no tool ${id}`);
  return s;
};
// Field defaults overlaid with the given inputs, coerced like the form does.
function rawFor(s, input) {
  const raw = {};
  for (const f of s.fields) raw[f.id] = f.value !== undefined ? f.value : (f.type === 'checkbox' ? false : (f.type === 'select' && f.options ? f.options[0][0] : ''));
  return Object.assign(raw, input);
}
const run = (id, input = {}) => { const s = spec(id); return s.run(ToolboxPacks.coerce(s, rawFor(s, input))); };
const text = (id, input) => ToolboxPacks.asText(run(id, input));
const row = (id, input, label) => {
  const r = run(id, input).find(([k]) => k === label);
  if (!r) throw new Error(`no row "${label}"`);
  return r[1];
};
const BAD = /NaN|Infinity|Invalid Date|undefined/;

describe('money/date/health pack registration', () => {
  it('registers every spec with a known family and a pack-specific id', () => {
    expect(PACK.length).toBeGreaterThanOrEqual(60);
    expect(ToolboxPacks.specs.length).toBe(PACK.length);
    const taken = ['regex', 'json', 'csv', 'base64', 'hash', 'timestamp', 'cron', 'uuid', 'wordcount', 'color', 'jwt', 'urlencode', 'caseconvert', 'passgen', 'markdown'];
    for (const s of PACK) {
      expect(['finance', 'business', 'date', 'health', 'general']).toContain(s.family);
      expect(s.id).toMatch(/^(fin|biz|date|health|everyday)-/);
      expect(taken).not.toContain(s.id);
    }
  });
});

describe('every example gives its documented result', () => {
  for (const s of PACK) {
    s.examples.forEach((ex, k) => {
      it(`${s.id} example ${k + 1}`, () => {
        const out = s.run(ToolboxPacks.coerce(s, rawFor(s, ex.in)));
        if (ex.match) expect(ToolboxPacks.asText(out)).toMatch(ex.match);
        else expect(out).toEqual(ex.out);
        expect(ToolboxPacks.asText(out)).not.toMatch(BAD);
      });
    });
  }
});

describe('every tool copes with its default values', () => {
  for (const s of PACK) {
    it(`${s.id} defaults`, () => {
      let out;
      try {
        out = s.run(ToolboxPacks.defaults(s));
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(e.message.length).toBeGreaterThan(0);
        return;
      }
      expect(typeof out === 'string' || Array.isArray(out)).toBe(true);
      if (Array.isArray(out)) for (const r of out) { expect(r).toHaveLength(2); expect(typeof r[1]).toBe('string'); }
      expect(ToolboxPacks.asText(out)).not.toMatch(BAD);
    });
  }
});

describe('bad input is refused with a plain message', () => {
  it('empty and invalid numbers', () => {
    expect(() => run('fin-loan', { amount: '' })).toThrow(/Enter the loan amount/);
    expect(() => run('fin-loan', { amount: -5 })).toThrow(/more than 0/);
    expect(() => run('fin-loan', { years: 2.51 })).toThrow(/whole number of months/);
    expect(() => run('health-bmi', { weight: '' })).toThrow(/Enter your weight/);
    expect(() => run('biz-conversion', { visitors: 10, conversions: 20 })).toThrow(/more conversions than visitors/);
    expect(() => run('health-macros', { protein: 30, carbs: 40, fat: 25 })).toThrow(/add up to 95%/);
  });
  it('bad dates and times', () => {
    expect(() => run('date-days-between', { start: '2023-02-29', end: '2023-03-01' })).toThrow(/isn't a real date/);
    expect(() => run('date-weekday', { date: 'yesterday' })).toThrow(/YYYY-MM-DD/);
    expect(() => run('date-time-diff', { start: '25:00' })).toThrow(/HH:MM/);
    expect(() => run('date-utc-offset', { from: '+15:00' })).toThrow(/between -12:00 and \+14:00/);
    expect(() => run('date-age', { birth: '2030-01-01', on: '2024-01-01' })).toThrow(/after/);
  });
  it('bad list lines name the line', () => {
    expect(() => run('fin-invoice', { items: '2 x 3\nsomething' })).toThrow(/Line 2/);
    expect(() => run('fin-debt-payoff', { debts: 'Card, 100, 10' })).toThrow(/Line 1/);
    expect(() => run('everyday-gpa', { courses: 'Math Q 3' })).toThrow(/Line 1/);
    expect(() => run('date-timesheet', { shifts: 'Mon 9-5' })).toThrow(/Line 1/);
  });
  it('impossible situations', () => {
    expect(() => run('fin-card-payoff', { balance: 5000, apr: 24, payment: 100 })).toThrow(/doesn't cover/);
    expect(() => run('fin-debt-payoff', { debts: 'Card, 10000, 30, 10', extra: 0 })).toThrow(/never paid off/);
    expect(() => run('fin-break-even', { price: 10, variable: 10 })).toThrow(/higher than the variable cost/);
    expect(() => run('fin-markup-margin', { mode: 'margin', value: 100 })).toThrow(/below 100%/);
  });
});

describe('edge cases for the trickiest tools', () => {
  it('money rounding ignores float noise (1.005 -> 1.01)', () => {
    expect(row('fin-simple-interest', { principal: 1.005, rate: 0, years: 1 }, 'Total')).toBe('1.01');
    expect(row('fin-simple-interest', { principal: 1234567.5, rate: 0, years: 1 }, 'Total')).toBe('1,234,567.50');
  });

  it('IRR: conventional, gapped, multi-root and impossible flows', () => {
    expect(row('fin-irr', { flows: '-1000, 500, 500, 500' }, 'IRR')).toBe('23.38%');
    expect(row('fin-irr', { flows: '-100\n0\n121' }, 'IRR')).toBe('10.00%');
    expect(row('fin-irr', { flows: '-1000\n1000' }, 'IRR')).toBe('0.00%');
    expect(row('fin-irr', { flows: '-1000\n500' }, 'IRR')).toBe('-50.00%');
    expect(run('fin-irr', { flows: '-100, 230, -132' })).toHaveLength(3);
    expect(() => run('fin-irr', { flows: '100, 200' })).toThrow(/negative/);
    expect(() => run('fin-irr', { flows: '-100, abc' })).toThrow(/"abc" isn't a number/);
    // The IRR it reports really does zero the NPV.
    const irr = parseFloat(row('fin-irr', { flows: '-2500, 800, 900, 1000, 300' }, 'IRR'));
    expect(row('fin-npv', { rate: irr, flows: '-2500, 800, 900, 1000, 300' }, 'Net present value')).toMatch(/^-?0\.\d\d$|^-?[0-3]\.\d\d$/);
  });

  it('snowball vs avalanche: avalanche never pays more interest', () => {
    const debts = 'Card, 2000, 22, 60\nStore, 600, 25, 25\nCar, 5000, 6, 150\nLoan, 1500, 9, 40';
    const interest = m => Number(row('fin-debt-payoff', { debts, extra: 150, method: m }, 'Total interest').replace(/,/g, ''));
    expect(interest('avalanche')).toBeLessThanOrEqual(interest('snowball'));
    expect(text('fin-debt-payoff', { debts, extra: 150, method: 'snowball' })).toMatch(/^1\. Store:/);
    expect(text('fin-debt-payoff', { debts, extra: 150, method: 'avalanche' })).toMatch(/^1\. Store:/); // highest APR is also Store
  });

  it('business days: single days, weekends, reversed ranges, leap years', () => {
    const bd = (start, end, holidays = '') => row('date-business-days', { start, end, holidays }, 'Business days');
    expect(bd('2024-01-03', '2024-01-03')).toBe('1');
    expect(bd('2024-01-06', '2024-01-06')).toBe('0');
    expect(bd('2024-12-31', '2024-01-01')).toBe('262');
    expect(bd('2023-01-01', '2023-12-31')).toBe('260');
    expect(bd('2024-02-26', '2024-03-04', '2024-02-29')).toBe('5');
    expect(() => bd('2024-01-01', '2024-01-31', '2024-13-01')).toThrow(/isn't a real date/);
  });

  it('deadline: zero workdays is the start date, Friday start skips the weekend', () => {
    expect(row('biz-deadline', { start: '2024-01-05', days: 0 }, 'Deadline')).toBe('2024-01-05 (Friday)');
    expect(row('biz-deadline', { start: '2024-01-05', days: 1 }, 'Deadline')).toBe('2024-01-08 (Monday)');
  });

  it('Easter: known Western and Orthodox dates, including the extremes', () => {
    const e = y => row('date-easter', { year: y }, 'Easter Sunday');
    const o = y => row('date-easter', { year: y }, 'Orthodox Easter');
    expect(e(1818)).toBe('1818-03-22'); // earliest possible
    expect(e(2285)).toBe('2285-03-22');
    expect(e(1943)).toBe('1943-04-25'); // latest possible
    expect(e(2038)).toBe('2038-04-25');
    expect(e(2000)).toBe('2000-04-23');
    expect(e(2026)).toBe('2026-04-05');
    expect(o(2000)).toBe('2000-04-30');
    expect(o(2026)).toBe('2026-04-12');
    expect(o(2017)).toBe('2017-04-16'); // same day as Western that year
    expect(e(2017)).toBe('2017-04-16');
    expect(() => e(1500)).toThrow(/less than 1583/);
  });

  it('age across month ends and leap days', () => {
    const age = (birth, on) => row('date-age', { birth, on }, 'Age');
    expect(age('2000-01-31', '2000-02-29')).toBe('0 years, 0 months, 29 days');
    expect(age('2000-01-31', '2000-03-01')).toBe('0 years, 1 month, 1 day');
    expect(age('2000-01-31', '2000-03-31')).toBe('0 years, 2 months, 0 days');
    expect(age('1999-12-31', '2000-01-30')).toBe('0 years, 0 months, 30 days');
    expect(age('2000-02-29', '2001-02-28')).toBe('0 years, 11 months, 30 days');
    expect(age('2000-02-29', '2001-03-01')).toBe('1 year, 0 months, 1 day');
    expect(age('2000-02-29', '2004-02-29')).toBe('4 years, 0 months, 0 days');
    expect(row('date-age', { birth: '2000-02-29', on: '2004-02-29' }, 'Next birthday')).toBe('Today — turning 4');
    expect(row('date-age', { birth: '1990-12-31', on: '2024-12-31' }, 'Next birthday')).toBe('Today — turning 34');
    expect(row('date-age', { birth: '1990-01-01', on: '2024-12-31' }, 'Next birthday')).toBe('2025-01-01 (Wednesday), in 1 day (turning 35)');
  });

  it('adding months clamps to the end of the month', () => {
    expect(row('date-add', { date: '2023-01-31', amount: 1, unit: 'months' }, 'Result')).toBe('2023-02-28');
    expect(row('date-add', { date: '2024-03-31', op: 'sub', amount: 1, unit: 'months' }, 'Result')).toBe('2024-02-29');
    expect(row('date-add', { date: '2024-01-15', amount: 13, unit: 'months' }, 'Result')).toBe('2025-02-15');
    expect(row('date-add', { date: '2024-01-15', op: 'sub', amount: 25, unit: 'months' }, 'Result')).toBe('2021-12-15');
  });

  it('ISO weeks at year boundaries', () => {
    const wk = d => row('date-week-number', { date: d }, 'ISO week date');
    expect(wk('2027-01-01')).toBe('2026-W53-5');
    expect(wk('2008-12-29')).toBe('2009-W01-1');
    expect(wk('2010-01-03')).toBe('2009-W53-7');
    expect(wk('2024-01-01')).toBe('2024-W01-1');
  });

  it('timesheet and clock differences across midnight', () => {
    expect(text('date-timesheet', { shifts: 'Fri 23:00-07:00 60' })).toBe('Fri: 23:00–07:00 (overnight) − 60 min = 7:00\nTotal: 7:00\nDecimal hours: 7.00');
    expect(row('date-timesheet', { shifts: '18:00-18:00' }, 'Total')).toBe('0:00');
    expect(row('date-timesheet', { shifts: 'Sat 20:30 – 04:15\nSun 21:45-06:00 15', rate: 18.5 }, 'Total')).toBe('15:45');
    expect(row('date-timesheet', { shifts: 'Sat 20:30 – 04:15\nSun 21:45-06:00 15', rate: 18.5 }, 'Pay')).toBe('291.38');
    expect(() => run('date-timesheet', { shifts: '09:00-09:30 45' })).toThrow(/break is longer/);
    expect(row('date-time-diff', { start: '23:59', end: '00:01', break: 0 }, 'Duration')).toBe('0:02');
    expect(() => run('date-time-diff', { start: '09:00', end: '10:00', break: 61 })).toThrow(/break is longer/);
  });

  it('time zone offsets across day boundaries and odd offsets', () => {
    expect(row('date-utc-offset', { date: '2024-03-01', time: '00:30', from: '+05:45', to: '-09:30' }, 'Converted')).toBe('2024-02-29 09:15 (UTC-09:30)');
    expect(row('date-utc-offset', { date: '2024-12-31', time: '23:00', from: 'Z', to: '+14' }, 'Converted')).toBe('2025-01-01 13:00 (UTC+14:00)');
  });

  it('A/B test is symmetric and handles zero conversions', () => {
    expect(row('biz-ab-test', { nA: 1000, cA: 130, nB: 1000, cB: 100 }, 'p-value (two-sided)')).toBe('0.0355');
    expect(row('biz-ab-test', { nA: 10000, cA: 0, nB: 10000, cB: 50 }, 'p-value (two-sided)')).toBe('< 0.0001');
    expect(() => run('biz-ab-test', { nA: 100, cA: 0, nB: 100, cB: 0 })).toThrow(/nothing to compare/);
  });

  it('recipe scaler leaves lines without a leading amount alone', () => {
    expect(run('everyday-recipe-scale', { from: 2, to: 4, items: 'Salt to taste\n1/3 cup cream\n⅛ tsp nutmeg' })).toBe('Salt to taste\n2/3 cup cream\n1/4 tsp nutmeg');
  });
});

describe('date maths does not depend on the machine time zone', () => {
  const src = fs.readFileSync(SRC, 'utf8');

  it('only UTC accessors are used and no strings are parsed as dates', () => {
    expect(src).not.toMatch(/\.(?:get|set)(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\(/);
    expect(src).not.toMatch(/getTimezoneOffset|toLocale\w*String|Date\.parse|new Date\(\s*['"`]/);
    // Nothing that reaches outside the pure function.
    expect(src).not.toMatch(/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|document|indexedDB)\b/);
  });

  // Run every example in child processes with far-apart zones and compare.
  const script = `
    const { ToolboxPacks } = require(${JSON.stringify(PACKS_SRC)});
    const PACK = require(${JSON.stringify(SRC)});
    const out = { offset: new Date(2024, 0, 1).getTimezoneOffset(), results: [] };
    for (const s of PACK) for (const ex of s.examples) {
      const raw = {};
      for (const f of s.fields) raw[f.id] = f.value !== undefined ? f.value : (f.type === 'checkbox' ? false : (f.type === 'select' && f.options ? f.options[0][0] : ''));
      Object.assign(raw, ex.in);
      out.results.push([s.id, s.run(ToolboxPacks.coerce(s, raw))]);
    }
    process.stdout.write(JSON.stringify(out));`;
  const here = PACK.flatMap(s => s.examples.map(ex => [s.id, s.run(ToolboxPacks.coerce(s, rawFor(s, ex.in)))]));
  const zones = { 'Pacific/Kiritimati': -840, 'America/Los_Angeles': 480, 'Asia/Kathmandu': -345 };
  for (const [tz, offset] of Object.entries(zones)) {
    it(`gives identical results with TZ=${tz}`, () => {
      const res = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));
      expect(res.offset).toBe(offset); // proves the child really ran in that zone
      expect(res.results).toEqual(JSON.parse(JSON.stringify(here)));
    });
  }
});
