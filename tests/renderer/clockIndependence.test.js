// Tests that depend on the time of day.
//
// One of these went red at midnight: schedulerEngine pinned "now" to 11:00 of
// the current day while the code under test stamped its own timestamps from the
// real clock, so the two disagreed between 00:00 and 09:00 and the suite failed
// for no reason but the hour it ran.
//
// A test that only fails at 3am is worse than one that always fails, so this
// looks for the shape of that mistake across the suite: a test that builds a
// specific time of day out of the CURRENT date without pinning the clock.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TESTS = path.join(__dirname, '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(TESTS, p).split(path.sep).join('/');

describe('the suite does not depend on when it is run', () => {
  it('never sets a fixed hour on the current date without pinning the clock', () => {
    const offenders = [];
    for (const file of walk(TESTS)) {
      if (rel(file) === 'renderer/clockIndependence.test.js') continue;
      const src = fs.readFileSync(file, 'utf8');

      // `new Date()` with no argument is "now"; setHours on it builds a time of
      // day relative to whenever the suite happens to run.
      const usesNowThenSetsHour = /new Date\(\s*\)[\s\S]{0,200}?\.setHours\s*\(/.test(src)
        || /\.setHours\s*\([\s\S]{0,80}?\)/.test(src) && /new Date\(\s*\)/.test(src);
      if (!usesNowThenSetsHour) continue;

      // Pinning the clock makes it deterministic again, whichever way.
      const pinned = /vi\.setSystemTime|useFakeTimers|MockDate|vi\.spyOn\(Date/.test(src);
      if (!pinned) offenders.push(rel(file));
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  }, 30000);

  it('finds the pattern it is looking for, so it cannot pass by doing nothing', () => {
    // The guard above is only worth having if it would actually fire. This is
    // the exact shape that broke, checked against the matcher itself.
    const bad = 'const now = new Date();\nnow.setHours(11, 0, 0, 0);\nrun(now.getTime());';
    const usesNowThenSetsHour = /new Date\(\s*\)[\s\S]{0,200}?\.setHours\s*\(/.test(bad);
    expect(usesNowThenSetsHour).toBe(true);
    expect(/vi\.setSystemTime|useFakeTimers/.test(bad)).toBe(false);
  });

  it('the scheduler suite that broke is pinned now', () => {
    const src = fs.readFileSync(path.join(TESTS, 'renderer', 'schedulerEngine.test.js'), 'utf8');
    expect(src).toMatch(/vi\.setSystemTime/);
    // Only Date is faked — faking the timers stops the run queue draining.
    expect(src).toMatch(/toFake:\s*\['Date'\]/);
  });
});
