#!/usr/bin/env node
// Check that a PACKAGED Vex has the Electron fuses scripts/lib/fuse-config.js
// asks for, and that its app.asar matches the integrity record built into Vex.exe.
//
//   node scripts/verify-fuses.js [<folder holding Vex.exe, default dist/win-unpacked>]
//
// OPT-IN: fuses are only built in (and so only checked) when VEX_FUSES=1.
// Release builds leave them off because castLabs EVS denied a fused Vex.exe
// (RELEASING.md, "Electron fuses and app.asar integrity"). With VEX_FUSES unset
// this prints one line and passes. CI sets VEX_FUSES=1.
//
// Why: Vex installs per user, into a folder the user (and any program running
// as the user) can write to. Without fuses, same-user malware can edit
// resources/app.asar, or run Vex.exe as a plain Node interpreter
// (ELECTRON_RUN_AS_NODE=1) and execute anything under Vex's name. The fuses
// (scripts/lib/fuse-config.js, flipped by electron-builder when VEX_FUSES=1) close those
// doors; this script proves the BUILT exe really has them, since a silently
// ignored option would leave the doors open with no sign.
//
// ORDER (castLabs / Widevine). electron-builder flips the fuses in doPack,
// right BEFORE it Authenticode-signs, and afterSign (scripts/vmp-sign.js, the
// castLabs VMP signature = SHA-512 of the whole Vex.exe) runs after that. So
// the fuse state is part of what gets signed and nothing here modifies the exe.
// This script only READS. Run it after the build (it is part of
// verify-packaged-boot.js); it never writes anything.
//
// Dev tooling is unaffected: fuses exist only in a packaged exe, so
// `npm start` / `npm test` / the probes (ELECTRON_RUN_AS_NODE on node_modules'
// electron.exe) behave exactly as before.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { FUSES, fusesRequested } = require('./lib/fuse-config');

const root = path.join(__dirname, '..');

// package.json option name -> index in the fuse wire (@electron/fuses FuseV1Options).
const FUSE_INDEX = Object.freeze({
  runAsNode: 0,
  enableCookieEncryption: 1,
  enableNodeOptionsEnvironmentVariable: 2,
  enableNodeCliInspectArguments: 3,
  enableEmbeddedAsarIntegrityValidation: 4,
  onlyLoadAppFromAsar: 5,
  loadBrowserProcessSpecificV8Snapshot: 6,
  grantFileProtocolExtraPrivileges: 7,
});
const ENABLE = 49, DISABLE = 48;   // FuseState

// The fuses the build is configured to set (only these are checked): the shared set.
function expectedFuses(cfg = FUSES) {
  if (!cfg || typeof cfg !== 'object') throw new Error('no fuse configuration, so the packaged app would keep every fuse at its default.');
  const out = {};
  for (const [name, value] of Object.entries(cfg)) {
    if (name === 'resetAdHocDarwinSignature') continue;
    if (!(name in FUSE_INDEX)) throw new Error('fuse ' + name + ' is not a fuse electron-builder knows.');
    if (typeof value !== 'boolean') throw new Error('fuse ' + name + ' must be true or false.');
    out[name] = value;
  }
  return out;
}

// Differences between the wire read from an exe and what was asked for. [] = fine.
function compareFuses(wire, expected) {
  const problems = [];
  for (const [name, want] of Object.entries(expected)) {
    const state = wire[FUSE_INDEX[name]];
    if (state !== ENABLE && state !== DISABLE) problems.push(`${name}: this Electron has no such fuse (state ${state})`);
    else if ((state === ENABLE) !== want) problems.push(`${name} is ${state === ENABLE ? 'ON' : 'OFF'} in the built exe, but the fuse configuration wants ${want ? 'ON' : 'OFF'}`);
  }
  return problems;
}

// SHA-256 (hex) of an asar's header string: what electron-builder records and Electron validates.
function asarHeaderHash(asarFile) {
  const { headerString } = require('@electron/asar/lib/disk').readArchiveHeaderSync(asarFile);
  return crypto.createHash('sha256').update(headerString).digest('hex');
}

// The INTEGRITY/ELECTRONASAR record electron-builder writes into the exe: [{ file, alg, value }].
function readIntegrityRecord(exeFile) {
  const { NtExecutable, NtExecutableResource } = require('resedit');
  const resources = NtExecutableResource.from(NtExecutable.from(fs.readFileSync(exeFile)));
  const entry = resources.entries.find(e => String(e.type) === 'INTEGRITY' && String(e.id) === 'ELECTRONASAR');
  if (!entry) return null;
  return JSON.parse(Buffer.from(entry.bin).toString('utf8'));
}

const NOT_REQUESTED = 'verify-fuses: fuses not requested (VEX_FUSES unset): not checked';

async function check(appDir, cfg = FUSES, env = process.env) {
  if (!fusesRequested(env)) return { ok: true, skipped: true, problems: [], expected: {} };
  const problems = [];
  const exe = path.join(appDir, 'Vex.exe');
  if (!fs.existsSync(exe)) throw new Error(exe + ' does not exist: build first');
  const expected = expectedFuses(cfg);
  const { getCurrentFuseWire } = require('@electron/fuses');
  problems.push(...compareFuses(await getCurrentFuseWire(exe), expected));

  if (expected.enableEmbeddedAsarIntegrityValidation) {
    const record = readIntegrityRecord(exe);
    const asar = path.join(appDir, 'resources', 'app.asar');
    if (!record) problems.push('Vex.exe has no ELECTRONASAR integrity record, so Electron has nothing to validate app.asar against (and with the fuse on it would refuse to start)');
    else if (!fs.existsSync(asar)) problems.push('resources/app.asar is missing');
    else {
      const mine = record.find(r => String(r.file).replace(/\\/g, '/') === 'resources/app.asar');
      const actual = asarHeaderHash(asar);
      if (!mine) problems.push('the integrity record in Vex.exe does not list resources/app.asar');
      else if (String(mine.alg).toUpperCase() !== 'SHA256' || mine.value !== actual) problems.push('the integrity record in Vex.exe does not match resources/app.asar (the asar was changed after the exe was prepared)');
    }
  }
  if (expected.onlyLoadAppFromAsar && fs.existsSync(path.join(appDir, 'resources', 'app'))) {
    problems.push('resources/app exists next to app.asar; with onlyLoadAppFromAsar it would be ignored, which hides a packaging mistake');
  }
  return { ok: problems.length === 0, problems, expected };
}

async function main() {
  const appDir = path.resolve(process.argv[2] || path.join(root, 'dist', 'win-unpacked'));
  const r = await check(appDir);
  if (r.skipped) { console.log(NOT_REQUESTED); return; }
  if (!r.ok) {
    console.error('verify-fuses: the packaged app does not have the protections the fuse configuration asks for:');
    for (const p of r.problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('verify-fuses: ' + Object.entries(r.expected).map(([k, v]) => `${k}=${v}`).join(', ') + ' -- all present in ' + path.join(appDir, 'Vex.exe'));
}

if (require.main === module) {
  main().catch(err => { console.error('verify-fuses: ' + ((err && err.message) || err)); process.exit(1); });
}

module.exports = { NOT_REQUESTED, FUSE_INDEX, expectedFuses, compareFuses, asarHeaderHash, readIntegrityRecord, check, ENABLE, DISABLE };
