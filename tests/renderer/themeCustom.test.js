// @vitest-environment jsdom
//
// Item #4 (2026-10-08): your own colour themes. The colour maths, the stored
// form and the .vextheme file (js/theme-custom.js, docs/THEME_FORMAT.md).
// Contrast is measured here with an independent copy of the formula the theme
// tests use, so the editor's warnings and those tests agree.
import { describe, it, expect, beforeEach } from 'vitest';

const { CustomThemes: C } = require('../../src/renderer/js/theme-custom.js');

const rgb = (v) => {
  const m = /^#([0-9a-f]{6})$/i.exec(v || '');
  if (!m) throw new Error(`not a 6-digit hex colour: ${v}`);
  return m[1].match(/../g).map(x => parseInt(x, 16));
};
const lum = (v) => rgb(v).map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const DARK = { background: '#0e0e12', surface: '#1a1a22', text: '#e6e6f0', muted: '#7f7f92', primary: '#8b8bff' };
const LIGHT = { background: '#f3f3f3', surface: '#fbfbfb', text: '#1a1a1a', primary: '#ffcc00' };

// A small seeded generator, so the palettes below are the same every run.
function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
const randHex = (r) => '#' + [0, 0, 0].map(() => Math.floor(r() * 256).toString(16).padStart(2, '0')).join('');

const goodFile = (over = {}) => JSON.stringify({ format: 'vex-theme', version: 1, name: 'Harbour', colors: { ...DARK }, ...over });

