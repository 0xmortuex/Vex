// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
import fs from 'node:fs';
import path from 'node:path';
import { TL, OUT } from './lib.mjs';
const f = process.argv[2];
const r = JSON.parse(fs.readFileSync(path.join(OUT, f)));
const lim = Number(process.argv[3] || 200);
for (const it of r.slice(0, lim)) console.log(`${it.surface.slice(0, 28)} | ${it.cls === 'table-not-applied' ? 'TBL' : '---'} ${it.sc ? 'S' : 'o'} ${it.k} | ${it.t.slice(0, 110)}`);
console.log(r.length, 'total');
