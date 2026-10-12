#!/usr/bin/env node
// Runs before `rimraf dist` in the dist/publish scripts. The owner runs
// dist\win-unpacked\Vex.exe day to day; deleting that folder under a running
// copy fails partway (EBUSY) or leaves a half-deleted app. So this stops the
// build, with a clear message, while a Vex.exe from dist\ is running.
//
// It stops instead of building somewhere else on purpose: the freshly built
// dist\win-unpacked is the copy that gets run next, and every later publish
// step (verify-packaged-boot, upload-release) reads dist\.
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

// The executable paths (from `paths`) that live inside `distDir`.
function runningFrom(paths, distDir) {
  const prefix = path.resolve(distDir).toLowerCase() + path.sep;
  return paths.filter(p => typeof p === 'string' && p && path.resolve(p).toLowerCase().startsWith(prefix));
}

// Full paths of every running Vex.exe (Windows only; elsewhere there is none).
function runningVexPaths() {
  if (process.platform !== 'win32') return [];
  const out = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='Vex.exe'\" | ForEach-Object { $_.ExecutablePath }",
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function main() {
  const dist = path.join(root, 'dist');
  const busy = runningFrom(runningVexPaths(), dist);
  if (busy.length) {
    console.error('check-dist-free: Vex is running from ' + dist + ' (' + [...new Set(busy)].join(', ') + ').');
    console.error('check-dist-free: close it first — the build deletes and rebuilds that folder.');
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { runningFrom };
