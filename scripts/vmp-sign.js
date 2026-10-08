const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const codeSigning = require('./code-signing');

// Sign the packaged app for Widevine (castLabs Verified Media Path), and FAIL the
// build if the signer fell back to a development/cached signature.
//
// How we gate: for a real (DRM) build we FORCE a fresh online signature
// (`sign-pkg -f`) and require positive proof it was issued — the signer prints
// "Signature request successful". We do NOT treat "Using cached signature" as a
// failure: confirmed 2026-06-17 that the cached path can reuse a perfectly VALID
// EVS signature (verify-pkg → "Signature is valid: streaming, … days left"), so
// the old substring check false-aborted real builds. Forcing the sign sidesteps
// the cache entirely and makes the gate deterministic. The remaining hard-failure
// marker is "Certificate is valid for development only" (a dev-tier cert).
//
// Escape hatch: set VEX_SKIP_VMP_VERIFY=1 for an intentional no-DRM build — it
// uses the fast cached path and warns instead of aborting. (DRM will NOT work.)
//
// Code signing (scripts/code-signing.js): electron-builder has already
// Authenticode-signed every .exe in the app folder when this runs. The VMP
// signature is a SHA-512 of the whole Vex.exe, so it has to come after that.
// When signing is configured, Vex.exe must already carry the signature here
// (else the build stops, before castLabs is asked), and Vex.exe must be byte
// for byte the same after VMP signing as before it.
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function requireAuthenticode(exe, setup, when) {
  const offline = process.env.ELECTRON_BUILDER_OFFLINE === 'true';
  const result = await codeSigning.checkSigned([{ name: path.basename(exe), file: exe }], setup, codeSigning.signatureReader(), { offline });
  for (const line of result.lines) console.log('[Sign]' + line.replace(/^ +/, ' '));
  if (!result.ok) {
    throw new Error(`[Sign] ${path.basename(exe)} is not signed as configured ${when}: ${result.problems.join('; ')}`);
  }
}

exports.default = async function (context) {
  const appOutDir = context.appOutDir;
  const exe = path.join(appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const setup = codeSigning.setupFromEnv(process.env);
  if (setup.mode !== 'none') {
    await requireAuthenticode(exe, setup, 'before VMP signing');
    console.log(`[Sign] ${path.basename(exe)} is Authenticode-signed; VMP signing comes after it (castLabs: the VMP signature covers the whole .exe)`);
  }
  const skip = process.env.VEX_SKIP_VMP_VERIFY === '1';
  if (skip) {
    console.warn('[VMP] Explicit no-DRM test build: signing skipped. Not a release artifact.');
    return;
  }
  const force = !skip; // real builds force a fresh sign; no-DRM builds use cache
  console.log('[VMP] signing:', appOutDir, force ? '(forcing fresh EVS signature)' : '(no-DRM / cached path)');

  const exeBefore = sha256(exe);
  let signOut = '';
  try {
    // Merge stderr→stdout so we capture the signer's markers regardless of stream.
    signOut = execSync(`python -m castlabs_evs.vmp sign-pkg ${force ? '-f ' : ''}"${appOutDir}" 2>&1`, { encoding: 'utf8' });
    process.stdout.write(signOut);
    console.log('[VMP] signing complete');
  } catch (err) {
    signOut = (err.stdout || '') + (err.stderr || '');
    if (signOut) process.stdout.write(signOut);
    console.error('[VMP] signing failed:', err.message);
    throw err;
  }

  if (skip) {
    console.warn('[VMP] WARNING: no-DRM build (VEX_SKIP_VMP_VERIFY=1) — DRM/Widevine will NOT work in this build.');
    return;
  }

  // Real build: require a freshly-issued, non-dev signature.
  const freshOk = /signature request successful/i.test(signOut);
  const devOnly = /valid for development only/i.test(signOut);
  if (freshOk && !devOnly) {
    // A fresh signature was REQUESTED — but that alone does NOT prove the shipped
    // binary still matches it. Verify the packaged signature as the authoritative
    // final gate. (v2.29.4 shipped broken DRM because the signer ran as `afterPack`,
    // BEFORE Authenticode re-wrote Vex.exe: the "success" marker printed yet a
    // standalone verify-pkg failed. Running verify-pkg here — last — makes shipping
    // an invalid signature impossible.)
    let verifyOut = '';
    try {
      verifyOut = execSync(`python -m castlabs_evs.vmp verify-pkg "${appOutDir}" 2>&1`, { encoding: 'utf8' });
      process.stdout.write(verifyOut);
    } catch (err) {
      verifyOut = (err.stdout || '') + (err.stderr || '');
      if (verifyOut) process.stdout.write(verifyOut);
    }
    if (!/signature is valid/i.test(verifyOut)) {
      console.error('');
      console.error('[VMP] BUILD ABORTED — a signature was issued but verify-pkg did NOT confirm it on the');
      console.error('      packaged app. Something re-wrote the binary after signing — check the hook order:');
      console.error('      VMP signing MUST run as electron-builder `afterSign`, never `afterPack` (afterPack');
      console.error('      runs before Authenticode, which invalidates the signature). Refusing to ship broken DRM.');
      console.error('');
      throw new Error('VMP post-sign verify-pkg failed — packaged signature invalid, aborting.');
    }
    if (sha256(exe) !== exeBefore) {
      throw new Error(`[VMP] ${path.basename(exe)} changed during VMP signing — neither its Authenticode nor its VMP signature can be trusted, aborting.`);
    }
    if (setup.mode !== 'none') await requireAuthenticode(exe, setup, 'after VMP signing');
    console.log('[VMP] fresh EVS signature acquired AND verify-pkg confirmed valid — Widevine/DRM enabled');
    return;
  }

  console.error('');
  console.error('[VMP] BUILD ABORTED — did not obtain a fresh valid VMP signature, so this build');
  console.error('      would ship with broken DRM (Spotify/Netflix won\'t play). To produce a DRM-capable build:');
  console.error('        1) python -m castlabs_evs.account reauth   (or `signup` if you have no account, then confirm via email)');
  console.error('        2) npm run dist:win');
  console.error('      To build WITHOUT DRM on purpose, set VEX_SKIP_VMP_VERIFY=1 and rebuild.');
  console.error('');
  throw new Error('VMP signing did not produce a fresh valid signature — aborting to avoid shipping broken DRM.');
};
