// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
const PACK = require('../../src/renderer/js/toolbox-pack-units-math-science.js');

ToolboxPacks.specs = [];
ToolboxPacks.add(PACK);

const byId = id => PACK.find(s => s.id === id);
// Field defaults as raw form values, overlaid with the given inputs.
function rawFor(spec, input = {}) {
  const raw = {};
  for (const f of spec.fields) raw[f.id] = f.value !== undefined ? f.value : (f.type === 'checkbox' ? false : (f.type === 'select' && f.options ? f.options[0][0] : ''));
  return { ...raw, ...input };
}
const run = (id, input) => { const s = byId(id); return s.run(ToolboxPacks.coerce(s, rawFor(s, input))); };
const text = (id, input) => ToolboxPacks.asText(run(id, input));
const row = (out, label) => (out.find(r => r[0] === label) || [])[1];

describe('units/math/science pack — shape', () => {
  it('registers every spec in the convert, math or science family', () => {
    expect(ToolboxPacks.specs.length).toBe(PACK.length);
    expect(PACK.length).toBeGreaterThanOrEqual(60);
    for (const s of PACK) expect(['convert', 'math', 'science']).toContain(s.family);
  });

  it('does not reuse the built-in tool ids', () => {
    const taken = ['regex', 'json', 'csv', 'base64', 'hash', 'timestamp', 'cron', 'uuid', 'wordcount', 'color', 'jwt', 'urlencode', 'caseconvert', 'passgen', 'markdown'];
    for (const s of PACK) expect(taken).not.toContain(s.id);
  });
});

describe('units/math/science pack — every example', () => {
  for (const spec of PACK) {
    spec.examples.forEach((ex, i) => {
      it(`${spec.id} example ${i + 1}`, () => {
        const out = spec.run(ToolboxPacks.coerce(spec, rawFor(spec, ex.in)));
        if (ex.match) expect(ToolboxPacks.asText(out)).toMatch(ex.match);
        else expect(out).toEqual(ex.out);
      });
    });
  }
});

describe('units/math/science pack — defaults never produce garbage', () => {
  for (const spec of PACK) {
    it(`${spec.id} with its default values`, () => {
      let out;
      try { out = spec.run(ToolboxPacks.defaults(spec)); } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(e.message.length).toBeGreaterThan(0);
        return;
      }
      expect(typeof out === 'string' || Array.isArray(out)).toBe(true);
      if (Array.isArray(out)) for (const r of out) { expect(r).toHaveLength(2); expect(typeof r[1]).toBe('string'); }
      expect(ToolboxPacks.asText(out)).not.toMatch(/NaN|Infinity|undefined(?! \()/);
    });
  }
});

describe('molar mass parser', () => {
  const mm = f => row(run('sci-molar-mass', { f }), 'Molar mass');
  it('handles nesting, brackets and hydrates', () => {
    expect(mm('K4[Fe(CN)6]')).toBe('368.345 g/mol');
    expect(mm('Mg3(PO4)2')).toBe('262.855 g/mol');
    expect(mm('CuSO4*5H2O')).toBe(mm('CuSO4·5H2O'));
    expect(mm('CuSO4.5H2O')).toBe('249.677 g/mol');
    expect(mm(' C O 2 ')).toBe('44.009 g/mol');
    expect(mm('(CH3)2CO')).toBe('58.08 g/mol');
  });
  it('distinguishes Co (cobalt) from CO', () => {
    expect(mm('Co')).toBe('58.933 g/mol');
    expect(mm('CO')).toBe('28.01 g/mol');
  });
  it('knows all 118 elements', () => {
    const all = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ');
    expect(all).toHaveLength(118);
    for (const el of all) expect(mm(el)).toMatch(/^\d+(\.\d+)? g\/mol$/);
  });
  it('rejects malformed formulas with a clear message', () => {
    expect(() => run('sci-molar-mass', { f: 'Xx2' })).toThrow(/not an element/);
    expect(() => run('sci-molar-mass', { f: 'Ca(OH2' })).toThrow(/closing "\)"/);
    expect(() => run('sci-molar-mass', { f: 'H2O)' })).toThrow(/Unexpected "\)"/);
    expect(() => run('sci-molar-mass', { f: 'h2o' })).toThrow(/capital letter/);
    expect(() => run('sci-molar-mass', { f: 'H0' })).toThrow(/count of 0/);
    expect(() => run('sci-molar-mass', { f: 'Na()' })).toThrow(/empty brackets/);
    expect(() => run('sci-molar-mass', { f: '' })).toThrow(/Enter a chemical formula/);
    expect(() => run('sci-molar-mass', { f: 'CuSO4·' })).toThrow(/both sides/);
  });
});

