const { execSync } = require('child_process');

// Sign the packaged app for Widevine (castLabs Verified Media Path), then VERIFY
// the signature and FAIL the build if it's invalid.
//
// Why the verify step exists: without a valid VMP signature, castLabs/Google's
// component server refuses to deliver the software Widevine CDM, so DRM playback
// (Spotify/Netflix) silently breaks. This shipped unnoticed before because
// `vmp sign-pkg` falls back to an invalid cached signature ("Certificate is valid
// for development only") instead of erroring. Verifying after signing turns that
// silent failure into a loud build failure.
//
// Escape hatch: set VEX_SKIP_VMP_VERIFY=1 to build a knowingly-unsigned dev build
// (DRM will NOT work, but the build completes).
exports.default = async function (context) {
  const appOutDir = context.appOutDir;
  console.log('[VMP] signing:', appOutDir);
  try {
    execSync(`python -m castlabs_evs.vmp sign-pkg "${appOutDir}"`, { stdio: 'inherit' });
    console.log('[VMP] signing complete');
  } catch (err) {
    console.error('[VMP] signing failed:', err.message);
    throw err;
  }

  if (process.env.VEX_SKIP_VMP_VERIFY === '1') {
    console.warn('[VMP] VEX_SKIP_VMP_VERIFY=1 set — skipping signature verification. DRM/Widevine will NOT work in this build.');
    return;
  }

  console.log('[VMP] verifying signature…');
  try {
    execSync(`python -m castlabs_evs.vmp verify-pkg "${appOutDir}"`, { stdio: 'inherit' });
    console.log('[VMP] signature verified — Widevine/DRM enabled');
  } catch (err) {
    console.error('');
    console.error('[VMP] SIGNATURE VERIFICATION FAILED — this build would ship with broken DRM (Spotify/Netflix won\'t play).');
    console.error('[VMP] The packaged app is not validly Widevine (VMP) signed. To fix the castLabs EVS signing:');
    console.error('        1) python -m castlabs_evs.account reauth      (or `signup` if you have no account, then confirm via email)');
    console.error('        2) npm run dist:win                            (rebuild — it will sign with a valid certificate)');
    console.error('        3) python -m castlabs_evs.vmp verify-pkg "' + appOutDir + '"   (should now pass)');
    console.error('      To intentionally build WITHOUT DRM, set VEX_SKIP_VMP_VERIFY=1.');
    console.error('');
    throw new Error('VMP signature verification failed (InvalidSignature) — aborting build to avoid shipping broken DRM.');
  }
};
