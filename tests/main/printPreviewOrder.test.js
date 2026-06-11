// Pin the load order in src/main.js: the print-preview command-line switches
// MUST be applied BEFORE any other touch of `app.*`, because Chromium freezes
// its feature list on the first app.* access. Regression context (commit
// 41c001f → b087ffb): the `enable-print-preview` switch was originally placed
// AFTER `console.log('[Vex URL] isPackaged:', app.isPackaged)`, which silently
// disabled the rich preview UI in packaged builds. Hoisting the switch fixed
// it; this test stops it from sliding back down.
//
// Static source-text test (not a runtime test) because src/main.js requires
// the real electron module, which isn't loadable in vitest's node env.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = resolve(__dirname, '../../src/main.js');
const mainSrc = readFileSync(mainPath, 'utf8');

// Strip // line-comments per line so phrases like "reading app.isPackaged
// silently disabled..." inside a doc comment don't trip the ordering check.
// We do not strip /* */ block comments — main.js doesn't use them around
// these areas, and the simple stripper avoids the cost of a real parser.
function stripLineComment(line) {
  // Only honour '//' that isn't inside a string. Cheap heuristic: walk the
  // line and bail out on the first '//' not preceded by ' or ".
  let inSingle = false, inDouble = false, inBacktick = false;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (c === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (c === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (c === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;
    else if (c === '/' && line[i + 1] === '/' && !inSingle && !inDouble && !inBacktick) {
      return line.slice(0, i);
    }
  }
  return line;
}
const lines = mainSrc.split(/\r?\n/).map(stripLineComment);

// Returns the 1-based line number of the FIRST line matching `re`, or
// Number.POSITIVE_INFINITY if not found (so "switch comes before X" still
// passes when X happens to be absent — the test fails on actual ordering, not
// on missing checks).
function firstLine(re) {
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return Number.POSITIVE_INFINITY;
}

describe('main.js — print-preview switch ordering invariant', () => {
  it('appendSwitch("enable-print-preview") is present', () => {
    expect(mainSrc).toMatch(/appendSwitch\(\s*['"]enable-print-preview['"]\s*\)/);
  });

  it('appendSwitch("enable-features", "PrintPreview") is present', () => {
    expect(mainSrc).toMatch(/appendSwitch\(\s*['"]enable-features['"]\s*,\s*['"]PrintPreview['"]\s*\)/);
  });

  // The actual regression: BOTH switches must come before ANY runtime read of
  // `app.*` that would trigger Chromium's feature-list init. The
  // `appendSwitch` calls themselves go through `app.commandLine`, but
  // `commandLine` is a special pre-init API surface and does not lock
  // features — that's the whole reason it exists.
  const printPreviewLine     = () => firstLine(/appendSwitch\(\s*['"]enable-print-preview['"]/);
  const printFeatureFlagLine = () => firstLine(/appendSwitch\(\s*['"]enable-features['"]\s*,\s*['"]PrintPreview['"]/);

  // Forbidden "first app.* access" patterns. We exclude `app.commandLine` (the
  // pre-init surface) and `app.on('will-quit', ...)` because attaching event
  // listeners is not a feature-list trigger — only event firing would be.
  // What IS a trigger: reading `app.isPackaged`, calling `app.whenReady()`,
  // calling `app.requestSingleInstanceLock()`, etc.
  const triggerPatterns = [
    { name: 'app.isPackaged read',                  re: /app\.isPackaged/ },
    { name: 'app.whenReady() call',                  re: /app\.whenReady\s*\(/ },
    { name: 'app.requestSingleInstanceLock() call',  re: /app\.requestSingleInstanceLock\s*\(/ },
    { name: 'app.getPath(...) call',                 re: /app\.getPath\s*\(/ },
    { name: 'app.setAppUserModelId(...) call',       re: /app\.setAppUserModelId\s*\(/ },
  ];

  for (const t of triggerPatterns) {
    it(`appendSwitch("enable-print-preview") precedes the first ${t.name}`, () => {
      const switchLine = printPreviewLine();
      const triggerLine = firstLine(t.re);
      expect(
        switchLine,
        `enable-print-preview switch (line ${switchLine}) must come BEFORE ${t.name} (line ${triggerLine}). ` +
        `Chromium freezes its feature list on first app.* access — moving the switch below this line silently disables print preview.`,
      ).toBeLessThan(triggerLine);
    });

    it(`appendSwitch("enable-features", "PrintPreview") precedes the first ${t.name}`, () => {
      const switchLine = printFeatureFlagLine();
      const triggerLine = firstLine(t.re);
      expect(
        switchLine,
        `enable-features=PrintPreview (line ${switchLine}) must come BEFORE ${t.name} (line ${triggerLine}).`,
      ).toBeLessThan(triggerLine);
    });
  }

  it('both print-preview switches sit in the file header (line ≤ 25)', () => {
    // Belt-and-suspenders: even if no other app.* calls existed, putting the
    // switches near the top of the file is the contract a reader would expect
    // from the comment in main.js. If someone moves them deep into a function,
    // this test fails loudly.
    expect(printPreviewLine()).toBeLessThanOrEqual(25);
    expect(printFeatureFlagLine()).toBeLessThanOrEqual(25);
  });
});
