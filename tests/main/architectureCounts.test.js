// docs/ARCHITECTURE.md used to say "about 450 Vitest files" and "every src/main module has its own test file".
// There are over 1,400 test files, and four modules no test requires. Keep the document's numbers true.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else out.push(p);
  }
  return out;
};
const tests = walk(path.join(root, 'tests')).filter(f => /\.test\.js$/.test(f));
const mainDir = path.join(root, 'src', 'main');
const modules = walk(mainDir).filter(f => f.endsWith('.js')).map(f => path.relative(mainDir, f).replace(/\\/g, '/'));
const blob = tests.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const untested = modules.filter(m => !new RegExp('main/' + m.replace(/\.js$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\.js)?[\'"`]').test(blob));
const doc = fs.readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8');
const num = (s) => Number(String(s).replace(/,/g, ''));

describe('docs/ARCHITECTURE.md test counts', () => {
  it('no longer claims about 450 test files or a test for every src/main module', () => {
    expect(doc).not.toMatch(/about 450 Vitest files/);
    expect(doc).not.toMatch(/Every `src\/main` module has its own test file/);
  });

  it('states the number of Vitest files within 3% of the real count, and the per-folder counts exactly enough', () => {
    const m = /([\d,]+) Vitest files at the time of writing \(([\d,]+) in `tests\/main`, ([\d,]+) in `tests\/renderer`, ([\d,]+) in `tests\/workers`\)/.exec(doc);
    expect(m, 'the sentence with the counts').toBeTruthy();
    const real = tests.length;
    expect(Math.abs(num(m[1]) - real) / real).toBeLessThan(0.03);
    const inDir = (d) => tests.filter(f => f.startsWith(path.join(root, 'tests', d) + path.sep)).length;
    expect(Math.abs(num(m[2]) - inDir('main'))).toBeLessThanOrEqual(15);
    expect(Math.abs(num(m[3]) - inDir('renderer'))).toBeLessThanOrEqual(30);
    expect(Math.abs(num(m[4]) - inDir('workers'))).toBeLessThanOrEqual(3);
  });

  it('names exactly the src/main modules that no test requires', () => {
    expect(untested.sort()).toEqual(['evodata-entity-store.js', 'protect.js', 'restart-smoke.js', 'ui-smoke.js']);
    for (const name of untested) expect(doc).toContain('`' + name + '`');
    const n = /Of the (\d+) `\.js` files under `src\/main`, (\d+) are required by name/.exec(doc);
    expect(n, 'the sentence with the module counts').toBeTruthy();
    expect(Math.abs(num(n[1]) - modules.length)).toBeLessThanOrEqual(5);
  });
});
