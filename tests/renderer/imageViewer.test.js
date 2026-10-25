// @vitest-environment jsdom
// Vex's own image viewer, page side (src/renderer/image-viewer): the arithmetic, what a picture says about itself (EXIF as text),
// the words (every one has Turkish), the markup (names, targets), and the window's switch (js/image-viewer-host.js).
// How it LOOKS and behaves under real input is checked in real Chromium by the probes, not here (jsdom cannot resolve var() or layout).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(__dirname, '..', '..', 'src', 'renderer', 'image-viewer');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
let G, M, TRS;
beforeEach(async () => {
  G = await import('../../src/renderer/image-viewer/geometry.js');
  M = await import('../../src/renderer/image-viewer/meta.js');
  TRS = (await import('../../src/renderer/image-viewer/strings-tr.js')).TR;
});

describe('sizes, zoom and pan', () => {
  it('a quarter turn swaps the sides', () => {
    expect(G.effective(300, 200, 0)).toEqual({ w: 300, h: 200 });
    expect(G.effective(300, 200, 90)).toEqual({ w: 200, h: 300 });
    expect(G.effective(300, 200, 180)).toEqual({ w: 300, h: 200 });
    expect(G.effective(300, 200, 270)).toEqual({ w: 200, h: 300 });
  });
  it('fit shrinks a big picture and never enlarges a small one; fill covers the window', () => {
    expect(G.fitZoom(3000, 2000, 1500, 1000)).toBeCloseTo(0.5);
    expect(G.fitZoom(300, 200, 1500, 1000)).toBe(1);
    expect(G.fitZoom(3000, 1000, 1500, 1000)).toBeCloseTo(0.5);
    expect(G.fillZoom(3000, 2000, 1500, 1000)).toBeCloseTo(0.5);
    expect(G.fillZoom(300, 200, 1500, 1000)).toBeCloseTo(5);
    expect(G.fillZoom(3000, 1000, 1500, 1000)).toBeCloseTo(1);
    expect(G.fitZoom(0, 0, 100, 100)).toBe(1);
  });
  it('zoom stays between its limits', () => {
    expect(G.clampZoom(1000)).toBe(G.MAX_ZOOM);
    expect(G.clampZoom(0.0001)).toBe(G.MIN_ZOOM);
    expect(G.fitZoom(1e6, 1e6, 100, 100)).toBe(G.MIN_ZOOM);
  });
  it('a picture smaller than the window on an axis stays centred on it, a bigger one cannot be dragged past its edge', () => {
    expect(G.clampPan({ x: 90, y: -40 }, 100, 100, 1, 400, 300)).toEqual({ x: 0, y: 0 });
    expect(G.clampPan({ x: 999, y: -999 }, 1000, 800, 1, 400, 300)).toEqual({ x: 300, y: -250 });
    expect(G.clampPan({ x: 10, y: 10 }, 1000, 100, 1, 400, 300)).toEqual({ x: 10, y: 0 });
  });
  it('zooming keeps the point under the pointer where it is', () => {
    const pan = { x: 20, y: -10 }, z0 = 1, z1 = 2, c = { x: 100, y: 50 };
    const next = G.panForZoomAt(pan, z0, z1, c.x, c.y);
    // the picture point under the pointer: (c - pan) / zoom, before and after
    expect((c.x - pan.x) / z0).toBeCloseTo((c.x - next.x) / z1);
    expect((c.y - pan.y) / z0).toBeCloseTo((c.y - next.y) / z1);
    expect(G.panForZoomAt({ x: 0, y: 0 }, 1, 2, 0, 0)).toEqual({ x: 0, y: 0 });
  });
  it('a wheel notch zooms by a fixed amount and a trackpad pinch by its own, both smoothly and capped', () => {
    expect(G.wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeGreaterThan(1);
    expect(G.wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeLessThan(1);
    expect(G.wheelFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false })).toBeGreaterThan(1);
    expect(G.wheelFactor({ deltaY: -100000, deltaMode: 0, ctrlKey: true })).toBeLessThan(15);
    expect(G.wheelFactor({ deltaY: 0, deltaMode: 0, ctrlKey: false })).toBe(1);
  });
  it('the percent field reads what a person types', () => {
    expect(G.parsePercent('150')).toBeCloseTo(1.5);
    expect(G.parsePercent(' 150% ')).toBeCloseTo(1.5);
    expect(G.parsePercent('33,5')).toBeCloseTo(0.335);
    expect(G.parsePercent('2x')).toBe(2);
    expect(G.parsePercent('99999')).toBe(G.MAX_ZOOM);
    for (const bad of ['', 'abc', '-5', '0', '12%%', '1e3']) expect(G.parsePercent(bad), bad).toBe(null);
    expect(G.formatPercent(1)).toBe('100%');
    expect(G.formatPercent(0.333)).toBe('33.3%');
    expect(G.formatPercent(0.05)).toBe('5%');
  });
  it('a crop stays inside the picture and is at least one pixel', () => {
    expect(G.clampRect({ x: -5, y: 3.4, w: 9999, h: 0 }, 100, 80)).toEqual({ x: 0, y: 3, w: 100, h: 1 });
    expect(G.clampRect({ x: 99, y: 79, w: 50, h: 50 }, 100, 80)).toEqual({ x: 99, y: 79, w: 1, h: 1 });
    expect(G.scaledSide(150, 300, 200)).toBe(100);
    expect(G.scaledSide(1, 1000, 1)).toBe(1);
  });
});

