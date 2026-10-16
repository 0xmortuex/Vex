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
