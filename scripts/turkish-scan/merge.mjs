// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
// Merge result files (dedupe by kind+text, first surface wins), print per-surface counts, write merged.json
import fs from 'node:fs';
import path from 'node:path';
import { TL, OUT, lookupTr, trValues } from './lib.mjs';
import { looksEnglish } from './english.mjs';
const files = process.argv.slice(2);
const seen = new Map();
for (const f of files) {
  for (const it of JSON.parse(fs.readFileSync(path.join(OUT, f)))) {
    const key = (it.k === 'text' ? 'text' : 'attr') + '|' + it.t;   // an attribute and a text with the same words are one string
    if (seen.has(key)) continue;
    // re-classify with the current table + detector (so reruns after a fix show the improvement)
    if (!looksEnglish(it.t) || trValues.has(it.t)) continue;
    const tr = lookupTr(it.t);
    it.cls = tr != null && tr !== it.t ? 'table-not-applied' : 'no-entry';
    seen.set(key, it);
  }
}
const all = [...seen.values()];
const by = new Map();
for (const it of all) { const k = it.surface.replace(/\s*\(.*$/, '').replace(/ step \d+.*/, ' (steps)'); by.set(k, (by.get(k) || 0) + 1); }
console.log('UNIQUE ENGLISH STRINGS:', all.length, ' table-not-applied:', all.filter(x => x.cls === 'table-not-applied').length, ' out-of-scope:', all.filter(x => !x.sc).length);
for (const [k, v] of [...by].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);
fs.writeFileSync(path.join(OUT, 'merged.json'), JSON.stringify(all, null, 1));