describe('what a picture says about itself', () => {
  const exif = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'image-viewer-exif-segment.bin')));
  const jpegWith = (segment) => { const out = new Uint8Array(2 + segment.length + 2); out.set([0xff, 0xd8]); out.set(segment, 2); out.set([0xff, 0xd9], 2 + segment.length); return out; };

  it('tells the file type from its bytes, not its name', () => {
    expect(M.sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(M.sniff(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('jpeg');
    expect(M.sniff(new TextEncoder().encode('GIF89a....'))).toBe('gif');
    expect(M.sniff(new TextEncoder().encode('RIFF....WEBPVP8 '))).toBe('webp');
    expect(M.sniff(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe('bmp');
    expect(M.sniff(new TextEncoder().encode('<html>'))).toBe(null);
  });
  it('reads the camera, the exposure, the time and the place of a JPEG as text', () => {
    const m = M.readMeta(jpegWith(exif));
    expect(m.kind).toBe('jpeg');
    expect(m.exif).toMatchObject({ make: 'Vexcam', model: 'Probe X-1', software: 'make-assets', taken: '2026:10:25 14:03:09', exposure: '1/250 s', aperture: 'f/2.8', iso: 'ISO 400', focal: '35 mm' });
    expect(m.exif.gps.lat).toBeCloseTo(41.0082, 4);
    expect(m.exif.gps.lon).toBeCloseTo(28.9784, 4);
    expect(M.formatPlace(m.exif.gps)).toBe('41.00820 N, 28.97840 E');
  });
  it('a south or west reference makes the number negative', () => {
    expect(M.formatPlace({ lat: -33.8688, lon: -151.2 })).toBe('33.86880 S, 151.20000 W');
  });
  it('says nothing when there is nothing, and a damaged block hides only the details', () => {
    expect(M.readMeta(jpegWith(new Uint8Array([0xff, 0xe0, 0, 4, 0, 0]))).exif).toBe(null);
    const cut = jpegWith(exif.subarray(0, 60));
    expect(() => M.readMeta(cut)).not.toThrow();
    expect(M.readMeta(new Uint8Array([1, 2, 3]))).toEqual({ kind: null, exif: null, icc: null });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]);
    expect(M.readMeta(png)).toMatchObject({ kind: 'png', exif: null, icc: null });
  });
  it('names a PNG\'s colour profile', () => {
    const be = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const chunk = (type, data) => [...be(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    const bytes = new Uint8Array([...sig, ...chunk('sRGB', [0]), ...chunk('IDAT', [0]), ...chunk('IEND', [])]);
    expect(M.readMeta(bytes).icc).toEqual({ name: 'sRGB', space: 'RGB' });
  });
});

describe('the words', () => {
  const keys = () => {
    const found = new Set();
    for (const f of ['app.js', 'ui.js']) for (const m of read(f).matchAll(/\bt\((['"])((?:\\.|(?!\1).)*)\1/g)) found.add(m[2].replace(/\\'/g, "'"));
    for (const m of read('viewer.html').matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]*)"/g)) found.add(m[1].replace(/&amp;/g, '&'));
    return [...found];
  };
  it('every text the page can show has a Turkish one', () => {
    const missing = keys().filter((k) => !Object.prototype.hasOwnProperty.call(TRS, k) || !String(TRS[k]).trim());
    expect(missing).toEqual([]);
  });
  it('and a Turkish text keeps the {names} of the English one', () => {
    for (const [en, tr] of Object.entries(TRS)) {
      expect([...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), en).toEqual([...tr.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });
  it('no Turkish text is left that nothing uses (but the ones main sends)', () => {
    const used = new Set(keys());
    const fromMain = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'image-viewer.js'), 'utf8');
    const unused = Object.keys(TRS).filter((k) => !used.has(k) && !fromMain.includes(k.replace(/ \d+ MB$/, '')) && !/larger than 64 MB/.test(k));
    expect(unused).toEqual([]);
  });
  it('t() fills the names in, in either language', async () => {
    const S = await import('../../src/renderer/image-viewer/strings.js');
    expect(S.t('Saved as {name}', { name: 'a.png' })).toBe('Saved as a.png');
    S.setLang('tr');
    expect(S.t('Saved as {name}', { name: 'a.png' })).toBe('a.png olarak kaydedildi');
    expect(S.t('A text that is not in the table')).toBe('A text that is not in the table');
    S.setLang('en');
  });
});

describe('the markup', () => {
  const html = read('viewer.html');
  it('every button has a name a screen reader can read, and a keyboard can reach', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const b of doc.querySelectorAll('button')) {
      const named = b.getAttribute('data-i18n-aria') || b.getAttribute('data-i18n') || b.textContent.trim();
      expect(named, b.outerHTML.slice(0, 90)).toBeTruthy();
      expect(b.getAttribute('tabindex'), b.id).not.toBe('-1');
    }
  });
  it('every field is labelled', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const f of doc.querySelectorAll('input, select')) {
      expect(f.closest('label') || f.getAttribute('aria-label'), f.id).toBeTruthy();
    }
  });
  it('there is a toolbar, a labelled region for the picture, a live region and a skip link', () => {
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('id="iv-stage"');
    expect(html).toMatch(/id="iv-live"[^>]*aria-live="polite"/);
    expect(html).toMatch(/class="iv-skip" href="#iv-stage"/);
  });
  it('the page loads only its own scripts, as modules, and no inline script', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBe(2);
    for (const s of scripts) { expect(s[1]).toMatch(/src="\//); expect(s[2].trim()).toBe(''); }
  });
  it('has no emoji (icons are VexIcons drawings)', () => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    for (const f of ['viewer.html', 'viewer.css', 'app.js', 'ui.js', 'strings-tr.js', 'meta.js', 'geometry.js', 'theme.js']) expect(emoji.test(read(f)), f).toBe(false);
    const host = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'image-viewer-host.js'), 'utf8');
    expect(emoji.test(host)).toBe(false);
  });
  it('every icon the page names is in the icon set', () => {
    const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
    const names = new Set([...html.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]));
    for (const m of read('app.js').matchAll(/(?:icon:|setIcon\([^,]+,|\?|:)\s*'([a-z][a-z0-9-]+)'/g)) if (VexIcons.has(m[1])) names.add(m[1]);
    for (const m of read('app.js').matchAll(/\bicon: '([a-z0-9-]+)'/g)) names.add(m[1]);
    for (const n of names) expect(VexIcons.has(n), n).toBe(true);
    expect(names.size).toBeGreaterThan(15);
  });
});

