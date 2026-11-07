// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const WT = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SP = process.env.TURKISH_SCAN_OUT || path.join(os.tmpdir(), 'vex-turkish-scan');
const port = Number(process.argv[2]);
fs.mkdirSync(SP, { recursive: true });
const profile = path.join(SP, `profile-turkish-leftovers-scan-${port}-${Date.now()}`);   // throwaway, delete it afterwards
const probeEnv = createRequire(import.meta.url)('../lib/probe-profile.js').prepare(profile).env;   // marks the throwaway profile (src/main/debug-guard.js)
const out = fs.openSync(path.join(SP, 'app.log'), 'a');
const child = spawn(path.join(WT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`],
  { cwd: WT, env: { ...process.env, ...probeEnv, VEX_NO_OS_SCHEDULE: '1' }, stdio: ['ignore', out, out], detached: true });
child.unref();
fs.writeFileSync(path.join(SP, 'run.json'), JSON.stringify({ pid: child.pid, port, profile }));
console.log('started', child.pid, port, profile);
