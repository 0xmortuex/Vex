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

  it('runs in the Firefox look, Glass and Classic, at 1920 and 2560, in every Settings layout', () => {
    expect(src).toMatch(/const SETTINGS_SIZES = \[\[1920, 1080\], \[2560, 1440\]\];/);
    expect(src).toMatch(/\['firefox', 'glass', 'classic'\]\.filter\(s => runStyles\.includes\(s\)\)/);
    expect(src).toMatch(/columns: '3', nav: 'side', density: 'compact'/);
    expect(src).toMatch(/if \(!res\.blocks\) throw new Error\('Settings showed no sections/);
  });
});
