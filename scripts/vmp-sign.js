const { execSync } = require('child_process');

// Sign the packaged app for Widevine (castLabs Verified Media Path), and FAIL the
// build if the signer fell back to a development/cached signature.
//
// Why detect the fallback (not `verify-pkg`): without a valid VMP signature the
// component server withholds the software Widevine CDM and DRM playback silently
// breaks. `verify-pkg` proved unreliable as an in-build gate (it returned success
// in the build environment while failing standalone), so instead we scan
// `sign-pkg`'s OWN output for its fallback markers — "Certificate is valid for
// development only" / "Using cached signature" — which deterministically indicate
// the build is NOT validly signed for Widevine.
//
// Escape hatch: set VEX_SKIP_VMP_VERIFY=1 to build anyway (DRM will NOT work, but
// the build completes) — e.g. when you don't care about protected playback.
exports.default = async function (context) {
  const appOutDir = context.appOutDir;
  console.log('[VMP] signing:', appOutDir);

  let signOut = '';
  try {
    // Merge stderr→stdout so we capture the signer's markers regardless of stream.
    signOut = execSync(`python -m castlabs_evs.vmp sign-pkg "${appOutDir}" 2>&1`, { encoding: 'utf8' });
    process.stdout.write(signOut);
    console.log('[VMP] signing complete');
  } catch (err) {
    signOut = (err.stdout || '') + (err.stderr || '');
    if (signOut) process.stdout.write(signOut);
    console.error('[VMP] signing failed:', err.message);
    throw err;
  }

  const fellBack = /valid for development only/i.test(signOut) || /using cached signature/i.test(signOut);
  if (!fellBack) {
    console.log('[VMP] signed with a valid certificate — Widevine/DRM enabled');
    return;
  }

  if (process.env.VEX_SKIP_VMP_VERIFY === '1') {
    console.warn('[VMP] WARNING: signed with a development/cached fallback signature — DRM/Widevine will NOT work in this build. Continuing because VEX_SKIP_VMP_VERIFY=1.');
    return;
  }

  console.error('');
  console.error('[VMP] BUILD ABORTED — the signer fell back to a development/cached signature, so this build');
  console.error('      would ship with broken DRM (Spotify/Netflix won\'t play). To produce a DRM-capable build:');
  console.error('        1) python -m castlabs_evs.account reauth   (or `signup` if you have no account, then confirm via email)');
  console.error('        2) npm run dist:win');
  console.error('      To build WITHOUT DRM on purpose, set VEX_SKIP_VMP_VERIFY=1 and rebuild.');
  console.error('');
  throw new Error('VMP signing fell back to a development/cached signature — aborting to avoid shipping broken DRM.');
};
