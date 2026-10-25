// @vitest-environment jsdom
//
// Vex's own PDF viewer, the page side (src/renderer/pdf-viewer): the marks and how they are kept, what is saved, the words in two
// languages, the colours (only the interface's tokens), and the page's own markup (names for everything you press).
// What it looks like and how it behaves in the real window is checked by driving a real Vex (scripts are in the report).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(__dirname, '..', '..', 'src', 'renderer', 'pdf-viewer');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const files = fs.readdirSync(DIR).filter((f) => /\.(js|html|css)$/.test(f));

let marks, strings, theme;
async function load() {
  marks = await import('../../src/renderer/pdf-viewer/marks.js');
  strings = await import('../../src/renderer/pdf-viewer/strings.js');
  theme = await import('../../src/renderer/pdf-viewer/theme.js');
}

describe('the marks and how they are kept', () => {
  const hl = (page = 1) => ({ kind: 'highlight', page, color: '#ffe44d', rects: [{ x: 10, y: 10, w: 100, h: 14 }] });
  it('adds, removes and brings back, one step at a time, and says what changed', async () => {
    await load();
    const s = marks.createMarkStore();
    const seen = [];
    s.on((why) => seen.push(why && why.type));
    const a = s.add(hl());
    const b = s.add({ kind: 'rect', page: 2, color: '#112233', x: 1, y: 2, w: 3, h: 4 });
    expect(s.count()).toBe(2);
    expect(s.byPage(2)).toEqual([b]);
    s.update(b.id, { x: 50 });
    expect(s.get(b.id).x).toBe(50);
    s.remove(a.id);
    expect(s.list().map((m) => m.id)).toEqual([b.id]);
    expect(s.undo()).toBe(true);                 // the highlight comes back
    expect(s.get(a.id)).toBeTruthy();
    expect(s.undo()).toBe(true);                 // x goes back
    expect(s.get(b.id).x).toBe(1);
    expect(s.redo()).toBe(true);
    expect(s.get(b.id).x).toBe(50);
    expect(seen.filter(Boolean)).toEqual(['add', 'add', 'update', 'remove', 'undo', 'undo', 'redo']);
  });
  it('a new step clears what could have been redone', async () => {
    await load();
    const s = marks.createMarkStore();
    s.add(hl()); s.undo();
    expect(s.canRedo()).toBe(true);
    s.add(hl(2));
    expect(s.canRedo()).toBe(false);
    expect(s.canUndo()).toBe(true);
  });
  it('a selection that crosses lines is one step', async () => {
    await load();
    const s = marks.createMarkStore();
    s.addMany([hl(1), hl(2), hl(3)]);
    expect(s.count()).toBe(3);
    s.undo();
    expect(s.count()).toBe(0);
  });
  it('a drag shows its way (preview) and is one step when it ends', async () => {
    await load();
    const s = marks.createMarkStore();
    const m = s.add({ kind: 'rect', page: 1, color: '#000000', x: 0, y: 0, w: 5, h: 5 });
    s.preview(m.id, { x: 20 }); s.preview(m.id, { x: 40 });
    expect(s.get(m.id).x).toBe(40);
    s.get(m.id).x = 0;
    s.update(m.id, { x: 40 });
    s.undo();
    expect(s.get(m.id).x).toBe(0);
  });
  it('tells what is not saved yet, and holds a limit', async () => {
    await load();
    const s = marks.createMarkStore();
    expect(s.isDirty()).toBe(false);
    s.add(hl());
    expect(s.isDirty()).toBe(true);
    s.markSaved();
    expect(s.isDirty()).toBe(false);
    s.undo();
    expect(s.isDirty()).toBe(true);
    const full = marks.createMarkStore();
    for (let i = 0; i < marks.LIMITS.marks; i++) full.add(hl());
    expect(() => full.add(hl())).toThrow(/most marks/);
  });
  it('finds a mark under a point: a line by its path, an area by its box', async () => {
    await load();
    const line = { kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0, width: 1 };
    expect(marks.hits(line, 50, 2, 3)).toBe(true);
    expect(marks.hits(line, 50, 40, 3)).toBe(false);
    const rect = { kind: 'rect', x: 10, y: 10, w: 30, h: 20 };
    expect(marks.hits(rect, 20, 20, 2)).toBe(true);
    expect(marks.hits(rect, 80, 20, 2)).toBe(false);
    expect(marks.boundsOf(hl())).toEqual({ x: 10, y: 10, w: 100, h: 14 });
    expect(marks.boundsOf({ kind: 'ink', points: [[5, 5], [15, 30]] })).toEqual({ x: 5, y: 5, w: 10, h: 25 });
  });
  it('joins the pieces of one line of text into one box, down the page or across it', async () => {
    await load();
    const across = marks.mergeLineRects([{ x: 0, y: 0, w: 40, h: 10 }, { x: 42, y: 1, w: 30, h: 10 }, { x: 0, y: 30, w: 20, h: 10 }]);
    expect(across).toHaveLength(2);
    expect(across[0].w).toBeGreaterThanOrEqual(72);
    const down = marks.mergeLineRects([{ x: 0, y: 0, w: 10, h: 40 }, { x: 1, y: 42, w: 10, h: 30 }, { x: 30, y: 0, w: 10, h: 20 }], 'v');
    expect(down).toHaveLength(2);
    expect(down.find((r) => r.x === 0).h).toBeGreaterThanOrEqual(72);
    expect(marks.mergeLineRects([{ x: 0, y: 0, w: 0.2, h: 10 }])).toEqual([]);
  });
});

