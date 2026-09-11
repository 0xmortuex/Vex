// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
const PACK = require('../../src/renderer/js/toolbox-pack-text.js');

// The hand-built tools in toolbox.js own these ids.
const BUILT_IN = ['regex', 'json', 'csv', 'base64', 'hash', 'timestamp', 'cron', 'uuid', 'wordcount', 'color', 'jwt', 'urlencode', 'caseconvert', 'passgen', 'markdown'];

// Raw form values: each field's default, as the form would hold it before coerce().
const rawDefaults = spec => Object.fromEntries(spec.fields.map(f => [f.id,
  f.value !== undefined ? f.value : f.type === 'checkbox' ? false : f.type === 'select' ? f.options[0][0] : '']));
const runSpec = (spec, input = {}) => spec.run(ToolboxPacks.coerce(spec, { ...rawDefaults(spec), ...input }));
const tool = id => {
  const spec = PACK.find(s => s.id === id);
  if (!spec) throw new Error(`no tool ${id}`);
  return spec;
};
const run = (id, input) => runSpec(tool(id), input);

describe('text pack registration', () => {
  it('registers cleanly with ToolboxPacks.add', () => {
    const saved = ToolboxPacks.specs;
    ToolboxPacks.specs = [];
    try {
      ToolboxPacks.add(PACK);
      expect(ToolboxPacks.specs.length).toBe(PACK.length);
    } finally {
      ToolboxPacks.specs = saved;
    }
  });

  it('stays in its families and never reuses a built-in id', () => {
    expect(PACK.length).toBeGreaterThanOrEqual(55);
    for (const s of PACK) {
      expect(['text', 'write', 'generate', 'general']).toContain(s.family);
      expect(BUILT_IN).not.toContain(s.id);
    }
  });

  it('declares well-formed fields', () => {
    for (const s of PACK) {
      const ids = s.fields.map(f => f.id);
      expect(new Set(ids).size, s.id).toBe(ids.length);
      for (const f of s.fields) {
        expect(['text', 'textarea', 'number', 'select', 'date', 'time', 'checkbox', 'color'], `${s.id}.${f.id}`).toContain(f.type);
        expect(f.label, `${s.id}.${f.id}`).toBeTruthy();
        if (f.type === 'select') {
          expect(Array.isArray(f.options) && f.options.length > 0, `${s.id}.${f.id}`).toBe(true);
          expect(f.options.map(o => o[0]), `${s.id}.${f.id}`).toContain(f.value);
        }
      }
      for (const ex of s.examples) {
        for (const k of Object.keys(ex.in)) expect(ids, `${s.id} example uses unknown field ${k}`).toContain(k);
        expect('out' in ex || ex.match instanceof RegExp, s.id).toBe(true);
      }
    }
  });
});

describe.each(PACK.map(s => [s.id, s]))('%s', (_id, spec) => {
  it('produces every example result', () => {
    for (const ex of spec.examples) {
      const out = runSpec(spec, ex.in);
      if ('out' in ex) expect(out).toEqual(ex.out);
      else expect(ToolboxPacks.asText(out)).toMatch(ex.match);
    }
  });

  it('with default values, returns a result or throws a plain Error', () => {
    let out;
    try {
      out = runSpec(spec);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e.constructor).toBe(Error);
      expect(String(e.message).trim()).not.toBe('');
      return;
    }
    expect(typeof out === 'string' || Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) for (const row of out) { expect(row.length).toBe(2); expect(typeof row[0]).toBe('string'); }
  });
});

