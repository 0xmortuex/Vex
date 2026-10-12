// @vitest-environment jsdom
//
// check:ui lays Settings out at 1920 and 2560 in each Settings layout and
// judges it with settingsLayout(): a section over another, a gap above a
// section wider than the spacing, text cut off, a switch squeezed. Full
// screen once broke all four (the owner, 2026-10-12). This runs that check
// on made-up layouts, so it is known to catch each one.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../../scripts/check-ui.js'), 'utf8');

beforeAll(() => {
  const start = src.indexOf('const PAGE_LIB = `') + 'const PAGE_LIB = `'.length;
  const end = src.search(/'installed';\r?\n`;/);
  if (start < 18 || end < 0) throw new Error('PAGE_LIB not found in scripts/check-ui.js');
  const raw = src.slice(start, end);
  // The library is a template literal in the script: read it as one.
  // eslint-disable-next-line no-eval
  const lib = (0, eval)('`' + raw + '`');
  // eslint-disable-next-line no-eval
  (0, eval)(lib);
});

// Blocks at made-up places: [id, left, top, width, height].
const lay = (blocks) => {
  document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"></div></div>';
  const root = document.querySelector('.settings-content');
  Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => 1868 });
  for (const [id, left, top, width, height, html] of blocks) {
    const el = document.createElement('div');
    el.className = 'setting-group';
    el.id = id;
    el.style.marginBottom = '16px';
    el.innerHTML = html || '';
    el.getBoundingClientRect = () => ({ left, top, right: left + width, bottom: top + height, width, height });
    el.getClientRects = () => [{}];
    root.appendChild(el);
  }
  return root;
};
const run = () => window.__vexCheckUi.settingsLayout([], 'firefox', '1920x1080, test').findings.map(f => f.check);

beforeEach(() => { document.body.innerHTML = ''; });

describe('check:ui settingsLayout', () => {
  it('passes two columns laid out right', () => {
    lay([['a', 32, 100, 600, 300], ['b', 650, 100, 600, 120], ['c', 650, 236, 600, 200], ['d', 32, 416, 600, 100]]);
    expect(run()).toEqual([]);
  });

  it('flags a section drawn over another', () => {
    lay([['a', 32, 100, 600, 300], ['b', 32, 380, 600, 100]]);
    expect(run()).toContain('settings-overlap');
  });

  it('flags a gap above a section wider than the spacing (the band above the AI sections)', () => {
    lay([['a', 32, 100, 600, 300], ['b', 650, 100, 600, 100], ['c', 650, 438, 600, 100]]);
    expect(run()).toEqual(['settings-gap']);
  });

  it('flags a switch squeezed beside a long label', () => {
    const root = lay([['a', 32, 100, 600, 300, '<label class="toggle"><input type="checkbox"><span class="toggle-slider"></span></label>']]);
    const t = root.querySelector('.toggle');
    t.getClientRects = () => [{}];
    Object.defineProperty(t, 'offsetWidth', { configurable: true, get: () => 22 });
    t.getBoundingClientRect = () => ({ left: 600, top: 120, right: 622, bottom: 142, width: 22, height: 22 });
    expect(run()).toContain('settings-squeezed');
  });

  it('flags text reaching out of its section (cut off by the section)', () => {
    const root = lay([['a', 32, 100, 600, 300, '<p id="t">Long words</p>']]);
    const p = root.querySelector('#t');
    p.getClientRects = () => [{}];
    p.getBoundingClientRect = () => ({ left: 40, top: 380, right: 300, bottom: 430, width: 260, height: 50 });
    expect(run()).toContain('settings-clipped');
  });

  it('runs in the Firefox look, Glass and Classic, at 1280, 1920 and 2560', () => {
    expect(src).toMatch(/const SETTINGS_SIZES = \[\[1280, 720\], \[1920, 1080\], \[2560, 1440\]\];/);
    expect(src).toMatch(/\['firefox', 'glass', 'classic'\]\.filter\(s => runStyles\.includes\(s\)\)/);
    expect(src).toMatch(/if \(!res\.blocks\) throw new Error\('Settings showed no sections/);
  });

  it('takes every choice the Settings layout has, so a new one cannot be left out', () => {
    const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');
    const take = (re) => (src.match(re) || [])[1].split(',').map(x => x.trim().replace(/['"]/g, ''));
    expect(take(/const SETTINGS_COLUMNS = \[([^\]]*)\]/)).toEqual(SettingsUI.LAYOUT_CHOICES.columns.map(c => c[0]));
    expect(take(/const SETTINGS_NAVS = \[([^\]]*)\]/)).toEqual(SettingsUI.LAYOUT_CHOICES.nav.map(c => c[0]));
    expect(take(/const SETTINGS_DENSITIES = \[([^\]]*)\]/)).toEqual(SettingsUI.LAYOUT_CHOICES.density.map(c => c[0]));
  });
});

describe('check:ui settingsLayout, "One column, full width"', () => {
  const runWide = () => window.__vexCheckUi.settingsLayout([], 'firefox', '1920x1080, wide', { columns: 'wide', nav: 'chips' }).findings.map(f => f.check);
  const laid = (width) => {
    const root = lay([['a', 32, 100, width, 300], ['b', 32, 416, width, 120]]);
    root.style.paddingLeft = '32px';
    root.style.paddingRight = '32px';
    return root;
  };

  it('passes sections that run the width of the area (1868px less 64px of padding)', () => {
    laid(1804);
    expect(runWide()).toEqual([]);
  });

  it('flags a centred 780px column in a 1868px area (the bug that shipped)', () => {
    laid(780);
    expect(runWide()).toEqual(['settings-not-wide', 'settings-not-wide']);   // both sections
  });
});

describe('check:ui settingsGrow', () => {
  it('flags a section that grew and left the next one over it in the very next frame', async () => {
    const root = lay([['a', 32, 100, 600, 300], ['b', 32, 416, 600, 100]]);
    const a = root.querySelector('#a');
    // The grown section reaches into the one below, which has not moved yet.
    a.getBoundingClientRect = () => (a.querySelector('div')
      ? { left: 32, top: 100, right: 632, bottom: 600, width: 600, height: 500 }
      : { left: 32, top: 100, right: 632, bottom: 400, width: 600, height: 300 });
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    const res = await window.__vexCheckUi.settingsGrow([], 'firefox', '1920x1080, test', { columns: 'auto' });
    expect(res.findings.map(f => f.check)).toContain('settings-overlap');
    expect(a.querySelector('div')).toBeNull();   // put back
  });
});
