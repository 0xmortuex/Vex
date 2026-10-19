#!/usr/bin/env node
// Refuses a heavy run (package build, full test suite, check:ui) while the
// owner is gaming or the PC is short of memory (T0-006).
//
// Why: 2026-10-14 a MEMORY_MANAGEMENT BSOD, and 2026-10-15 an electron-builder
// run died of commit exhaustion while Marvel Rivals ran. Both were avoidable by
// looking first.
//
//   node scripts/heavy-gate.js <label> [--force] [--dry]
//
// Called from the npm scripts (pretest, dist, dist:win, pack, publish,
// check:ui). It only READS: a process list (tasklist) and two memory numbers
// (Win32_OperatingSystem). It never closes anything.
//
// Refuses (exit 2) when
//   * a game process is running (list below, plus VEX_GATE_EXTRA_GAMES=a.exe,b.exe),
//   * free physical memory is under VEX_GATE_MIN_PHYS_GB (default 6), or
//   * free commit (virtual) memory is under VEX_GATE_MIN_COMMIT_GB (default 10).
//
// Override, knowingly: --force, VEX_HEAVY_FORCE=1, or `npm run <script> --force`
// (npm sets npm_config_force). CI (CI=true) is skipped: a runner has no game.
// A failure to measure (tasklist or PowerShell broke) is an error, not a pass.
'use strict';

const { spawnSync } = require('child_process');

const GAMES = [
  /^RobloxPlayerBeta\.exe$/i,
  /^cs2\.exe$/i,
  /^csgo\.exe$/i,
  /^Marvel(?:Rivals)?[-\w]*\.exe$/i,
  /^ArcRaiders[-\w]*\.exe$/i,
  /^PioneerGame[-\w]*\.exe$/i,
  /-Win64-Shipping\.exe$/i,
  /^VALORANT[-\w]*\.exe$/i,
  /^FortniteClient[-\w]*\.exe$/i,
  /^GTA5\.exe$/i,
  /^eldenring\.exe$/i,
  /^Overwatch\.exe$/i,
];

const GB = 1024 * 1024; // KB per GB

function gamesRunning(processNames, extra = []) {
  const extras = extra.map(s => s.trim().toLowerCase()).filter(Boolean);
  const found = new Set();
  for (const name of processNames) {
    if (GAMES.some(re => re.test(name)) || extras.includes(String(name).toLowerCase())) found.add(name);
  }
  return [...found];
}

// mem: { freePhysKB, freeCommitKB }. Returns { ok, reasons }.
function evaluate({ processNames, mem, minPhysGB = 6, minCommitGB = 10, extraGames = [] }) {
  const reasons = [];
  const games = gamesRunning(processNames, extraGames);
  if (games.length) reasons.push('a game is running (' + games.join(', ') + ')');
  const phys = mem.freePhysKB / GB, commit = mem.freeCommitKB / GB;
  if (phys < minPhysGB) reasons.push(`free physical memory is ${phys.toFixed(1)} GB (needs ${minPhysGB} GB)`);
  if (commit < minCommitGB) reasons.push(`free committed memory is ${commit.toFixed(1)} GB (needs ${minCommitGB} GB)`);
  return { ok: reasons.length === 0, reasons, physGB: phys, commitGB: commit };
}

// Memory per program from `tasklist /FO CSV /NH` rows ("Image","PID","Session","Session#","1,234 K"): the programs
// holding the most working-set memory, each summed over its processes, so a refusal can say what to close.
function topMemoryUsers(tasklistText, n = 5) {
  const byName = new Map();
  for (const line of String(tasklistText).split(/\r?\n/)) {
    const f = line.match(/"([^"]*)"/g);
    if (!f || f.length < 5) continue;
    const name = f[0].slice(1, -1), kb = Number(f[4].replace(/[^\d]/g, ''));
    if (!name || !Number.isFinite(kb)) continue;
    const cur = byName.get(name) || { name, kb: 0, count: 0 };
    cur.kb += kb; cur.count += 1;
    byName.set(name, cur);
  }
  return [...byName.values()].sort((a, b) => b.kb - a.kb).slice(0, n)
    .map(p => `${p.name} ${(p.kb / GB).toFixed(1)} GB${p.count > 1 ? ' (' + p.count + ' processes)' : ''}`);
}

function listProcessNames() {
  const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error('heavy-gate: could not list processes: ' + ((r.error && r.error.message) || r.stderr));
  return r.stdout.split(/\r?\n/).map(l => { const m = l.match(/^"([^"]+)"/); return m ? m[1] : ''; }).filter(Boolean);
}

function readMemory() {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$o = Get-CimInstance Win32_OperatingSystem; "$($o.FreePhysicalMemory) $($o.FreeVirtualMemory)"'], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error('heavy-gate: could not read memory: ' + ((r.error && r.error.message) || r.stderr));
  const m = r.stdout.trim().match(/^(\d+)\s+(\d+)$/);
  if (!m) throw new Error('heavy-gate: unexpected memory answer: ' + r.stdout.trim());
  return { freePhysKB: Number(m[1]), freeCommitKB: Number(m[2]) };
}

function wantsForce(argv, env) {
  return argv.includes('--force') || env.VEX_HEAVY_FORCE === '1' || env.npm_config_force === 'true';
}

function main(argv = process.argv.slice(2), env = process.env) {
  const label = argv.find(a => !a.startsWith('--')) || 'heavy run';
  if (env.CI) { console.log(`heavy-gate: ${label}: CI, skipped`); return 0; }
  if (process.platform !== 'win32') { console.log(`heavy-gate: ${label}: not Windows, skipped`); return 0; }
  const verdict = evaluate({
    processNames: listProcessNames(),
    mem: readMemory(),
    minPhysGB: Number(env.VEX_GATE_MIN_PHYS_GB) || 6,
    minCommitGB: Number(env.VEX_GATE_MIN_COMMIT_GB) || 10,
    extraGames: String(env.VEX_GATE_EXTRA_GAMES || '').split(','),
  });
  if (verdict.ok) {
    console.log(`heavy-gate: ${label}: ok (${verdict.physGB.toFixed(1)} GB free, ${verdict.commitGB.toFixed(1)} GB commit free, no game)`);
    return 0;
  }
  const force = wantsForce(argv, env);
  const msg = `heavy-gate: ${label} refused: ${verdict.reasons.join('; ')}.`;
  if (force) { console.warn(msg + ' --force given: running anyway.'); return 0; }
  console.error(msg);
  if (verdict.reasons.some(r => /memory/.test(r))) {
    const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (!r.error && r.status === 0) console.error('heavy-gate: using the most memory now: ' + topMemoryUsers(r.stdout).join(', ') + '. Closing some of these frees memory; this gate never closes anything.');
  }
  console.error('heavy-gate: a build or full test run beside a game can crash it or the PC (BSOD 2026-10-14). Wait until the game is closed.');
  console.error('heavy-gate: to run anyway: add --force (npm run <script> --force), or set VEX_HEAVY_FORCE=1.');
  return 2;
}

module.exports = { evaluate, gamesRunning, wantsForce, topMemoryUsers, GAMES };

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (err) { console.error(err.message); process.exitCode = 1; }
}
