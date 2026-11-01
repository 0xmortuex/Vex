// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
import fs from 'node:fs';
import path from 'node:path';
import { TL, OUT } from './lib.mjs';
const f = process.argv[2];
const filt = process.argv[3] ? new RegExp(process.argv[3]) : null;
const r = JSON.parse(fs.readFileSync(path.join(OUT, f))).filter(x => !filt || filt.test(x.surface));
const g = new Map();
for (const it of r) { const k = it.surface.slice(0, 30) + ' | ' + it.w; if (!g.has(k)) g.set(k, []); g.get(k).push(it); }
for (const [k, v] of [...g].sort((a, b) => b[1].length - a[1].length).slice(0, Number(process.argv[4] || 40))) {
  console.log(`${v.length}\t${k}\t${v.filter(x => x.cls === 'table-not-applied').length} tbl\t${v.filter(x => !x.sc).length} out-of-scope`);
  for (const it of v.slice(0, 3)) console.log('      ', it.k, '|', it.t.slice(0, 100));
}