describe('the style sheet', () => {
  const css = read('viewer.css');
  it('has no colour of its own: only theme tokens, and the few fixed ones that must not follow the theme', () => {
    const hex = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    // fallbacks inside var(--token, #...) are allowed; a bare colour is not, except black for the full-screen backdrop and the dimmer
    const bare = css.split('\n').filter((l) => /#[0-9a-fA-F]{3,8}\b/.test(l) && !/var\(--[a-z0-9-]+,/.test(l) && !/^\s*(\/\*|\*)/.test(l));
    for (const line of bare) expect(line, line).toMatch(/#000\b|#fff\b|color-scheme/);
    expect(hex.length).toBeGreaterThan(0);
  });
  it('keeps the targets at least 28 px, respects reduced motion and shows a focus ring on the focused element itself', () => {
    expect(css).toMatch(/--iv-ctl: 32px/);
    expect(css).toMatch(/prefers-reduced-motion: no-preference/);
    expect(css).toMatch(/\.iv :focus-visible \{ outline: 2px solid var\(--iv-accent\)/);
    // the only gradient is the checkerboard (a repeating conic one), which is the point of that toggle
    expect([...css.matchAll(/([a-z-]*)gradient\(/g)].every((m) => m[1] === 'repeating-conic-')).toBe(true);
  });
});

describe('the window\'s switch', () => {
  beforeEach(() => { localStorage.clear(); delete window.VexImageViewerOff; });
  it('is on unless it was switched off, and tells main and the window', async () => {
    const calls = [];
    window.vex = { imageviewSetEnabled: (on) => { calls.push(on); return Promise.resolve({ ok: true }); } };
    const { VexImageViewer } = require('../../src/renderer/js/image-viewer-host.js');
    expect(VexImageViewer.enabled()).toBe(true);
    VexImageViewer.setEnabled(false);
    expect(VexImageViewer.enabled()).toBe(false);
    expect(window.VexImageViewerOff).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.imageViewer.prefs'))).toEqual({ enabled: false });
    VexImageViewer.setEnabled(true);
    expect(window.VexImageViewerOff).toBe(false);
    expect(calls.slice(-2)).toEqual([false, true]);
    delete window.vex;
  });
  it('a damaged saved value is reported, not hidden, and the viewer stays on', () => {
    localStorage.setItem('vex.imageViewer.prefs', '{not json');
    const { VexImageViewer } = require('../../src/renderer/js/image-viewer-host.js');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(VexImageViewer.enabled()).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
