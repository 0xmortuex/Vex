// The Electron fuses Vex asks electron-builder to flip, defined once.
//
// OPT-IN. Release builds do NOT flip them (VEX_FUSES unset): castLabs EVS
// refused to VMP-sign a fused Vex.exe ("Binary signature denied", 2026-11-08),
// while the unfused v52.84.4 signed. CI sets VEX_FUSES=1 so the fused build is
// still produced and checked. RELEASING.md, "Electron fuses and app.asar
// integrity", says how to test a fused build against EVS.
//
// Used by scripts/code-signing.js (adds it to the electron-builder config) and
// scripts/verify-fuses.js (the expected state of a built exe).
'use strict';

const FUSES = Object.freeze({
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
});

// True only for VEX_FUSES=1 (exactly).
const fusesRequested = (env = process.env) => env.VEX_FUSES === '1';

module.exports = { FUSES, fusesRequested };
