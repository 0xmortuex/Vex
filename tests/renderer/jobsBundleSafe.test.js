// js/jobs.js runs while other files load (every VexJobs.every(...) at load arms its timer and asks heldBecause()).
// In the packaged window the scripts are bundled (scripts/window-bundle.js), so a const of a later file in the same
// chunk is "declared but not initialised" at that moment, and `typeof thatConst` THROWS. window.X is safe: a module
// sets it only when it is done. The 2026-10-17 packaged build lost 459 modules to `typeof GameWarmdown` here.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('jobs.js reads the modules it consults through window', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/jobs.js'), 'utf8');
  for (const name of ['GameWarmdown', 'GameMode', 'CommitGuard', 'BatteryMode', 'VexBreaker', 'VexCost']) {
    it(name + ' is never the operand of a bare typeof', () => {
      expect(text).not.toMatch(new RegExp('typeof ' + name + '\\b'));
    });
  }
});