describe('what is handed to main to be saved', () => {
  it('rounds the numbers and keeps the kinds', async () => {
    await load();
    const out = marks.toSavePayload([
      { id: 'm1', kind: 'highlight', page: 1, color: '#ffe44d', rects: [{ x: 1.23456, y: 2, w: 3, h: 4 }] },
      { id: 'm2', kind: 'text', page: 2, color: '#14161a', x: 10.555, y: 20, size: 14, text: ' Merhaba ', angle: 90, w: 120 },
      { id: 'm3', kind: 'line', page: 1, color: '#aa0000', x1: 0, y1: 0, x2: 10, y2: 10, arrow: true, width: 2 },
      { id: 'm4', kind: 'signature', page: 1, color: '#000000', x: 5, y: 5, w: 100, h: 30 },
    ]);
    expect(out[0].rects[0].x).toBe(1.23);
    expect(out[1]).toMatchObject({ kind: 'text', text: 'Merhaba', angle: 90, size: 14, w: 120 });
    expect(out[2].arrow).toBe(true);
    expect(out[3].angle).toBe(0);
    expect(out.every((m) => !('id' in m))).toBe(true);
  });
  it('refuses a note with no words', async () => {
    await load();
    expect(() => marks.toSavePayload([{ kind: 'text', page: 1, color: '#000000', x: 1, y: 1, size: 12, text: '  ' }])).toThrow(/no text/);
    expect(() => marks.toSavePayload([{ kind: 'text', page: 1, color: '#000000', x: 1, y: 1, size: 12, text: 'x'.repeat(501) }])).toThrow(/at most/);
    expect(() => marks.toSavePayload([{ kind: 'sparkle', page: 1 }])).toThrow(/cannot be saved/);
  });
  it('reads the typed answers of a form by field name', async () => {
    await load();
    const widgets = [
      { id: '9R', fieldName: 'ad', fieldType: 'Tx' },
      { id: '16R', fieldName: 'haber', fieldType: 'Btn', checkBox: true },
      { id: '22R', fieldName: 'plan', fieldType: 'Btn', radioButton: true, buttonValue: 'free' },
      { id: '27R', fieldName: 'plan', fieldType: 'Btn', radioButton: true, buttonValue: 'pro' },
      { id: '33R', fieldName: 'ulke', fieldType: 'Ch' },
      { id: '40R', fieldName: 'untouched', fieldType: 'Tx' },
    ];
    const storage = { '9R': { value: 'Fadi Çağlar' }, '16R': { value: true }, '22R': { value: false }, '27R': { value: true }, '33R': { value: ['Germany'] } };
    expect(marks.formValuesFrom(widgets, storage)).toEqual({ ad: 'Fadi Çağlar', haber: true, plan: 'pro', ulke: 'Germany' });
    expect(marks.formValuesFrom(widgets, {})).toEqual({});
    expect(marks.formValuesFrom(null, {})).toEqual({});
  });
});

