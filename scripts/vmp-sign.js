const { execSync } = require('child_process');

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
exports.default = async function (context) {
  const appOutDir = context.appOutDir;
  const skip = process.env.VEX_SKIP_VMP_VERIFY === '1';
  const force = !skip; // real builds force a fresh sign; no-DRM builds use cache
  console.log('[VMP] signing:', appOutDir, force ? '(forcing fresh EVS signature)' : '(no-DRM / cached path)');

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
    console.log('[VMP] fresh EVS signature acquired — Widevine/DRM enabled');
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