describe('edge cases', () => {
  const throwsPlain = (fn, re) => {
    let err;
    try { fn(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(re);
  };

  it('round-trips binary, hex, Morse and HTML entities', () => {
    const s = 'Vex ✓ 😀 naïve';
    expect(run('text-binary', { mode: 'decode', text: run('text-binary', { text: s }) })).toBe(s);
    expect(run('text-hex', { mode: 'decode', text: run('text-hex', { text: s }) })).toBe(s);
    expect(run('html-entities', { mode: 'decode', text: run('html-entities', { text: '<b>"a" & \'b\' é</b>', all: true }) })).toBe('<b>"a" & \'b\' é</b>');
    expect(run('morse', { mode: 'decode', text: run('morse', { text: 'Call me at 5, ok?' }) })).toBe('CALL ME AT 5, OK?');
    expect(run('caesar-cipher', { mode: 'decode', shift: 29, text: run('caesar-cipher', { shift: 29, text: 'Zebra' }) })).toBe('Zebra');
    const esc = run('string-escape', { text: 'a "b"\n\\c\té 😀' });
    expect(run('string-escape', { mode: 'unescape', text: esc })).toBe('a "b"\n\\c\té 😀');
    expect(run('string-escape', { mode: 'unescape', text: '"it\\\'s ""fine"""' })).toBe('it\'s ""fine""');
  });

  it('rejects bad encoded input with a reason', () => {
    throwsPlain(() => run('text-binary', { mode: 'decode', text: '0101' }), /multiple of 8/);
    throwsPlain(() => run('text-binary', { mode: 'decode', text: '11111111' }), /not valid UTF-8/);
    throwsPlain(() => run('text-hex', { mode: 'decode', text: 'abc' }), /two digits/);
    throwsPlain(() => run('text-hex', { mode: 'decode', text: 'zz' }), /0–9/);
    throwsPlain(() => run('morse', { mode: 'decode', text: '........' }), /not a Morse/);
    throwsPlain(() => run('morse', { text: 'π' }), /no Morse/);
    throwsPlain(() => run('find-replace', { text: 'abc', find: '(' , regex: true }), /not a valid regular expression/);
    throwsPlain(() => run('find-replace', { text: 'abc', find: 'z' }), /not found/);
    throwsPlain(() => run('string-escape', { mode: 'unescape', text: 'bad \\q' }), /not a valid escaped string/);
    throwsPlain(() => run('csv-to-list', { text: 'a,b', column: 3 }), /only 2 columns/);
    throwsPlain(() => run('markdown-table', { text: '"open,1' }), /never closed/);
  });

  it('validates Roman numerals strictly', () => {
    expect(run('roman-numerals', { value: '4' })).toBe('IV');
    expect(run('roman-numerals', { value: 'XLII' })).toBe('42');
    throwsPlain(() => run('roman-numerals', { value: 'IIII' }), /did you mean IV/);
    throwsPlain(() => run('roman-numerals', { value: 'IC' }), /not a standard Roman numeral/);
    throwsPlain(() => run('roman-numerals', { value: '4000' }), /1 to 3999/);
    throwsPlain(() => run('roman-numerals', { value: '0' }), /1 to 3999/);
    for (let n = 1; n <= 3999; n += 7) expect(run('roman-numerals', { value: run('roman-numerals', { value: String(n) }) })).toBe(String(n));
  });

  it('writes numbers and ordinals in words', () => {
    expect(run('number-words', { n: '100' })).toBe('one hundred');
    expect(run('number-words', { n: '110', and: true })).toBe('one hundred and ten');
    expect(run('number-words', { n: '2000050', and: true })).toBe('two million and fifty');
    expect(run('number-words', { n: '999999999999999999999999' })).toMatch(/^nine hundred ninety-nine sextillion nine hundred ninety-nine quintillion/);
    expect(run('number-words', { n: '1' + '0'.repeat(24) })).toBe('one septillion');
    expect(run('number-words', { n: '-0' })).toBe('zero');
    throwsPlain(() => run('number-words', { n: '1e5' }), /plain number/);
    throwsPlain(() => run('number-words', { n: '1'.repeat(28) }), /digits are supported/);
    const ord = n => run('ordinal', { n })[0][1];
    expect(['1', '2', '3', '4', '11', '12', '13', '101', '111', '122', '1013'].map(ord)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '101st', '111th', '122nd', '1013th']);
    expect(run('ordinal', { n: '0' })[1][1]).toBe('zeroth');
    expect(run('ordinal', { n: '90' })[1][1]).toBe('ninetieth');
    throwsPlain(() => run('ordinal', { n: '-1' }), /whole number/);
  });

  it('shuffles, picks and splits without losing or repeating anything', () => {
    for (let i = 0; i < 30; i++) {
      expect(run('lines-shuffle', { text: 'a\nb\nc\nd\ne' }).split('\n').sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(new Set(run('random-pick', { items: 'a\nb\nc\nd', count: 4 }).split('\n')).size).toBe(4);
      const teams = run('team-split', { items: 'a,b,c,d,e,f,g', teams: 3 });
      expect(teams.map(t => t[1].split(', ').length).sort()).toEqual([2, 2, 3]);
      expect(teams.flatMap(t => t[1].split(', ')).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    }
    throwsPlain(() => run('random-pick', { items: 'a\nb', count: 3 }), /only 2 items/);
    throwsPlain(() => run('team-split', { items: 'a', teams: 2 }), /can't make 2 teams/);
  });

  it('keeps random numbers and dice inside their ranges', () => {
    const nums = run('random-number', { min: 1, max: 10, count: 10, unique: true }).split('\n').map(Number);
    expect(nums.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    throwsPlain(() => run('random-number', { min: 1, max: 3, count: 4, unique: true }), /Only 3 different numbers/);
    throwsPlain(() => run('random-number', { min: 5, max: 1 }), /must not be more/);
    throwsPlain(() => run('random-number', { min: 1.2, max: 1.8 }), /No number/);
    for (let i = 0; i < 50; i++) {
      const total = Number(run('dice-roll', { dice: '3d4+2' }).at(-1)[1]);
      expect(total).toBeGreaterThanOrEqual(5);
      expect(total).toBeLessThanOrEqual(14);
      const [roll] = run('dice-roll', { dice: '4d6kl1' });
      const [rolls, kept] = roll[1].split(' → kept ');
      expect(Number(kept.split(' = ')[0])).toBe(Math.min(...rolls.split(', ').map(Number)));
    }
    throwsPlain(() => run('dice-roll', { dice: '10' }), /at least one die/);
    throwsPlain(() => run('dice-roll', { dice: '2x6' }), /Couldn't read/);
    throwsPlain(() => run('dice-roll', { dice: '4d6kh5' }), /keep between 1 and 4/);
    const flips = run('coin-flip', { count: 1000 });
    expect(flips.length).toBe(2);
    expect(Number(flips[0][1].split(' ')[0]) + Number(flips[1][1].split(' ')[0])).toBe(1000);
  });

  it('wraps without ever exceeding the width', () => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.';
    for (const width of [5, 10, 17, 40]) {
      const out = run('text-wrap', { text, width, breakLong: true });
      for (const l of out.split('\n')) expect(l.length).toBeLessThanOrEqual(width);
      // When no word is longer than the width, wrapping only swaps spaces for line breaks.
      if (width >= 12) expect(out.replace(/\n/g, ' ')).toBe(text);
      else expect(out.replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
    }
  });

  it('diffs pure insertions and deletions', () => {
    expect(run('text-diff', { a: '', b: 'new' })).toBe('- \n+ new');
    expect(run('text-diff', { a: 'a\nb\nc', b: 'a\nc' })).toBe('  a\n- b\n  c');
    expect(run('text-diff', { a: 'a\nc', b: 'a\nb\nc', onlyChanges: true })).toBe('+ b');
  });

  it('strips emoji sequences completely', () => {
    expect(run('emoji-remove', { text: 'Family 👨\u200D👩\u200D👧\u200D👦 and 1\uFE0F\u20E3 and ❤\uFE0F!' })).toBe('Family and 1 and !');
  });

  it('scores obviously weak and strong passwords sensibly', () => {
    const rating = pw => run('password-strength', { password: pw }).find(r => r[0] === 'Rating')[1];
    expect(rating('aaaaaaaaaaaa')).toBe('Very weak');
    expect(rating('123456')).toBe('Very weak');
    expect(rating('qwerty')).toBe('Very weak');
    expect(['Strong', 'Very strong']).toContain(rating('k7#Qp2!vZx9@Lm4$'));
  });
});
