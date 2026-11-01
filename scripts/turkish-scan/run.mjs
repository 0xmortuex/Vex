// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
// node scripts/turkish-scan/run.mjs [port]
//
// The live scan, start to end: starts Vex on a throwaway profile (VEX_NO_OS_SCHEDULE=1, one window, the debugging port only),
// walks the setup wizard in Turkish, visits Settings in Normal and Developer mode, the sidebar panels, Ctrl+K, the toolbar menus,
// the library, FAQ, pickers and dialogs, then merges the results: out/merged.json and a count per surface.
// Output goes to $TURKISH_SCAN_OUT (default: the temp folder, vex-turkish-scan).
// It stops ONLY the process it started (the PID is in run.json), after checking that its command line holds the throwaway profile.
// Read the result with: node scripts/turkish-scan/show.mjs merged.json   or   node scripts/turkish-scan/group.mjs merged.json
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = process.env.TURKISH_SCAN_OUT || path.join(os.tmpdir(), 'vex-turkish-scan');
const port = process.argv[2] || '10040';
const node = (f, ...a) => { const r = spawnSync(process.execPath, [path.join(here, f), ...a], { stdio: 'inherit', env: process.env }); if (r.status) console.log(f, 'exited', r.status); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

node('start.mjs', port);
await sleep(15000);
const run = JSON.parse(fs.readFileSync(path.join(OUT, 'run.json')));
try {
  node('wizard.mjs', 'full');
  for (const p of [1, 2, 3, 4, 5, 6]) node(`surfaces${p}.mjs`);
  node('merge.mjs', 'wizard-full.json', 'part1.json', 'part2.json', 'part3.json', 'part4.json', 'part5.json', 'part6.json');
} finally {
  // stop only our own process: confirm its command line names our profile and port first
  const cmd = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${run.pid}").CommandLine`]).toString();
  if (cmd.includes(run.profile) && cmd.includes('--remote-debugging-port=' + run.port)) execFileSync('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${run.pid} -Force`]);
  else console.log('NOT stopping pid', run.pid, '- its command line is not ours. Stop it yourself.');
  console.log('delete the throwaway profile when done:', run.profile);
}
