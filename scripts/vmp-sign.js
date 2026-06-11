const { execSync } = require('child_process');

exports.default = async function (context) {
  const appOutDir = context.appOutDir;
  console.log('[VMP] signing:', appOutDir);
  try {
    execSync(`python -m castlabs_evs.vmp sign-pkg "${appOutDir}"`, {
      stdio: 'inherit',
    });
    console.log('[VMP] signing complete');
  } catch (err) {
    console.error('[VMP] signing failed:', err.message);
    throw err;
  }
};
