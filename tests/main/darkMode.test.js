// @vitest-environment node
//
// Dark mode for websites. The rules (renderer/js/dark-mode.js, read by main as
// well), main's answers (main/dark-mode.js), the IPC fences, and the page-side
// preload's colour maths and its refusal to run where it must not (an
// extension's page, a file:// page, a frame). The engine's behaviour in a real
// page is checked in Chromium by the probe scripts, not here: jsdom has no
// constructed stylesheets and cannot compute a style.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const path = require('path');

const { VexDarkMode: D } = require('../../src/renderer/js/dark-mode.js');
const pre = require('../../src/dark-mode-preload.js');
const { wireDarkMode, cleanRaw, baseColor } = require('../../src/main/dark-mode.js');

const K = D.KEYS;
const raw = (o) => ({ ...Object.fromEntries(D.rawKeys().map(k => [k, null])), ...o });
const list = (...h) => JSON.stringify(h);

describe('which page gets dark mode', () => {
  it('per site (the default): only the listed hosts, www ignored', () => {
    const r = raw({ [K.hosts]: list('example.com') });
    expect(D.decide(r, 'https://www.example.com/a').on).toBe(true);
    expect(D.decide(r, 'https://other.org/').on).toBe(false);
    expect(D.decide(r, 'https://other.org/').reason).toBe('not-listed');
  });
  it('keeps the old behaviour for a profile that never saved a mode: the list works, the legacy flag means everywhere', () => {
    expect(D.parse(raw({})).mode).toBe('site');
    expect(D.parse(raw({ [K.legacyAll]: 'true' })).mode).toBe('all');
    expect(D.decide(raw({ [K.legacyAll]: 'true' }), 'https://a.test/').on).toBe(true);
    expect(D.decide(raw({ [K.mode]: 'site', [K.legacyAll]: 'true' }), 'https://a.test/').on).toBe(false);
  });
  it('off turns everything off, the list stays', () => {
    const r = raw({ [K.mode]: 'off', [K.hosts]: list('example.com') });
    expect(D.decide(r, 'https://example.com/').on).toBe(false);
    expect(D.decide(r, 'https://example.com/').reason).toBe('mode-off');
  });
  it('all sites except the listed ones', () => {
    const r = raw({ [K.mode]: 'all', [K.never]: list('bank.test') });
    expect(D.decide(r, 'https://news.test/').on).toBe(true);
    expect(D.decide(r, 'https://bank.test/login').on).toBe(false);
    expect(D.decide(r, 'https://bank.test/login').reason).toBe('excepted');
  });
  it('never on Vex’s own pages, extensions, files, about: or data:', () => {
    const r = raw({ [K.mode]: 'all' });
    for (const u of ['file:///C:/x/start.html', 'vex://start', 'chrome-extension://abc/pdf.html', 'about:blank', 'data:text/html,hi', 'devtools://x', '', 'not a url']) {
      expect(D.decide(r, u).on, u).toBe(false);
      expect(D.decide(r, u).reason, u).toBe('not-web');
    }
  });
  it('never in a Tor tab, even when the person asks for a preview', () => {
    const r = raw({ [K.mode]: 'all' });
    expect(D.decide(r, 'https://a.test/', { tor: true }).on).toBe(false);
    expect(D.decide(r, 'https://a.test/', { tor: true, force: true }).on).toBe(false);
  });
  it('leaves Dark Reader in charge by default, and does not when asked not to', () => {
    const r = raw({ [K.mode]: 'all' });
    expect(D.decide(r, 'https://a.test/', { darkReader: true }).on).toBe(false);
    expect(D.decide(r, 'https://a.test/', { darkReader: true }).reason).toBe('dark-reader');
    expect(D.decide({ ...r, [K.readerDefer]: 'false' }, 'https://a.test/', { darkReader: true }).on).toBe(true);
  });
  it('a preview forces it on for a page that is not listed, and force:false forces it off', () => {
    const r = raw({ [K.mode]: 'site' });
    expect(D.decide(r, 'https://a.test/', { force: true }).on).toBe(true);
    expect(D.decide(raw({ [K.mode]: 'all' }), 'https://a.test/', { force: false }).on).toBe(false);
  });
  it('a damaged list or look names no site and falls back to the defaults, never throwing', () => {
    const r = raw({ [K.hosts]: '{oops', [K.look]: 'nope', [K.engine]: 'weird', [K.mode]: 'weird' });
    expect(D.decide(r, 'https://a.test/').on).toBe(false);
    const s = D.parse(r);
    expect(s.engine).toBe('smart');
    expect(s.look).toEqual({ brightness: 100, contrast: 100, sepia: 0 });
    expect(s.mode).toBe('site');
  });
  it('the look is clamped, and images are kept unless switched off', () => {
    const s = D.parse(raw({ [K.look]: JSON.stringify({ brightness: 900, contrast: -4, sepia: 55.4 }) }));
    expect(s.look).toEqual({ brightness: 150, contrast: 50, sepia: 55 });
    expect(s.keepImages).toBe(true);
    expect(D.parse(raw({ [K.keepImages]: 'false' })).keepImages).toBe(false);
  });
});

