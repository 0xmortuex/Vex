const harness = require('./lib/probe-harness');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

async function launch(profile, phase) {
  return new Promise((resolve, reject) => {
    // The harness forces VEX_NO_OS_SCHEDULE=1 (the fresh profile's weekly-review
    // reminder used to register a real Windows task on every run) and stops
    // only the process it started.
    const probe = harness.launch({
      exe: process.env.VEX_SMOKE_EXECUTABLE || undefined,
      args: [...(process.env.VEX_SMOKE_EXECUTABLE ? [] : ['.']), '--user-data-dir=' + profile],
      cwd: path.resolve(__dirname, '..'),
      env: { VEX_SMOKE: '1', VEX_RESTART_PHASE: phase, VEX_SKIP_VMP_VERIFY: '1' },
    });
    const child = probe.child;
    let output = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { harness.stopOwned(probe); } catch (err) { reject(err); } }, 60000);
    const collect = chunk => { output = (output + chunk).slice(-100000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      if (!timedOut && code === 0 && /SMOKE: PASS/.test(output)) resolve();
      else reject(new Error(phase + ' failed: ' + output.slice(-3000)));
    });
  });
}
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-restart-'));
  try {
    await launch(profile, 'seed');
    await launch(profile, 'verify');
    console.log('PASS: two-process restart preserved tab identity/pin and preference deletion');
  } finally {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