describe('quadratic solver', () => {
  it('gives pure imaginary and complex roots', () => {
    const q = (a, b, c) => run('math-quadratic', { a, b, c });
    expect(row(q(1, 0, 1), 'x₁')).toBe('i');
    expect(row(q(1, 0, 1), 'x₂')).toBe('-i');
    expect(row(q(-1, 0, -4), 'x₁')).toBe('2i');
    expect(row(q(2, 2, 1), 'x₁')).toBe('-0.5 + 0.5i');
    expect(row(q(2, 2, 1), 'x₂')).toBe('-0.5 - 0.5i');
  });
  it('keeps the small root accurate when b² ≫ 4ac', () => {
    const out = run('math-quadratic', { a: 1, b: -1e8, c: 1 });
    expect(row(out, 'x₁')).toBe('100000000');
    expect(row(out, 'x₂')).toBe('1e-8');
  });
  it('refuses a = 0', () => {
    expect(() => run('math-quadratic', { a: 0, b: 2, c: 1 })).toThrow(/cannot be 0/);
  });
});

describe('number base converter', () => {
  it('converts numbers beyond 2^53 exactly', () => {
    const out = run('unit-number-base', { num: '1' + '0'.repeat(100), from: 2, to: 16 });
    expect(row(out, 'Decimal')).toBe((2n ** 100n).toString());
    expect(row(out, 'Base 16')).toBe('1' + '0'.repeat(25));
  });
  it('accepts a matching prefix, separators and case', () => {
    expect(row(run('unit-number-base', { num: '0xDEAD_beef', from: 16, to: 10 }), 'Base 10')).toBe('3735928559');
  });
  it('rejects bad digits, fractions and bases', () => {
    expect(() => run('unit-number-base', { num: '102', from: 2, to: 10 })).toThrow(/"2" is not a valid digit in base 2/);
    expect(() => run('unit-number-base', { num: '1.5', from: 10, to: 2 })).toThrow(/whole numbers/);
    expect(() => run('unit-number-base', { num: '10', from: 37, to: 2 })).toThrow(/at most 36/);
    expect(() => run('unit-number-base', { num: '10', from: 10, to: 1 })).toThrow(/at least 2/);
    expect(() => run('unit-number-base', { num: '', from: 10, to: 2 })).toThrow(/Enter a number/);
  });
});

describe('exact arithmetic and formatting', () => {
  it('rounds decimal strings exactly, not via floats', () => {
    expect(run('math-round', { x: '2.675', mode: 'dp', digits: 2 })).toBe('2.68');
    expect(run('math-round', { x: '0.5', mode: 'dp', digits: 0 })).toBe('1');
    expect(run('math-round', { x: '1234.5678', mode: 'sf', digits: 6 })).toBe('1234.57');
  });
  it('shows very large and very small results in e-notation', () => {
    expect(run('unit-length', { value: 1, from: 'ly', to: 'm' })).toBe('1 ly = 9.460730473e15 m');
    expect(run('unit-length', { value: 1, from: 'nm', to: 'km' })).toBe('1 nm = 1e-12 km');
  });
  it('finds repeating decimals and exact rational determinants', () => {
    expect(row(run('math-fraction-decimal', { x: '1/7' }), 'Decimal')).toBe('0.(142857)');
    expect(row(run('math-fraction-decimal', { x: '0.(9)' }), 'Fraction')).toBe('1');
    expect(row(run('math-determinant', { m: '1/3 0\n0 3' }), 'Determinant')).toBe('1');
  });
  it('rejects bad input instead of returning NaN or Infinity', () => {
    expect(() => run('unit-length', { value: '' })).toThrow(/Enter a number/);
    expect(() => run('unit-temperature', { value: -300, from: 'C', to: 'K' })).toThrow(/absolute zero/);
    expect(() => run('math-fraction-calc', { a: '1/2', op: '/', b: '0' })).toThrow(/Division by zero/);
    expect(() => run('math-fraction-decimal', { x: '1/0' })).toThrow(/denominator cannot be 0/);
    expect(() => run('math-power', { b: 10, e: 400 })).toThrow(/not a finite number/);
    expect(() => run('math-power', { b: -8, e: 1 / 3 })).toThrow(/no real result/);
    expect(() => run('math-log', { x: -1, base: 10 })).toThrow(/greater than 0/);
    expect(() => run('math-root', { x: -4, n: 2 })).toThrow(/not a real number/);
    expect(() => run('math-triangle', { a: 1, b: 2, c: 3 })).toThrow(/cannot form a triangle/);
    expect(() => run('math-linear-system', { a1: 1, b1: 2, c1: 3, a2: 2, b2: 4, c2: 6 })).toThrow(/No unique solution/);
    expect(() => run('math-statistics', { nums: '1, two, 3' })).toThrow(/"two" is not a number/);
    expect(() => run('sci-ohms-law', { V: 12, I: 1, R: 6, P: '' })).toThrow(/exactly 2/);
    expect(() => run('sci-lens', { f: 10, do: 10, di: '' })).toThrow(/focal point/);
    expect(() => run('sci-wind-chill', { t: 60, w: 10, units: 'us' })).toThrow(/50 °F/);
    expect(() => run('sci-resistor-colors', { bands: 'brown pink red gold' })).toThrow(/digit colour/);
    expect(() => run('unit-shoe-size', { size: 10, sys: 'eu' })).toThrow(/adult range/);
  });
});
