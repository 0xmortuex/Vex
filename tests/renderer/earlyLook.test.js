// @vitest-environment jsdom
//
// js/early-look.js: the saved theme and look are put back in <head>, before the first paint, so the window never shows the default cream theme
// and the Classic look on the way to the saved ones (three visible changes at every start, measured with a screencast on 2026-10-25).
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/early-look.js'), 'utf8');
const run = () => new Function(SRC)();

const snapshot = (over = {}) => JSON.stringify({
  v: 1,
  html: { attrs: { 'data-theme': 'midnight', 'data-scheme': 'dark' }, vars: { '--vex-font-base': 'Georgia, serif', '--workspace-color': '#d4a574' } },
  body: { attrs: { 'data-gui-style': 'firefox', 'data-gui-family': 'browser', 'data-sb-side': 'left', 'data-tab-layout': 'horizontal' }, vars: { '--look-sb-w': '420px' } },
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  for (const a of Array.from(document.documentElement.attributes)) document.documentElement.removeAttribute(a.name);
  document.documentElement.removeAttribute('style');
  for (const a of Array.from(document.body.attributes)) document.body.removeAttribute(a.name);
  document.body.removeAttribute('style');
});

describe('putting the saved look back', () => {
  it('sets the theme, the look and their custom properties from the snapshot', () => {
    localStorage.setItem('vex.bootLook', snapshot());
    run();
    expect(window.VexEarlyLook.applied).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
    expect(document.documentElement.getAttribute('data-scheme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--vex-font-base')).toBe('Georgia, serif');
    expect(document.body.getAttribute('data-gui-style')).toBe('firefox');
    expect(document.body.getAttribute('data-sb-side')).toBe('left');
    expect(document.body.style.getPropertyValue('--look-sb-w')).toBe('420px');
  });

  it('does nothing without a snapshot (the first run, or a private window with storage of its own)', () => {
    run();
    expect(window.VexEarlyLook.applied).toBe(false);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('ignores a snapshot it cannot read, and says so, rather than breaking the page', () => {
    const errors = [];
    const real = console.error;
    console.error = (...a) => errors.push(a.join(' '));
    try {
      localStorage.setItem('vex.bootLook', '{not json');
      run();
      expect(window.VexEarlyLook.applied).toBe(false);
      expect(errors.join('\n')).toMatch(/not valid JSON/);
    } finally { console.error = real; }
  });

  it('puts back only the listed attributes and custom properties', () => {
    localStorage.setItem('vex.bootLook', snapshot({
      html: { attrs: { 'data-theme': 'midnight', onclick: 'alert(1)', 'data-evil': 'x' }, vars: { '--ok': 'red', color: 'red' } },
      body: { attrs: { 'data-modal-open': '1', 'data-gui-style': 'chrome' }, vars: {} },
    }));
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
    expect(document.documentElement.hasAttribute('onclick')).toBe(false);
    expect(document.documentElement.hasAttribute('data-evil')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--ok')).toBe('red');
    expect(document.documentElement.style.getPropertyValue('color')).toBe('');
    expect(document.body.hasAttribute('data-modal-open')).toBe(false);
    expect(document.body.getAttribute('data-gui-style')).toBe('chrome');
  });

  it('a snapshot of another version is ignored', () => {
    localStorage.setItem('vex.bootLook', snapshot({ v: 2 }));
    run();
    expect(window.VexEarlyLook.applied).toBe(false);
  });
});

describe('keeping the snapshot current', () => {
  it('reads it back from the page, so no second copy of the theme logic exists', () => {
    document.documentElement.setAttribute('data-theme', 'sakura');
    document.documentElement.setAttribute('data-scheme', 'light');
    document.documentElement.style.setProperty('--vex-ui-scale', '1.2');
    document.body.setAttribute('data-gui-style', 'glass');
    document.body.setAttribute('data-modal-open', '1');
    run();
    const snap = window.VexEarlyLook.snapshot();
    expect(snap.html.attrs).toEqual({ 'data-theme': 'sakura', 'data-scheme': 'light' });
    expect(snap.html.vars['--vex-ui-scale']).toBe('1.2');
    expect(snap.body.attrs).toEqual({ 'data-gui-style': 'glass' });
  });

  it('save writes it to the one key', () => {
    document.documentElement.setAttribute('data-theme', 'sakura');
    run();
    window.VexEarlyLook.save();
    expect(JSON.parse(localStorage.getItem('vex.bootLook')).html.attrs['data-theme']).toBe('sakura');
  });
});

describe('where it sits in the page', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/index.html'), 'utf8').replace(/\r\n/g, '\n');
  it('is the first script in <head>, before every stylesheet, so it runs before anything is painted', () => {
    const tag = html.indexOf('<script src="js/early-look.js"></script>');
    expect(tag).toBeGreaterThan(-1);
    expect(tag).toBeLessThan(html.indexOf('</head>'));
    expect(tag).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
    expect(html.indexOf('<script', html.indexOf('<head>'))).toBe(tag);
  });
});

describe('a window that keeps its own storage (a private window) gets the look in its address', () => {
  const carriedIn = (snap) => { history.replaceState(null, '', '/index.html?private=true&boot=' + encodeURIComponent(snap)); };
  const reset = () => history.replaceState(null, '', '/');

  it('applies the look it was opened with when it has none saved', () => {
    carriedIn(snapshot());
    try {
      run();
      expect(window.VexEarlyLook.applied).toBe(true);
      expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
      expect(document.body.getAttribute('data-gui-style')).toBe('firefox');
      expect(window.VexEarlyLook.carried().html.attrs['data-theme']).toBe('midnight');
    } finally { reset(); }
  });

  it('prefers its own saved look to the one in the address', () => {
    localStorage.setItem('vex.bootLook', snapshot({ html: { attrs: { 'data-theme': 'sakura' }, vars: {} } }));
    carriedIn(snapshot());
    try {
      run();
      expect(document.documentElement.getAttribute('data-theme')).toBe('sakura');
    } finally { reset(); }
  });

  it('ignores an address look that is not a snapshot, or is too long', () => {
    const errors = [];
    const real = console.error;
    console.error = (...a) => errors.push(a.join(' '));
    try {
      carriedIn('{nope');
      run();
      expect(window.VexEarlyLook.carried()).toBeNull();
      carriedIn(JSON.stringify({ v: 1, html: { attrs: { 'data-theme': 'x'.repeat(5000) } } }));
      run();
      expect(window.VexEarlyLook.carried()).toBeNull();
    } finally { console.error = real; reset(); }
    expect(errors.join('\n')).toMatch(/not valid JSON/);
  });

  it('describes its own look as text for a window it opens', () => {
    document.documentElement.setAttribute('data-theme', 'sakura');
    run();
    expect(JSON.parse(window.VexEarlyLook.forNewWindow()).html.attrs['data-theme']).toBe('sakura');
  });
});

describe('the main process and the callers', () => {
  const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../src', f), 'utf8').replace(/\r\n/g, '\n');
  it('hands the snapshot through the preload, the schema and the address, and only a snapshot of the known shape', () => {
    expect(read('preload.js')).toContain("openPrivateWindow: (look, uiMode, url, boot) => ipcRenderer.invoke('open-private-window', look, uiMode, url, boot)");
    expect(read('main/ipc-schemas.js')).toContain('optional(string(4000))');
    const main = read('main.js');
    expect(main).toContain('function _bootLookParam(boot)');
    expect(main).toContain('snap.v === 1 && snap.html && snap.body');
    expect(main).toContain("...(_bootLookParam(boot) ? { boot: _bootLookParam(boot) } : {})");
    expect(read('renderer/js/incognito.js')).toContain('window.VexEarlyLook.forNewWindow()');
    expect(read('renderer/js/app.js')).toContain('window.VexEarlyLook.forNewWindow()');
  });
  it('a private window is shown once it has painted, not as a dark-purple box first', () => {
    const main = read('main.js');
    const at = main.indexOf("backgroundColor: '#1a0a1a'");
    expect(main.slice(at, at + 200)).toContain('show: false');
    expect(main).toContain("privWin.once('ready-to-show'");
  });
  it('the theme init in a private window uses the theme carried in the address', () => {
    expect(read('renderer/js/theme-manager.js')).toContain('window.VexEarlyLook.carried()');
  });
});
