// === Vex Toolbox pack: unit converters, math and science ===
// Unit converters built on exact SI factors, everyday and school math, and
// physics/chemistry formulas. Contract: js/toolbox-packs.js.
(function () {
  // ---- Number helpers --------------------------------------------------------
  // Every numeric result goes through fmt: up to 10 significant digits (hides
  // float noise, keeps exact factors like 1.609344 intact), trailing zeros
  // stripped, e-notation below 1e-6 or from 1e15. Results of empirical
  // formulas (weather indices, planet weights, cooking) use fmt(x, 4).
  function fmt(x, sig = 10) {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('The result is not a finite number — check the inputs.');
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e15 || a < 1e-6) {
      const [m, e] = x.toExponential(sig - 1).split('e');
      return `${trimZeros(m)}e${Number(e)}`;
    }
    const s = String(Number(x.toPrecision(sig)));
    return s === '-0' ? '0' : s;
  }
  function trimZeros(m) { return m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m; }

  const isBlank = x => typeof x === 'number' && Number.isNaN(x);

  // Validate one number input; throws a plain-language error.
  function need(x, label, o = {}) {
    if (isBlank(x)) throw new Error(`Enter a number for ${label}.`);
    if (!Number.isFinite(x)) throw new Error(`${cap(label)} is too large.`);
    if (o.int && !Number.isInteger(x)) throw new Error(`${cap(label)} must be a whole number.`);
    if (o.pos && x <= 0) throw new Error(`${cap(label)} must be greater than 0.`);
    if (o.nonneg && x < 0) throw new Error(`${cap(label)} cannot be negative.`);
    if (o.nonzero && x === 0) throw new Error(`${cap(label)} cannot be 0.`);
    if (o.min !== undefined && x < o.min) throw new Error(`${cap(label)} must be at least ${o.min}.`);
    if (o.max !== undefined && x > o.max) throw new Error(`${cap(label)} must be at most ${o.max}.`);
    return x;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // "Fill in any N of these" tools: which fields have a value.
  function filled(v, keys, want, names) {
    const got = keys.filter(k => !isBlank(v[k]));
    if (got.length !== want) {
      const others = keys.length - want;
      throw new Error(`Fill in exactly ${want} of: ${names.join(', ')} — and leave the other ${others === 1 ? 'one' : others} empty.`);
    }
    return got;
  }

  // Numbers typed into a textarea: split on commas, spaces, semicolons, new lines.
  function numberList(text, label = 'numbers') {
    const parts = String(text).split(/[\s,;]+/).filter(Boolean);
    if (!parts.length) throw new Error(`Enter some ${label}, separated by commas, spaces or new lines.`);
    return parts.map(p => {
      const n = Number(p);
      if (p === '' || !Number.isFinite(n)) throw new Error(`"${p}" is not a number.`);
      return n;
    });
  }

  const DEG = Math.PI / 180;
  // sin/cos in degrees with exact zeros at multiples of 90°.
  function sinDeg(d) { const r = ((d % 360) + 360) % 360; const s = Math.sin(r * DEG); return Math.abs(s) < 1e-12 ? 0 : s; }
  function cosDeg(d) { const r = ((d % 360) + 360) % 360; const c = Math.cos(r * DEG); return Math.abs(c) < 1e-12 ? 0 : c; }

  // ---- Exact decimals and fractions (BigInt) ---------------------------------
  // A decimal string as { neg, M, scale } meaning (neg ? -1 : 1) * M / 10^scale.
  function parseDecimal(str, label = 'the number') {
    const s = String(str).trim().replace(/[\s_]/g, '');
    if (!s) throw new Error(`Enter ${label}.`);
    if (s.includes(',')) throw new Error('Use a dot for decimals and no thousands separators (e.g. 1234.5).');
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m || !(m[2] || m[3])) throw new Error(`"${String(str).trim()}" is not a number.`);
    const frac = m[3] || '';
    const exp = m[4] ? Number(m[4]) : 0;
    if (Math.abs(exp) > 1000) throw new Error('The exponent is too large (limit ±1000).');
    const M = BigInt((m[2] || '') + frac || '0');
    return { neg: m[1] === '-' && M !== 0n, M, scale: frac.length - exp };
  }
  function decToString({ neg, M, scale }) {
    let s = M.toString();
    if (scale > 0) { s = s.padStart(scale + 1, '0'); s = s.slice(0, -scale) + '.' + s.slice(-scale); }
    else if (scale < 0 && M !== 0n) s += '0'.repeat(-scale);
    return (neg && M !== 0n ? '-' : '') + s;
  }
  // Round to p decimal places (p may be negative), halves away from zero.
  function roundDec({ neg, M, scale }, p) {
    let R;
    if (scale <= p) R = M * 10n ** BigInt(p - scale);
    else {
      const div = 10n ** BigInt(scale - p);
      R = M / div;
      if ((M % div) * 2n >= div) R += 1n;
    }
    return { neg: neg && R !== 0n, M: R, scale: p };
  }

  const babs = a => (a < 0n ? -a : a);
  function bgcd(a, b) { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; }
  function rat(n, d) {
    if (d === 0n) throw new Error('Division by zero.');
    if (d < 0n) { n = -n; d = -d; }
    const g = bgcd(n, d) || 1n;
    return { n: n / g, d: d / g };
  }
  const radd = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
  const rsub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
  const rmul = (a, b) => rat(a.n * b.n, a.d * b.d);
  const rdiv = (a, b) => { if (b.n === 0n) throw new Error('Division by zero.'); return rat(a.n * b.d, a.d * b.n); };
  function decToRat(d) {
    const n = d.neg ? -d.M : d.M;
    return d.scale >= 0 ? rat(n, 10n ** BigInt(d.scale)) : rat(n * 10n ** BigInt(-d.scale), 1n);
  }
  // "3/4", "-1 1/2", "0.75", "0.1(6)" (repeating), "1.5/2", "7".
  function parseRational(str, label = 'the number') {
    const s = String(str).trim();
    if (!s) throw new Error(`Enter ${label}.`);
    let m = /^([+-]?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s);
    if (m) {
      const r = radd(rat(BigInt(m[2]), 1n), rat(BigInt(m[3]), BigInt(m[4])));
      return m[1] === '-' ? rat(-r.n, r.d) : r;
    }
    m = /^([+-]?)(\d*)\.(\d*)\((\d+)\)$/.exec(s);
    if (m) {
      const [, sign, ip, nonrep, rep] = m;
      // x = ip.nonrep(rep) = (ip nonrep rep − ip nonrep) / (10^len(nonrep) · (10^len(rep) − 1))
      const whole = BigInt((ip || '0') + nonrep + rep) - BigInt((ip || '0') + nonrep);
      const r = rat(whole, 10n ** BigInt(nonrep.length) * (10n ** BigInt(rep.length) - 1n));
      return sign === '-' ? rat(-r.n, r.d) : r;
    }
    if (s.includes('/')) {
      const [a, b, extra] = s.split('/');
      if (extra !== undefined) throw new Error(`"${s}" has more than one "/".`);
      const den = decToRat(parseDecimal(b, 'a denominator'));
      if (den.n === 0n) throw new Error('The denominator cannot be 0.');
      return rdiv(decToRat(parseDecimal(a, 'a numerator')), den);
    }
    return decToRat(parseDecimal(s, label));
  }
  const ratFrac = r => (r.d === 1n ? r.n.toString() : `${r.n}/${r.d}`);
  function ratMixed(r) {
    if (r.d === 1n || babs(r.n) < r.d) return ratFrac(r);
    const w = babs(r.n) / r.d, rem = babs(r.n) % r.d;
    return `${r.n < 0n ? '-' : ''}${w} ${rem}/${r.d}`;
  }
  // Exact decimal expansion; a repeating block is shown in brackets: 1/6 = 0.1(6).
  function ratDecimal(r, maxDigits = 60) {
    const neg = r.n < 0n;
    let rem = babs(r.n) % r.d;
    const ip = babs(r.n) / r.d;
    if (rem === 0n) return (neg ? '-' : '') + ip;
    const seen = new Map();
    let digits = '';
    while (rem !== 0n && !seen.has(rem) && digits.length < maxDigits) {
      seen.set(rem, digits.length);
      rem *= 10n;
      digits += (rem / r.d).toString();
      rem %= r.d;
    }
    const sign = neg ? '-' : '';
    if (rem === 0n) return `${sign}${ip}.${digits}`;
    if (seen.has(rem)) { const at = seen.get(rem); return `${sign}${ip}.${digits.slice(0, at)}(${digits.slice(at)})`; }
    return `≈ ${fmt(Number(r.n) / Number(r.d))}`;
  }
  const ratRows = r => [['Fraction', ratFrac(r)], ['Mixed number', ratMixed(r)], ['Decimal', ratDecimal(r)], ['Percent', ratDecimal(rmul(r, rat(100n, 1n))) + '%']];

  // ---- Unit converters -------------------------------------------------------
  // units: [key, label, factor-to-base, symbol]. Result: "x a = y b".
  function converter({ id, name, icon, desc, keywords, units, from, to, value = 1, examples }) {
    const map = Object.fromEntries(units.map(u => [u[0], u]));
    const opts = units.map(u => [u[0], u[1]]);
    return {
      id, name, icon, family: 'convert', desc, keywords,
      fields: [
        { id: 'value', label: 'Value', type: 'number', value },
        { id: 'from', label: 'From', type: 'select', value: from, options: opts },
        { id: 'to', label: 'To', type: 'select', value: to, options: opts },
      ],
      run(v) {
        const x = need(v.value, 'the value');
        const a = map[v.from], b = map[v.to];
        if (!a || !b) throw new Error('Pick the units to convert from and to.');
        return `${fmt(x)} ${a[3]} = ${fmt(x * a[2] / b[2])} ${b[3]}`;
      },
      examples,
    };
  }

  // Exact definitions (NIST SP 811 / international yard and pound, 1959).
  const IN = 0.0254, FT = 0.3048, YD = 0.9144, MI = 1609.344, NMI = 1852;
  const LB = 0.45359237, G0 = 9.80665, LBF = LB * G0;
  const GAL = 3.785411784e-3, IMPGAL = 4.54609e-3; // m³
  const CAL = 4.184, BTU = 1055.05585262;

  // Temperature scales through kelvin.
  const TEMP = {
    C: { label: 'Celsius (°C)', sym: '°C', toK: x => x + 273.15, fromK: k => k - 273.15 },
    F: { label: 'Fahrenheit (°F)', sym: '°F', toK: x => (x + 459.67) * 5 / 9, fromK: k => k * 9 / 5 - 459.67 },
    K: { label: 'Kelvin (K)', sym: 'K', toK: x => x, fromK: k => k },
    R: { label: 'Rankine (°R)', sym: '°R', toK: x => x * 5 / 9, fromK: k => k * 9 / 5 },
  };

  // Fuel economy through km per litre.
  const FUEL = {
    mpgus: { label: 'Miles per US gallon (mpg)', sym: 'mpg (US)', toKmL: x => x * (MI / 1000) / (GAL * 1000), fromKmL: k => k / ((MI / 1000) / (GAL * 1000)) },
    mpguk: { label: 'Miles per imperial gallon (mpg UK)', sym: 'mpg (UK)', toKmL: x => x * (MI / 1000) / (IMPGAL * 1000), fromKmL: k => k / ((MI / 1000) / (IMPGAL * 1000)) },
    l100: { label: 'Litres per 100 km', sym: 'L/100 km', toKmL: x => 100 / x, fromKmL: k => 100 / k },
    kml: { label: 'Kilometres per litre', sym: 'km/L', toKmL: x => x, fromKmL: k => k },
  };

  // Cooking: volume units in mL, weight units in g. Ingredient densities come
  // from grams per US cup (typical USDA figures) — approximate by nature.
  const CUP = GAL * 1e6 / 16; // 236.5882365 mL
  const COOK_UNITS = {
    ml: ['Millilitres (mL)', 'mL', 'v', 1], l: ['Litres (L)', 'L', 'v', 1000],
    cup: ['US cups', 'cup', 'v', CUP], mcup: ['Metric cups (250 mL)', 'metric cup', 'v', 250],
    tbsp: ['US tablespoons', 'tbsp', 'v', CUP / 16], tsp: ['US teaspoons', 'tsp', 'v', CUP / 48],
    floz: ['US fluid ounces', 'fl oz', 'v', CUP / 8],
    g: ['Grams (g)', 'g', 'm', 1], kg: ['Kilograms (kg)', 'kg', 'm', 1000],
    oz: ['Ounces (oz, weight)', 'oz', 'm', LB * 1000 / 16], lb: ['Pounds (lb)', 'lb', 'm', LB * 1000],
  };
  const INGREDIENTS = {
    water: ['Water', CUP], milk: ['Milk', 244], flour: ['All-purpose flour', 125], sugar: ['Granulated sugar', 200],
    brown: ['Brown sugar (packed)', 220], icing: ['Powdered sugar', 120], butter: ['Butter', 227], oil: ['Vegetable oil', 218],
    honey: ['Honey', 340], rice: ['Rice (uncooked)', 185], oats: ['Rolled oats', 81], cocoa: ['Cocoa powder', 86],
  };

  // ---- Chemistry: standard atomic weights ------------------------------------
  // IUPAC abridged standard atomic weights (g/mol). Elements with no stable
  // isotope use the mass number of the longest-lived isotope.
  const WEIGHTS = {};
  ('H 1.008 He 4.0026 Li 6.94 Be 9.0122 B 10.81 C 12.011 N 14.007 O 15.999 F 18.998 Ne 20.180 ' +
   'Na 22.990 Mg 24.305 Al 26.982 Si 28.085 P 30.974 S 32.06 Cl 35.45 Ar 39.95 K 39.098 Ca 40.078 ' +
   'Sc 44.956 Ti 47.867 V 50.942 Cr 51.996 Mn 54.938 Fe 55.845 Co 58.933 Ni 58.693 Cu 63.546 Zn 65.38 ' +
   'Ga 69.723 Ge 72.630 As 74.922 Se 78.971 Br 79.904 Kr 83.798 Rb 85.468 Sr 87.62 Y 88.906 Zr 91.224 ' +
   'Nb 92.906 Mo 95.95 Tc 97 Ru 101.07 Rh 102.91 Pd 106.42 Ag 107.87 Cd 112.41 In 114.82 Sn 118.71 ' +
   'Sb 121.76 Te 127.60 I 126.90 Xe 131.29 Cs 132.91 Ba 137.33 La 138.91 Ce 140.12 Pr 140.91 Nd 144.24 ' +
   'Pm 145 Sm 150.36 Eu 151.96 Gd 157.25 Tb 158.93 Dy 162.50 Ho 164.93 Er 167.26 Tm 168.93 Yb 173.05 ' +
   'Lu 174.97 Hf 178.49 Ta 180.95 W 183.84 Re 186.21 Os 190.23 Ir 192.22 Pt 195.08 Au 196.97 Hg 200.59 ' +
   'Tl 204.38 Pb 207.2 Bi 208.98 Po 209 At 210 Rn 222 Fr 223 Ra 226 Ac 227 Th 232.04 ' +
   'Pa 231.04 U 238.03 Np 237 Pu 244 Am 243 Cm 247 Bk 247 Cf 251 Es 252 Fm 257 ' +
   'Md 258 No 259 Lr 266 Rf 267 Db 268 Sg 269 Bh 270 Hs 269 Mt 278 Ds 281 ' +
   'Rg 282 Cn 285 Nh 286 Fl 289 Mc 290 Lv 293 Ts 294 Og 294')
    .split(' ').forEach((t, i, a) => { if (i % 2 === 0) WEIGHTS[t] = Number(a[i + 1]); });

  // Formula -> Map(element -> atom count), in order of first appearance.
  // Supports (), [], {}, counts, and hydrates/adducts joined by · • * or ".".
  function parseFormula(src) {
    const s = String(src).replace(/\s+/g, '');
    if (!s) throw new Error('Enter a chemical formula, e.g. H2O or Ca(OH)2.');
    const total = new Map();
    for (const part of s.split(/[·•*.]/)) {
      if (!part) throw new Error('A "·" in the formula needs a formula on both sides.');
      const m = /^(\d+)(.*)$/.exec(part);
      const mult = m ? Number(m[1]) : 1;
      const body = m ? m[2] : part;
      if (!body) throw new Error(`"${part}" is a number without a formula.`);
      if (mult === 0) throw new Error('A multiplier of 0 is not allowed.');
      addCounts(total, parseGroup(body), mult);
    }
    return total;
  }
  function addCounts(into, from, times) { for (const [el, n] of from) into.set(el, (into.get(el) || 0) + n * times); }
  function parseGroup(s) {
    const CLOSE = { '(': ')', '[': ']', '{': '}' };
    let i = 0;
    const count = () => {
      const m = /^\d+/.exec(s.slice(i));
      if (!m) return 1;
      i += m[0].length;
      if (Number(m[0]) === 0) throw new Error('An atom count of 0 is not allowed.');
      return Number(m[0]);
    };
    const seq = close => {
      const out = new Map();
      while (i < s.length) {
        const ch = s[i];
        if (close && ch === close) { i++; return out; }
        if (CLOSE[ch]) {
          i++;
          const inner = seq(CLOSE[ch]);
          if (!inner.size) throw new Error('The formula has empty brackets.');
          addCounts(out, inner, count());
          continue;
        }
        const m = /^[A-Z][a-z]?/.exec(s.slice(i));
        if (!m) throw new Error(`Unexpected "${ch}" in the formula. Element symbols start with a capital letter (Co is cobalt, CO is carbon + oxygen).`);
        if (!(m[0] in WEIGHTS)) throw new Error(`"${m[0]}" is not an element symbol.`);
        i += m[0].length;
        addCounts(out, new Map([[m[0], 1]]), count());
      }
      if (close) throw new Error(`The formula is missing a closing "${close}".`);
      return out;
    };
    return seq(null);
  }
  function molarMass(formula) {
    const counts = parseFormula(formula);
    let total = 0;
    for (const [el, n] of counts) total += WEIGHTS[el] * n;
    return { counts, total };
  }

  // Physical constants (SI 2019 exact values; others CODATA 2018).
  const C_LIGHT = 299792458, H_PLANCK = 6.62607015e-34, E_CHARGE = 1.602176634e-19;
  const K_B = 1.380649e-23, N_A = 6.02214076e23, R_GAS = N_A * K_B, G_NEWTON = 6.6743e-11;
  const CONSTANTS = {
    c: ['Speed of light in vacuum', 'c', '299792458', 'm/s', true],
    h: ['Planck constant', 'h', '6.62607015e-34', 'J·s', true],
    hbar: ['Reduced Planck constant', 'ħ', '1.054571817e-34', 'J·s', true],
    e: ['Elementary charge', 'e', '1.602176634e-19', 'C', true],
    k: ['Boltzmann constant', 'k', '1.380649e-23', 'J/K', true],
    na: ['Avogadro constant', 'N_A', '6.02214076e23', '1/mol', true],
    r: ['Molar gas constant', 'R', '8.314462618', 'J/(mol·K)', true],
    f: ['Faraday constant', 'F', '96485.33212', 'C/mol', true],
    sigma: ['Stefan–Boltzmann constant', 'σ', '5.670374419e-8', 'W/(m²·K⁴)', true],
    wien: ['Wien displacement constant', 'b', '2.897771955e-3', 'm·K', true],
    g: ['Newtonian constant of gravitation', 'G', '6.67430e-11', 'm³/(kg·s²)', false],
    gn: ['Standard acceleration of gravity', 'g', '9.80665', 'm/s²', true],
    me: ['Electron mass', 'mₑ', '9.1093837015e-31', 'kg', false],
    mp: ['Proton mass', 'mₚ', '1.67262192369e-27', 'kg', false],
    mn: ['Neutron mass', 'mₙ', '1.67492749804e-27', 'kg', false],
    u: ['Atomic mass constant', 'u', '1.66053906660e-27', 'kg', false],
    eps0: ['Vacuum electric permittivity', 'ε₀', '8.8541878128e-12', 'F/m', false],
    mu0: ['Vacuum magnetic permeability', 'μ₀', '1.25663706212e-6', 'N/A²', false],
    alpha: ['Fine-structure constant', 'α', '7.2973525693e-3', '(dimensionless)', false],
    rinf: ['Rydberg constant', 'R∞', '10973731.568160', '1/m', false],
    a0: ['Bohr radius', 'a₀', '5.29177210903e-11', 'm', false],
    atm: ['Standard atmosphere', 'atm', '101325', 'Pa', true],
    zero: ['Absolute zero', '0 K', '-273.15', '°C', true],
  };

  // Surface gravity, m/s² (NASA planetary fact sheet; Earth = standard gravity).
  const BODIES = [['Mercury', 3.7], ['Venus', 8.87], ['Earth', G0], ['Moon', 1.62], ['Mars', 3.71], ['Jupiter', 24.79],
    ['Saturn', 10.44], ['Uranus', 8.87], ['Neptune', 11.15], ['Pluto', 0.62]];

  // Resistor colour code (IEC 60062).
  const RC_DIGIT = { black: 0, brown: 1, red: 2, orange: 3, yellow: 4, green: 5, blue: 6, violet: 7, grey: 8, white: 9 };
  const RC_MULT = { ...RC_DIGIT, gold: -1, silver: -2 };
  const RC_TOL = { brown: 1, red: 2, orange: 0.05, yellow: 0.02, green: 0.5, blue: 0.25, violet: 0.1, grey: 0.05, gold: 5, silver: 10 };
  const RC_TEMPCO = { black: 250, brown: 100, red: 50, orange: 15, yellow: 25, green: 20, blue: 10, violet: 5, grey: 1 };
  const RC_ALIAS = { gray: 'grey', purple: 'violet' };
  function ohms(x) {
    for (const [f, p] of [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']]) if (Math.abs(x) >= f) return `${fmt(x / f)} ${p}Ω`;
    return `${fmt(x)} Ω`;
  }

  // Trial-division factorisation for integers up to 2^53 − 1.
  function factorize(n) {
    const f = [];
    const take = p => { let e = 0; while (n % p === 0) { n /= p; e++; } if (e) f.push([p, e]); };
    take(2); take(3);
    for (let p = 5; p * p <= n; p += 6) { take(p); take(p + 2); }
    if (n > 1) f.push([n, 1]);
    return f;
  }

  const ordinalRoot = n => (n === 2 ? 'Square root' : n === 3 ? 'Cube root' : `${n}th root`);
  // "y = 2x + 1" from slope and intercept, tidy for 0/±1.
  function lineEq(m, b) {
    const ms = fmt(m);
    let s = m === 0 ? '' : (ms === '1' ? 'x' : ms === '-1' ? '-x' : `${ms}x`);
    const bs = fmt(Math.abs(b));
    if (!s) return `y = ${fmt(b)}`;
    if (bs !== '0') s += b < 0 ? ` - ${bs}` : ` + ${bs}`;
    return `y = ${s}`;
  }
  function complexStr(re, im) {
    const ip = Math.abs(im) === 1 ? 'i' : `${fmt(Math.abs(im))}i`;
    if (re === 0) return (im < 0 ? '-' : '') + ip;
    return `${fmt(re)} ${im < 0 ? '-' : '+'} ${ip}`;
  }

  function parseMatrix(text) {
    const rows = String(text).split(/\n/).map(l => l.trim()).filter(Boolean)
      .map(l => l.replace(/[[\]]/g, '').split(/[\s,;]+/).filter(Boolean).map(t => parseRational(t, 'a matrix entry')));
    const n = rows.length;
    if (!n) throw new Error('Enter the matrix, one row per line (e.g. "1 2" then "3 4").');
    if (n > 8) throw new Error('Matrices up to 8×8 are supported.');
    if (rows.some(r => r.length !== n)) throw new Error(`The matrix must be square: ${n} row${n > 1 ? 's' : ''} of ${n} number${n > 1 ? 's' : ''} each.`);
    return rows;
  }
  // Exact determinant by fraction-based Gaussian elimination.
  function determinant(A) {
    const a = A.map(r => r.slice());
    const n = a.length;
    let det = rat(1n, 1n);
    for (let c = 0; c < n; c++) {
      let p = c;
      while (p < n && a[p][c].n === 0n) p++;
      if (p === n) return rat(0n, 1n);
      if (p !== c) { [a[p], a[c]] = [a[c], a[p]]; det = rat(-det.n, det.d); }
      det = rmul(det, a[c][c]);
      for (let r = c + 1; r < n; r++) {
        if (a[r][c].n === 0n) continue;
        const f = rdiv(a[r][c], a[c][c]);
        for (let k = c; k < n; k++) a[r][k] = rsub(a[r][k], rmul(f, a[c][k]));
      }
    }
    return det;
  }

  function bigFromBase(str, base) {
    let s = String(str).trim().replace(/[\s_]/g, '').toLowerCase();
    if (!s) throw new Error('Enter a number to convert.');
    let neg = false;
    if (s[0] === '-' || s[0] === '+') { neg = s[0] === '-'; s = s.slice(1); }
    const pre = { 16: '0x', 2: '0b', 8: '0o' }[base];
    if (pre && s.startsWith(pre)) s = s.slice(2);
    if (!s) throw new Error('Enter a number to convert.');
    if (s.includes('.')) throw new Error('Only whole numbers can be converted between bases.');
    const B = BigInt(base);
    let acc = 0n;
    for (const ch of s) {
      const d = parseInt(ch, 36);
      if (Number.isNaN(d) || d >= base) throw new Error(`"${ch}" is not a valid digit in base ${base}.`);
      acc = acc * B + BigInt(d);
    }
    return neg ? -acc : acc;
  }
  const bigToBase = (x, base) => x.toString(base).toUpperCase();

  const PACK = [
    // ======================= Unit converters =================================
    converter({
      id: 'unit-length', name: 'Length converter', icon: '📏', desc: 'Convert between metric, imperial, nautical and astronomical lengths.',
      keywords: ['distance', 'meter', 'metre', 'mile', 'km', 'feet', 'inch', 'yard'],
      units: [['nm', 'Nanometres', 1e-9, 'nm'], ['um', 'Micrometres', 1e-6, 'µm'], ['mm', 'Millimetres', 1e-3, 'mm'], ['cm', 'Centimetres', 1e-2, 'cm'],
        ['m', 'Metres', 1, 'm'], ['km', 'Kilometres', 1000, 'km'], ['in', 'Inches', IN, 'in'], ['ft', 'Feet', FT, 'ft'], ['yd', 'Yards', YD, 'yd'],
        ['mi', 'Miles', MI, 'mi'], ['nmi', 'Nautical miles', NMI, 'nmi'], ['au', 'Astronomical units', 149597870700, 'au'], ['ly', 'Light-years', 9460730472580800, 'ly']],
      from: 'mi', to: 'km',
      examples: [{ in: { value: 1, from: 'mi', to: 'km' }, out: '1 mi = 1.609344 km' }, { in: { value: 1, from: 'in', to: 'cm' }, out: '1 in = 2.54 cm' },
        { in: { value: 3, from: 'ft', to: 'yd' }, out: '3 ft = 1 yd' }],
    }),
    converter({
      id: 'unit-area', name: 'Area converter', icon: '⬛', desc: 'Convert square metres, hectares, acres, square feet and more.',
      keywords: ['acre', 'hectare', 'square', 'sq ft', 'm2'],
      units: [['mm2', 'Square millimetres', 1e-6, 'mm²'], ['cm2', 'Square centimetres', 1e-4, 'cm²'], ['m2', 'Square metres', 1, 'm²'], ['ha', 'Hectares', 1e4, 'ha'],
        ['km2', 'Square kilometres', 1e6, 'km²'], ['in2', 'Square inches', IN * IN, 'in²'], ['ft2', 'Square feet', FT * FT, 'ft²'], ['yd2', 'Square yards', YD * YD, 'yd²'],
        ['ac', 'Acres', 4046.8564224, 'ac'], ['mi2', 'Square miles', MI * MI, 'mi²']],
      from: 'ha', to: 'ac',
      examples: [{ in: { value: 1, from: 'ac', to: 'm2' }, out: '1 ac = 4046.856422 m²' }, { in: { value: 1, from: 'mi2', to: 'ac' }, out: '1 mi² = 640 ac' },
        { in: { value: 1, from: 'ha', to: 'm2' }, out: '1 ha = 10000 m²' }],
    }),
    converter({
      id: 'unit-volume', name: 'Volume converter', icon: '🧪', desc: 'Convert litres, cubic metres, US and imperial gallons, pints and fluid ounces.',
      keywords: ['liter', 'litre', 'gallon', 'pint', 'quart', 'fluid ounce', 'cubic'],
      units: [['ml', 'Millilitres', 1e-6, 'mL'], ['l', 'Litres', 1e-3, 'L'], ['m3', 'Cubic metres', 1, 'm³'], ['cm3', 'Cubic centimetres', 1e-6, 'cm³'],
        ['in3', 'Cubic inches', IN ** 3, 'in³'], ['ft3', 'Cubic feet', FT ** 3, 'ft³'], ['gal', 'US gallons', GAL, 'US gal'], ['qt', 'US quarts', GAL / 4, 'US qt'],
        ['pt', 'US pints', GAL / 8, 'US pt'], ['cup', 'US cups', GAL / 16, 'US cup'], ['floz', 'US fluid ounces', GAL / 128, 'US fl oz'],
        ['igal', 'Imperial gallons', IMPGAL, 'imp gal'], ['ipt', 'Imperial pints', IMPGAL / 8, 'imp pt'], ['ifloz', 'Imperial fluid ounces', IMPGAL / 160, 'imp fl oz']],
      from: 'gal', to: 'l',
      examples: [{ in: { value: 1, from: 'gal', to: 'l' }, out: '1 US gal = 3.785411784 L' }, { in: { value: 1, from: 'igal', to: 'l' }, out: '1 imp gal = 4.54609 L' },
        { in: { value: 1, from: 'ft3', to: 'l' }, out: '1 ft³ = 28.31684659 L' }],
    }),
    converter({
      id: 'unit-mass', name: 'Weight & mass converter', icon: '⚖', desc: 'Convert kilograms, pounds, ounces, stone, tonnes and more.',
      keywords: ['weight', 'kg', 'lb', 'pound', 'ounce', 'stone', 'ton', 'gram'],
      units: [['mg', 'Milligrams', 1e-6, 'mg'], ['g', 'Grams', 1e-3, 'g'], ['kg', 'Kilograms', 1, 'kg'], ['t', 'Tonnes (metric)', 1000, 't'],
        ['oz', 'Ounces', LB / 16, 'oz'], ['lb', 'Pounds', LB, 'lb'], ['st', 'Stone', LB * 14, 'st'], ['ton', 'US short tons', LB * 2000, 'short ton'],
        ['lton', 'UK long tons', LB * 2240, 'long ton'], ['ct', 'Carats', 2e-4, 'ct'], ['gr', 'Grains', LB / 7000, 'gr']],
      from: 'lb', to: 'kg',
      examples: [{ in: { value: 1, from: 'lb', to: 'kg' }, out: '1 lb = 0.45359237 kg' }, { in: { value: 1, from: 'st', to: 'lb' }, out: '1 st = 14 lb' },
        { in: { value: 1, from: 'kg', to: 'lb' }, out: '1 kg = 2.204622622 lb' }],
    }),
    {
      id: 'unit-temperature', name: 'Temperature converter', icon: '🌡', family: 'convert', desc: 'Convert between Celsius, Fahrenheit, Kelvin and Rankine.',
      keywords: ['celsius', 'fahrenheit', 'kelvin', 'degrees'],
      fields: [
        { id: 'value', label: 'Value', type: 'number', value: 100 },
        { id: 'from', label: 'From', type: 'select', value: 'C', options: Object.entries(TEMP).map(([k, t]) => [k, t.label]) },
        { id: 'to', label: 'To', type: 'select', value: 'F', options: Object.entries(TEMP).map(([k, t]) => [k, t.label]) },
      ],
      run(v) {
        const x = need(v.value, 'the temperature');
        const a = TEMP[v.from], b = TEMP[v.to];
        if (!a || !b) throw new Error('Pick the scales to convert from and to.');
        const k = a.toK(x);
        if (k < -1e-9) throw new Error('That is colder than absolute zero (0 K = −273.15 °C = −459.67 °F).');
        return `${fmt(x)} ${a.sym} = ${fmt(b.fromK(Math.max(k, 0)))} ${b.sym}`;
      },
      examples: [{ in: { value: 100, from: 'C', to: 'F' }, out: '100 °C = 212 °F' }, { in: { value: -40, from: 'F', to: 'C' }, out: '-40 °F = -40 °C' },
        { in: { value: 0, from: 'K', to: 'C' }, out: '0 K = -273.15 °C' }, { in: { value: 98.6, from: 'F', to: 'C' }, out: '98.6 °F = 37 °C' }],
    },
    converter({
      id: 'unit-speed', name: 'Speed converter', icon: '🏎', desc: 'Convert km/h, mph, m/s, knots and feet per second.',
      keywords: ['velocity', 'kmh', 'mph', 'knot'],
      units: [['ms', 'Metres per second', 1, 'm/s'], ['kmh', 'Kilometres per hour', 1 / 3.6, 'km/h'], ['mph', 'Miles per hour', MI / 3600, 'mph'],
        ['kn', 'Knots', NMI / 3600, 'kn'], ['fts', 'Feet per second', FT, 'ft/s']],
      from: 'mph', to: 'kmh',
      examples: [{ in: { value: 1, from: 'mph', to: 'kmh' }, out: '1 mph = 1.609344 km/h' }, { in: { value: 36, from: 'kmh', to: 'ms' }, out: '36 km/h = 10 m/s' },
        { in: { value: 1, from: 'kn', to: 'kmh' }, out: '1 kn = 1.852 km/h' }],
    }),
    converter({
      id: 'unit-time', name: 'Time duration converter', icon: '⏱', desc: 'Convert seconds, minutes, hours, days, weeks and average months/years.',
      keywords: ['duration', 'seconds', 'minutes', 'hours', 'days'],
      units: [['ns', 'Nanoseconds', 1e-9, 'ns'], ['us', 'Microseconds', 1e-6, 'µs'], ['ms', 'Milliseconds', 1e-3, 'ms'], ['s', 'Seconds', 1, 's'],
        ['min', 'Minutes', 60, 'min'], ['h', 'Hours', 3600, 'h'], ['d', 'Days', 86400, 'days'], ['wk', 'Weeks', 604800, 'weeks'],
        ['mo', 'Months (average, 30.436875 days)', 2629746, 'months'], ['yr', 'Years (average Gregorian, 365.2425 days)', 31556952, 'years'],
        ['dec', 'Decades (average)', 315569520, 'decades'], ['cen', 'Centuries (average)', 3155695200, 'centuries']],
      from: 'd', to: 'h',
      examples: [{ in: { value: 1, from: 'd', to: 's' }, out: '1 days = 86400 s' }, { in: { value: 1, from: 'yr', to: 'd' }, out: '1 years = 365.2425 days' },
        { in: { value: 90, from: 'min', to: 'h' }, out: '90 min = 1.5 h' }],
    }),
    converter({
      id: 'unit-data', name: 'Data size converter', icon: '💾', desc: 'Convert bits, bytes, decimal kB/MB/GB/TB and binary KiB/MiB/GiB/TiB.',
      keywords: ['bytes', 'megabyte', 'gigabyte', 'kibibyte', 'mebibyte', 'storage', 'bits'],
      units: [['bit', 'Bits', 1 / 8, 'bit'], ['B', 'Bytes', 1, 'B'], ['kbit', 'Kilobits', 125, 'kbit'], ['Mbit', 'Megabits', 125e3, 'Mbit'], ['Gbit', 'Gigabits', 125e6, 'Gbit'],
        ['kB', 'Kilobytes (1000 B)', 1e3, 'kB'], ['MB', 'Megabytes (1000² B)', 1e6, 'MB'], ['GB', 'Gigabytes (1000³ B)', 1e9, 'GB'], ['TB', 'Terabytes (1000⁴ B)', 1e12, 'TB'],
        ['PB', 'Petabytes (1000⁵ B)', 1e15, 'PB'], ['KiB', 'Kibibytes (1024 B)', 1024, 'KiB'], ['MiB', 'Mebibytes (1024² B)', 1024 ** 2, 'MiB'],
        ['GiB', 'Gibibytes (1024³ B)', 1024 ** 3, 'GiB'], ['TiB', 'Tebibytes (1024⁴ B)', 1024 ** 4, 'TiB'], ['PiB', 'Pebibytes (1024⁵ B)', 1024 ** 5, 'PiB']],
      from: 'GB', to: 'GiB',
      examples: [{ in: { value: 1, from: 'GiB', to: 'MB' }, out: '1 GiB = 1073.741824 MB' }, { in: { value: 1, from: 'B', to: 'bit' }, out: '1 B = 8 bit' },
        { in: { value: 1, from: 'TB', to: 'GiB' }, out: '1 TB = 931.3225746 GiB' }],
    }),
    converter({
      id: 'unit-pressure', name: 'Pressure converter', icon: '🎈', desc: 'Convert pascals, bar, atmospheres, psi, mmHg, inHg and torr.',
      keywords: ['psi', 'bar', 'atm', 'pascal', 'tire', 'tyre', 'mmhg'],
      units: [['pa', 'Pascals', 1, 'Pa'], ['hpa', 'Hectopascals', 100, 'hPa'], ['kpa', 'Kilopascals', 1000, 'kPa'], ['mpa', 'Megapascals', 1e6, 'MPa'],
        ['bar', 'Bar', 1e5, 'bar'], ['mbar', 'Millibar', 100, 'mbar'], ['atm', 'Standard atmospheres', 101325, 'atm'], ['psi', 'Pounds per square inch', LBF / (IN * IN), 'psi'],
        ['mmhg', 'Millimetres of mercury', 133.322387415, 'mmHg'], ['inhg', 'Inches of mercury', 3386.389, 'inHg'], ['torr', 'Torr', 101325 / 760, 'Torr']],
      from: 'psi', to: 'bar',
      examples: [{ in: { value: 1, from: 'atm', to: 'psi' }, out: '1 atm = 14.69594878 psi' }, { in: { value: 1, from: 'atm', to: 'torr' }, out: '1 atm = 760 Torr' },
        { in: { value: 1, from: 'bar', to: 'kpa' }, out: '1 bar = 100 kPa' }],
    }),
    converter({
      id: 'unit-energy', name: 'Energy converter', icon: '🔋', desc: 'Convert joules, calories, kWh, BTU, electronvolts and more.',
      keywords: ['joule', 'calorie', 'kcal', 'kwh', 'btu', 'ev', 'therm'],
      units: [['j', 'Joules', 1, 'J'], ['kj', 'Kilojoules', 1000, 'kJ'], ['mj', 'Megajoules', 1e6, 'MJ'], ['cal', 'Calories (thermochemical)', CAL, 'cal'],
        ['kcal', 'Kilocalories (food Calories)', CAL * 1000, 'kcal'], ['wh', 'Watt-hours', 3600, 'Wh'], ['kwh', 'Kilowatt-hours', 3.6e6, 'kWh'],
        ['btu', 'BTU (International Table)', BTU, 'BTU'], ['therm', 'Therms (US)', 105480400, 'thm'], ['ev', 'Electronvolts', E_CHARGE, 'eV'],
        ['ftlb', 'Foot-pounds', FT * LBF, 'ft·lbf'], ['erg', 'Ergs', 1e-7, 'erg']],
      from: 'kwh', to: 'mj',
      examples: [{ in: { value: 1, from: 'kwh', to: 'j' }, out: '1 kWh = 3600000 J' }, { in: { value: 1, from: 'kcal', to: 'kj' }, out: '1 kcal = 4.184 kJ' },
        { in: { value: 1, from: 'btu', to: 'j' }, out: '1 BTU = 1055.055853 J' }],
    }),
    converter({
      id: 'unit-power', name: 'Power converter', icon: '⚡', desc: 'Convert watts, kilowatts, horsepower (mechanical and metric) and BTU/h.',
      keywords: ['watt', 'horsepower', 'hp', 'kw', 'btu/h'],
      units: [['w', 'Watts', 1, 'W'], ['kw', 'Kilowatts', 1000, 'kW'], ['mw', 'Megawatts', 1e6, 'MW'], ['hp', 'Horsepower (mechanical)', 550 * FT * LBF, 'hp'],
        ['ps', 'Metric horsepower (PS)', 75 * G0, 'PS'], ['btuh', 'BTU per hour', BTU / 3600, 'BTU/h'], ['kcalh', 'Kilocalories per hour', CAL * 1000 / 3600, 'kcal/h'],
        ['ftlbs', 'Foot-pounds per second', FT * LBF, 'ft·lbf/s']],
      from: 'hp', to: 'kw',
      examples: [{ in: { value: 1, from: 'hp', to: 'w' }, out: '1 hp = 745.6998716 W' }, { in: { value: 1, from: 'ps', to: 'w' }, out: '1 PS = 735.49875 W' }],
    }),
    converter({
      id: 'unit-force', name: 'Force converter', icon: '💪', desc: 'Convert newtons, kilonewtons, pound-force, kilogram-force and dynes.',
      keywords: ['newton', 'lbf', 'kgf', 'dyne'],
      units: [['n', 'Newtons', 1, 'N'], ['kn', 'Kilonewtons', 1000, 'kN'], ['lbf', 'Pound-force', LBF, 'lbf'], ['kgf', 'Kilogram-force', G0, 'kgf'],
        ['ozf', 'Ounce-force', LBF / 16, 'ozf'], ['kip', 'Kips (1000 lbf)', LBF * 1000, 'kip'], ['pdl', 'Poundals', LB * FT, 'pdl'], ['dyn', 'Dynes', 1e-5, 'dyn']],
      from: 'lbf', to: 'n',
      examples: [{ in: { value: 1, from: 'lbf', to: 'n' }, out: '1 lbf = 4.448221615 N' }, { in: { value: 1, from: 'kgf', to: 'n' }, out: '1 kgf = 9.80665 N' }],
    }),
    converter({
      id: 'unit-angle', name: 'Angle converter', icon: '📐', desc: 'Convert degrees, radians, gradians, turns, arcminutes and arcseconds.',
      keywords: ['degree', 'radian', 'gradian', 'arcminute'],
      units: [['deg', 'Degrees', Math.PI / 180, '°'], ['rad', 'Radians', 1, 'rad'], ['mrad', 'Milliradians', 1e-3, 'mrad'], ['grad', 'Gradians', Math.PI / 200, 'grad'],
        ['turn', 'Turns', 2 * Math.PI, 'turn'], ['arcmin', 'Arcminutes', Math.PI / 10800, '′'], ['arcsec', 'Arcseconds', Math.PI / 648000, '″']],
      from: 'deg', to: 'rad',
      examples: [{ in: { value: 180, from: 'deg', to: 'rad' }, out: '180 ° = 3.141592654 rad' }, { in: { value: 1, from: 'turn', to: 'deg' }, out: '1 turn = 360 °' },
        { in: { value: 100, from: 'grad', to: 'deg' }, out: '100 grad = 90 °' }],
    }),
    {
      id: 'unit-fuel-economy', name: 'Fuel economy converter', icon: '⛽', family: 'convert', desc: 'Convert mpg (US or UK), litres per 100 km and km per litre.',
      keywords: ['mpg', 'l/100km', 'consumption', 'mileage'],
      fields: [
        { id: 'value', label: 'Value', type: 'number', value: 30 },
        { id: 'from', label: 'From', type: 'select', value: 'mpgus', options: Object.entries(FUEL).map(([k, u]) => [k, u.label]) },
        { id: 'to', label: 'To', type: 'select', value: 'l100', options: Object.entries(FUEL).map(([k, u]) => [k, u.label]) },
      ],
      run(v) {
        const x = need(v.value, 'the fuel economy', { pos: true });
        const a = FUEL[v.from], b = FUEL[v.to];
        if (!a || !b) throw new Error('Pick the units to convert from and to.');
        return `${fmt(x)} ${a.sym} = ${fmt(b.fromKmL(a.toKmL(x)))} ${b.sym}`;
      },
      examples: [{ in: { value: 30, from: 'mpgus', to: 'l100' }, out: '30 mpg (US) = 7.840486111 L/100 km' },
        { in: { value: 5, from: 'l100', to: 'kml' }, out: '5 L/100 km = 20 km/L' }, { in: { value: 1, from: 'mpgus', to: 'kml' }, out: '1 mpg (US) = 0.4251437074 km/L' }],
    },
    {
      id: 'unit-cooking', name: 'Cooking measurement converter', icon: '🥄', family: 'convert',
      desc: 'Convert cups, spoons, millilitres and grams for common ingredients (weights are typical values, so approximate).',
      keywords: ['recipe', 'cup', 'tablespoon', 'teaspoon', 'baking', 'grams', 'flour', 'sugar'],
      fields: [
        { id: 'value', label: 'Amount', type: 'number', value: 1 },
        { id: 'from', label: 'From', type: 'select', value: 'cup', options: Object.entries(COOK_UNITS).map(([k, u]) => [k, u[0]]) },
        { id: 'to', label: 'To', type: 'select', value: 'g', options: Object.entries(COOK_UNITS).map(([k, u]) => [k, u[0]]) },
        { id: 'ing', label: 'Ingredient (for volume ⇄ weight)', type: 'select', value: 'water', options: Object.entries(INGREDIENTS).map(([k, i]) => [k, i[0]]) },
      ],
      run(v) {
        const x = need(v.value, 'the amount', { nonneg: true });
        const a = COOK_UNITS[v.from], b = COOK_UNITS[v.to], ing = INGREDIENTS[v.ing];
        if (!a || !b || !ing) throw new Error('Pick the units and the ingredient.');
        const density = ing[1] / CUP; // g per mL
        let base = x * a[3]; // mL or g
        if (a[2] !== b[2]) base = a[2] === 'v' ? base * density : base / density;
        return `${fmt(x)} ${a[1]} ${ing[0].toLowerCase()} ≈ ${fmt(base / b[3], 4)} ${b[1]}`;
      },
      examples: [{ in: { value: 1, from: 'cup', to: 'ml', ing: 'water' }, out: '1 cup water ≈ 236.6 mL' },
        { in: { value: 2, from: 'cup', to: 'g', ing: 'flour' }, out: '2 cup all-purpose flour ≈ 250 g' },
        { in: { value: 1, from: 'tbsp', to: 'tsp', ing: 'water' }, out: '1 tbsp water ≈ 3 tsp' },
        { in: { value: 100, from: 'g', to: 'cup', ing: 'sugar' }, out: '100 g granulated sugar ≈ 0.5 cup' }],
    },
    {
      id: 'unit-shoe-size', name: 'Shoe size converter', icon: '👟', family: 'convert',
      desc: 'Approximate adult shoe sizes across EU, UK and US (men and women). Brands vary — always try shoes on.',
      keywords: ['shoe', 'size', 'eu', 'uk', 'us', 'footwear'],
      fields: [
        { id: 'size', label: 'Size', type: 'number', value: 42, step: 0.5 },
        { id: 'sys', label: 'Size system', type: 'select', value: 'eu', options: [['eu', 'EU'], ['uk', 'UK'], ['usm', 'US men'], ['usw', 'US women']] },
      ],
      run(v) {
        const x = need(v.size, 'the size', { pos: true });
        // UK adult sizes are barleycorns (1/3 in) from a 25-barleycorn base; EU
        // (Paris points) are 2/3 cm: EU = 1.27 × (UK + 25). US men ≈ UK + 1, US women ≈ UK + 2.5.
        const toUK = { eu: x / 1.27 - 25, uk: x, usm: x - 1, usw: x - 2.5 }[v.sys];
        if (toUK === undefined) throw new Error('Pick a size system.');
        if (toUK < 0 || toUK > 16) throw new Error('That size is outside the adult range this chart covers (about EU 32–52).');
        const half = n => fmt(Math.round(n * 2) / 2);
        return [['EU', half(1.27 * (toUK + 25))], ['UK', half(toUK)], ['US men', half(toUK + 1)], ['US women', half(toUK + 2.5)],
          ['Note', 'Approximate — sizing differs between brands.']];
      },
      examples: [{ in: { size: 42, sys: 'eu' }, out: [['EU', '42'], ['UK', '8'], ['US men', '9'], ['US women', '10.5'], ['Note', 'Approximate — sizing differs between brands.']] },
        { in: { size: 7.5, sys: 'usw' }, out: [['EU', '38'], ['UK', '5'], ['US men', '6'], ['US women', '7.5'], ['Note', 'Approximate — sizing differs between brands.']] }],
    },
    {
      id: 'unit-number-base', name: 'Number base converter', icon: '🔢', family: 'convert',
      desc: 'Convert whole numbers of any size between bases 2–36 (binary, octal, decimal, hex…).',
      keywords: ['binary', 'hex', 'hexadecimal', 'octal', 'decimal', 'radix', 'base36'],
      fields: [
        { id: 'num', label: 'Number', type: 'text', value: '255', placeholder: 'e.g. 255, ff, 0b1010' },
        { id: 'from', label: 'From base (2–36)', type: 'number', value: 10, min: 2, max: 36 },
        { id: 'to', label: 'To base (2–36)', type: 'number', value: 16, min: 2, max: 36 },
      ],
      run(v) {
        const from = need(v.from, 'the "from" base', { int: true, min: 2, max: 36 });
        const to = need(v.to, 'the "to" base', { int: true, min: 2, max: 36 });
        const x = bigFromBase(v.num, from);
        return [[`Base ${to}`, bigToBase(x, to)], ['Binary', bigToBase(x, 2)], ['Octal', bigToBase(x, 8)], ['Decimal', x.toString()], ['Hexadecimal', bigToBase(x, 16)]];
      },
      examples: [{ in: { num: '255', from: 10, to: 16 }, out: [['Base 16', 'FF'], ['Binary', '11111111'], ['Octal', '377'], ['Decimal', '255'], ['Hexadecimal', 'FF']] },
        { in: { num: 'zz', from: 36, to: 10 }, out: [['Base 10', '1295'], ['Binary', '10100001111'], ['Octal', '2417'], ['Decimal', '1295'], ['Hexadecimal', '50F']] },
        { in: { num: '-0b1010', from: 2, to: 3 }, out: [['Base 3', '-101'], ['Binary', '-1010'], ['Octal', '-12'], ['Decimal', '-10'], ['Hexadecimal', '-A']] }],
    },
    converter({
      id: 'unit-density', name: 'Density converter', icon: '🧊', desc: 'Convert kg/m³, g/cm³, kg/L, lb/ft³, lb/in³ and lb per US gallon.',
      keywords: ['density', 'specific gravity', 'kg/m3', 'g/cm3'],
      units: [['kgm3', 'Kilograms per cubic metre', 1, 'kg/m³'], ['gcm3', 'Grams per cubic centimetre (= g/mL)', 1000, 'g/cm³'], ['kgl', 'Kilograms per litre', 1000, 'kg/L'],
        ['gl', 'Grams per litre', 1, 'g/L'], ['lbft3', 'Pounds per cubic foot', LB / FT ** 3, 'lb/ft³'], ['lbin3', 'Pounds per cubic inch', LB / IN ** 3, 'lb/in³'],
        ['lbgal', 'Pounds per US gallon', LB / GAL, 'lb/gal']],
      from: 'gcm3', to: 'kgm3',
      examples: [{ in: { value: 1, from: 'gcm3', to: 'kgm3' }, out: '1 g/cm³ = 1000 kg/m³' }, { in: { value: 1, from: 'gcm3', to: 'lbft3' }, out: '1 g/cm³ = 62.42796058 lb/ft³' }],
    }),
    converter({
      id: 'unit-frequency', name: 'Frequency converter', icon: '〰', desc: 'Convert hertz, kHz, MHz, GHz, revolutions per minute and radians per second.',
      keywords: ['hertz', 'rpm', 'hz', 'angular velocity'],
      units: [['hz', 'Hertz', 1, 'Hz'], ['khz', 'Kilohertz', 1e3, 'kHz'], ['mhz', 'Megahertz', 1e6, 'MHz'], ['ghz', 'Gigahertz', 1e9, 'GHz'], ['thz', 'Terahertz', 1e12, 'THz'],
        ['rpm', 'Revolutions per minute', 1 / 60, 'rpm'], ['rads', 'Radians per second', 1 / (2 * Math.PI), 'rad/s']],
      from: 'rpm', to: 'hz',
      examples: [{ in: { value: 60, from: 'rpm', to: 'hz' }, out: '60 rpm = 1 Hz' }, { in: { value: 1, from: 'hz', to: 'rads' }, out: '1 Hz = 6.283185307 rad/s' }],
    }),
    converter({
      id: 'unit-torque', name: 'Torque converter', icon: '🔧', desc: 'Convert newton-metres, pound-feet, pound-inches and kilogram-force metres.',
      keywords: ['torque', 'nm', 'ft-lb', 'lb-ft', 'wrench'],
      units: [['nm', 'Newton-metres', 1, 'N·m'], ['ncm', 'Newton-centimetres', 0.01, 'N·cm'], ['knm', 'Kilonewton-metres', 1000, 'kN·m'], ['lbft', 'Pound-force feet', LBF * FT, 'lbf·ft'],
        ['lbin', 'Pound-force inches', LBF * IN, 'lbf·in'], ['ozin', 'Ounce-force inches', LBF / 16 * IN, 'ozf·in'], ['kgfm', 'Kilogram-force metres', G0, 'kgf·m'], ['kgfcm', 'Kilogram-force centimetres', G0 / 100, 'kgf·cm']],
      from: 'lbft', to: 'nm',
      examples: [{ in: { value: 1, from: 'lbft', to: 'nm' }, out: '1 lbf·ft = 1.355817948 N·m' }, { in: { value: 12, from: 'lbin', to: 'lbft' }, out: '12 lbf·in = 1 lbf·ft' }],
    }),
    converter({
      id: 'unit-illuminance', name: 'Illuminance converter', icon: '💡', desc: 'Convert lux, foot-candles and phots.',
      keywords: ['lux', 'foot-candle', 'light', 'brightness'],
      units: [['lx', 'Lux', 1, 'lx'], ['fc', 'Foot-candles', 1 / (FT * FT), 'fc'], ['ph', 'Phots', 1e4, 'ph'], ['nx', 'Nox', 1e-3, 'nx']],
      from: 'fc', to: 'lx',
      examples: [{ in: { value: 1, from: 'fc', to: 'lx' }, out: '1 fc = 10.76391042 lx' }, { in: { value: 1, from: 'ph', to: 'lx' }, out: '1 ph = 10000 lx' }],
    }),
    converter({
      id: 'unit-acceleration', name: 'Acceleration converter', icon: '🚀', desc: 'Convert m/s², standard gravity (g), ft/s², gal and km/h per second.',
      keywords: ['g-force', 'acceleration', 'gravity'],
      units: [['ms2', 'Metres per second squared', 1, 'm/s²'], ['g', 'Standard gravity (g)', G0, 'g'], ['fts2', 'Feet per second squared', FT, 'ft/s²'],
        ['gal', 'Gal (cm/s²)', 0.01, 'Gal'], ['kmhs', 'km/h per second', 1 / 3.6, 'km/h/s'], ['mphs', 'mph per second', MI / 3600, 'mph/s']],
      from: 'g', to: 'ms2',
      examples: [{ in: { value: 1, from: 'g', to: 'ms2' }, out: '1 g = 9.80665 m/s²' }, { in: { value: 1, from: 'g', to: 'fts2' }, out: '1 g = 32.17404856 ft/s²' }],
    }),
    converter({
      id: 'unit-flow-rate', name: 'Flow rate converter', icon: '🚰', desc: 'Convert litres per minute, cubic metres per hour, gallons per minute and CFM.',
      keywords: ['flow', 'gpm', 'cfm', 'l/min', 'pump'],
      units: [['m3s', 'Cubic metres per second', 1, 'm³/s'], ['m3h', 'Cubic metres per hour', 1 / 3600, 'm³/h'], ['ls', 'Litres per second', 1e-3, 'L/s'],
        ['lmin', 'Litres per minute', 1e-3 / 60, 'L/min'], ['lh', 'Litres per hour', 1e-3 / 3600, 'L/h'], ['gpm', 'US gallons per minute', GAL / 60, 'US gpm'],
        ['igpm', 'Imperial gallons per minute', IMPGAL / 60, 'imp gpm'], ['cfm', 'Cubic feet per minute', FT ** 3 / 60, 'CFM']],
      from: 'gpm', to: 'lmin',
      examples: [{ in: { value: 1, from: 'gpm', to: 'lmin' }, out: '1 US gpm = 3.785411784 L/min' }, { in: { value: 1, from: 'm3h', to: 'lmin' }, out: '1 m³/h = 16.66666667 L/min' }],
    }),

    // ============================== Math =====================================
    {
      id: 'math-percent', name: 'Percentage calculator', icon: '%', family: 'math', desc: 'x% of y, x is what percent of y, percent change, and adding or taking off a percentage.',
      keywords: ['percent', 'percentage', 'increase', 'decrease', 'discount'],
      fields: [
        { id: 'mode', label: 'Question', type: 'select', value: 'of', options: [['of', 'What is A% of B?'], ['what', 'A is what % of B?'], ['change', '% change from A to B'], ['add', 'B increased by A%'], ['sub', 'B decreased by A%']] },
        { id: 'a', label: 'A', type: 'number', value: 15 },
        { id: 'b', label: 'B', type: 'number', value: 200 },
      ],
      run(v) {
        const a = need(v.a, 'A'), b = need(v.b, 'B');
        switch (v.mode) {
          case 'of': return `${fmt(a)}% of ${fmt(b)} = ${fmt(a * b / 100)}`;
          case 'what': if (b === 0) throw new Error('B cannot be 0 (nothing is a percentage of 0).'); return `${fmt(a)} is ${fmt(a / b * 100)}% of ${fmt(b)}`;
          case 'change': {
            if (a === 0) throw new Error('A percent change from 0 is undefined — A cannot be 0.');
            const p = (b - a) / Math.abs(a) * 100;
            return `From ${fmt(a)} to ${fmt(b)} is ${p > 0 ? 'an increase' : p < 0 ? 'a decrease' : 'a change'} of ${fmt(Math.abs(p))}%`;
          }
          case 'add': return `${fmt(b)} + ${fmt(a)}% = ${fmt(b * (100 + a) / 100)}`;
          case 'sub': return `${fmt(b)} − ${fmt(a)}% = ${fmt(b * (100 - a) / 100)}`;
          default: throw new Error('Pick a question.');
        }
      },
      examples: [{ in: { mode: 'of', a: 15, b: 200 }, out: '15% of 200 = 30' }, { in: { mode: 'what', a: 30, b: 200 }, out: '30 is 15% of 200' },
        { in: { mode: 'change', a: 80, b: 100 }, out: 'From 80 to 100 is an increase of 25%' }, { in: { mode: 'change', a: 100, b: 80 }, out: 'From 100 to 80 is a decrease of 20%' },
        { in: { mode: 'add', a: 20, b: 50 }, out: '50 + 20% = 60' }, { in: { mode: 'sub', a: 25, b: 80 }, out: '80 − 25% = 60' }],
    },
    {
      id: 'math-ratio', name: 'Ratio simplifier', icon: '∶', family: 'math', desc: 'Reduce a ratio like 16:12 or 1.5:2.25:3 to whole numbers in lowest terms.',
      keywords: ['ratio', 'simplify', 'aspect ratio', 'proportion'],
      fields: [{ id: 'ratio', label: 'Ratio', type: 'text', value: '1920:1080', placeholder: 'e.g. 16:12 or 1.5 : 2.25 : 3' }],
      run(v) {
        const parts = String(v.ratio).split(':').map(s => s.trim());
        if (parts.length < 2) throw new Error('Enter at least two parts separated by ":" (e.g. 16:12).');
        const rs = parts.map(p => parseRational(p, 'each part of the ratio'));
        if (rs.some(r => r.n <= 0n)) throw new Error('Every part of the ratio must be greater than 0.');
        // Scale to whole numbers (LCM of denominators), then divide by the GCD.
        const l = rs.reduce((acc, r) => acc / bgcd(acc, r.d) * r.d, 1n);
        const ints = rs.map(r => r.n * (l / r.d));
        const g = ints.reduce((acc, x) => bgcd(acc, x));
        const simple = ints.map(x => x / g);
        const first = Number(simple[0]);
        return [['Simplified', simple.join(':')], ['As 1 : n', ['1', ...simple.slice(1).map(x => fmt(Number(x) / first))].join(' : ')]];
      },
      examples: [{ in: { ratio: '1920:1080' }, out: [['Simplified', '16:9'], ['As 1 : n', '1 : 0.5625']] },
        { in: { ratio: '1.5 : 2.25 : 3' }, out: [['Simplified', '2:3:4'], ['As 1 : n', '1 : 1.5 : 2']] }],
    },
    {
      id: 'math-fraction-decimal', name: 'Fraction ⇄ decimal', icon: '½', family: 'math',
      desc: 'Turn a fraction, mixed number or decimal (repeating digits in brackets, like 0.1(6)) into every other form, exactly.',
      keywords: ['fraction', 'decimal', 'repeating', 'recurring', 'mixed number'],
      fields: [{ id: 'x', label: 'Fraction or decimal', type: 'text', value: '3/8', placeholder: 'e.g. 3/8, 1 1/2, 0.375, 0.(3)' }],
      run(v) { return ratRows(parseRational(v.x)); },
      examples: [{ in: { x: '3/8' }, out: [['Fraction', '3/8'], ['Mixed number', '3/8'], ['Decimal', '0.375'], ['Percent', '37.5%']] },
        { in: { x: '0.1(6)' }, out: [['Fraction', '1/6'], ['Mixed number', '1/6'], ['Decimal', '0.1(6)'], ['Percent', '16.(6)%']] },
        { in: { x: '-1 1/2' }, out: [['Fraction', '-3/2'], ['Mixed number', '-1 1/2'], ['Decimal', '-1.5'], ['Percent', '-150%']] },
        { in: { x: '0.125' }, out: [['Fraction', '1/8'], ['Mixed number', '1/8'], ['Decimal', '0.125'], ['Percent', '12.5%']] }],
    },
    {
      id: 'math-fraction-calc', name: 'Fraction calculator', icon: '➗', family: 'math', desc: 'Add, subtract, multiply or divide fractions and mixed numbers exactly.',
      keywords: ['fraction', 'add fractions', 'common denominator'],
      fields: [
        { id: 'a', label: 'First fraction', type: 'text', value: '1/2' },
        { id: 'op', label: 'Operation', type: 'select', value: '+', options: [['+', '+ add'], ['-', '− subtract'], ['*', '× multiply'], ['/', '÷ divide']] },
        { id: 'b', label: 'Second fraction', type: 'text', value: '1/3' },
      ],
      run(v) {
        const a = parseRational(v.a, 'the first fraction'), b = parseRational(v.b, 'the second fraction');
        const f = { '+': radd, '-': rsub, '*': rmul, '/': rdiv }[v.op];
        if (!f) throw new Error('Pick an operation.');
        return ratRows(f(a, b));
      },
      examples: [{ in: { a: '1/2', op: '+', b: '1/3' }, out: [['Fraction', '5/6'], ['Mixed number', '5/6'], ['Decimal', '0.8(3)'], ['Percent', '83.(3)%']] },
        { in: { a: '1 1/2', op: '*', b: '2/3' }, out: [['Fraction', '1'], ['Mixed number', '1'], ['Decimal', '1'], ['Percent', '100%']] },
        { in: { a: '3/4', op: '/', b: '1/8' }, out: [['Fraction', '6'], ['Mixed number', '6'], ['Decimal', '6'], ['Percent', '600%']] },
        { in: { a: '1/4', op: '-', b: '2/3' }, out: [['Fraction', '-5/12'], ['Mixed number', '-5/12'], ['Decimal', '-0.41(6)'], ['Percent', '-41.(6)%']] }],
    },
    {
      id: 'math-gcd-lcm', name: 'GCD & LCM', icon: '🔗', family: 'math', desc: 'Greatest common divisor and least common multiple of any whole numbers.',
      keywords: ['gcd', 'hcf', 'gcf', 'lcm', 'common factor', 'common multiple'],
      fields: [{ id: 'nums', label: 'Whole numbers', type: 'textarea', value: '12, 18, 24' }],
      run(v) {
        const parts = String(v.nums).split(/[\s,;]+/).filter(Boolean);
        if (parts.length < 2) throw new Error('Enter at least two whole numbers.');
        const xs = parts.map(p => { if (!/^[+-]?\d+$/.test(p)) throw new Error(`"${p}" is not a whole number.`); const b = BigInt(p); if (b === 0n) throw new Error('The numbers cannot be 0.'); return babs(b); });
        const g = xs.reduce((a, b) => bgcd(a, b));
        const l = xs.reduce((a, b) => a / bgcd(a, b) * b);
        return [['GCD', g.toString()], ['LCM', l.toString()]];
      },
      examples: [{ in: { nums: '12, 18, 24' }, out: [['GCD', '6'], ['LCM', '72']] }, { in: { nums: '17 5' }, out: [['GCD', '1'], ['LCM', '85']] }],
    },
    {
      id: 'math-prime-factors', name: 'Prime check & factorization', icon: '🔍', family: 'math', desc: 'Is it prime? Prime factorization and number of divisors (up to 9 quadrillion).',
      keywords: ['prime', 'factor', 'factorization', 'divisors', 'composite'],
      fields: [{ id: 'n', label: 'Whole number', type: 'number', value: 360 }],
      run(v) {
        const n = need(v.n, 'the number', { int: true, min: 2 });
        if (n > Number.MAX_SAFE_INTEGER) throw new Error('Numbers up to 9007199254740991 are supported.');
        const f = factorize(n);
        const prime = f.length === 1 && f[0][1] === 1;
        return [['Prime?', prime ? 'Yes' : `No — divisible by ${f[0][0]}`], ['Prime factors', f.map(([p, e]) => (e > 1 ? `${p}^${e}` : `${p}`)).join(' × ')],
          ['Number of divisors', String(f.reduce((a, [, e]) => a * (e + 1), 1))]];
      },
      examples: [{ in: { n: 360 }, out: [['Prime?', 'No — divisible by 2'], ['Prime factors', '2^3 × 3^2 × 5'], ['Number of divisors', '24']] },
        { in: { n: 97 }, out: [['Prime?', 'Yes'], ['Prime factors', '97'], ['Number of divisors', '2']] },
        { in: { n: 1000000007 }, out: [['Prime?', 'Yes'], ['Prime factors', '1000000007'], ['Number of divisors', '2']] }],
    },
    {
      id: 'math-factorial', name: 'Factorial', icon: '!', family: 'math', desc: 'Exact n! for n from 0 to 1000.',
      keywords: ['factorial', 'n!'],
      fields: [{ id: 'n', label: 'n', type: 'number', value: 20, min: 0, max: 1000 }],
      run(v) {
        const n = need(v.n, 'n', { int: true, min: 0, max: 1000 });
        let r = 1n;
        for (let i = 2n; i <= BigInt(n); i++) r *= i;
        const s = r.toString();
        return [[`${n}!`, s], ['Digits', String(s.length)]];
      },
      examples: [{ in: { n: 20 }, out: [['20!', '2432902008176640000'], ['Digits', '19']] }, { in: { n: 0 }, out: [['0!', '1'], ['Digits', '1']] }],
    },
    {
      id: 'math-combinations', name: 'Combinations & permutations', icon: '🃏', family: 'math', desc: 'nCr, nPr, and both with repetition — exact results.',
      keywords: ['ncr', 'npr', 'choose', 'binomial', 'arrangements', 'combinatorics'],
      fields: [
        { id: 'n', label: 'n (items to choose from)', type: 'number', value: 52 },
        { id: 'r', label: 'r (items chosen)', type: 'number', value: 5 },
      ],
      run(v) {
        const n = need(v.n, 'n', { int: true, min: 0, max: 1000 }), r = need(v.r, 'r', { int: true, min: 0, max: 1000 });
        const N = BigInt(n), R = BigInt(r);
        const choose = (a, b) => { if (b > a) return 0n; let c = 1n; for (let i = 0n; i < b; i++) c = c * (a - i) / (i + 1n); return c; };
        let p = r > n ? 0n : 1n;
        if (r <= n) for (let i = 0n; i < R; i++) p *= N - i;
        return [['Combinations (nCr)', choose(N, R).toString()], ['Permutations (nPr)', p.toString()],
          ['Combinations with repetition', n === 0 ? (r === 0 ? '1' : '0') : choose(N + R - 1n, R).toString()], ['Permutations with repetition (nʳ)', (N ** R).toString()]];
      },
      examples: [{ in: { n: 52, r: 5 }, out: [['Combinations (nCr)', '2598960'], ['Permutations (nPr)', '311875200'], ['Combinations with repetition', '3819816'], ['Permutations with repetition (nʳ)', '380204032']] },
        { in: { n: 5, r: 2 }, out: [['Combinations (nCr)', '10'], ['Permutations (nPr)', '20'], ['Combinations with repetition', '15'], ['Permutations with repetition (nʳ)', '25']] }],
    },
    {
      id: 'math-quadratic', name: 'Quadratic equation solver', icon: '𝑥²', family: 'math', desc: 'Solve ax² + bx + c = 0, including complex roots, with discriminant and vertex.',
      keywords: ['quadratic', 'roots', 'discriminant', 'parabola', 'solve'],
      fields: [
        { id: 'a', label: 'a', type: 'number', value: 1 }, { id: 'b', label: 'b', type: 'number', value: -3 }, { id: 'c', label: 'c', type: 'number', value: 2 },
      ],
      run(v) {
        const a = need(v.a, 'a', { nonzero: true }), b = need(v.b, 'b'), c = need(v.c, 'c');
        const D = b * b - 4 * a * c;
        const vertex = ['Vertex', `(${fmt(-b / (2 * a))}, ${fmt(c - b * b / (4 * a))})`];
        if (D > 0) {
          // Numerically stable form: avoids cancellation when b² ≫ 4ac.
          const q = -(b + (b >= 0 ? 1 : -1) * Math.sqrt(D)) / 2;
          const r = [q / a, c / q].sort((x, y) => y - x);
          return [['Discriminant', fmt(D)], ['Roots', 'Two real roots'], ['x₁', fmt(r[0])], ['x₂', fmt(r[1])], vertex];
        }
        if (D === 0) return [['Discriminant', '0'], ['Roots', 'One repeated real root'], ['x', fmt(-b / (2 * a))], vertex];
        const re = -b / (2 * a), im = Math.sqrt(-D) / (2 * Math.abs(a));
        return [['Discriminant', fmt(D)], ['Roots', 'Two complex roots'], ['x₁', complexStr(re, im)], ['x₂', complexStr(re, -im)], vertex];
      },
      examples: [{ in: { a: 1, b: -3, c: 2 }, out: [['Discriminant', '1'], ['Roots', 'Two real roots'], ['x₁', '2'], ['x₂', '1'], ['Vertex', '(1.5, -0.25)']] },
        { in: { a: 1, b: 2, c: 5 }, out: [['Discriminant', '-16'], ['Roots', 'Two complex roots'], ['x₁', '-1 + 2i'], ['x₂', '-1 - 2i'], ['Vertex', '(-1, 4)']] },
        { in: { a: 1, b: -4, c: 4 }, out: [['Discriminant', '0'], ['Roots', 'One repeated real root'], ['x', '2'], ['Vertex', '(2, 0)']] }],
    },
    {
      id: 'math-linear-system', name: 'Two-equation solver', icon: '⧉', family: 'math', desc: 'Solve a₁x + b₁y = c₁ and a₂x + b₂y = c₂ for x and y.',
      keywords: ['simultaneous', 'linear system', 'cramer', 'equations'],
      fields: [
        { id: 'a1', label: 'a₁', type: 'number', value: 2 }, { id: 'b1', label: 'b₁', type: 'number', value: 3 }, { id: 'c1', label: 'c₁', type: 'number', value: 8 },
        { id: 'a2', label: 'a₂', type: 'number', value: 1 }, { id: 'b2', label: 'b₂', type: 'number', value: -1 }, { id: 'c2', label: 'c₂', type: 'number', value: -1 },
      ],
      run(v) {
        const [a1, b1, c1, a2, b2, c2] = ['a1', 'b1', 'c1', 'a2', 'b2', 'c2'].map(k => need(v[k], k));
        const det = a1 * b2 - a2 * b1;
        if (det === 0) throw new Error('No unique solution: the two equations describe parallel or identical lines.');
        return [['x', fmt((c1 * b2 - c2 * b1) / det)], ['y', fmt((a1 * c2 - a2 * c1) / det)]];
      },
      examples: [{ in: { a1: 2, b1: 3, c1: 8, a2: 1, b2: -1, c2: -1 }, out: [['x', '1'], ['y', '2']] }],
    },
    {
      id: 'math-statistics', name: 'Statistics', icon: '📊', family: 'math', desc: 'Mean, median, mode, range, variance and standard deviation of a list of numbers.',
      keywords: ['mean', 'average', 'median', 'mode', 'standard deviation', 'variance', 'stdev'],
      fields: [{ id: 'nums', label: 'Numbers', type: 'textarea', value: '2, 4, 4, 4, 5, 5, 7, 9' }],
      run(v) {
        const xs = numberList(v.nums);
        const n = xs.length;
        const sorted = xs.slice().sort((a, b) => a - b);
        const sum = xs.reduce((a, b) => a + b, 0);
        const mean = sum / n;
        const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
        const counts = new Map();
        for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1);
        const top = Math.max(...counts.values());
        const mode = top === 1 ? 'none (no value repeats)' : [...counts].filter(([, c]) => c === top).map(([x]) => fmt(x)).sort((a, b) => a - b).join(', ');
        const ss = xs.reduce((a, x) => a + (x - mean) ** 2, 0);
        const na = 'needs at least 2 numbers';
        return [['Count', String(n)], ['Sum', fmt(sum)], ['Mean', fmt(mean)], ['Median', fmt(median)], ['Mode', mode],
          ['Minimum', fmt(sorted[0])], ['Maximum', fmt(sorted[n - 1])], ['Range', fmt(sorted[n - 1] - sorted[0])],
          ['Variance (population)', fmt(ss / n)], ['Standard deviation (population)', fmt(Math.sqrt(ss / n))],
          ['Variance (sample)', n > 1 ? fmt(ss / (n - 1)) : na], ['Standard deviation (sample)', n > 1 ? fmt(Math.sqrt(ss / (n - 1))) : na]];
      },
      examples: [{ in: { nums: '2, 4, 4, 4, 5, 5, 7, 9' }, out: [['Count', '8'], ['Sum', '40'], ['Mean', '5'], ['Median', '4.5'], ['Mode', '4'], ['Minimum', '2'], ['Maximum', '9'], ['Range', '7'],
        ['Variance (population)', '4'], ['Standard deviation (population)', '2'], ['Variance (sample)', '4.571428571'], ['Standard deviation (sample)', '2.138089935']] }],
    },
    {
      id: 'math-weighted-average', name: 'Weighted average', icon: '⚖', family: 'math', desc: 'Average of values with different weights — one "value, weight" pair per line.',
      keywords: ['weighted mean', 'weights', 'grade average'],
      fields: [{ id: 'pairs', label: 'Value, weight (one pair per line)', type: 'textarea', value: '80, 2\n90, 3' }],
      run(v) {
        const lines = String(v.pairs).split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) throw new Error('Enter one "value, weight" pair per line.');
        let sw = 0, swx = 0;
        for (const l of lines) {
          const p = l.split(/[\s,;:]+/).filter(Boolean);
          if (p.length !== 2) throw new Error(`"${l}" should be a value and a weight, like "90, 3".`);
          const [x, w] = p.map(Number);
          if (!Number.isFinite(x) || !Number.isFinite(w)) throw new Error(`"${l}" contains something that is not a number.`);
          if (w < 0) throw new Error('Weights cannot be negative.');
          sw += w; swx += w * x;
        }
        if (sw === 0) throw new Error('The weights add up to 0 — at least one weight must be positive.');
        return [['Weighted average', fmt(swx / sw)], ['Total weight', fmt(sw)], ['Pairs', String(lines.length)]];
      },
      examples: [{ in: { pairs: '80, 2\n90, 3' }, out: [['Weighted average', '86'], ['Total weight', '5'], ['Pairs', '2']] }],
    },
    {
      id: 'math-round', name: 'Rounding', icon: '≈', family: 'math', desc: 'Round to decimal places or significant figures, exactly as typed (halves round away from zero).',
      keywords: ['round', 'significant figures', 'sig figs', 'decimal places'],
      fields: [
        { id: 'x', label: 'Number', type: 'text', value: '3.14159' },
        { id: 'mode', label: 'Round to', type: 'select', value: 'dp', options: [['dp', 'Decimal places'], ['sf', 'Significant figures']] },
        { id: 'digits', label: 'How many', type: 'number', value: 2, min: 0 },
      ],
      run(v) {
        const d = parseDecimal(v.x);
        if (v.mode === 'dp') return decToString(roundDec(d, need(v.digits, 'the number of decimal places', { int: true, min: 0, max: 100 })));
        if (v.mode !== 'sf') throw new Error('Pick decimal places or significant figures.');
        const sf = need(v.digits, 'the number of significant figures', { int: true, min: 1, max: 100 });
        if (d.M === 0n) return '0';
        const lead = d.M.toString().length - 1 - d.scale; // power of ten of the first digit
        let r = roundDec(d, sf - 1 - lead);
        if (r.M.toString().length > sf) r = { ...r, M: r.M / 10n, scale: r.scale - 1 }; // 9.99 → 10.0 carried a digit
        return decToString(r);
      },
      examples: [{ in: { x: '1.005', mode: 'dp', digits: 2 }, out: '1.01' }, { in: { x: '-2.5', mode: 'dp', digits: 0 }, out: '-3' },
        { in: { x: '123456', mode: 'sf', digits: 2 }, out: '120000' }, { in: { x: '0.00123456', mode: 'sf', digits: 3 }, out: '0.00123' },
        { in: { x: '9.99', mode: 'sf', digits: 2 }, out: '10' }, { in: { x: '1.2', mode: 'sf', digits: 3 }, out: '1.20' }],
    },
    {
      id: 'math-sci-notation', name: 'Scientific notation', icon: '×10ⁿ', family: 'math', desc: 'Write a number in scientific, E and engineering notation, or back to a plain decimal.',
      keywords: ['scientific notation', 'standard form', 'engineering notation', 'exponent'],
      fields: [{ id: 'x', label: 'Number', type: 'text', value: '123000', placeholder: 'e.g. 123000, 0.00045, 6.02e23' }],
      run(v) {
        const d = parseDecimal(v.x);
        let { M, scale } = d;
        if (M === 0n) return [['Scientific', '0'], ['E notation', '0'], ['Engineering', '0'], ['Decimal', '0']];
        while (M % 10n === 0n) { M /= 10n; scale--; }
        const digits = M.toString(), sign = d.neg ? '-' : '';
        const exp = digits.length - 1 - scale;
        const mant = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '');
        const e3 = Math.floor(exp / 3) * 3, shift = exp - e3;
        const ip = digits.slice(0, shift + 1).padEnd(shift + 1, '0'), rest = digits.slice(shift + 1);
        return [['Scientific', `${sign}${mant} × 10^${exp}`], ['E notation', `${sign}${mant}e${exp}`],
          ['Engineering', `${sign}${ip}${rest ? '.' + rest : ''} × 10^${e3}`], ['Decimal', decToString({ neg: d.neg, M, scale })]];
      },
      examples: [{ in: { x: '123000' }, out: [['Scientific', '1.23 × 10^5'], ['E notation', '1.23e5'], ['Engineering', '123 × 10^3'], ['Decimal', '123000']] },
        { in: { x: '0.00045' }, out: [['Scientific', '4.5 × 10^-4'], ['E notation', '4.5e-4'], ['Engineering', '450 × 10^-6'], ['Decimal', '0.00045']] },
        { in: { x: '-6.02e23' }, out: [['Scientific', '-6.02 × 10^23'], ['E notation', '-6.02e23'], ['Engineering', '-602 × 10^21'], ['Decimal', '-602000000000000000000000']] }],
    },
    {
      id: 'math-power', name: 'Power calculator', icon: 'xʸ', family: 'math', desc: 'Raise a number to any power, including fractional and negative exponents.',
      keywords: ['exponent', 'power', 'squared', 'cubed'],
      fields: [{ id: 'b', label: 'Base', type: 'number', value: 2 }, { id: 'e', label: 'Exponent', type: 'number', value: 10 }],
      run(v) {
        const b = need(v.b, 'the base'), e = need(v.e, 'the exponent');
        if (b === 0 && e < 0) throw new Error('0 to a negative power is undefined (division by zero).');
        if (b < 0 && !Number.isInteger(e)) throw new Error('A negative base with a fractional exponent has no real result.');
        return `${fmt(b)}^${fmt(e)} = ${fmt(b ** e)}`;
      },
      examples: [{ in: { b: 2, e: 10 }, out: '2^10 = 1024' }, { in: { b: 2, e: 0.5 }, out: '2^0.5 = 1.414213562' }, { in: { b: 10, e: -3 }, out: '10^-3 = 0.001' }],
    },
    {
      id: 'math-log', name: 'Logarithm calculator', icon: 'log', family: 'math', desc: 'Logarithm of a number in any base, plus natural log, log₁₀ and log₂.',
      keywords: ['log', 'ln', 'logarithm', 'natural log'],
      fields: [{ id: 'x', label: 'Number', type: 'number', value: 1000 }, { id: 'base', label: 'Base', type: 'number', value: 10 }],
      run(v) {
        const x = need(v.x, 'the number', { pos: true });
        const b = need(v.base, 'the base', { pos: true });
        if (b === 1) throw new Error('The base cannot be 1.');
        const lb = b === 10 ? Math.log10(x) : b === 2 ? Math.log2(x) : Math.log(x) / Math.log(b);
        return [[`log base ${fmt(b)}`, fmt(lb)], ['Natural log (ln)', fmt(Math.log(x))], ['log₁₀', fmt(Math.log10(x))], ['log₂', fmt(Math.log2(x))]];
      },
      examples: [{ in: { x: 1000, base: 10 }, out: [['log base 10', '3'], ['Natural log (ln)', '6.907755279'], ['log₁₀', '3'], ['log₂', '9.965784285']] },
        { in: { x: 81, base: 3 }, out: [['log base 3', '4'], ['Natural log (ln)', '4.394449155'], ['log₁₀', '1.908485019'], ['log₂', '6.339850003']] }],
    },
    {
      id: 'math-root', name: 'Root calculator', icon: '√', family: 'math', desc: 'Square root, cube root or any nth root (odd roots of negative numbers too).',
      keywords: ['square root', 'cube root', 'nth root', 'radical'],
      fields: [{ id: 'x', label: 'Number', type: 'number', value: 2 }, { id: 'n', label: 'Root (n)', type: 'number', value: 2, min: 2 }],
      run(v) {
        const x = need(v.x, 'the number'), n = need(v.n, 'n', { int: true, min: 2, max: 1000 });
        if (x < 0 && n % 2 === 0) throw new Error('An even root of a negative number is not a real number.');
        const r = n === 2 ? Math.sqrt(x) : n === 3 ? Math.cbrt(x) : Math.sign(x) * Math.abs(x) ** (1 / n);
        return `${ordinalRoot(n)} of ${fmt(x)} = ${fmt(r)}`;
      },
      examples: [{ in: { x: 2, n: 2 }, out: 'Square root of 2 = 1.414213562' }, { in: { x: -27, n: 3 }, out: 'Cube root of -27 = -3' }, { in: { x: 32, n: 5 }, out: '5th root of 32 = 2' }],
    },
    {
      id: 'math-pythagoras', name: 'Pythagorean theorem', icon: '📐', family: 'math', desc: 'Right triangle: enter any two of the legs a, b and hypotenuse c to get the third.',
      keywords: ['pythagoras', 'hypotenuse', 'right triangle'],
      fields: [
        { id: 'a', label: 'Leg a', type: 'number', value: 3 }, { id: 'b', label: 'Leg b', type: 'number', value: 4 },
        { id: 'c', label: 'Hypotenuse c (leave one box empty)', type: 'number', value: '' },
      ],
      run(v) {
        const got = filled(v, ['a', 'b', 'c'], 2, ['a', 'b', 'c']);
        for (const k of got) need(v[k], k, { pos: true });
        let { a, b, c } = v;
        if (!got.includes('c')) c = Math.hypot(a, b);
        else {
          const leg = got.includes('a') ? a : b;
          if (c <= leg) throw new Error('The hypotenuse must be longer than either leg.');
          const other = Math.sqrt(c * c - leg * leg);
          if (got.includes('a')) b = other; else a = other;
        }
        return [['a', fmt(a)], ['b', fmt(b)], ['c', fmt(c)]];
      },
      examples: [{ in: { a: 3, b: 4, c: '' }, out: [['a', '3'], ['b', '4'], ['c', '5']] }, { in: { a: 5, b: '', c: 13 }, out: [['a', '5'], ['b', '12'], ['c', '13']] }],
    },
    {
      id: 'math-triangle', name: 'Triangle from three sides', icon: '△', family: 'math', desc: 'Area (Heron’s formula), perimeter, angles and type of a triangle from its three sides.',
      keywords: ['heron', 'triangle area', 'law of cosines', 'angles'],
      fields: [{ id: 'a', label: 'Side a', type: 'number', value: 3 }, { id: 'b', label: 'Side b', type: 'number', value: 4 }, { id: 'c', label: 'Side c', type: 'number', value: 5 }],
      run(v) {
        const a = need(v.a, 'side a', { pos: true }), b = need(v.b, 'side b', { pos: true }), c = need(v.c, 'side c', { pos: true });
        if (a + b <= c || a + c <= b || b + c <= a) throw new Error('These sides cannot form a triangle: each side must be shorter than the other two together.');
        const s = (a + b + c) / 2;
        const area = Math.sqrt(s * (s - a) * (s - b) * (s - c));
        const ang = (x, y, z) => Math.acos(Math.min(1, Math.max(-1, (y * y + z * z - x * x) / (2 * y * z)))) / DEG;
        const A = ang(a, b, c), B = ang(b, a, c), C = 180 - A - B;
        const big = Math.max(A, B, C);
        const kind = a === b && b === c ? 'Equilateral' : a === b || b === c || a === c ? 'Isosceles' : 'Scalene';
        const corner = Math.abs(big - 90) < 1e-9 ? 'right' : big > 90 ? 'obtuse' : 'acute';
        return [['Area', fmt(area)], ['Perimeter', fmt(2 * s)], ['Angle A (opposite a)', `${fmt(A)}°`], ['Angle B (opposite b)', `${fmt(B)}°`],
          ['Angle C (opposite c)', `${fmt(C)}°`], ['Type', `${kind}, ${corner}`]];
      },
      examples: [{ in: { a: 3, b: 4, c: 5 }, out: [['Area', '6'], ['Perimeter', '12'], ['Angle A (opposite a)', '36.86989765°'], ['Angle B (opposite b)', '53.13010235°'], ['Angle C (opposite c)', '90°'], ['Type', 'Scalene, right']] },
        { in: { a: 2, b: 2, c: 2 }, out: [['Area', '1.732050808'], ['Perimeter', '6'], ['Angle A (opposite a)', '60°'], ['Angle B (opposite b)', '60°'], ['Angle C (opposite c)', '60°'], ['Type', 'Equilateral, acute']] }],
    },
    {
      id: 'math-circle', name: 'Circle calculator', icon: '◯', family: 'math', desc: 'From any one of radius, diameter, circumference or area, get all the others.',
      keywords: ['circle', 'radius', 'diameter', 'circumference', 'pi'],
      fields: [
        { id: 'known', label: 'I know the', type: 'select', value: 'r', options: [['r', 'Radius'], ['d', 'Diameter'], ['c', 'Circumference'], ['a', 'Area']] },
        { id: 'x', label: 'Value', type: 'number', value: 1 },
      ],
      run(v) {
        const x = need(v.x, 'the value', { pos: true });
        const r = { r: x, d: x / 2, c: x / (2 * Math.PI), a: Math.sqrt(x / Math.PI) }[v.known];
        if (r === undefined) throw new Error('Pick what you know.');
        return [['Radius', fmt(r)], ['Diameter', fmt(2 * r)], ['Circumference', fmt(2 * Math.PI * r)], ['Area', fmt(Math.PI * r * r)]];
      },
      examples: [{ in: { known: 'r', x: 1 }, out: [['Radius', '1'], ['Diameter', '2'], ['Circumference', '6.283185307'], ['Area', '3.141592654']] },
        { in: { known: 'a', x: Math.PI }, out: [['Radius', '1'], ['Diameter', '2'], ['Circumference', '6.283185307'], ['Area', '3.141592654']] }],
    },
    {
      id: 'math-solid', name: 'Sphere, cylinder & cone', icon: '🧊', family: 'math', desc: 'Volume and surface area of a sphere, cylinder or cone.',
      keywords: ['volume', 'surface area', 'sphere', 'cylinder', 'cone', '3d'],
      fields: [
        { id: 'shape', label: 'Shape', type: 'select', value: 'cylinder', options: [['sphere', 'Sphere'], ['cylinder', 'Cylinder'], ['cone', 'Cone']] },
        { id: 'r', label: 'Radius', type: 'number', value: 1 },
        { id: 'h', label: 'Height (cylinder and cone)', type: 'number', value: 2 },
      ],
      run(v) {
        const r = need(v.r, 'the radius', { pos: true });
        const P = Math.PI;
        if (v.shape === 'sphere') return [['Volume', fmt(4 / 3 * P * r ** 3)], ['Surface area', fmt(4 * P * r * r)]];
        const h = need(v.h, 'the height', { pos: true });
        if (v.shape === 'cylinder') return [['Volume', fmt(P * r * r * h)], ['Side (lateral) area', fmt(2 * P * r * h)], ['Total surface area', fmt(2 * P * r * (r + h))]];
        if (v.shape === 'cone') {
          const l = Math.hypot(r, h);
          return [['Volume', fmt(P * r * r * h / 3)], ['Slant height', fmt(l)], ['Side (lateral) area', fmt(P * r * l)], ['Total surface area', fmt(P * r * (r + l))]];
        }
        throw new Error('Pick a shape.');
      },
      examples: [{ in: { shape: 'sphere', r: 1 }, out: [['Volume', '4.188790205'], ['Surface area', '12.56637061']] },
        { in: { shape: 'cylinder', r: 1, h: 2 }, out: [['Volume', '6.283185307'], ['Side (lateral) area', '12.56637061'], ['Total surface area', '18.84955592']] },
        { in: { shape: 'cone', r: 3, h: 4 }, out: [['Volume', '37.69911184'], ['Slant height', '5'], ['Side (lateral) area', '47.1238898'], ['Total surface area', '75.39822369']] }],
    },
    {
      id: 'math-rectangle', name: 'Rectangle calculator', icon: '▭', family: 'math', desc: 'Area, perimeter and diagonal of a rectangle.',
      keywords: ['rectangle', 'area', 'perimeter', 'diagonal', 'square'],
      fields: [{ id: 'l', label: 'Length', type: 'number', value: 3 }, { id: 'w', label: 'Width', type: 'number', value: 4 }],
      run(v) {
        const l = need(v.l, 'the length', { pos: true }), w = need(v.w, 'the width', { pos: true });
        return [['Area', fmt(l * w)], ['Perimeter', fmt(2 * (l + w))], ['Diagonal', fmt(Math.hypot(l, w))]];
      },
      examples: [{ in: { l: 3, w: 4 }, out: [['Area', '12'], ['Perimeter', '14'], ['Diagonal', '5']] }],
    },
    {
      id: 'math-polygon', name: 'Regular polygon', icon: '⬡', family: 'math', desc: 'Area, perimeter, angles, apothem and circumradius of a regular polygon.',
      keywords: ['polygon', 'hexagon', 'pentagon', 'octagon', 'apothem', 'interior angle'],
      fields: [{ id: 'n', label: 'Number of sides', type: 'number', value: 6, min: 3 }, { id: 's', label: 'Side length', type: 'number', value: 1 }],
      run(v) {
        const n = need(v.n, 'the number of sides', { int: true, min: 3, max: 1e6 }), s = need(v.s, 'the side length', { pos: true });
        const t = Math.PI / n;
        return [['Area', fmt(n * s * s / (4 * Math.tan(t)))], ['Perimeter', fmt(n * s)], ['Interior angle', `${fmt((n - 2) * 180 / n)}°`],
          ['Exterior angle', `${fmt(360 / n)}°`], ['Apothem (inradius)', fmt(s / (2 * Math.tan(t)))], ['Circumradius', fmt(s / (2 * Math.sin(t)))]];
      },
      examples: [{ in: { n: 6, s: 1 }, out: [['Area', '2.598076211'], ['Perimeter', '6'], ['Interior angle', '120°'], ['Exterior angle', '60°'], ['Apothem (inradius)', '0.8660254038'], ['Circumradius', '1']] },
        { in: { n: 4, s: 2 }, out: [['Area', '4'], ['Perimeter', '8'], ['Interior angle', '90°'], ['Exterior angle', '90°'], ['Apothem (inradius)', '1'], ['Circumradius', '1.414213562']] }],
    },
    {
      id: 'math-two-points', name: 'Distance, slope & line', icon: '📈', family: 'math', desc: 'Distance, midpoint, slope and line equation through two points.',
      keywords: ['distance formula', 'slope', 'midpoint', 'line equation', 'gradient'],
      fields: [
        { id: 'x1', label: 'x₁', type: 'number', value: 1 }, { id: 'y1', label: 'y₁', type: 'number', value: 2 },
        { id: 'x2', label: 'x₂', type: 'number', value: 3 }, { id: 'y2', label: 'y₂', type: 'number', value: 6 },
      ],
      run(v) {
        const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(k => need(v[k], k));
        if (x1 === x2 && y1 === y2) throw new Error('The two points are the same — enter two different points.');
        const rows = [['Distance', fmt(Math.hypot(x2 - x1, y2 - y1))], ['Midpoint', `(${fmt((x1 + x2) / 2)}, ${fmt((y1 + y2) / 2)})`]];
        if (x1 === x2) return rows.concat([['Slope', 'undefined (vertical line)'], ['Line', `x = ${fmt(x1)}`]]);
        const m = (y2 - y1) / (x2 - x1);
        return rows.concat([['Slope', fmt(m)], ['Line', lineEq(m, y1 - m * x1)], ['Angle to x-axis', `${fmt(Math.atan(m) / DEG)}°`]]);
      },
      examples: [{ in: { x1: 1, y1: 2, x2: 3, y2: 6 }, out: [['Distance', '4.472135955'], ['Midpoint', '(2, 4)'], ['Slope', '2'], ['Line', 'y = 2x'], ['Angle to x-axis', '63.43494882°']] },
        { in: { x1: 0, y1: 1, x2: 2, y2: 0 }, out: [['Distance', '2.236067977'], ['Midpoint', '(1, 0.5)'], ['Slope', '-0.5'], ['Line', 'y = -0.5x + 1'], ['Angle to x-axis', '-26.56505118°']] },
        { in: { x1: 2, y1: 1, x2: 2, y2: 5 }, out: [['Distance', '4'], ['Midpoint', '(2, 3)'], ['Slope', 'undefined (vertical line)'], ['Line', 'x = 2']] }],
    },
    {
      id: 'math-proportion', name: 'Rule of three', icon: '⚌', family: 'math', desc: 'If A corresponds to B, what does C correspond to? Solves A/B = C/x.',
      keywords: ['proportion', 'rule of three', 'cross multiply', 'scale'],
      fields: [{ id: 'a', label: 'A', type: 'number', value: 2 }, { id: 'b', label: 'corresponds to B', type: 'number', value: 5 }, { id: 'c', label: 'C corresponds to', type: 'number', value: 6 }],
      run(v) {
        const a = need(v.a, 'A', { nonzero: true }), b = need(v.b, 'B'), c = need(v.c, 'C');
        return `x = ${fmt(b * c / a)}`;
      },
      examples: [{ in: { a: 2, b: 5, c: 6 }, out: 'x = 15' }, { in: { a: 3, b: 250, c: 5 }, out: 'x = 416.6666667' }],
    },
    {
      id: 'math-determinant', name: 'Matrix determinant', icon: '▦', family: 'math', desc: 'Exact determinant of a square matrix (up to 8×8) — one row per line.',
      keywords: ['matrix', 'determinant', 'linear algebra', 'invertible'],
      fields: [{ id: 'm', label: 'Matrix (one row per line)', type: 'textarea', value: '6 1 1\n4 -2 5\n2 8 7' }],
      run(v) {
        const A = parseMatrix(v.m);
        const d = determinant(A);
        return [['Size', `${A.length}×${A.length}`], ['Determinant', d.d === 1n ? d.n.toString() : `${ratFrac(d)} = ${ratDecimal(d)}`], ['Invertible', d.n === 0n ? 'No' : 'Yes']];
      },
      examples: [{ in: { m: '6 1 1\n4 -2 5\n2 8 7' }, out: [['Size', '3×3'], ['Determinant', '-306'], ['Invertible', 'Yes']] },
        { in: { m: '1 2\n3 4' }, out: [['Size', '2×2'], ['Determinant', '-2'], ['Invertible', 'Yes']] },
        { in: { m: '1 2 3\n4 5 6\n7 8 9' }, out: [['Size', '3×3'], ['Determinant', '0'], ['Invertible', 'No']] },
        { in: { m: '0.5 1\n1 3' }, out: [['Size', '2×2'], ['Determinant', '1/2 = 0.5'], ['Invertible', 'Yes']] }],
    },
    {
      id: 'math-fibonacci', name: 'Fibonacci number', icon: '🐚', family: 'math', desc: 'The exact nth Fibonacci number (F(0) = 0, F(1) = 1), up to n = 10000.',
      keywords: ['fibonacci', 'sequence', 'golden ratio'],
      fields: [{ id: 'n', label: 'n', type: 'number', value: 10, min: 0 }],
      run(v) {
        const n = need(v.n, 'n', { int: true, min: 0, max: 10000 });
        let a = 0n, b = 1n;
        for (let i = 0; i < n; i++) [a, b] = [b, a + b];
        const s = a.toString();
        return [[`F(${n})`, s], ['Digits', String(s.length)]];
      },
      examples: [{ in: { n: 10 }, out: [['F(10)', '55'], ['Digits', '2']] }, { in: { n: 100 }, out: [['F(100)', '354224848179261915075'], ['Digits', '21']] }],
    },
    {
      id: 'math-sequence', name: 'Arithmetic & geometric sequences', icon: '⋯', family: 'math', desc: 'nth term and sum of the first n terms of an arithmetic or geometric sequence.',
      keywords: ['series', 'sequence', 'progression', 'sum', 'nth term'],
      fields: [
        { id: 'kind', label: 'Sequence', type: 'select', value: 'arith', options: [['arith', 'Arithmetic (add d each step)'], ['geom', 'Geometric (multiply by r each step)']] },
        { id: 'a', label: 'First term', type: 'number', value: 1 },
        { id: 'd', label: 'Difference d / ratio r', type: 'number', value: 1 },
        { id: 'n', label: 'Number of terms n', type: 'number', value: 100, min: 1 },
      ],
      run(v) {
        const a = need(v.a, 'the first term'), d = need(v.d, 'the difference or ratio'), n = need(v.n, 'n', { int: true, min: 1, max: 1e9 });
        const geo = v.kind === 'geom';
        if (!geo && v.kind !== 'arith') throw new Error('Pick a sequence type.');
        const term = k => (geo ? a * d ** (k - 1) : a + (k - 1) * d);
        const sum = geo ? (d === 1 ? a * n : a * (1 - d ** n) / (1 - d)) : n * (2 * a + (n - 1) * d) / 2;
        const shown = Math.min(n, 10);
        const list = Array.from({ length: shown }, (_, i) => fmt(term(i + 1))).join(', ') + (n > shown ? ', …' : '');
        return [[`Term ${n}`, fmt(term(n))], [`Sum of the first ${n} terms`, fmt(sum)], ['Starts', list]];
      },
      examples: [{ in: { kind: 'arith', a: 1, d: 1, n: 100 }, out: [['Term 100', '100'], ['Sum of the first 100 terms', '5050'], ['Starts', '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, …']] },
        { in: { kind: 'geom', a: 1, d: 2, n: 10 }, out: [['Term 10', '512'], ['Sum of the first 10 terms', '1023'], ['Starts', '1, 2, 4, 8, 16, 32, 64, 128, 256, 512']] }],
    },
    {
      id: 'math-trig', name: 'Trigonometry', icon: '∠', family: 'math', desc: 'Sine, cosine and tangent of an angle in degrees or radians.',
      keywords: ['sin', 'cos', 'tan', 'sine', 'cosine', 'tangent', 'trigonometry'],
      fields: [
        { id: 'x', label: 'Angle', type: 'number', value: 30 },
        { id: 'unit', label: 'Unit', type: 'select', value: 'deg', options: [['deg', 'Degrees'], ['rad', 'Radians']] },
      ],
      run(v) {
        const x = need(v.x, 'the angle');
        if (v.unit !== 'deg' && v.unit !== 'rad') throw new Error('Pick degrees or radians.');
        const deg = v.unit === 'deg' ? x : x / DEG;
        const s = sinDeg(deg), c = cosDeg(deg);
        return [['sin', fmt(s)], ['cos', fmt(c)], ['tan', c === 0 ? 'undefined (cos = 0)' : fmt(s / c)],
          v.unit === 'deg' ? ['In radians', fmt(x * DEG)] : ['In degrees', `${fmt(deg)}°`]];
      },
      examples: [{ in: { x: 30, unit: 'deg' }, out: [['sin', '0.5'], ['cos', '0.8660254038'], ['tan', '0.5773502692'], ['In radians', '0.5235987756']] },
        { in: { x: 90, unit: 'deg' }, out: [['sin', '1'], ['cos', '0'], ['tan', 'undefined (cos = 0)'], ['In radians', '1.570796327']] },
        { in: { x: Math.PI, unit: 'rad' }, out: [['sin', '0'], ['cos', '-1'], ['tan', '0'], ['In degrees', '180°']] }],
    },
    {
      id: 'math-speed-distance-time', name: 'Speed, distance & time', icon: '🏁', family: 'math', desc: 'Enter any two of distance, time and average speed to get the third (use matching units).',
      keywords: ['average speed', 'travel time', 'distance', 'pace'],
      fields: [
        { id: 'd', label: 'Distance (e.g. km)', type: 'number', value: 120 },
        { id: 't', label: 'Time (e.g. hours)', type: 'number', value: 1.5 },
        { id: 's', label: 'Speed (e.g. km/h) — leave one box empty', type: 'number', value: '' },
      ],
      run(v) {
        const got = filled(v, ['d', 't', 's'], 2, ['distance', 'time', 'speed']);
        const names = { d: 'the distance', t: 'the time', s: 'the speed' };
        for (const k of got) need(v[k], names[k], { pos: true });
        let { d, t, s } = v;
        if (!got.includes('s')) s = d / t;
        else if (!got.includes('t')) t = d / s;
        else d = s * t;
        return [['Distance', fmt(d)], ['Time', fmt(t)], ['Speed', fmt(s)]];
      },
      examples: [{ in: { d: 120, t: 1.5, s: '' }, out: [['Distance', '120'], ['Time', '1.5'], ['Speed', '80']] }, { in: { d: 100, t: '', s: 40 }, out: [['Distance', '100'], ['Time', '2.5'], ['Speed', '40']] }],
    },

    // ============================= Science ===================================
    {
      id: 'sci-ohms-law', name: "Ohm's law", icon: 'Ω', family: 'science', desc: 'Voltage, current, resistance and power — enter any two, get the other two.',
      keywords: ['ohm', 'voltage', 'current', 'resistance', 'watts', 'amps', 'volts', 'electric'],
      fields: [
        { id: 'V', label: 'Voltage (V)', type: 'number', value: 12 }, { id: 'I', label: 'Current (A)', type: 'number', value: '' },
        { id: 'R', label: 'Resistance (Ω)', type: 'number', value: 6 }, { id: 'P', label: 'Power (W)', type: 'number', value: '' },
      ],
      run(v) {
        const got = filled(v, ['V', 'I', 'R', 'P'], 2, ['voltage', 'current', 'resistance', 'power']);
        const has = k => got.includes(k);
        let { V, I, R, P } = v;
        if (has('V')) need(V, 'the voltage');
        if (has('I')) need(I, 'the current');
        if (has('R')) need(R, 'the resistance', { pos: true });
        if (has('P')) need(P, 'the power', { nonneg: true });
        const nz = (x, what) => { if (x === 0) throw new Error(`${what} cannot be 0 for this calculation.`); return x; };
        if (has('V') && has('I')) { R = V / nz(I, 'Current'); P = V * I; }
        else if (has('V') && has('R')) { I = V / R; P = V * V / R; }
        else if (has('V') && has('P')) { I = P / nz(V, 'Voltage'); R = V * V / nz(P, 'Power'); }
        else if (has('I') && has('R')) { V = I * R; P = I * I * R; }
        else if (has('I') && has('P')) { V = P / nz(I, 'Current'); R = P / (I * I); if (R === 0) throw new Error('Power 0 with a current means 0 Ω — enter a non-zero power.'); }
        else { I = Math.sqrt(P / R); V = Math.sqrt(P * R); }
        if (R < 0) throw new Error('These values give a negative resistance — check the signs.');
        return [['Voltage', `${fmt(V)} V`], ['Current', `${fmt(I)} A`], ['Resistance', `${fmt(R)} Ω`], ['Power', `${fmt(P)} W`]];
      },
      examples: [{ in: { V: 12, I: '', R: 6, P: '' }, out: [['Voltage', '12 V'], ['Current', '2 A'], ['Resistance', '6 Ω'], ['Power', '24 W']] },
        { in: { V: '', I: '', R: 100, P: 4 }, out: [['Voltage', '20 V'], ['Current', '0.2 A'], ['Resistance', '100 Ω'], ['Power', '4 W']] },
        { in: { V: 230, I: '', R: '', P: 1000 }, out: [['Voltage', '230 V'], ['Current', '4.347826087 A'], ['Resistance', '52.9 Ω'], ['Power', '1000 W']] }],
    },
    {
      id: 'sci-resistor-colors', name: 'Resistor colour code', icon: '🎨', family: 'science', desc: 'Decode 3, 4, 5 or 6-band resistor colours into resistance, tolerance and range.',
      keywords: ['resistor', 'color code', 'colour code', 'bands', 'electronics'],
      fields: [{ id: 'bands', label: 'Band colours, in order', type: 'text', value: 'yellow violet red gold', placeholder: 'e.g. brown black red gold' }],
      run(v) {
        const b = String(v.bands).toLowerCase().split(/[\s,;/-]+/).filter(Boolean).map(c => RC_ALIAS[c] || c);
        if (b.length < 3 || b.length > 6) throw new Error('Enter 3 to 6 band colours, e.g. "brown black red gold".');
        const nDigits = b.length >= 5 ? 3 : 2;
        let digits = 0;
        for (let i = 0; i < nDigits; i++) {
          if (!(b[i] in RC_DIGIT)) throw new Error(`Band ${i + 1} ("${b[i]}") must be a digit colour: black, brown, red, orange, yellow, green, blue, violet, grey or white.`);
          digits = digits * 10 + RC_DIGIT[b[i]];
        }
        const mc = b[nDigits];
        if (!(mc in RC_MULT)) throw new Error(`"${mc}" is not a multiplier colour.`);
        const e = RC_MULT[mc];
        const r = e >= 0 ? digits * 10 ** e : digits / 10 ** -e;
        let tol = 20;
        if (b.length > 3) {
          const tc = b[nDigits + 1];
          if (!(tc in RC_TOL)) throw new Error(`"${tc}" is not a tolerance colour.`);
          tol = RC_TOL[tc];
        }
        const rows = [['Resistance', ohms(r)], ['Tolerance', `±${fmt(tol)}%`], ['Range', `${ohms(r * (100 - tol) / 100)} – ${ohms(r * (100 + tol) / 100)}`]];
        if (b.length === 6) {
          if (!(b[5] in RC_TEMPCO)) throw new Error(`"${b[5]}" is not a temperature-coefficient colour.`);
          rows.push(['Temperature coefficient', `${RC_TEMPCO[b[5]]} ppm/K`]);
        }
        return rows;
      },
      examples: [{ in: { bands: 'yellow violet red gold' }, out: [['Resistance', '4.7 kΩ'], ['Tolerance', '±5%'], ['Range', '4.465 kΩ – 4.935 kΩ']] },
        { in: { bands: 'brown black red gold' }, out: [['Resistance', '1 kΩ'], ['Tolerance', '±5%'], ['Range', '950 Ω – 1.05 kΩ']] },
        { in: { bands: 'brown black black brown brown' }, out: [['Resistance', '1 kΩ'], ['Tolerance', '±1%'], ['Range', '990 Ω – 1.01 kΩ']] },
        { in: { bands: 'red red gold' }, out: [['Resistance', '2.2 Ω'], ['Tolerance', '±20%'], ['Range', '1.76 Ω – 2.64 Ω']] }],
    },
    {
      id: 'sci-resistors-combined', name: 'Series & parallel resistors', icon: '⫼', family: 'science', desc: 'Total resistance of resistors in series and in parallel.',
      keywords: ['series', 'parallel', 'equivalent resistance', 'resistor network'],
      fields: [{ id: 'list', label: 'Resistances (Ω)', type: 'textarea', value: '100, 220, 470' }],
      run(v) {
        const rs = numberList(v.list, 'resistances');
        if (rs.some(r => r <= 0)) throw new Error('Every resistance must be greater than 0.');
        return [['Series total', ohms(rs.reduce((a, r) => a + r, 0))], ['Parallel total', ohms(1 / rs.reduce((a, r) => a + 1 / r, 0))]];
      },
      examples: [{ in: { list: '100, 100' }, out: [['Series total', '200 Ω'], ['Parallel total', '50 Ω']] },
        { in: { list: '1000 1000 1000' }, out: [['Series total', '3 kΩ'], ['Parallel total', '333.3333333 Ω']] }],
    },
    {
      id: 'sci-energy-cost', name: 'Electricity cost', icon: '🔌', family: 'science', desc: 'Energy used and running cost of an appliance from its wattage and hours of use.',
      keywords: ['kwh', 'electricity bill', 'power consumption', 'appliance', 'watts'],
      fields: [
        { id: 'w', label: 'Power (watts)', type: 'number', value: 100 },
        { id: 'h', label: 'Hours per day', type: 'number', value: 5 },
        { id: 'days', label: 'Days', type: 'number', value: 30 },
        { id: 'price', label: 'Price per kWh (any currency)', type: 'number', value: 0.15 },
      ],
      run(v) {
        const w = need(v.w, 'the power', { nonneg: true }), h = need(v.h, 'hours per day', { nonneg: true, max: 24 });
        const days = need(v.days, 'the number of days', { nonneg: true }), price = need(v.price, 'the price', { nonneg: true });
        const kwh = w * h * days / 1000;
        return [['Energy used', `${fmt(kwh)} kWh`], ['Cost', fmt(kwh * price)], ['Cost per day', fmt(w * h / 1000 * price)]];
      },
      examples: [{ in: { w: 100, h: 5, days: 30, price: 0.15 }, out: [['Energy used', '15 kWh'], ['Cost', '2.25'], ['Cost per day', '0.075']] }],
    },
    {
      id: 'sci-kinetic-energy', name: 'Kinetic energy', icon: '💨', family: 'science', desc: 'Kinetic energy (½mv²) and momentum of a moving mass.',
      keywords: ['kinetic', 'momentum', 'energy', 'velocity'],
      fields: [{ id: 'm', label: 'Mass (kg)', type: 'number', value: 2 }, { id: 'v', label: 'Speed (m/s)', type: 'number', value: 3 }],
      run(v) {
        const m = need(v.m, 'the mass', { nonneg: true }), s = need(v.v, 'the speed');
        return [['Kinetic energy', `${fmt(0.5 * m * s * s)} J`], ['Momentum', `${fmt(m * s)} kg·m/s`]];
      },
      examples: [{ in: { m: 2, v: 3 }, out: [['Kinetic energy', '9 J'], ['Momentum', '6 kg·m/s']] }, { in: { m: 1000, v: 27.8 }, out: [['Kinetic energy', '386420 J'], ['Momentum', '27800 kg·m/s']] }],
    },
    {
      id: 'sci-potential-energy', name: 'Gravitational potential energy', icon: '⛰', family: 'science', desc: 'Potential energy (mgh) of a mass raised to a height.',
      keywords: ['potential energy', 'mgh', 'height', 'gravity'],
      fields: [
        { id: 'm', label: 'Mass (kg)', type: 'number', value: 10 }, { id: 'h', label: 'Height (m)', type: 'number', value: 10 },
        { id: 'g', label: 'Gravity (m/s²)', type: 'number', value: 9.80665 },
      ],
      run(v) {
        const m = need(v.m, 'the mass', { nonneg: true }), h = need(v.h, 'the height'), g = need(v.g, 'gravity', { pos: true });
        return `Potential energy = ${fmt(m * g * h)} J`;
      },
      examples: [{ in: { m: 10, h: 10, g: 9.80665 }, out: 'Potential energy = 980.665 J' }, { in: { m: 2, h: 5, g: 10 }, out: 'Potential energy = 100 J' }],
    },
    {
      id: 'sci-force', name: 'Force, mass & acceleration', icon: '➡', family: 'science', desc: "Newton's second law F = m·a — enter any two to get the third.",
      keywords: ['newton', 'f=ma', 'force', 'acceleration', 'mass'],
      fields: [
        { id: 'F', label: 'Force (N)', type: 'number', value: '' }, { id: 'm', label: 'Mass (kg)', type: 'number', value: 10 },
        { id: 'a', label: 'Acceleration (m/s²)', type: 'number', value: 2 },
      ],
      run(v) {
        const got = filled(v, ['F', 'm', 'a'], 2, ['force', 'mass', 'acceleration']);
        let { F, m, a } = v;
        if (got.includes('m')) need(m, 'the mass', { pos: true });
        if (got.includes('F')) need(F, 'the force');
        if (got.includes('a')) need(a, 'the acceleration');
        if (!got.includes('F')) F = m * a;
        else if (!got.includes('a')) a = F / m;
        else { if (a === 0) throw new Error('Acceleration cannot be 0 when solving for mass.'); m = F / a; if (m <= 0) throw new Error('Force and acceleration must point the same way (same sign) to give a positive mass.'); }
        return [['Force', `${fmt(F)} N`], ['Mass', `${fmt(m)} kg`], ['Acceleration', `${fmt(a)} m/s²`]];
      },
      examples: [{ in: { F: '', m: 10, a: 2 }, out: [['Force', '20 N'], ['Mass', '10 kg'], ['Acceleration', '2 m/s²']] }, { in: { F: 50, m: '', a: 5 }, out: [['Force', '50 N'], ['Mass', '10 kg'], ['Acceleration', '5 m/s²']] }],
    },
    {
      id: 'sci-density', name: 'Density, mass & volume', icon: '🪨', family: 'science', desc: 'Density = mass ÷ volume — enter any two to get the third (use matching units, e.g. g and cm³).',
      keywords: ['density', 'mass', 'volume', 'buoyancy'],
      fields: [
        { id: 'rho', label: 'Density', type: 'number', value: '' }, { id: 'm', label: 'Mass', type: 'number', value: 500 },
        { id: 'vol', label: 'Volume', type: 'number', value: 250 },
      ],
      run(v) {
        const got = filled(v, ['rho', 'm', 'vol'], 2, ['density', 'mass', 'volume']);
        const names = { rho: 'the density', m: 'the mass', vol: 'the volume' };
        for (const k of got) need(v[k], names[k], { pos: true });
        let { rho, m, vol } = v;
        if (!got.includes('rho')) rho = m / vol; else if (!got.includes('m')) m = rho * vol; else vol = m / rho;
        return [['Density', fmt(rho)], ['Mass', fmt(m)], ['Volume', fmt(vol)]];
      },
      examples: [{ in: { rho: '', m: 500, vol: 250 }, out: [['Density', '2'], ['Mass', '500'], ['Volume', '250']] }, { in: { rho: 19.3, m: '', vol: 10 }, out: [['Density', '19.3'], ['Mass', '193'], ['Volume', '10']] }],
    },
    {
      id: 'sci-ideal-gas', name: 'Ideal gas law', icon: '🎈', family: 'science', desc: 'PV = nRT — enter three of pressure, volume, amount and temperature to get the fourth.',
      keywords: ['pv=nrt', 'gas law', 'pressure', 'moles', 'kelvin'],
      fields: [
        { id: 'P', label: 'Pressure (kPa)', type: 'number', value: 101.325 }, { id: 'V', label: 'Volume (L)', type: 'number', value: '' },
        { id: 'n', label: 'Amount (mol)', type: 'number', value: 1 }, { id: 'T', label: 'Temperature (K)', type: 'number', value: 273.15 },
      ],
      run(v) {
        const got = filled(v, ['P', 'V', 'n', 'T'], 3, ['pressure', 'volume', 'amount', 'temperature']);
        const names = { P: 'the pressure', V: 'the volume', n: 'the amount', T: 'the temperature' };
        for (const k of got) need(v[k], names[k], { pos: true });
        let { P, V, n, T } = v;
        // kPa·L = J, so R = 8.314462618 kPa·L/(mol·K).
        if (!got.includes('P')) P = n * R_GAS * T / V;
        else if (!got.includes('V')) V = n * R_GAS * T / P;
        else if (!got.includes('n')) n = P * V / (R_GAS * T);
        else T = P * V / (n * R_GAS);
        return [['Pressure', `${fmt(P)} kPa`], ['Volume', `${fmt(V)} L`], ['Amount', `${fmt(n)} mol`], ['Temperature', `${fmt(T)} K (${fmt(T - 273.15)} °C)`]];
      },
      examples: [{ in: { P: 101.325, V: '', n: 1, T: 273.15 }, out: [['Pressure', '101.325 kPa'], ['Volume', '22.41396955 L'], ['Amount', '1 mol'], ['Temperature', '273.15 K (0 °C)']] },
        { in: { P: '', V: 10, n: 2, T: 300 }, out: [['Pressure', '498.8677571 kPa'], ['Volume', '10 L'], ['Amount', '2 mol'], ['Temperature', '300 K (26.85 °C)']] }],
    },
    {
      id: 'sci-molar-mass', name: 'Molar mass', icon: '⚗', family: 'science', desc: 'Molar mass and mass composition of a chemical formula, e.g. H2O, Ca(OH)2, CuSO4·5H2O.',
      keywords: ['molar mass', 'molecular weight', 'formula mass', 'chemistry', 'periodic table', 'g/mol'],
      fields: [{ id: 'f', label: 'Chemical formula', type: 'text', value: 'H2O', placeholder: 'e.g. C6H12O6, K4[Fe(CN)6], CuSO4·5H2O' }],
      run(v) {
        const { counts, total } = molarMass(v.f);
        const rows = [['Molar mass', `${fmt(total)} g/mol`]];
        for (const [el, n] of counts) rows.push([el, `${n} × ${WEIGHTS[el]} = ${fmt(n * WEIGHTS[el])} g/mol (${fmt(n * WEIGHTS[el] / total * 100, 4)}%)`]);
        return rows;
      },
      examples: [{ in: { f: 'H2O' }, out: [['Molar mass', '18.015 g/mol'], ['H', '2 × 1.008 = 2.016 g/mol (11.19%)'], ['O', '1 × 15.999 = 15.999 g/mol (88.81%)']] },
        { in: { f: 'NaCl' }, match: /^Molar mass: 58\.44 g\/mol\n/ },
        { in: { f: 'C6H12O6' }, match: /^Molar mass: 180\.156 g\/mol\n/ },
        { in: { f: 'Ca(OH)2' }, match: /^Molar mass: 74\.092 g\/mol\nCa: 1 × 40\.078.*\nO: 2 × 15\.999.*\nH: 2 × 1\.008/ },
        { in: { f: 'CuSO4·5H2O' }, match: /^Molar mass: 249\.677 g\/mol\n/ }],
    },
    {
      id: 'sci-moles', name: 'Grams ⇄ moles', icon: '🧮', family: 'science', desc: 'Convert a mass of a substance to moles and number of particles (or back) from its formula.',
      keywords: ['moles', 'mol', 'avogadro', 'grams to moles', 'stoichiometry'],
      fields: [
        { id: 'f', label: 'Chemical formula', type: 'text', value: 'H2O' },
        { id: 'mode', label: 'I have', type: 'select', value: 'g', options: [['g', 'Mass in grams'], ['mol', 'Amount in moles']] },
        { id: 'x', label: 'Amount', type: 'number', value: 36.03 },
      ],
      run(v) {
        const { total } = molarMass(v.f);
        const x = need(v.x, 'the amount', { nonneg: true });
        if (v.mode !== 'g' && v.mode !== 'mol') throw new Error('Pick grams or moles.');
        const mol = v.mode === 'g' ? x / total : x;
        return [['Molar mass', `${fmt(total)} g/mol`], ['Mass', `${fmt(mol * total)} g`], ['Amount', `${fmt(mol)} mol`], ['Particles', fmt(mol * N_A)]];
      },
      examples: [{ in: { f: 'H2O', mode: 'g', x: 36.03 }, out: [['Molar mass', '18.015 g/mol'], ['Mass', '36.03 g'], ['Amount', '2 mol'], ['Particles', '1.204428152e24']] },
        { in: { f: 'CO2', mode: 'mol', x: 0.5 }, out: [['Molar mass', '44.009 g/mol'], ['Mass', '22.0045 g'], ['Amount', '0.5 mol'], ['Particles', '3.01107038e23']] }],
    },
    {
      id: 'sci-dilution', name: 'Dilution (C₁V₁ = C₂V₂)', icon: '💧', family: 'science', desc: 'Enter three of the starting and final concentration and volume to get the fourth.',
      keywords: ['dilution', 'concentration', 'c1v1', 'molarity', 'stock solution'],
      fields: [
        { id: 'c1', label: 'Starting concentration C₁', type: 'number', value: 2 }, { id: 'v1', label: 'Starting volume V₁', type: 'number', value: '' },
        { id: 'c2', label: 'Final concentration C₂', type: 'number', value: 0.5 }, { id: 'v2', label: 'Final volume V₂', type: 'number', value: 100 },
      ],
      run(v) {
        const got = filled(v, ['c1', 'v1', 'c2', 'v2'], 3, ['C₁', 'V₁', 'C₂', 'V₂']);
        for (const k of got) need(v[k], k.toUpperCase(), { pos: true });
        let { c1, v1, c2, v2 } = v;
        if (!got.includes('c1')) c1 = c2 * v2 / v1; else if (!got.includes('v1')) v1 = c2 * v2 / c1;
        else if (!got.includes('c2')) c2 = c1 * v1 / v2; else v2 = c1 * v1 / c2;
        if (c2 > c1) throw new Error('The final concentration is higher than the starting one — that is concentration, not dilution.');
        return [['C₁', fmt(c1)], ['V₁', fmt(v1)], ['C₂', fmt(c2)], ['V₂', fmt(v2)], ['Solvent to add', fmt(v2 - v1)]];
      },
      examples: [{ in: { c1: 2, v1: '', c2: 0.5, v2: 100 }, out: [['C₁', '2'], ['V₁', '25'], ['C₂', '0.5'], ['V₂', '100'], ['Solvent to add', '75']] }],
    },
    {
      id: 'sci-ph', name: 'pH calculator', icon: '🧫', family: 'science', desc: 'Convert between pH, pOH, [H⁺] and [OH⁻] (water at 25 °C).',
      keywords: ['ph', 'poh', 'acid', 'base', 'hydrogen ion', 'concentration'],
      fields: [
        { id: 'mode', label: 'I know', type: 'select', value: 'ph', options: [['ph', 'pH'], ['h', '[H⁺] (mol/L)'], ['poh', 'pOH'], ['oh', '[OH⁻] (mol/L)']] },
        { id: 'x', label: 'Value', type: 'number', value: 7 },
      ],
      run(v) {
        const x = need(v.x, 'the value');
        if ((v.mode === 'h' || v.mode === 'oh') && x <= 0) throw new Error('A concentration must be greater than 0.');
        const pH = { ph: x, h: -Math.log10(x), poh: 14 - x, oh: 14 + Math.log10(x) }[v.mode];
        if (pH === undefined) throw new Error('Pick what you know.');
        const nature = Math.abs(pH - 7) < 1e-9 ? 'Neutral' : pH < 7 ? 'Acidic' : 'Basic (alkaline)';
        return [['pH', fmt(pH)], ['pOH', fmt(14 - pH)], ['[H⁺]', `${fmt(10 ** -pH)} mol/L`], ['[OH⁻]', `${fmt(10 ** (pH - 14))} mol/L`], ['Solution', nature]];
      },
      examples: [{ in: { mode: 'ph', x: 7 }, out: [['pH', '7'], ['pOH', '7'], ['[H⁺]', '1e-7 mol/L'], ['[OH⁻]', '1e-7 mol/L'], ['Solution', 'Neutral']] },
        { in: { mode: 'h', x: 0.001 }, out: [['pH', '3'], ['pOH', '11'], ['[H⁺]', '0.001 mol/L'], ['[OH⁻]', '1e-11 mol/L'], ['Solution', 'Acidic']] }],
    },
    {
      id: 'sci-half-life', name: 'Half-life decay', icon: '☢', family: 'science', desc: 'How much of a radioactive (or any exponentially decaying) quantity remains after a time.',
      keywords: ['half-life', 'radioactive', 'decay', 'carbon dating', 'exponential decay'],
      fields: [
        { id: 'n0', label: 'Starting amount', type: 'number', value: 100 },
        { id: 'half', label: 'Half-life', type: 'number', value: 5730 },
        { id: 't', label: 'Time elapsed (same unit as half-life)', type: 'number', value: 11460 },
      ],
      run(v) {
        const n0 = need(v.n0, 'the starting amount', { nonneg: true }), h = need(v.half, 'the half-life', { pos: true }), t = need(v.t, 'the elapsed time', { nonneg: true });
        const frac = 2 ** (-t / h);
        return [['Remaining', fmt(n0 * frac)], ['Decayed', fmt(n0 * (1 - frac))], ['Fraction remaining', `${fmt(frac * 100)}%`],
          ['Half-lives elapsed', fmt(t / h)], ['Decay constant λ', `${fmt(Math.LN2 / h)} per time unit`]];
      },
      examples: [{ in: { n0: 100, half: 5730, t: 11460 }, out: [['Remaining', '25'], ['Decayed', '75'], ['Fraction remaining', '25%'], ['Half-lives elapsed', '2'], ['Decay constant λ', '0.0001209680943 per time unit']] }],
    },
    {
      id: 'sci-wave-photon', name: 'Wavelength, frequency & photon energy', icon: '🌈', family: 'science', desc: 'Convert between wavelength, frequency and photon energy of light (in vacuum).',
      keywords: ['wavelength', 'frequency', 'photon', 'electromagnetic', 'spectrum', 'ev', 'light'],
      fields: [
        { id: 'x', label: 'Value', type: 'number', value: 500 },
        { id: 'unit', label: 'Unit', type: 'select', value: 'nm', options: [['nm', 'Wavelength, nm'], ['um', 'Wavelength, µm'], ['mm', 'Wavelength, mm'], ['m', 'Wavelength, m'],
          ['hz', 'Frequency, Hz'], ['mhz', 'Frequency, MHz'], ['ghz', 'Frequency, GHz'], ['thz', 'Frequency, THz'], ['ev', 'Photon energy, eV']] },
      ],
      run(v) {
        const x = need(v.x, 'the value', { pos: true });
        const lam = { nm: 1e-9, um: 1e-6, mm: 1e-3, m: 1 }[v.unit];
        const hz = { hz: 1, mhz: 1e6, ghz: 1e9, thz: 1e12 }[v.unit];
        let f;
        if (lam) f = C_LIGHT / (x * lam); else if (hz) f = x * hz; else if (v.unit === 'ev') f = x * E_CHARGE / H_PLANCK; else throw new Error('Pick a unit.');
        const L = C_LIGHT / f, E = H_PLANCK * f;
        const band = L >= 1 ? 'Radio' : L >= 1e-3 ? 'Microwave' : L > 750e-9 ? 'Infrared' : L >= 380e-9 ? 'Visible light' : L >= 10e-9 ? 'Ultraviolet' : L >= 1e-11 ? 'X-ray' : 'Gamma ray';
        return [['Wavelength', `${fmt(L * 1e9)} nm`], ['Frequency', `${fmt(f)} Hz`], ['Photon energy', `${fmt(E)} J`], ['Photon energy (eV)', `${fmt(E / E_CHARGE)} eV`], ['Band (approximate)', band]];
      },
      examples: [{ in: { x: 500, unit: 'nm' }, out: [['Wavelength', '500 nm'], ['Frequency', '599584916000000 Hz'], ['Photon energy', '3.972891714e-19 J'], ['Photon energy (eV)', '2.479683969 eV'], ['Band (approximate)', 'Visible light']] },
        { in: { x: 2.4, unit: 'ghz' }, out: [['Wavelength', '124913524.2 nm'], ['Frequency', '2400000000 Hz'], ['Photon energy', '1.590256836e-24 J'], ['Photon energy (eV)', '0.000009925602473 eV'], ['Band (approximate)', 'Microwave']] }],
    },
    {
      id: 'sci-speed-of-sound', name: 'Speed of sound', icon: '🔊', family: 'science', desc: 'Approximate speed of sound in dry air at a given temperature.',
      keywords: ['sound', 'acoustics', 'mach', 'air'],
      fields: [{ id: 't', label: 'Air temperature (°C)', type: 'number', value: 20 }],
      run(v) {
        const t = need(v.t, 'the temperature', { min: -273.15 });
        const s = 331.3 * Math.sqrt(1 + t / 273.15); // ideal-gas approximation for dry air
        return [['Speed', `${fmt(s, 4)} m/s`], ['', `${fmt(s * 3.6, 4)} km/h`], ['', `${fmt(s / (MI / 3600), 4)} mph`], ['', `${fmt(s / FT, 4)} ft/s`]];
      },
      examples: [{ in: { t: 0 }, out: [['Speed', '331.3 m/s'], ['', '1193 km/h'], ['', '741.1 mph'], ['', '1087 ft/s']] },
        { in: { t: 20 }, out: [['Speed', '343.2 m/s'], ['', '1236 km/h'], ['', '767.7 mph'], ['', '1126 ft/s']] }],
    },
    {
      id: 'sci-planet-weight', name: 'Weight on other planets', icon: '🪐', family: 'science', desc: 'What a scale would read on the Moon, Mars and the other planets.',
      keywords: ['planet', 'gravity', 'moon', 'mars', 'jupiter', 'space'],
      fields: [{ id: 'w', label: 'Weight on Earth (kg or lb)', type: 'number', value: 70 }],
      run(v) {
        const w = need(v.w, 'the weight', { nonneg: true });
        return BODIES.map(([name, g]) => [name, `${fmt(w * g / G0, 4)} (${fmt(g, 4)} m/s²)`]);
      },
      examples: [{ in: { w: 100 }, out: [['Mercury', '37.73 (3.7 m/s²)'], ['Venus', '90.45 (8.87 m/s²)'], ['Earth', '100 (9.807 m/s²)'], ['Moon', '16.52 (1.62 m/s²)'],
        ['Mars', '37.83 (3.71 m/s²)'], ['Jupiter', '252.8 (24.79 m/s²)'], ['Saturn', '106.5 (10.44 m/s²)'], ['Uranus', '90.45 (8.87 m/s²)'], ['Neptune', '113.7 (11.15 m/s²)'], ['Pluto', '6.322 (0.62 m/s²)']] }],
    },
    {
      id: 'sci-dew-point', name: 'Dew point', icon: '💧', family: 'science', desc: 'Dew point from air temperature and relative humidity (Magnus formula).',
      keywords: ['dew point', 'humidity', 'condensation', 'weather'],
      fields: [
        { id: 't', label: 'Air temperature', type: 'number', value: 25 },
        { id: 'unit', label: 'Unit', type: 'select', value: 'C', options: [['C', '°C'], ['F', '°F']] },
        { id: 'rh', label: 'Relative humidity (%)', type: 'number', value: 60 },
      ],
      run(v) {
        const t0 = need(v.t, 'the temperature'), rh = need(v.rh, 'the humidity', { pos: true, max: 100 });
        if (v.unit !== 'C' && v.unit !== 'F') throw new Error('Pick °C or °F.');
        const t = v.unit === 'F' ? (t0 - 32) * 5 / 9 : t0;
        if (t < -45 || t > 60) throw new Error('The Magnus formula is only accurate between −45 °C and 60 °C.');
        const b = 17.62, c = 243.12; // Sonntag (1990) constants
        const gam = Math.log(rh / 100) + b * t / (c + t);
        const dp = c * gam / (b - gam);
        return [['Dew point', `${fmt(dp, 4)} °C`], ['', `${fmt(dp * 9 / 5 + 32, 4)} °F`]];
      },
      examples: [{ in: { t: 25, unit: 'C', rh: 60 }, out: [['Dew point', '16.69 °C'], ['', '62.05 °F']] }, { in: { t: 20, unit: 'C', rh: 100 }, out: [['Dew point', '20 °C'], ['', '68 °F']] }],
    },
    {
      id: 'sci-heat-index', name: 'Heat index', icon: '🥵', family: 'science', desc: '"Feels like" temperature from heat and humidity (US National Weather Service formula).',
      keywords: ['heat index', 'feels like', 'humidity', 'weather', 'apparent temperature'],
      fields: [
        { id: 't', label: 'Air temperature', type: 'number', value: 90 },
        { id: 'unit', label: 'Unit', type: 'select', value: 'F', options: [['F', '°F'], ['C', '°C']] },
        { id: 'rh', label: 'Relative humidity (%)', type: 'number', value: 70 },
      ],
      run(v) {
        const t0 = need(v.t, 'the temperature'), rh = need(v.rh, 'the humidity', { min: 0, max: 100 });
        if (v.unit !== 'C' && v.unit !== 'F') throw new Error('Pick °F or °C.');
        const T = v.unit === 'C' ? t0 * 9 / 5 + 32 : t0;
        if (T < 40 || T > 150) throw new Error('The heat index is meant for temperatures from about 40 °F (4 °C) upward.');
        let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + rh * 0.094);
        if ((hi + T) / 2 >= 80) {
          // Rothfusz regression with the NWS low/high-humidity adjustments.
          hi = -42.379 + 2.04901523 * T + 10.14333127 * rh - 0.22475541 * T * rh - 0.00683783 * T * T - 0.05481717 * rh * rh
            + 0.00122874 * T * T * rh + 0.00085282 * T * rh * rh - 0.00000199 * T * T * rh * rh;
          if (rh < 13 && T >= 80 && T <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
          else if (rh > 85 && T >= 80 && T <= 87) hi += ((rh - 85) / 10) * ((87 - T) / 5);
        }
        return [['Heat index', `${fmt(hi, 4)} °F`], ['', `${fmt((hi - 32) * 5 / 9, 4)} °C`]];
      },
      examples: [{ in: { t: 90, unit: 'F', rh: 70 }, out: [['Heat index', '105.9 °F'], ['', '41.07 °C']] },
        { in: { t: 70, unit: 'F', rh: 50 }, out: [['Heat index', '69.05 °F'], ['', '20.58 °C']] }],
    },
    {
      id: 'sci-wind-chill', name: 'Wind chill', icon: '🥶', family: 'science', desc: '"Feels like" temperature from cold and wind (NWS / Environment Canada formula).',
      keywords: ['wind chill', 'feels like', 'cold', 'weather'],
      fields: [
        { id: 't', label: 'Air temperature', type: 'number', value: 0 },
        { id: 'w', label: 'Wind speed', type: 'number', value: 15 },
        { id: 'units', label: 'Units', type: 'select', value: 'us', options: [['us', '°F and mph'], ['si', '°C and km/h']] },
      ],
      run(v) {
        const t = need(v.t, 'the temperature'), w = need(v.w, 'the wind speed', { nonneg: true });
        if (v.units === 'us') {
          if (t > 50 || w < 3) throw new Error('Wind chill is only defined at or below 50 °F with wind of at least 3 mph.');
          const p = w ** 0.16;
          return `Wind chill ${fmt(35.74 + 0.6215 * t - 35.75 * p + 0.4275 * t * p, 4)} °F`;
        }
        if (v.units !== 'si') throw new Error('Pick the units.');
        if (t > 10 || w < 4.8) throw new Error('Wind chill is only defined at or below 10 °C with wind of at least 4.8 km/h.');
        const p = w ** 0.16;
        return `Wind chill ${fmt(13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p, 4)} °C`;
      },
      examples: [{ in: { t: 0, w: 15, units: 'us' }, out: 'Wind chill -19.4 °F' }, { in: { t: -10, w: 20, units: 'si' }, out: 'Wind chill -17.86 °C' }],
    },
    {
      id: 'sci-constants', name: 'Physical constants', icon: 'ℏ', family: 'science', desc: 'Look up fundamental physical constants with units and whether the value is exact.',
      keywords: ['constant', 'speed of light', 'planck', 'avogadro', 'boltzmann', 'codata'],
      fields: [{ id: 'k', label: 'Constant', type: 'select', value: 'c', options: Object.entries(CONSTANTS).map(([k, c]) => [k, `${c[0]} (${c[1]})`]) }],
      run(v) {
        const c = CONSTANTS[v.k];
        if (!c) throw new Error('Pick a constant.');
        return [['Constant', `${c[0]} (${c[1]})`], ['Value', c[2]], ['Unit', c[3]], ['Status', c[4] ? 'Exact (defined in the SI)' : 'Measured — CODATA 2018 recommended value']];
      },
      examples: [{ in: { k: 'c' }, out: [['Constant', 'Speed of light in vacuum (c)'], ['Value', '299792458'], ['Unit', 'm/s'], ['Status', 'Exact (defined in the SI)']] },
        { in: { k: 'g' }, out: [['Constant', 'Newtonian constant of gravitation (G)'], ['Value', '6.67430e-11'], ['Unit', 'm³/(kg·s²)'], ['Status', 'Measured — CODATA 2018 recommended value']] }],
    },
    {
      id: 'sci-projectile', name: 'Projectile motion', icon: '🎯', family: 'science', desc: 'Range, flight time, peak height and impact speed of a launched object (no air resistance).',
      keywords: ['projectile', 'trajectory', 'ballistics', 'range', 'launch angle'],
      fields: [
        { id: 'v', label: 'Launch speed (m/s)', type: 'number', value: 10 },
        { id: 'a', label: 'Launch angle (degrees above horizontal)', type: 'number', value: 45 },
        { id: 'h', label: 'Launch height (m)', type: 'number', value: 0 },
        { id: 'g', label: 'Gravity (m/s²)', type: 'number', value: 9.80665 },
      ],
      run(v) {
        const s = need(v.v, 'the launch speed', { nonneg: true }), a = need(v.a, 'the launch angle', { min: -90, max: 90 });
        const h = need(v.h, 'the launch height', { nonneg: true }), g = need(v.g, 'gravity', { pos: true });
        const vx = s * cosDeg(a), vy = s * sinDeg(a);
        const t = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
        return [['Time of flight', `${fmt(t)} s`], ['Horizontal range', `${fmt(vx * t)} m`], ['Maximum height', `${fmt(h + Math.max(vy, 0) ** 2 / (2 * g))} m`],
          ['Impact speed', `${fmt(Math.sqrt(s * s + 2 * g * h))} m/s`]];
      },
      examples: [{ in: { v: 10, a: 45, h: 0, g: 9.80665 }, out: [['Time of flight', '1.442096498 s'], ['Horizontal range', '10.19716213 m'], ['Maximum height', '2.549290532 m'], ['Impact speed', '10 m/s']] },
        { in: { v: 20, a: 90, h: 0, g: 10 }, out: [['Time of flight', '4 s'], ['Horizontal range', '0 m'], ['Maximum height', '20 m'], ['Impact speed', '20 m/s']] }],
    },
    {
      id: 'sci-lens', name: 'Thin lens equation', icon: '🔎', family: 'science', desc: '1/f = 1/dₒ + 1/dᵢ — enter any two of focal length, object and image distance.',
      keywords: ['lens', 'optics', 'focal length', 'magnification', 'mirror'],
      fields: [
        { id: 'f', label: 'Focal length f (negative for a diverging lens)', type: 'number', value: 10 },
        { id: 'do', label: 'Object distance dₒ', type: 'number', value: 30 },
        { id: 'di', label: 'Image distance dᵢ (negative = virtual image)', type: 'number', value: '' },
      ],
      run(v) {
        const got = filled(v, ['f', 'do', 'di'], 2, ['focal length', 'object distance', 'image distance']);
        const names = { f: 'the focal length', do: 'the object distance', di: 'the image distance' };
        for (const k of got) need(v[k], names[k], { nonzero: true });
        let { f, do: dO, di } = v;
        const inv = (x, msg) => { if (Math.abs(x) < 1e-15) throw new Error(msg); return 1 / x; };
        if (!got.includes('di')) di = inv(1 / f - 1 / dO, 'The object is at the focal point, so the image forms at infinity.');
        else if (!got.includes('do')) dO = inv(1 / f - 1 / di, 'The image is at the focal point, so the object would be at infinity.');
        else f = inv(1 / dO + 1 / di, 'These distances give an infinite focal length (a flat window, not a lens).');
        const m = -di / dO;
        const size = Math.abs(Math.abs(m) - 1) < 1e-12 ? 'same size' : Math.abs(m) > 1 ? 'enlarged' : 'reduced';
        return [['Focal length', fmt(f)], ['Object distance', fmt(dO)], ['Image distance', fmt(di)], ['Magnification', fmt(m)],
          ['Image', `${di > 0 ? 'Real' : 'Virtual'}, ${m < 0 ? 'inverted' : 'upright'}, ${size}`]];
      },
      examples: [{ in: { f: 10, do: 30, di: '' }, out: [['Focal length', '10'], ['Object distance', '30'], ['Image distance', '15'], ['Magnification', '-0.5'], ['Image', 'Real, inverted, reduced']] },
        { in: { f: 10, do: 5, di: '' }, out: [['Focal length', '10'], ['Object distance', '5'], ['Image distance', '-10'], ['Magnification', '2'], ['Image', 'Virtual, upright, enlarged']] }],
    },
    {
      id: 'sci-decibel-sum', name: 'Adding decibels', icon: '🔉', family: 'science', desc: 'Combined sound level of several sources (decibels add logarithmically).',
      keywords: ['decibel', 'db', 'sound level', 'noise', 'acoustics'],
      fields: [{ id: 'list', label: 'Levels (dB)', type: 'textarea', value: '90, 90' }],
      run(v) {
        const ls = numberList(v.list, 'decibel levels');
        const total = 10 * Math.log10(ls.reduce((a, l) => a + 10 ** (l / 10), 0));
        return [['Combined level', `${fmt(total)} dB`], ['Above the loudest source by', `${fmt(total - Math.max(...ls))} dB`]];
      },
      examples: [{ in: { list: '90, 90' }, out: [['Combined level', '93.01029996 dB'], ['Above the loudest source by', '3.010299957 dB']] },
        { in: { list: '60 60 60 60 60 60 60 60 60 60' }, out: [['Combined level', '70 dB'], ['Above the loudest source by', '10 dB']] }],
    },
    {
      id: 'sci-gravitation', name: 'Gravitational force', icon: '🌍', family: 'science', desc: "Newton's law of gravitation: attraction between two masses.",
      keywords: ['gravity', 'newton', 'gravitation', 'attraction', 'orbit'],
      fields: [
        { id: 'm1', label: 'Mass 1 (kg)', type: 'number', value: 5.972e24 }, { id: 'm2', label: 'Mass 2 (kg)', type: 'number', value: 7.348e22 },
        { id: 'r', label: 'Distance between centres (m)', type: 'number', value: 3.844e8 },
      ],
      run(v) {
        const m1 = need(v.m1, 'mass 1', { pos: true }), m2 = need(v.m2, 'mass 2', { pos: true }), r = need(v.r, 'the distance', { pos: true });
        return `Force = ${fmt(G_NEWTON * m1 * m2 / (r * r))} N`;
      },
      examples: [{ in: { m1: 1, m2: 1, r: 1 }, out: 'Force = 6.6743e-11 N' }, { in: { m1: 1000, m2: 1000, r: 10 }, out: 'Force = 6.6743e-7 N' }],
    },
    {
      id: 'sci-escape-velocity', name: 'Escape & orbital velocity', icon: '🛰', family: 'science', desc: 'Escape velocity and circular orbital speed at a distance from a body’s centre.',
      keywords: ['escape velocity', 'orbital speed', 'orbit', 'rocket', 'space'],
      fields: [
        { id: 'M', label: 'Mass of the body (kg)', type: 'number', value: 5.9722e24 },
        { id: 'r', label: 'Distance from centre (m)', type: 'number', value: 6.371e6 },
      ],
      run(v) {
        const M = need(v.M, 'the mass', { pos: true }), r = need(v.r, 'the distance', { pos: true });
        const esc = Math.sqrt(2 * G_NEWTON * M / r), orb = Math.sqrt(G_NEWTON * M / r);
        return [['Escape velocity', `${fmt(esc)} m/s (${fmt(esc / 1000)} km/s)`], ['Circular orbit speed', `${fmt(orb)} m/s (${fmt(orb / 1000)} km/s)`],
          ['Orbital period', `${fmt(2 * Math.PI * r / orb / 60)} min`]];
      },
      examples: [{ in: { M: 5.9722e24, r: 6.371e6 }, match: /^Escape velocity: 11186\.\d+ m\/s \(11\.18\d+ km\/s\)\nCircular orbit speed: 7909\.\d+ m\/s/ }],
    },
  ];

  if (typeof ToolboxPacks !== 'undefined') ToolboxPacks.add(PACK);
  if (typeof module !== 'undefined' && module.exports) module.exports = PACK;
})();
