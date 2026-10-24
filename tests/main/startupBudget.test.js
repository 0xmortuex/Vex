// The start-up budget (scripts/startup-budget.js, T3-066) and the late-module list (js/lazy-boot.js).
import { describe, it, expect } from 'vitest';

const path = require('path');
const sb = require('../../scripts/startup-budget');
const ROOT = path.resolve(__dirname, '../..');

describe('start-up budget', () => {
  it('counts only plain local blocking scripts and ignores commented-out ones', () => {
    const html = '<script src="js/a.js"></script><!-- <script src="js/b.js"></script> --><script src="https://x.test/c.js"></script><script>inline()</script><script src="js/d.js"></script>';
    expect(sb.blockingScripts(html)).toEqual(['js/a.js', 'js/d.js']);
  });

  it('passes for the repository as it is', () => {
    const r = sb.check(ROOT);
    expect(r.errors).toEqual([]);
  });

  it('fails when the scripts grow more than 15 percent past the budget', () => {
    const now = sb.measure(ROOT);
    const r = sb.check(ROOT, { scripts: Math.floor(now.scripts / 1.2), bytes: now.bytes });
    expect(r.errors.join('\n')).toMatch(/blocking scripts is more than 15% over/);
    const ok = sb.check(ROOT, { scripts: Math.ceil(now.scripts / 1.1), bytes: Math.ceil(now.bytes / 1.1) });
    expect(ok.errors).toEqual([]);
  });

  it('keeps every late module out of index.html and names real usage ids', () => {
    const late = sb.lateModules(ROOT);
    expect(late.map(m => m.src)).toEqual(expect.arrayContaining(['js/release-checklist.js', 'js/diagnostics-bundle.js', 'js/your-data.js']));
    const r = sb.check(ROOT);
    expect(r.errors.filter(e => /twice|does not exist|usage id/.test(e))).toEqual([]);
  });
});

describe('the real boot against the budget (T3-066)', () => {
  const budget = { domNodes: 10000, marksMs: { scripts: 1000, ready: 1100, settled: 3000 }, marksCapMs: { scripts: 5000, ready: 6000, settled: 12000 } };
  it('passes a boot inside the DOM limit and under the ceilings', () => {
    expect(sb.checkBoot({ marks: { scripts: 4000, ready: 4500, settled: 9000 }, nodes: 11000 }, budget)).toEqual([]);
  });
  it('fails a DOM that grew more than 15 percent, and a mark over its ceiling', () => {
    const e = sb.checkBoot({ marks: { scripts: 4000, ready: 7000, settled: 9000 }, nodes: 11600 }, budget);
    expect(e.join('\n')).toMatch(/11600 DOM nodes after start-up is more than 15% over the measured 10000 \(limit 11500\)/);
    expect(e.join('\n')).toMatch(/"ready" boot mark came at 7000 ms, over its ceiling of 6000/);
  });
  it('a boot that reports no node count is an error; a boot with no marks only has its DOM judged', () => {
    expect(sb.checkBoot({ marks: null, nodes: undefined }, budget)[0]).toMatch(/did not report its DOM node count/);
    expect(sb.checkBoot({ marks: null, nodes: 9000 }, budget)).toEqual([]);
  });
  it('the budget file carries the measured figures, and the smoke runner and main.js use them', () => {
    const fs = require('fs');
    const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'startup-budget.json'), 'utf8'));
    expect(file.domNodes).toBeGreaterThan(1000);
    expect(Object.keys(file.marksCapMs).sort()).toEqual(['ready', 'scripts', 'settled']);
    expect(fs.readFileSync(path.join(ROOT, 'scripts', 'verify-smoke-boot.js'), 'utf8')).toMatch(/checkBoot/);
    expect(fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8')).toMatch(/SMOKE: BOOT /);
  });
  it('more than forty modules load after start-up, and none is also a blocking tag', () => {
    expect(sb.lateModules(ROOT).length).toBeGreaterThanOrEqual(40);
    expect(sb.measure(ROOT).scripts).toBeLessThanOrEqual(677);
  });
});