describe('the words: every sentence has Turkish, and the table has nothing left over', () => {
  // The sentences a person reads, found the same way the code writes them: t('...'), data-i18n attributes, and the lists of names.
  function sentences() {
    const found = new Set();
    for (const f of files.filter((n) => /\.(js|html)$/.test(n) && n !== 'strings-tr.js')) {
      const src = read(f);
      for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) found.add(m[1].replace(/\\'/g, "'"));
      for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) found.add(m[1]);
      for (const m of src.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]*)"/g)) found.add(m[1]);
      for (const m of src.matchAll(/\bt\(\s*[^'"()]*\?\s*'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) { found.add(m[1].replace(/\\'/g, "'")); found.add(m[2].replace(/\\'/g, "'")); }
    }
    return found;
  }
  it('every sentence has a Turkish one', async () => {
    await load();
    const { TR } = await import('../../src/renderer/pdf-viewer/strings-tr.js');
    const { SHORTCUTS } = await import('../../src/renderer/pdf-viewer/actions.js');
    const extra = [...theme.SWATCHES.map((s) => s.name), ...SHORTCUTS.map(([what]) => what),
      'Highlight', 'Underline', 'Strikethrough', 'Drawing', 'Text note', 'Rectangle', 'Ellipse', 'Line', 'Signature', 'Arrow'];
    const missing = [...sentences(), ...extra].filter((s) => s && !(s in TR));
    expect(missing).toEqual([]);
  });
  it('no Turkish sentence is left from one that went', async () => {
    await load();
    const { TR } = await import('../../src/renderer/pdf-viewer/strings-tr.js');
    const { SHORTCUTS } = await import('../../src/renderer/pdf-viewer/actions.js');
    const live = new Set([...sentences(), ...theme.SWATCHES.map((s) => s.name), ...SHORTCUTS.map(([what]) => what),
      'Highlight', 'Underline', 'Strikethrough', 'Drawing', 'Text note', 'Rectangle', 'Ellipse', 'Line', 'Signature', 'Arrow']);
    expect(Object.keys(TR).filter((k) => !live.has(k))).toEqual([]);
  });
  it('a Turkish sentence keeps every {name} the English has, and says something different', async () => {
    const { TR } = await import('../../src/renderer/pdf-viewer/strings-tr.js');
    const same = new Set(['Aa', '{n} pt', 'Zoom', 'Ink']);
    for (const [en, tr] of Object.entries(TR)) {
      expect((tr.match(/\{\w+\}/g) || []).sort()).toEqual((en.match(/\{\w+\}/g) || []).sort());
      if (!same.has(en) && en.length > 3) expect(tr, en).not.toBe(en);
      expect(tr.trim()).not.toBe('');
    }
  });
  it('t() translates in Turkish, falls back to English, and fills the {names}', async () => {
    await load();
    strings.setLang('tr');
    expect(strings.t('Print')).toBe('Yazdır');
    expect(strings.t('Page {n} of {total}', { n: 3, total: 8 })).toBe('Sayfa 3 / 8');
    expect(strings.t('a sentence nobody wrote')).toBe('a sentence nobody wrote');
    expect(document.documentElement.lang).toBe('tr');
    strings.setLang('en');
    expect(strings.t('Print')).toBe('Print');
    expect(strings.t('Page {n} of {total}', { n: 3, total: 8 })).toBe('Page 3 of 8');
    strings.setLang('tr-TR');
    expect(strings.getLang()).toBe('tr');
    strings.setLang('en');
  });
  it('the page\'s static text is translated and icons are put in', async () => {
    await load();
    document.body.innerHTML = '<button data-i18n-title="Print" data-i18n-aria="Print"></button><span data-i18n="Pages">Pages</span><input data-i18n-placeholder="Find in the document">';
    strings.setLang('tr');
    strings.applyStatic(document);
    expect(document.querySelector('button').title).toBe('Yazdır');
    expect(document.querySelector('button').getAttribute('aria-label')).toBe('Yazdır');
    expect(document.querySelector('span').textContent).toBe('Sayfalar');
    expect(document.querySelector('input').getAttribute('placeholder')).toBe('Belgede ara');
    strings.setLang('en');
  });
});

describe('the colours are the interface\'s own', () => {
  const css = read('viewer.css');
  it('uses only tokens the window sends, its own --pv-* names and the engine\'s page variables', async () => {
    const { WebviewManager } = require('../../src/renderer/js/webview.js');
    const sent = new Set(WebviewManager.PDF_THEME_VARS);
    const own = /^--(pv-|scale-factor|total-scale-factor|page-|mk$|mk-color$|sw$|p$|loading-icon-delay|viewer-container-height|spreadHorizontalWrapped-margin-LR|highlight-)/;
    const used = new Set([...css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]));
    const strangers = [...used].filter((n) => !sent.has(n) && !own.test(n));
    expect(strangers).toEqual([]);
  });
  it('every token it sends exists in the interface\'s own stylesheets', () => {
    const { WebviewManager } = require('../../src/renderer/js/webview.js');
    const all = ['theme-tokens.css', 'gui-browser.css', 'fonts.css', 'app.css'].map((f) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'css', f), 'utf8')).join('\n');
    const absent = WebviewManager.PDF_THEME_VARS.filter((n) => !all.includes(n + ':') && !all.includes(n + ' :'));
    // The few that are set from script, not written in a stylesheet.
    expect(absent.filter((n) => !['--vex-font-display', '--b-ring-w', '--on-primary'].includes(n))).toEqual([]);
  });
  it('writes no colour of its own (except the ink of a mark and the white of paper)', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const literal = [...body.matchAll(/(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\))/g)].map((m) => m[1]);
    // The fallbacks inside var(--x, #fff), the paper white and black, the sepia/night paper and a text-note's default ink.
    const allowed = new Set(['#fff', '#ffffff', '#000', '#f1e7d0', '#16181d', '#f3f3f3', '#ececec', '#1b1b1b', '#d0d0d0', '#b3261e', '#1e3a5f', '#c2611a', 'rgba(0, 0, 0, 0.25)']);
    const stray = [...new Set(literal)].filter((c) => !allowed.has(c));
    expect(stray).toEqual([]);
  });
  it('keeps the font and radius tokens, and leaves motion off for people who ask', () => {
    expect(css).toMatch(/var\(--vex-font-base/);
    expect(css).toMatch(/var\(--vex-font-display/);
    expect(css).toMatch(/var\(--vex-font-mono/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
    expect(css).toMatch(/:focus-visible \{ outline: 2px solid var\(--pv-accent\)/);
  });
  it('every button is at least 28 pixels', () => {
    expect(css).toMatch(/--pv-ctl: 32px/);
    expect(css).toMatch(/\.pv-chip \{[^}]*height: 28px/);
    expect(css).toMatch(/\.pv-swatch \{ width: 28px; height: 28px/);
  });
  it('picks the text on the accent colour by contrast', async () => {
    await load();
    const lum = theme.luminance;
    expect(lum([255, 255, 255])).toBeCloseTo(1, 3);
    expect(lum([0, 0, 0])).toBe(0);
    expect(lum([255, 228, 77])).toBeGreaterThan(0.4);
    expect(lum([30, 58, 95])).toBeLessThan(0.1);
  });
});

describe('the page\'s own markup', () => {
  const html = read('viewer.html');
  it('every button has a name: its words, an aria-label or a title it is given', () => {
    for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const attrs = m[1], inner = m[2].replace(/<[^>]*>/g, '').trim();
      const named = inner.length > 0 || /data-i18n-aria=|aria-label=|data-i18n=/.test(attrs) || /data-i18n=/.test(m[2]);
      expect(named, attrs).toBe(true);
    }
  });
  it('every control the code looks up exists in the page', () => {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const created = new Set(['vex-pdf-text', 'pv-dlg-title']);
    const wanted = new Set();
    for (const f of files.filter((n) => n.endsWith('.js') && n !== 'strings-tr.js')) {
      const src = read(f);
      for (const m of src.matchAll(/(?:\$\(|querySelector\(|getElementById\()\s*['"]#?(pv-[a-z-]+)['"]/g)) wanted.add(m[1]);
      for (const m of src.matchAll(/getElementById\('((?:pv-)[a-z-]+)'\)/g)) wanted.add(m[1]);
    }
    const lost = [...wanted].filter((id) => !ids.has(id) && !created.has(id));
    expect(lost).toEqual([]);
  });
  it('is a document with a language, a skip link, a toolbar, a labelled side panel and a polite status area', () => {
    expect(html).toMatch(/^<!DOCTYPE html>\s*<html lang="en">/);
    expect(html).toMatch(/class="pv-skip" href="#pv-scroller"/);
    expect(html).toMatch(/role="toolbar"/);
    expect(html).toMatch(/role="tablist"/);
    expect(html).toMatch(/id="pv-toasts"[^>]*aria-live="polite"/);
    expect(html).toMatch(/<meta name="vex-persist" content="0">/);        // main fills this one in
  });
  it('links only what main serves, loads its icons first, and has no inline script', () => {
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (m[1].startsWith('#') || m[1] === 'data:,') continue;      // data:, is the page saying it has no icon of its own
      expect(m[1]).toMatch(/^\/(css|lib|app)\/|^\/icons\.js$/);
    }
    expect(html.indexOf('/icons.js')).toBeLessThan(html.indexOf('/app/app.js'));
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/);
    expect(html).not.toMatch(/\son[a-z]+="/);
  });
  it('the toolbar is inert until a document is open (so nothing can be pressed on an empty page)', () => {
    expect(html).toMatch(/<header id="pv-bar"[^>]*\binert\b/);
    expect(read('app.js')).toMatch(/dom\.bar\.inert = false/);
  });
});

describe('what the window does about it (js/webview.js, js/pdf-viewer-host.js)', () => {
  it('keeps the PDF\'s address for a viewer address, with its #page', () => {
    const { WebviewManager } = require('../../src/renderer/js/webview.js');
    expect(WebviewManager.pdfOriginal('vex-pdf://view/?u=https%3A%2F%2Fa.example%2Fb.pdf%3Fid%3D1#page=2')).toBe('https://a.example/b.pdf?id=1#page=2');
    expect(WebviewManager.pdfOriginal('vex-pdf://view/doc?u=x')).toBe(null);
    expect(WebviewManager.pdfOriginal('vex-pdf://view/?u=')).toBe(null);
    expect(WebviewManager.pdfOriginal(undefined)).toBe(null);
  });
  it('sends a PDF file to the viewer unless the viewer is switched off', () => {
    const { WebviewManager } = require('../../src/renderer/js/webview.js');
    window.VexPdfViewerOff = true;
    expect(WebviewManager.viewerAddress('file:///C:/a.pdf')).toBe('file:///C:/a.pdf');
    delete window.VexPdfViewerOff;
    expect(WebviewManager.viewerAddress('file:///C:/a.pdf')).toMatch(/^vex-pdf:\/\/view\/\?u=/);
  });
  it('the switch is on until it is turned off, and tells main', () => {
    localStorage.clear();
    const told = [];
    window.vex = { pdfviewSetEnabled: (on) => { told.push(on); return Promise.resolve({ ok: true }); } };
    const { VexPdfViewer: V } = require('../../src/renderer/js/pdf-viewer-host.js');
    expect(V.enabled()).toBe(true);
    V.setEnabled(false);
    expect(V.enabled()).toBe(false);
    expect(window.VexPdfViewerOff).toBe(true);
    V.setEnabled(true);
    expect(window.VexPdfViewerOff).toBe(false);
    expect(told).toContain(false);
    expect(told[told.length - 1]).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.pdfViewer.prefs'))).toEqual({ enabled: true });
    delete window.vex;
  });
});

describe('the engine ships with the app', () => {
  it('copies pdf.js, its page components, the worker and what they load, and its licence', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'bundle-browser-libs.js'), 'utf8');
    for (const part of ["'build/pdf.min.mjs', 'pdf.mjs'", "'build/pdf.worker.min.mjs', 'pdf.worker.mjs'", "'web/pdf_viewer.mjs'", "'cmaps', 'standard_fonts', 'wasm', 'iccs'", "'pdfjs-LICENSE'"]) expect(src).toContain(part);
  });
  it('is a build-time package only (it is copied, not packed twice)', () => {
    const pkg = require('../../package.json');
    expect(pkg.dependencies['pdfjs-dist']).toBeUndefined();
    expect(pkg.devDependencies['pdfjs-dist']).toBe('6.4.299');
  });
  it('is listed in the third-party notices', () => {
    const notices = fs.readFileSync(path.join(__dirname, '..', '..', 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toMatch(/pdfjs-dist/);
    expect(notices).toMatch(/Mozilla/);
  });
});
