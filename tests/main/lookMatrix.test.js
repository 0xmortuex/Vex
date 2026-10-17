// T2-028: the look matrix (scripts/check-look-matrix.js): the parts that need no Electron.
import { describe, it, expect } from 'vitest';
import vm from 'vm';

const M = require('../../scripts/check-look-matrix.js');
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

describe('the cells', () => {
  it('default to four looks, the default theme and Oxford, 1920 and 2560, plus a 200 percent zoom pass per look and theme', () => {
    const o = M.parseArgs([]);
    expect(o.looks).toEqual(['firefox', 'firefox-dark', 'glass', 'classic']);
    expect(o.themes).toEqual(['default', 'oxford']);
    const grid = M.cells(o);
    expect(grid).toHaveLength(4 * 2 * 3);
    expect(grid.filter(c => c.zoom === 200).every(c => c.w === 1280 && c.h === 720 && c.dsf === 2)).toBe(true);
    expect(grid.filter(c => c.zoom === 100).map(c => c.w + 'x' + c.h)).toContain('2560x1440');
  });
  it('--no-zoom drops the zoom cells; options narrow the matrix; bad ones are refused', () => {
    expect(M.cells(M.parseArgs(['--no-zoom', '--looks=firefox', '--themes=oxford']))).toHaveLength(2);
    expect(M.parseArgs(['--panels=all']).allPanels).toBe(true);
    expect(() => M.parseArgs(['--widths=800'])).toThrow(/unknown width/);
    expect(() => M.parseArgs(['--frob'])).toThrow(/unknown argument/);
    expect(() => M.parseArgs(['--looks='])).toThrow(/at least one/);
  });
  it('names the pictures by cell and panel', () => {
    const c = M.cells(M.parseArgs(['--looks=glass', '--themes=oxford']))[2];
    expect(M.cellName(c)).toBe('glass-oxford-2560-zoom200');
    expect(M.shotPath('out', c, 'notes').split(path.sep).join('/')).toBe('out/glass-oxford-2560-zoom200/notes.png');
  });
});

describe('judging a measurement', () => {
  const c = { look: 'firefox', theme: 'oxford', width: 1920, zoom: 100 };
  it('flags overflow, an unreachable control and accessibility errors, and nothing else', () => {
    expect(M.judge({ overflowX: 0, unreachable: [], a11y: [{ rule: 'contrast', severity: 'warning', message: 'x' }] }, c, null)).toEqual([]);
    const f = M.judge({ overflowX: 40, unreachable: ['#top-bar'], a11y: [{ rule: 'label', severity: 'error', message: 'button has no name' }] }, c, 'notes');
    expect(f.map(x => x.kind)).toEqual(['horizontal-overflow', 'unreachable-control', 'a11y']);
    expect(f[0].at).toBe('firefox-oxford-1920/notes');
  });
});

describe('the page side and the wiring', () => {
  it('the measuring script compiles', () => { expect(() => new vm.Script(M.PAGE_MEASURE)).not.toThrow(); });
  it('is opt-in: an npm script, not a CI step, and goes through the probe harness and the heavy gate', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['check:looks']).toMatch(/check-look-matrix/);
    expect(read('.github', 'workflows', 'verify.yml')).not.toMatch(/check:looks|check-look-matrix/);
    const src = read('scripts', 'check-look-matrix.js');
    expect(src).toMatch(/probe-harness/);
    expect(src).toMatch(/heavy-gate/);
    expect(src).not.toMatch(/\bspawn\(/);
    expect(src).toMatch(/CAPTURE_LIMIT_MS/);
  });
});