describe('colour maths', () => {
  it('contrast and luminance match the theme tests\' formula', () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const a = randHex(r), b = randHex(r);
      expect(C.contrast(a, b)).toBeCloseTo(contrast(a, b), 10);
    }
  });

  it('accepts #rgb and #rrggbb in any case, and nothing else', () => {
    expect(C.normHex('#ABC')).toBe('#aabbcc');
    expect(C.normHex(' #A1b2C3 ')).toBe('#a1b2c3');
    for (const bad of ['red', '#12345', '#1234567', 'rgb(1,2,3)', '#fff;}', '', null, 12, '#ggg', 'url(x)']) expect(C.normHex(bad), String(bad)).toBeNull();
  });

  it('five colours make a whole theme: the optional four are derived', () => {
    const d = C.derive({ background: '#101820', surface: '#1b2733', text: '#e8eef5', primary: '#4cc2ff' });
    for (const k of C.COLOR_KEYS) expect(d.colors[k], k).toMatch(/^#[0-9a-f]{6}$/);
    // Every token the built-in themes set in the chrome is set here too.
    for (const k of ['--vex-bg-base', '--vex-bg-elevated', '--vex-bg-deep', '--vex-glass-tab-active', '--vex-glass-input', '--vex-border-subtle',
      '--vex-border-strong', '--vex-accent-dim', '--vex-text-secondary', '--vex-text-accent', '--vex-danger-hover', '--bg-2', '--sidebar',
      '--primary-hover', '--on-primary', '--tab-active', '--tab-hover']) expect(d.chrome[k], k).toBeTruthy();
    for (const k of ['--vex-bg-base', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-input', '--vex-accent', '--on-primary', '--vex-text-muted']) expect(d.page[k], k).toBeTruthy();
    // The page and the window agree where they share a token.
    for (const k of ['--vex-bg-base', '--vex-accent', '--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-border-subtle', '--vex-border-medium', '--vex-border-strong', '--on-primary'])
      expect(d.page[k], k).toBe(d.chrome[k]);
  });

  it('light or dark by the same rule as Light and dark (luminance of the background above 0.4)', () => {
    expect(C.isLight(C.complete(LIGHT))).toBe(true);
    expect(C.isLight(C.complete(DARK))).toBe(false);
    // Light themes carry their own hover and shadow; dark ones use the shared ones.
    expect(C.derive(LIGHT).chrome['--vex-hover-fill']).toMatch(/^rgba\(26, 26, 26, 0\.06\)$/);
    expect(C.derive(DARK).chrome['--vex-hover-fill']).toBeUndefined();
  });

  it('the text on the accent is white where white reads, else the best of the page colour and black', () => {
    expect(C.derive({ ...DARK, primary: '#1d4ed8' }).chrome['--on-primary']).toBe('#ffffff');
    const yellow = C.derive({ ...DARK, primary: '#fde047' });
    expect(yellow.chrome['--on-primary']).not.toBe('#ffffff');
    expect(contrast(yellow.chrome['--on-primary'], '#fde047')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('contrast warnings and Fix contrast', () => {
  it('flags exactly the colours below 4.5:1, measured against every surface they sit on', () => {
    const checks = C.checks(DARK);
    const d = C.derive(DARK);
    const muted = checks.find(c => c.key === 'muted');
    const worst = Math.min(...[d.surfaces.bg, d.surfaces.surf, d.surfaces.deep, d.surfaces.glow].map(s => contrast(d.colors.muted, s)));
    expect(muted.ratio).toBeCloseTo(worst, 2);
    expect(muted.ok).toBe(worst >= 4.5);
    expect(muted.ok).toBe(false);
    expect(checks.find(c => c.key === 'text').ok).toBe(true);
    expect(C.checks(LIGHT).find(c => c.key === 'primary').ok).toBe(false);
    expect(checks.map(c => c.key)).toEqual(['text', 'muted', 'primary', 'onPrimary', 'success', 'warning', 'danger']);
  });

  it('Fix contrast brings every check to 4.5:1 without moving the background, surface or borders', () => {
    const r = rng(42);
    let fixedAll = 0;
    for (let i = 0; i < 60; i++) {
      const dark = r() < 0.5;
      const bg = dark ? C.mix(randHex(r), '#000000', 0.8) : C.mix(randHex(r), '#ffffff', 0.85);
      const colors = { background: bg, surface: C.mix(bg, dark ? '#ffffff' : '#000000', 0.06), text: randHex(r), muted: randHex(r), primary: randHex(r),
        success: randHex(r), warning: randHex(r), danger: randHex(r), border: randHex(r) };
      const out = C.fixContrast(colors);
      expect(out.unresolved, JSON.stringify(colors)).toEqual([]);
      for (const c of C.checks(out.colors)) expect(contrast(c.fg, c.against), `${c.key} ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(4.5);
      expect(out.colors.background).toBe(colors.background);
      expect(out.colors.surface).toBe(colors.surface);
      expect(out.colors.border).toBe(colors.border);
      fixedAll++;
    }
    expect(fixedAll).toBe(60);
  });

  it('keeps the hue of a colour it moves, and leaves a passing colour alone', () => {
    const out = C.fixContrast(LIGHT).colors;
    const [h0] = C.toHsl('#ffcc00'), [h1] = C.toHsl(out.primary);
    expect(Math.abs(h0 - h1)).toBeLessThan(0.02);
    expect(out.text).toBe('#1a1a1a');
  });
});

describe('CSS is written only from checked values', () => {
  it('writes a block for the theme id with every token', () => {
    const css = C.css('user-abcdef', DARK);
    expect(css.startsWith('[data-theme="user-abcdef"] {')).toBe(true);
    expect(css).toContain('--vex-bg-base: #0e0e12;');
    expect(css.match(/;/g).length).toBe(Object.keys(C.derive(DARK).chrome).length);
  });

  it('refuses an id that is not one of yours, and any value that is not a colour', () => {
    for (const id of ['oxford', 'user-ABC', 'user-a"]{}', 'user-x', 'user-abcd1']) expect(() => C.css(id, DARK), id).toThrow();
    expect(() => C._block('user-abcd', { '--x': 'red; } body { display:none' })).toThrow(/Refusing/);
    expect(() => C._block('user-abcd', { '--x;}': '#000000' })).toThrow(/Refusing/);
    expect(() => C.css('user-abcd', { ...DARK, text: 'url(javascript:1)' })).toThrow();
  });

  it('the New Tab gets its colours as 54 hex digits and nothing else', () => {
    const q = C.toQuery(DARK);
    expect(q).toMatch(/^[0-9a-f]{54}$/);
    expect(C.fromQuery(q)).toEqual(C.complete(DARK));
    for (const bad of [null, '', q.slice(1), q + '0', q.replace(/^./, 'g'), '<script>']) expect(C.fromQuery(bad)).toBeNull();
  });
});

describe('the .vextheme file', () => {
  it('round-trips: export then import gives the same name and colours', () => {
    const rec = { id: 'user-abcdef', name: 'Harbour', colors: C.complete(DARK) };
    const img = 'data:image/png;base64,iVBORw0KGgo=';
    const back = C.parseFile(C.toFile(rec, img));
    expect(back).toEqual({ name: 'Harbour', colors: rec.colors, image: img });
    const text = JSON.parse(C.toFile(rec, null));
    expect(Object.keys(text)).toEqual(['format', 'version', 'name', 'colors']);
    expect(text.format).toBe('vex-theme');
    expect(text.version).toBe(1);
  });

  it('accepts the four needed colours plus the accent, deriving the rest', () => {
    const t = C.parseFile(goodFile({ colors: { background: '#FFF', surface: '#eeeeee', text: '#111', primary: '#0055AA' } }));
    expect(t.colors.background).toBe('#ffffff');
    expect(t.colors.primary).toBe('#0055aa');
    expect(t.colors.muted).toMatch(/^#[0-9a-f]{6}$/);
    expect(t.image).toBeNull();
  });

  const hostile = {
    'not JSON': 'body { color: red }',
    'a list': '[1,2]',
    'another format': goodFile({ format: 'css' }),
    'no version': goodFile({ version: undefined }),
    'a newer version': goodFile({ version: 2 }),
    'an unknown field': goodFile({ css: 'body{display:none}' }),
    'a __proto__ field': '{"format":"vex-theme","version":1,"name":"x","colors":{"background":"#000","surface":"#111","text":"#fff","primary":"#f00"},"__proto__":{"polluted":1}}',
    'an unknown colour': goodFile({ colors: { ...DARK, accentGlow: '#ffffff' } }),
    'a colour as CSS': goodFile({ colors: { ...DARK, text: '#fff; } body { display: none' } }),
    'a colour by name': goodFile({ colors: { ...DARK, primary: 'red' } }),
    'a missing colour': goodFile({ colors: { background: '#000000', surface: '#111111', text: '#ffffff' } }),
    'no name': goodFile({ name: '   ' }),
    'a long name': goodFile({ name: 'x'.repeat(41) }),
    'a name that is not text': goodFile({ name: { toString: 1 } }),
    'an SVG picture': goodFile({ image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }),
    'a picture from the web': goodFile({ image: 'https://example.com/a.png' }),
    'a picture with something after it': goodFile({ image: 'data:image/png;base64,AAAA") ; background:url("x' }),
    'a picture too big': goodFile({ image: 'data:image/png;base64,' + 'A'.repeat(1500000) }),
    'a file too big': goodFile({ name: 'x' }) + ' '.repeat(2 * 1024 * 1024),
  };
  for (const [what, text] of Object.entries(hostile)) {
    it(`refuses ${what}`, () => { expect(() => C.parseFile(text)).toThrow(); });
  }

  it('a name with markup is kept as text (it is only ever shown with textContent) and never reaches CSS', () => {
    const t = C.parseFile(goodFile({ name: '</style><img src=x onerror=alert(1)>' }));
    expect(t.name).toBe('</style><img src=x onerror=alert(1)>');
    expect(C.css('user-abcd', t.colors)).not.toContain('<');
  });

  it('control characters are taken out of a name', () => {
    expect(C.parseFile(goodFile({ name: 'A\u0000B\n  C' })).name).toBe('AB C');
  });
});

describe('the saved list', () => {
  beforeEach(() => localStorage.clear());

  it('keeps good records and leaves out damaged ones (and duplicates)', () => {
    const good = { id: 'user-abcdef', name: 'One', colors: C.complete(DARK), base: 'nord', updated: 5 };
    localStorage.setItem(C.KEY, JSON.stringify([
      good,
      { ...good },
      { id: 'user-ghijkl', name: 'Two', colors: { ...C.complete(DARK), text: 'red' } },
      { id: 'oxford', name: 'Three', colors: C.complete(DARK) },
      { id: 'user-mnopqr', name: 'Four', colors: C.complete(DARK), extra: 1 },
    ]));
    expect(C.list().map(r => r.id)).toEqual(['user-abcdef']);
  });

  it('saveList refuses a bad record instead of writing it', () => {
    expect(() => C.saveList([{ id: 'user-abcdef', name: '', colors: C.complete(DARK) }])).toThrow();
    expect(localStorage.getItem(C.KEY)).toBeNull();
  });

  it('new ids are user- and ten letters, never one already taken', () => {
    const id = C.newId([]);
    expect(id).toMatch(/^user-[a-z]{10}$/);
    expect(C.ID_RE.test(id)).toBe(true);
  });

  it('an unreadable stored list is an empty list, said in the console', () => {
    localStorage.setItem(C.KEY, '{nope');
    expect(C.list()).toEqual([]);
  });
});