describe('main answers a page and the window', () => {
  function wire(stored, extensions) {
    const handlers = new Map(); const listeners = new Map();
    const ipcMain = { on: (c, f) => listeners.set(c, f), handle: (c, f) => handlers.set(c, f) };
    const sent = [];
    const contents = (url, ses) => ({ id: 7, session: ses || { getAllExtensions: () => extensions || [] }, isDestroyed: () => false, getURL: () => url, send: (...a) => sent.push(a) });
    const page = contents('https://a.test/');
    const webContents = { fromId: (id) => (id === 7 ? page : null) };
    wireDarkMode({ ipcMain, webContents, persistLoad: () => stored, sessionFor: () => ({ getAllExtensions: () => extensions || [] }) });
    const ask = (frame, sender) => { const e = { senderFrame: frame, sender: sender || page, returnValue: undefined }; listeners.get('darkmode:page')(e); return e.returnValue; };
    return { ask, handlers, sent, page, contents };
  }
  it('answers from the saved settings and the frame’s own address', () => {
    const w = wire({ [K.hosts]: list('a.test') });
    const d = w.ask({ url: 'https://a.test/x', parent: null });
    expect(d.on).toBe(true);
    expect(d.engine).toBe('smart');
    expect(d.base).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('a sub-frame is told no; so is a page whose settings cannot be read', () => {
    const w = wire({ 'vex.forceDarkHosts': list('a.test') });
    expect(w.ask({ url: 'https://a.test/', parent: {} })).toEqual({ on: false });
    expect(w.ask(null)).toEqual({ on: false });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = wire(null);
    bad.ask({ url: 'https://a.test/', parent: null });
    errors.mockRestore();
  });
  it('a Tor session and an installed Dark Reader both get none', () => {
    const stored = { 'vex.forceDarkHosts': list('a.test') };
    const tor = wire(stored);
    expect(tor.ask({ url: 'https://a.test/', parent: null }, { ...tor.page, session: { __vexTor: true, getAllExtensions: () => [] } }).on).toBe(false);
    const dr = wire(stored, [{ id: 'eimadpbcbfnmbkopoojfekhnkhdbieeh', name: 'Dark Reader' }]);
    const d = dr.ask({ url: 'https://a.test/', parent: null });
    expect(d.on).toBe(false);
    expect(d.reason).toBe('dark-reader');
    const byName = wire(stored, [{ id: 'x', name: 'Dark Reader' }]);
    expect(byName.ask({ url: 'https://a.test/', parent: null }).reason).toBe('dark-reader');
    expect((dr.handlers.get('darkmode:status')())).toEqual({ darkReader: true });
  });
  it('apply gives the tab its decision for the page it shows, from the window’s fresh settings', async () => {
    const w = wire({});
    const d = await w.handlers.get('darkmode:apply')({}, 7, raw({ [K.mode]: 'all' }), undefined);
    expect(d.on).toBe(true);
    expect(w.sent).toEqual([['vex-darkmode:set', d]]);
    w.sent.length = 0;
    const off = await w.handlers.get('darkmode:apply')({}, 7, raw({ [K.mode]: 'all' }), { force: false });
    expect(off.on).toBe(false);
    expect(w.sent[0][1].on).toBe(false);
    expect(() => w.handlers.get('darkmode:apply')({}, 99, raw({}), undefined)).toThrow(/tab is gone/);
  });
  it('apply refuses a settings object that is not text-or-null per key', () => {
    expect(() => cleanRaw(null)).toThrow();
    expect(() => cleanRaw([])).toThrow();
    expect(() => cleanRaw({ [K.mode]: 5 })).toThrow(/Not a dark mode setting/);
    expect(cleanRaw({ [K.mode]: 'all', 'vex.unrelated': 'x' })['vex.unrelated']).toBeUndefined();
  });
  it('the backdrop colour is the converted white of the page, and the old filter has its own', () => {
    expect(baseColor({ engine: 'smart', look: { brightness: 100, contrast: 100, sepia: 0 } })).toBe('#1a1d1e');
    expect(baseColor({ engine: 'simple', look: {} })).toBe('#0a0c10');
  });
});

describe('the IPC fences', () => {
  const policy = fs.readFileSync(path.resolve('src/main/ipc-policy.js'), 'utf8');
  const schemas = require('../../src/main/ipc-schemas.js');
  it('a page may ask only for its own decision; the window alone changes a tab', () => {
    const guest = /const GUEST_CHANNELS = new Set\(\[([\s\S]*?)\]\);/.exec(policy)[1];
    expect(guest).toContain("'darkmode:page'");
    expect(guest).not.toContain('darkmode:apply');
    const ui = /const UI_ONLY_CHANNELS = new Set\(\[([\s\S]*?)\]\);/.exec(policy)[1];
    expect(ui).toContain("'darkmode:apply'");
    expect(ui).toContain("'darkmode:status'");
    expect(/const TARGET_CHANNELS = new Set\(\[([\s\S]*?)\]\);/.exec(policy)[1]).toContain("'darkmode:apply'");
  });
  it('the arguments are checked', () => {
    expect(() => schemas.validate('darkmode:apply', [7, {}, undefined])).not.toThrow();
    expect(() => schemas.validate('darkmode:apply', [7, {}, { force: true }])).not.toThrow();
    expect(() => schemas.validate('darkmode:apply', ['7', {}])).toThrow();
    expect(() => schemas.validate('darkmode:apply', [7, [], undefined])).toThrow();
    expect(() => schemas.validate('darkmode:apply', [7, {}, { force: 'yes' }])).toThrow();
    expect(() => schemas.validate('darkmode:page', [])).not.toThrow();
    expect(() => schemas.validate('darkmode:page', ['x'])).toThrow();
  });
  it('the preload is registered for guests and in the packaged tree (src/**)', () => {
    const main = fs.readFileSync(path.resolve('src/main.js'), 'utf8');
    expect(main).toContain("path.join(__dirname, 'dark-mode-preload.js')");
    expect(fs.existsSync(path.resolve('src/dark-mode-preload.js'))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    expect(pkg.build.files).toContain('src/**/*');
  });
});

// The preload runs in every page of every session. It must stop at once where it
// has no business: the PDF viewer broke exactly because a preload ran in its frame.
describe('the preload runs only in a top-level web page', () => {
  const source = fs.readFileSync(path.resolve('src/dark-mode-preload.js'), 'utf8');
  function runIn({ href, top = true, contentType = 'text/html' }) {
    const url = new URL(href);
    const asked = [];
    const win = {};
    win.top = top ? win : {};
    win.window = win;
    const sandbox = {
      window: win, document: { contentType, documentElement: null }, location: { protocol: url.protocol, href },
      require: (name) => { if (name !== 'electron') throw new Error('only electron resolves in a sandboxed preload'); return { ipcRenderer: { sendSync: (...a) => { asked.push(a); return { on: false }; }, on: () => {} } }; },
      module: { exports: {} }, console,
    };
    vm.runInNewContext(source, sandbox);
    return asked;
  }
  it('asks main once for an ordinary page', () => {
    expect(runIn({ href: 'https://a.test/' })).toEqual([['darkmode:page']]);
    expect(runIn({ href: 'http://127.0.0.1:3000/' })).toEqual([['darkmode:page']]);
  });
  it('does not even ask in an extension page (the PDF viewer), a file page, a sub-frame or a non-HTML document', () => {
    expect(runIn({ href: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html' })).toEqual([]);
    expect(runIn({ href: 'file:///C:/Vex/src/renderer/start.html' })).toEqual([]);
    expect(runIn({ href: 'chrome-untrusted://pdf/x' })).toEqual([]);
    expect(runIn({ href: 'https://a.test/frame', top: false })).toEqual([]);
    expect(runIn({ href: 'https://a.test/a.pdf', contentType: 'application/pdf' })).toEqual([]);
    expect(runIn({ href: 'https://a.test/data.json', contentType: 'application/json' })).toEqual([]);
  });
});

describe('colours', () => {
  const L = pre.DEFAULT_LOOK;
  it('reads the colour forms pages use, and refuses the rest', () => {
    expect(pre.parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(pre.parseColor('#11223380').a).toBeCloseTo(0.502, 2);
    expect(pre.parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(pre.parseColor('rgba(10, 20, 30, .25)').a).toBe(0.25);
    expect(pre.parseColor('hsl(0 100% 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(pre.parseColor('rebeccapurple')).toEqual({ r: 102, g: 51, b: 153, a: 1 });
    expect(pre.parseColor('transparent').a).toBe(0);
    for (const bad of ['currentcolor', 'var(--x)', 'color-mix(in srgb, red, blue)', 'oklch(0.5 0.1 20)', '#12', 'nonsense', '']) expect(pre.parseColor(bad), bad).toBeNull();
  });
  it('a light background goes dark, a dark one stays, and the order of greys is kept', () => {
    const g = (hex) => pre.toCss(pre.mapBackground(pre.parseColor(hex)));
    expect(g('#fff')).toBe('#1a1d1e');
    expect(g('#000')).toBe('#000000');
    const lum = (hex) => pre.luminance(pre.parseColor(hex));
    expect(lum(g('#ffffff'))).toBeLessThan(lum(g('#eeeeee')));
    expect(lum(g('#eeeeee'))).toBeLessThan(lum(g('#cccccc')));
    expect(lum(g('#ffffff'))).toBeLessThan(0.02);
  });
  it('text stays readable: every grey and the usual link colours reach 4.5:1 on the darkened white', () => {
    const page = pre.mapBackground(pre.parseColor('#ffffff'));
    for (let v = 0; v <= 255; v += 5) {
      const fg = pre.mapForeground({ r: v, g: v, b: v, a: 1 });
      expect(pre.contrast(fg, page), 'grey ' + v).toBeGreaterThanOrEqual(4.5);
    }
    for (const c of ['#0645ad', '#cc0000', '#006400', '#800080', '#1a0dab', '#0000ee', '#551a8b', '#b00020', '#003366']) {
      expect(pre.contrast(pre.mapForeground(pre.parseColor(c)), page), c).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('text on every light card keeps 4.5:1 too (the card goes dark as the text goes light)', () => {
    for (let bg = 200; bg <= 255; bg += 5) {
      const card = pre.mapBackground({ r: bg, g: bg, b: bg, a: 1 });
      for (let v = 0; v <= 128; v += 16) expect(pre.contrast(pre.mapForeground({ r: v, g: v, b: v, a: 1 }), card), `${v} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('rewrites a value colour by colour and leaves urls, sizes and keywords alone', () => {
    expect(pre.convertValue('url(a.png) no-repeat #fff', 'bg', L)).toBe('url(a.png) no-repeat #1a1d1e');
    expect(pre.convertValue('1px solid #ddd', 'bd', L)).toMatch(/^1px solid #[0-9a-f]{6}$/);
    expect(pre.convertValue('linear-gradient(to right, #fff, #eee)', 'bg', L)).toMatch(/^linear-gradient\(to right, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
    expect(pre.convertValue('transparent', 'bg', L)).toBe('transparent');
    expect(pre.convertValue('#000', 'bg', L)).toBe('#000');
    expect(pre.convertValue('rgb(var(--r) var(--g) var(--b))', 'fg', L)).toContain('var(--vexdm-fg-r,var(--r))');
  });
  it('a variable is converted where it is defined, and used through its twin with the page’s own as the fallback', () => {
    expect(pre.convertValue('var(--bg)', 'bg', L)).toBe('var(--vexdm-bg-bg,var(--bg))');
    expect(pre.convertValue('var(--bg, #fff)', 'bg', L)).toBe('var(--vexdm-bg-bg,var(--bg,#1a1d1e))');
    const twins = pre.varTwins('--bg', '#ffffff', L);
    // white as text stays white, so there is no text twin: its use falls back to the page's own value
    expect(twins).toHaveLength(2);
    expect(twins[0]).toBe('--vexdm-bg-bg:#1a1d1e');
    expect(twins[1]).toMatch(/^--vexdm-bd-bg:#[0-9a-f]{6}$/);
    expect(pre.varTwins('--ink', '#111111', L).map(t => t.split(':')[0])).toEqual(['--vexdm-fg-ink', '--vexdm-bd-ink']);
    expect(pre.varTwins('--size', '12px', L)).toEqual([]);
    // a channel triple (shadcn): hsl(var(--background))
    const t = pre.varTwins('--background', '0 0% 100%', L);
    expect(t[0]).toMatch(/^--vexdm-bg-background:\d+ [\d.]+% [\d.]+%$/);
  });
  it('writes override rules only for colours, and never copies a url()', () => {
    const o = pre.overrideBlock('background: #fff url(x.png) no-repeat; color: rgb(0, 0, 0); box-shadow: 0 1px #000; width: 3px', L, true);
    expect(o).toContain('background-color:#1a1d1e!important');
    expect(o).toContain('color:#edebe9!important');
    expect(o).not.toContain('url(');
    expect(o).not.toContain('box-shadow');
    expect(o).not.toContain('width');
    expect(pre.overrideBlock('background:none;color:inherit;border:0', L, true)).toBe('');
    expect(pre.overrideBlock('color-scheme: light', L, true)).toBe('color-scheme:dark!important');
    expect(pre.overrideBlock('background: linear-gradient(#fff, #eee)', L, true)).toMatch(/^background-image:linear-gradient\(#1a1d1e, #[0-9a-f]{6}\)!important$/);
  });
  it('brightness, contrast and sepia move the converted colours', () => {
    const dim = { brightness: 70, contrast: 100, sepia: 0 };
    expect(pre.luminance(pre.parseColor(pre.convertValue('#fff', 'fg', dim)))).toBeLessThan(pre.luminance(pre.parseColor(pre.convertValue('#fff', 'fg', L))));
    const sepia = pre.parseColor(pre.convertValue('#808080', 'fg', { brightness: 100, contrast: 100, sepia: 100 }));
    expect(sepia.r).toBeGreaterThan(sepia.b);
  });
});
