// @vitest-environment jsdom
//
// Theme packs in a private window (own storage, look carried in the address), the picker's toast after a failure, and the Settings button
// that must not do nothing while the late-loaded picker is not there yet.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../src/renderer', f), 'utf8');
const run = (src, ret) => new Function(src + '\n;return ' + ret + ';')();
const PK = ['data-pk-tabs', 'data-pk-bar', 'data-pk-surface', 'data-pk-density', 'data-icon-pack'];

function openedFrom(attrs) {
  const boot = JSON.stringify({ v: 1, html: { attrs, vars: {} }, body: { attrs: {}, vars: {} } });
  history.pushState({}, '', '/index.html?private=true&boot=' + encodeURIComponent(boot));
}

beforeEach(() => {
  localStorage.clear();
  history.pushState({}, '', '/');
  for (const a of PK) document.documentElement.removeAttribute(a);
  delete window.VexEarlyLook; delete window.VexIconPacks; delete window.VexThemePacks;
  window.VexIcons = run(read('js/vex-icons.js'), 'VexIcons');
});

describe('a private window (empty storage, look carried in the address)', () => {
  it('keeps the design and the icon pack of the window it was opened from', () => {
    openedFrom({ 'data-theme': 'midnight', 'data-pk-tabs': 'pill', 'data-pk-surface': 'lift', 'data-icon-pack': 'bold' });
    run(read('js/early-look.js'), '0');
    expect(document.documentElement.getAttribute('data-pk-tabs')).toBe('pill');
    run(read('js/icon-packs.js'), '0');
    run(read('js/theme-packs.js'), '0');
    expect(document.documentElement.getAttribute('data-pk-tabs')).toBe('pill');
    expect(document.documentElement.getAttribute('data-pk-surface')).toBe('lift');
    expect(document.documentElement.getAttribute('data-icon-pack')).toBe('bold');
    expect(window.VexIconPacks.current().id).toBe('bold');
  });

  it('a normal window with nothing saved still starts plain', () => {
    run(read('js/early-look.js'), '0');
    run(read('js/icon-packs.js'), '0');
    run(read('js/theme-packs.js'), '0');
    expect(document.documentElement.hasAttribute('data-pk-tabs')).toBe(false);
    expect(document.documentElement.hasAttribute('data-icon-pack')).toBe(false);
  });

  it('its own saved choice wins over the carried one', () => {
    openedFrom({ 'data-icon-pack': 'bold' });
    localStorage.setItem('vex.iconPack', 'soft');
    run(read('js/early-look.js'), '0');
    run(read('js/icon-packs.js'), '0');
    expect(window.VexIconPacks.current().id).toBe('soft');
  });
});

describe('the theme pack picker', () => {
  it('does not say a pack was applied when applying it failed', () => {
    const ThemePackUI = run(read('js/theme-pack-ui.js'), 'ThemePackUI');
    const toasts = [];
    window.showToast = (text, kind) => toasts.push([text, kind]);
    const err = console.error; console.error = () => {};
    try {
      ThemePackUI._do(() => { throw new Error('boom'); }, 'Theme pack: X');
    } finally { console.error = err; delete window.showToast; }
    expect(toasts).toEqual([['boom', 'error']]);
  });
});

describe('Settings > Theme packs button', () => {
  it('waits for the late-loaded picker and says so when it never came', () => {
    const src = read('js/app.js');
    const at = src.indexOf("getElementById('setting-open-theme-packs')");
    const block = src.slice(at, at + 700);
    expect(block).toMatch(/VexBoot\.whenSettled\(\)/);
    expect(block).toMatch(/showToast\('Theme packs could not be loaded/);
  });
});
