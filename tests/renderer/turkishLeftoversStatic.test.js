// The count of English-looking user-visible strings with no Turkish entry, per file, may go down and never up.
//
// scripts/scan-turkish-leftovers.js reads the renderer's string literals (what is put in textContent / title / placeholder /
// aria-label, toast and dialog texts, the words between tags in markup) and keeps those that read as English and that
// VexI18nUI.lookup(text, 'tr') cannot translate. tests/renderer/turkishLeftoversBaseline.json holds today's counts.
//
//   - a file whose count went UP fails: a new English text was added without a Turkish entry. Add the Turkish to the `tr` table
//     of js/i18n-ui.js (the exact English string is the key), or see the string with
//         node scripts/scan-turkish-leftovers.js --file <name>
//   - a file whose count went DOWN is fine; shrink the baseline when you like (VEX_L10N_WRITE=1 npx vitest run <this file>)
//
// This is the static half. The live half (it starts Vex in Turkish and reads every surface) is scripts/turkish-scan/.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
const scan = require('../../scripts/scan-turkish-leftovers.js');

describe('Turkish leftovers (static scan)', () => {
  const byFile = scan.scanStatic();
  const now = scan.counts(byFile);
  const total = Object.values(now).reduce((a, b) => a + b, 0);

  if (process.env.VEX_L10N_WRITE) {
    it('rewrites the baseline', () => {
      const sorted = Object.fromEntries(Object.entries(now).sort((a, b) => a[0].localeCompare(b[0])));
      fs.writeFileSync(scan.BASELINE, JSON.stringify({ note: 'English-looking user-visible literals with no Turkish entry, per file (scripts/scan-turkish-leftovers.js). May only shrink.', total, files: sorted }, null, 1) + '\n');
    });
    return;
  }

  const base = JSON.parse(fs.readFileSync(scan.BASELINE, 'utf8'));

  it('the scan sees the strings (a broken scan would pass everything)', () => {
    expect(total).toBeGreaterThan(500);
    expect(Object.keys(now).length).toBeGreaterThan(50);
  });

  it('no file has more English-looking strings than the baseline', () => {
    const grew = [];
    for (const [f, n] of Object.entries(now)) {
      const was = base.files[f] || 0;
      if (n > was) grew.push(`${f}: ${was} -> ${n}  (node scripts/scan-turkish-leftovers.js --file ${f.replace(/\.js$/, '')})`);
    }
    expect(grew, 'English text without a Turkish entry was added:\n' + grew.join('\n')).toEqual([]);
  });

  it('the total is reported', () => {
    console.log(`[turkish leftovers] ${total} English-looking strings with no entry in ${Object.keys(now).length} files (baseline ${base.total})`);
    expect(total).toBeLessThanOrEqual(base.total);
  });
});
